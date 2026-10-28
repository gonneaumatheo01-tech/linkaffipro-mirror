/**
 * Synchronisation Link Affi → notre base (lecture seule côté Link Affi).
 * Voir docs/LINKAFFI-SYNC.md pour la correspondance, l'ordre et les curseurs.
 */
import {
  CURRENCY_RATES_SETTING_KEY,
  collectAffiliateCampaignIds,
  isOurPlayer,
  ngrDeltaEvent,
  revshareDayKey,
} from "@linkaffipro/core";
import { prisma, recordEvent, toJsonValue, type Prisma } from "@linkaffipro/db";
import { emitAutomationEvent } from "@linkaffipro/queue";
import {
  LinkAffiClient,
  PAGE_LIMIT,
  SYNC_TABLES,
  buildRateTable,
  computeWindow,
  cursorAfterPage,
  isTelegramCampaignRow,
  cursorAfterSuccess,
  mapCampaign,
  mapCasino,
  mapClick,
  mapDepositSnapshot,
  mapFtdInvalidation,
  mapPlayer,
  mapPlayerEvent,
  mapRevshareSnapshot,
  mapStat,
  ourAffiliateIds,
  keepUuidIds,
  statsDeepDue,
  statsQueries,
  windowQuery,
  type LaCampaign,
  type LaCasino,
  type LaClick,
  type LaCurrencyRate,
  type LaFtdInvalidation,
  type LaPlayer,
  type LaPlayerEvent,
  type LaPlayerFinancials,
  type LaSnapshot,
  type LaStat,
  type RateTable,
  type SubIdSource,
  type StatsCursor,
  type SyncCursor,
  type SyncTable,
} from "@linkaffipro/linkaffi";
import { logger } from "../logger";
import { markDailyStatsDirty } from "../stats/daily";
import {
  TELEGRAM_SYNC_NAME,
  syncTelegramCampaigns,
  telegramCampaignsDue,
} from "./linkaffi-telegram";
import { applyPlayerRow, diffCpaEvents, type ExistingPlayer } from "./player-apply";
import { reconcileAggregatePlayers } from "./aggregate-players";

type Db = typeof prisma;

export type SyncOptions = {
  full?: boolean;
  tables?: string[];
  now?: () => Date;
  client?: LinkAffiClient;
  db?: Db;
};
export type TableResult = {
  table: string;
  ok: boolean;
  rows: number;
  error?: string;
  skipped?: boolean;
};

const STALE_LOCK_MS = 30 * 60 * 1000;
const UNKNOWN_PROGRAM = "unknown";

/** Contexte partagé d'un passage : caches d'identifiants et taux. */
class SyncContext {
  rates: RateTable = { EUR: 1 };
  programIdByExternal = new Map<string, string>();
  campaignIdByExternal = new Map<string, string>();
  campaignProgramByCampaignId = new Map<string, string>();
  playerIdByLaId = new Map<string, string>();
  touchedPostIds = new Set<string>();
  /** Jours de Paris dont les commissions ont changé (CPA, revshare) : statistiques journalières à recalculer. */
  dirtyDays = new Set<string>();
  /** Lignes Telegram de `campaigns` vues par ce passage (phase 13) : jamais des offres, relues par la synchro Telegram. */
  telegramCampaignRows: LaCampaign[] = [];
  /** Offres Link Affi rattachées à nos campagnes (lu une fois par passage) : « nos » joueurs, voir `isOurPlayer`. */
  private ourOffers: Set<string> | null = null;
  constructor(
    public db: Db,
    public now: () => Date,
  ) {}

  async loadCaches() {
    const programs = await this.db.affiliateProgram.findMany({
      where: { source: "LINKAFFI" },
      select: { id: true, externalId: true },
    });
    for (const p of programs) if (p.externalId) this.programIdByExternal.set(p.externalId, p.id);
    const campaigns = await this.db.affiliateCampaign.findMany({
      select: { id: true, externalId: true, programId: true },
    });
    for (const c of campaigns) {
      this.campaignIdByExternal.set(c.externalId, c.id);
      this.campaignProgramByCampaignId.set(c.id, c.programId);
    }
  }

  async ourOfferIds(): Promise<Set<string>> {
    if (!this.ourOffers) {
      const campaigns = await this.db.campaign.findMany({ select: { affiliateCampaignIds: true } });
      this.ourOffers = new Set(collectAffiliateCampaignIds(campaigns));
    }
    return this.ourOffers;
  }

  async loadPlayerIds() {
    if (this.playerIdByLaId.size > 0) return;
    const players = await this.db.player.findMany({ select: { id: true, raw: true } });
    for (const p of players) {
      const laId = (p.raw as { id?: unknown } | null)?.id;
      if (typeof laId === "string") this.playerIdByLaId.set(laId, p.id);
    }
  }

  async ensureProgram(externalId: string | null): Promise<string> {
    const key = externalId ?? UNKNOWN_PROGRAM;
    const hit = this.programIdByExternal.get(key);
    if (hit) return hit;
    const p = await this.db.affiliateProgram.upsert({
      where: { source_externalId: { source: "LINKAFFI", externalId: key } },
      create: {
        source: "LINKAFFI",
        externalId: key,
        name: externalId ? `(programme ${externalId.slice(0, 8)})` : "(programme inconnu)",
        isActive: externalId !== null,
      },
      update: {},
      select: { id: true },
    });
    this.programIdByExternal.set(key, p.id);
    return p.id;
  }

  async ensureCampaign(
    externalId: string | null,
    programExternalId: string | null,
  ): Promise<string> {
    const key = externalId ?? `unknown:${programExternalId ?? UNKNOWN_PROGRAM}`;
    const hit = this.campaignIdByExternal.get(key);
    if (hit) return hit;
    const programId = await this.ensureProgram(programExternalId);
    const c = await this.db.affiliateCampaign.upsert({
      where: { programId_externalId: { programId, externalId: key } },
      create: {
        programId,
        externalId: key,
        name: externalId ? `(campagne ${externalId.slice(0, 8)})` : "(campagne inconnue)",
        trackingUrlTemplate: "",
        isActive: false,
      },
      update: {},
      select: { id: true },
    });
    this.campaignIdByExternal.set(key, c.id);
    this.campaignProgramByCampaignId.set(c.id, programId);
    return c.id;
  }

  /** Joueur par (programme, identifiant externe) — utilisé par les snapshots et invalidations. */
  async findPlayerByExternal(programExternalId: string, externalPlayerId: string) {
    const programId = this.programIdByExternal.get(programExternalId);
    if (!programId) return null;
    return this.db.player.findFirst({
      where: { externalPlayerId, affiliateCampaign: { programId } },
      select: {
        id: true,
        memberId: true,
        ngr: true,
        depositTotal: true,
        ftdAt: true,
        clickId: true,
      },
    });
  }
}

// ---------- Traitements par table ----------

async function handleCasinos(ctx: SyncContext, rows: LaCasino[]) {
  for (const row of rows) {
    const m = mapCasino(row);
    if (!m) continue;
    const p = await ctx.db.affiliateProgram.upsert({
      where: { source_externalId: { source: "LINKAFFI", externalId: m.externalId } },
      create: {
        source: "LINKAFFI",
        externalId: m.externalId,
        name: m.name,
        isActive: m.isActive,
        raw: toJsonValue(m.raw),
      },
      update: { name: m.name, isActive: m.isActive, raw: toJsonValue(m.raw) },
      select: { id: true },
    });
    ctx.programIdByExternal.set(m.externalId, p.id);
  }
}

async function handleCampaigns(ctx: SyncContext, rows: LaCampaign[]) {
  for (const row of rows) {
    // Campagne Telegram d'affilié (lien Link Affi vers un de nos canaux) : pas une offre.
    if (isTelegramCampaignRow(row)) {
      ctx.telegramCampaignRows.push(row);
      continue;
    }
    const m = mapCampaign(row);
    if (!m) continue;
    const programId = await ctx.ensureProgram(m.programExternalId);
    const c = await ctx.db.affiliateCampaign.upsert({
      where: { programId_externalId: { programId, externalId: m.externalId } },
      create: {
        programId,
        externalId: m.externalId,
        campaignKey: m.campaignKey,
        name: m.name,
        trackingUrlTemplate: m.trackingUrlTemplate,
        isActive: m.isActive,
        raw: toJsonValue(m.raw),
      },
      update: {
        campaignKey: m.campaignKey,
        name: m.name,
        trackingUrlTemplate: m.trackingUrlTemplate,
        raw: toJsonValue(m.raw),
      },
      select: { id: true },
    });
    ctx.campaignIdByExternal.set(m.externalId, c.id);
    ctx.campaignProgramByCampaignId.set(c.id, programId);
  }
}

async function handleCurrencyRates(ctx: SyncContext, rows: LaCurrencyRate[]) {
  ctx.rates = buildRateTable(rows);
  // Gardée pour la reprise `db:phase10:gains`, qui convertit les commissions avec la même table (rien n'est relu
  // chez Link Affi par la reprise).
  await ctx.db.setting.upsert({
    where: { key: CURRENCY_RATES_SETTING_KEY },
    create: { key: CURRENCY_RATES_SETTING_KEY, value: ctx.rates },
    update: { value: ctx.rates },
  });
}

/** Rattache un joueur à notre clic (sub-ID) : clickId, memberId ; retourne le postId touché. */
async function attachBySubId(
  ctx: SyncContext,
  playerId: string,
  subId: string | null,
): Promise<{ memberId: string | null; postId: string | null; clickId: string | null }> {
  if (!subId) return { memberId: null, postId: null, clickId: null };
  const click = await ctx.db.click.findUnique({
    where: { subId },
    select: { id: true, memberId: true, postId: true },
  });
  if (!click) return { memberId: null, postId: null, clickId: null };
  await ctx.db.player.update({
    where: { id: playerId },
    data: { clickId: click.id, memberId: click.memberId },
  });
  if (click.postId) ctx.touchedPostIds.add(click.postId);
  return { memberId: click.memberId, postId: click.postId, clickId: click.id };
}

async function handlePlayers(ctx: SyncContext, rows: LaPlayer[]) {
  await ctx.loadPlayerIds();
  for (const row of rows) {
    const m = mapPlayer(row, ctx.rates);
    if (!m) continue;
    const campaignId = await ctx.ensureCampaign(m.campaignExternalId, m.programExternalId);
    const existingRow = await ctx.db.player.findUnique({
      where: {
        affiliateCampaignId_externalPlayerId: {
          affiliateCampaignId: campaignId,
          externalPlayerId: m.externalPlayerId,
        },
      },
      select: {
        id: true,
        subId: true,
        subIdSource: true,
        updatedAt: true,
        registeredAt: true,
        ftdAt: true,
        depositCount: true,
        depositTotal: true,
        ngr: true,
        memberId: true,
        clickId: true,
        raw: true,
        cpaStatus: true,
        cpaAmount: true,
        cpaCreditedAt: true,
        cpaReversedAt: true,
      },
    });
    const existing: ExistingPlayer | null = existingRow
      ? {
          id: existingRow.id,
          subId: existingRow.subId,
          subIdSource: existingRow.subIdSource as SubIdSource,
          updatedAt: (existingRow.raw as { updated_at?: string } | null)?.updated_at
            ? new Date((existingRow.raw as { updated_at: string }).updated_at)
            : null,
          registeredAt: existingRow.registeredAt,
          ftdAt: existingRow.ftdAt,
          depositCount: existingRow.depositCount,
          depositTotal: Number(existingRow.depositTotal),
          ngr: Number(existingRow.ngr),
          memberId: existingRow.memberId,
          clickId: existingRow.clickId,
        }
      : null;
    const change = applyPlayerRow(existing, m);
    // Champs CPA écrits avec leurs événements, dans la même transaction (`applyCpaEvents`) : des champs à jour
    // garantissent des événements à jour, et un joueur dont la CPA n'a pas changé ne coûte aucune lecture de plus.
    const { cpaStatus, cpaAmount, cpaCreditedAt, cpaReversedAt, ...data } = change.data;
    const cpaFields = { cpaStatus, cpaAmount, cpaCreditedAt, cpaReversedAt };
    const player = await ctx.db.player.upsert({
      where: {
        affiliateCampaignId_externalPlayerId: {
          affiliateCampaignId: campaignId,
          externalPlayerId: m.externalPlayerId,
        },
      },
      create: {
        affiliateCampaignId: campaignId,
        externalPlayerId: m.externalPlayerId,
        ...data,
        raw: toJsonValue(data.raw),
      },
      update: { ...data, raw: toJsonValue(data.raw) },
      select: { id: true, memberId: true, clickId: true },
    });
    ctx.playerIdByLaId.set(m.externalId, player.id);
    let memberId = player.memberId;
    let clickId = player.clickId;
    if (change.subIdChanged || (change.data.subId && !player.clickId)) {
      const att = await attachBySubId(ctx, player.id, change.data.subId);
      memberId = att.memberId ?? memberId;
      clickId = att.clickId ?? clickId;
    } else if (player.clickId) {
      const click = await ctx.db.click.findUnique({
        where: { id: player.clickId },
        select: { postId: true },
      });
      if (click?.postId && change.events.length > 0) ctx.touchedPostIds.add(click.postId);
    }
    await applyCpaEvents(ctx, {
      playerId: player.id,
      memberId,
      externalPlayerId: m.externalPlayerId,
      existing: existingRow,
      fields: cpaFields,
      desired: change.cpaEvents,
      observedAt: m.updatedAt,
      ours: isOurPlayer({ clickId, affiliateCampaignId: campaignId }, await ctx.ourOfferIds()),
    });
    for (const ev of change.events) {
      // Date réelle Link Affi de l'événement (inscription, premier dépôt, dernière activité), jamais la date d'import.
      const occurredAt =
        (ev.type === "player.registered"
          ? change.data.registeredAt
          : ev.type === "player.ftd"
            ? change.data.ftdAt
            : change.data.lastEventAt) ?? undefined;
      await recordEvent({
        type: ev.type,
        occurredAt,
        memberId,
        payload: {
          playerId: player.id,
          externalPlayerId: m.externalPlayerId,
          campaignId,
          amount: ev.amount ?? null,
          subId: change.data.subId,
          subIdSource: change.data.subIdSource,
        },
      });
      if (memberId)
        await emitAutomationEvent(
          ev.type === "player.registered" ? "REGISTERED" : "DEPOSITED",
          memberId,
          { playerId: player.id, amount: ev.amount ?? null, eventType: ev.type, via: "linkaffi" },
        );
    }
  }
}

type CpaFields = {
  cpaStatus: string | null;
  cpaAmount: number | null;
  cpaCreditedAt: Date | null;
  cpaReversedAt: Date | null;
};

const sameTime = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Les champs CPA gardés sont-ils déjà ceux de Link Affi (statut, montant, dates retenues) ? */
export function sameCpaFields(
  stored: {
    cpaStatus: string | null;
    cpaAmount: unknown;
    cpaCreditedAt: Date | null;
    cpaReversedAt: Date | null;
  },
  next: CpaFields,
): boolean {
  return (
    stored.cpaStatus === next.cpaStatus &&
    (stored.cpaAmount === null || stored.cpaAmount === undefined
      ? null
      : Number(stored.cpaAmount)) === next.cpaAmount &&
    sameTime(stored.cpaCreditedAt, next.cpaCreditedAt) &&
    sameTime(stored.cpaReversedAt, next.cpaReversedAt)
  );
}

/**
 * Commission CPA du joueur (phase 10) : champs CPA du joueur et événements `CPA` (+montant, jour du crédit) /
 * `CPA_REVERSAL` (−montant, jour de l'annulation) alignés sur l'état Link Affi, dans une seule transaction (créés,
 * réécrits, retirés ; un cycle clos est gardé sous un identifiant numéroté, voir `diffCpaEvents`).
 * - Champs CPA déjà à jour : rien n'est lu ni écrit (les événements ont été écrits avec eux).
 * - Chaque nouvelle commission ou annulation de NOS joueurs est journalisée (`Event`) ; celles des joueurs des autres
 *   affiliés de Link Affi restent dans `PlayerEvent` (filtrées à la lecture), sans entrée de journal.
 * - Les jours touchés sont marqués à recalculer.
 */
async function applyCpaEvents(
  ctx: SyncContext,
  a: {
    playerId: string;
    memberId: string | null;
    externalPlayerId: string;
    existing: {
      cpaStatus: string | null;
      cpaAmount: unknown;
      cpaCreditedAt: Date | null;
      cpaReversedAt: Date | null;
    } | null;
    fields: CpaFields;
    desired: ReturnType<typeof applyPlayerRow>["cpaEvents"];
    observedAt: Date | null;
    ours: boolean;
  },
) {
  if (a.existing && sameCpaFields(a.existing, a.fields)) return;
  const { playerId } = a;
  // Joueur nouveau : aucun événement possible avant lui.
  const stored = a.existing
    ? await ctx.db.playerEvent.findMany({
        where: { playerId, type: { in: ["CPA", "CPA_REVERSAL"] } },
        select: { id: true, externalId: true, type: true, amount: true, occurredAt: true },
      })
    : [];
  const diff = diffCpaEvents(stored, a.desired, { observedAt: a.observedAt });
  await ctx.db.$transaction([
    ...diff.renames.map((r) =>
      ctx.db.playerEvent.update({ where: { id: r.id }, data: { externalId: r.to } }),
    ),
    ...diff.upserts.map((e) =>
      ctx.db.playerEvent.upsert({
        where: { playerId_externalId: { playerId, externalId: e.externalId } },
        create: {
          playerId,
          type: e.type,
          amount: e.amount,
          currency: "EUR",
          occurredAt: e.occurredAt,
          externalId: e.externalId,
          raw: { source: "players.cpa" },
        },
        update: { type: e.type, amount: e.amount, currency: "EUR", occurredAt: e.occurredAt },
      }),
    ),
    ...(diff.deletes.length
      ? [ctx.db.playerEvent.deleteMany({ where: { playerId, externalId: { in: diff.deletes } } })]
      : []),
    ctx.db.player.update({ where: { id: playerId }, data: a.fields }),
  ]);
  for (const day of diff.days) ctx.dirtyDays.add(day);
  if (!a.ours) return;
  for (const e of diff.upserts) {
    if (!diff.created.includes(e.externalId)) continue;
    await recordEvent({
      type: e.type === "CPA" ? "player.cpa_credited" : "player.cpa_reversed",
      occurredAt: e.occurredAt,
      memberId: a.memberId,
      payload: { playerId, externalPlayerId: a.externalPlayerId, amount: e.amount },
    });
  }
}

async function handlePlayerEvents(ctx: SyncContext, rows: LaPlayerEvent[]) {
  await ctx.loadPlayerIds();
  for (const row of rows) {
    const m = mapPlayerEvent(row, ctx.rates);
    if (!m) continue;
    const playerId = ctx.playerIdByLaId.get(m.playerExternalId);
    if (!playerId) continue; // joueur pas encore importé : sera repris au prochain passage (chevauchement)
    await ctx.db.playerEvent.upsert({
      where: { playerId_externalId: { playerId, externalId: m.externalId } },
      create: {
        playerId,
        type: m.type,
        amount: m.amount,
        currency: m.currency,
        occurredAt: m.occurredAt,
        externalId: m.externalId,
        raw: toJsonValue(m.raw),
      },
      update: {
        type: m.type,
        amount: m.amount,
        currency: m.currency,
        occurredAt: m.occurredAt,
        raw: toJsonValue(m.raw),
      },
    });
  }
}

async function handlePlayerFinancials(ctx: SyncContext, rows: LaPlayerFinancials[]) {
  await ctx.loadPlayerIds();
  for (const row of rows) {
    const laId = typeof row.player_id === "string" ? row.player_id : null;
    const playerId = laId ? ctx.playerIdByLaId.get(laId) : undefined;
    if (!playerId) continue;
    const existing = await ctx.db.player.findUnique({
      where: { id: playerId },
      select: { raw: true },
    });
    const raw = (existing?.raw as Record<string, unknown> | null) ?? {};
    await ctx.db.player.update({
      where: { id: playerId },
      data: { raw: toJsonValue({ ...raw, financials: row }) },
    });
  }
}

async function handleRevshareSnapshots(ctx: SyncContext, rows: LaSnapshot[]) {
  for (const row of rows) {
    const m = mapRevshareSnapshot(row, ctx.rates);
    if (!m) continue;
    const player = await ctx.findPlayerByExternal(m.programExternalId, m.externalPlayerId);
    if (!player) continue;
    const previous = Number(player.ngr ?? 0);
    // NGR daté (phase 8) : chaque variation devient un événement à la date réelle de l'instantané, jamais un cumul.
    const delta = ngrDeltaEvent(previous, m.ngr, m.at, ctx.now());
    if (!delta) continue;
    // Événement et cumul écrits ensemble : si l'un échoue, rien n'est écrit, l'erreur remonte (table en erreur) et la
    // variation est reprise au passage suivant — jamais d'écart entre `Player.ngr` et la somme des événements NGR.
    await ctx.db.$transaction(async (tx) => {
      await tx.playerEvent.create({
        data: {
          playerId: player.id,
          type: "NGR",
          amount: delta.amount,
          currency: "EUR",
          occurredAt: delta.occurredAt,
          raw: { source: "revshare_snapshots", previous, ngr: m.ngr },
        },
      });
      await tx.player.update({
        where: { id: player.id },
        data: { ngr: m.ngr, lastEventAt: m.at ?? undefined },
      });
    });
    await recordEvent({
      type: "player.ngr_updated",
      occurredAt: delta.occurredAt,
      memberId: player.memberId,
      payload: { playerId: player.id, ngr: m.ngr, previous, amount: delta.amount },
    });
  }
}

async function handleDepositSnapshots(ctx: SyncContext, rows: LaSnapshot[]) {
  for (const row of rows) {
    const m = mapDepositSnapshot(row, ctx.rates);
    if (!m) continue;
    const player = await ctx.findPlayerByExternal(m.programExternalId, m.externalPlayerId);
    if (!player || Number(player.depositTotal) >= m.depositTotal) continue;
    await ctx.db.player.update({
      where: { id: player.id },
      data: { depositTotal: m.depositTotal },
    });
    await recordEvent({
      type: "player.deposit",
      occurredAt: m.at ?? undefined,
      memberId: player.memberId,
      payload: {
        playerId: player.id,
        amount: m.depositTotal - Number(player.depositTotal),
        source: "deposit_snapshots",
      },
    });
  }
}

async function handleFtdInvalidations(ctx: SyncContext, rows: LaFtdInvalidation[]) {
  for (const row of rows) {
    const m = mapFtdInvalidation(row);
    if (!m) continue;
    const player = await ctx.findPlayerByExternal(m.programExternalId, m.externalPlayerId);
    if (!player) continue;
    const already = await ctx.db.playerEvent.findUnique({
      where: { playerId_externalId: { playerId: player.id, externalId: m.externalId } },
      select: { id: true },
    });
    if (already) continue;
    await ctx.db.playerEvent.create({
      data: {
        playerId: player.id,
        type: "OTHER",
        occurredAt: m.at,
        externalId: m.externalId,
        raw: toJsonValue(row),
      },
    });
    if (player.ftdAt) {
      await ctx.db.player.update({
        where: { id: player.id },
        data: { ftdAt: null, ftdAmount: null },
      });
      await recordEvent({
        type: "player.ftd_invalidated",
        occurredAt: m.at,
        memberId: player.memberId,
        payload: { playerId: player.id, reason: m.reason },
      });
    }
  }
}

/** Clics Link Affi avec sub_id : contrôle que nos clics d'offre sont bien arrivés (diagnostic uniquement). */
async function handleClicks(ctx: SyncContext, rows: LaClick[]) {
  let matched = 0;
  let unmatched = 0;
  for (const row of rows) {
    const m = mapClick(row);
    if (!m) continue;
    const click = await ctx.db.click.findUnique({
      where: { subId: m.subId },
      select: { id: true },
    });
    if (click) matched++;
    else unmatched++;
  }
  if (matched + unmatched > 0)
    logger.info({ matched, unmatched }, "clics Link Affi avec sub_id rapprochés");
}

/**
 * `stats` → `AffiliateDailyStat`, une ligne Link Affi = une ligne chez nous (upsert par `externalId`, rejouable).
 * L'offre et le casino sont retrouvés par leur identifiant Link Affi ; une ligne modifiée marque ses jours à recalculer.
 */
async function handleStats(ctx: SyncContext, rows: LaStat[]) {
  for (const row of rows) {
    const m = mapStat(row);
    if (!m) continue;
    const date = new Date(`${m.date}T00:00:00Z`);
    const data = {
      date,
      affiliateCampaignId: m.campaignExternalId
        ? (ctx.campaignIdByExternal.get(m.campaignExternalId) ?? null)
        : null,
      campaignExternalId: m.campaignExternalId,
      programId: m.programExternalId
        ? (ctx.programIdByExternal.get(m.programExternalId) ?? null)
        : null,
      programExternalId: m.programExternalId,
      affiliateExternalId: m.affiliateExternalId,
      clicks: m.clicks,
      signups: m.signups,
      deposits: m.deposits,
      depositAmount: m.depositAmount,
      revenue: m.revenue,
      cpaRevenue: m.cpaRevenue,
      revshareRevenue: m.revshareRevenue,
      sourceCreatedAt: m.sourceCreatedAt,
      raw: toJsonValue(m.raw),
    };
    const prev = await ctx.db.affiliateDailyStat.findUnique({
      where: { externalId: m.externalId },
      select: {
        date: true,
        sourceCreatedAt: true,
        affiliateCampaignId: true,
        revshareRevenue: true,
      },
    });
    await ctx.db.affiliateDailyStat.upsert({
      where: { externalId: m.externalId },
      create: { externalId: m.externalId, ...data },
      update: data,
    });
    const changed =
      !prev ||
      prev.date.getTime() !== date.getTime() ||
      (prev.sourceCreatedAt?.getTime() ?? null) !== (m.sourceCreatedAt?.getTime() ?? null) ||
      prev.affiliateCampaignId !== data.affiliateCampaignId ||
      Number(prev.revshareRevenue) !== m.revshareRevenue;
    if (!changed) continue;
    ctx.dirtyDays.add(revshareDayKey({ date: m.date, sourceCreatedAt: m.sourceCreatedAt }));
    if (prev) ctx.dirtyDays.add(revshareDayKey(prev));
  }
}

/**
 * Affiliés Link Affi à nous : propriétaires des offres rattachées à nos campagnes, ou des offres qui portent nos clics
 * (joueurs retrouvés par sub-ID, boutons Offre cliqués). La table `stats` couvre tous les affiliés de Link Affi : on ne
 * lit jamais que les lignes de ceux-là.
 */
async function ourStatsAffiliates(db: Db): Promise<string[]> {
  const [campaigns, withPlayers, withClicks] = await Promise.all([
    db.campaign.findMany({ select: { affiliateCampaignIds: true } }),
    db.player.groupBy({ by: ["affiliateCampaignId"], where: { clickId: { not: null } } }),
    db.trackingLink.findMany({
      where: {
        kind: "OFFER",
        affiliateCampaignId: { not: null },
        clickRecords: { some: { subId: { not: null }, isBot: false } },
      },
      select: { affiliateCampaignId: true },
      distinct: ["affiliateCampaignId"],
    }),
  ]);
  const ids = new Set(collectAffiliateCampaignIds(campaigns));
  for (const p of withPlayers) ids.add(p.affiliateCampaignId);
  for (const l of withClicks) if (l.affiliateCampaignId) ids.add(l.affiliateCampaignId);
  if (ids.size === 0) return [];
  const offers = await db.affiliateCampaign.findMany({
    where: { id: { in: [...ids] } },
    select: { raw: true },
  });
  // Un affiliate_id non-uuid (donnee de demo, saisie manuelle) ferait echouer toute la table `stats`.
  return keepUuidIds(ourAffiliateIds(offers));
}

const HANDLERS: Record<SyncTable, (ctx: SyncContext, rows: never[]) => Promise<void>> = {
  casinos: handleCasinos,
  campaigns: handleCampaigns,
  currency_rates: handleCurrencyRates,
  players: handlePlayers,
  player_events: handlePlayerEvents,
  player_financials: handlePlayerFinancials,
  revshare_snapshots: handleRevshareSnapshots,
  deposit_snapshots: handleDepositSnapshots,
  ftd_invalidations: handleFtdInvalidations,
  clicks: handleClicks,
  stats: handleStats,
};

// ---------- Boucle par table avec SyncState ----------

async function syncTable(
  ctx: SyncContext,
  client: LinkAffiClient,
  table: SyncTable,
  dateCol: string | null,
  full: boolean,
): Promise<TableResult> {
  const now = ctx.now();
  const state = await ctx.db.syncState.upsert({
    where: { source: table },
    create: { source: table },
    update: {},
  });
  if (
    state.isRunning &&
    state.lastRunAt &&
    now.getTime() - state.lastRunAt.getTime() < STALE_LOCK_MS
  ) {
    return { table, ok: true, rows: 0, skipped: true };
  }
  const cursor: SyncCursor = full ? {} : ((state.cursor as SyncCursor | null) ?? {});
  const w = computeWindow(dateCol, cursor, now, full);
  await ctx.db.syncState.update({
    where: { source: table },
    data: {
      isRunning: true,
      lastRunAt: now,
      lastError: null,
      cursor: toJsonValue(full ? {} : cursor),
    },
  });
  let offset = w.offset;
  let imported = 0;
  try {
    for (;;) {
      const page = await client.getPage(table, { ...windowQuery(w), limit: PAGE_LIMIT, offset });
      await HANDLERS[table](ctx, page.rows as never[]);
      imported += page.rows.length;
      offset += page.rows.length;
      const done = page.rows.length === 0 || page.rows.length < PAGE_LIMIT || offset >= page.total;
      await ctx.db.syncState.update({
        where: { source: table },
        data: {
          rowsImported: { increment: page.rows.length },
          cursor: toJsonValue(done ? cursorAfterSuccess(w) : cursorAfterPage(cursor, w, offset)),
        },
      });
      if (done) break;
    }
    await ctx.db.syncState.update({
      where: { source: table },
      data: { isRunning: false, lastSuccessAt: ctx.now(), lastError: null },
    });
    return { table, ok: true, rows: imported };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Compteur d'échecs consécutifs (lu par l'alerte `sync_failed`) ; remis à zéro au prochain succès.
    const errorStreak =
      (typeof (cursor as { errorStreak?: unknown }).errorStreak === "number"
        ? (cursor as { errorStreak: number }).errorStreak
        : 0) + 1;
    await ctx.db.syncState
      .update({
        where: { source: table },
        data: {
          isRunning: false,
          lastError: message,
          cursor: toJsonValue({ ...cursor, errorStreak }),
        },
      })
      .catch(() => undefined);
    logger.error({ table, err: message }, "synchro Link Affi : table en erreur");
    return { table, ok: false, rows: imported, error: message };
  }
}

/**
 * Table `stats` (part de revshare) : lecture propre, affilié par affilié (jamais les autres affiliés de Link Affi),
 * fenêtres de `statsQueries` (7 derniers jours mis à jour en place, 35 lors de la relecture de nuit + corrections
 * créées depuis le dernier succès ; historique complet pour un affilié pas encore lu). Même verrou, même curseur et même compteur d'échecs que les
 * autres tables (`SyncState` « stats »).
 */
async function syncStatsTable(
  ctx: SyncContext,
  client: LinkAffiClient,
  full: boolean,
): Promise<TableResult> {
  const table = "stats";
  const now = ctx.now();
  const state = await ctx.db.syncState.upsert({
    where: { source: table },
    create: { source: table },
    update: {},
  });
  if (
    state.isRunning &&
    state.lastRunAt &&
    now.getTime() - state.lastRunAt.getTime() < STALE_LOCK_MS
  ) {
    return { table, ok: true, rows: 0, skipped: true };
  }
  const cursor: StatsCursor = full ? {} : ((state.cursor as StatsCursor | null) ?? {});
  await ctx.db.syncState.update({
    where: { source: table },
    data: { isRunning: true, lastRunAt: now, lastError: null, cursor: toJsonValue(cursor) },
  });
  let imported = 0;
  // Relecture de nuit (35 jours par date) : retrouve une réécriture en place d'un jour plus ancien que 7 jours. Un
  // premier passage ou une resynchro complète lit tout l'historique : il en tient lieu.
  const deep = full || !cursor.since || statsDeepDue(cursor, now);
  try {
    const affiliates = await ourStatsAffiliates(ctx.db);
    for (const q of statsQueries(affiliates, cursor, now, full, deep)) {
      let offset = 0;
      for (;;) {
        const page = await client.getPage(table, { ...q, limit: PAGE_LIMIT, offset });
        await handleStats(ctx, page.rows as LaStat[]);
        imported += page.rows.length;
        offset += page.rows.length;
        if (page.rows.length === 0 || page.rows.length < PAGE_LIMIT || offset >= page.total) break;
      }
    }
    const deepAt = deep ? now.toISOString() : cursor.deepAt;
    const next: StatsCursor = {
      since: now.toISOString(),
      affiliates,
      ...(deepAt ? { deepAt } : {}),
    };
    await ctx.db.syncState.update({
      where: { source: table },
      data: {
        rowsImported: { increment: imported },
        cursor: toJsonValue(next),
        isRunning: false,
        lastSuccessAt: ctx.now(),
        lastError: null,
      },
    });
    return { table, ok: true, rows: imported };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorStreak =
      (typeof (cursor as { errorStreak?: unknown }).errorStreak === "number"
        ? (cursor as { errorStreak: number }).errorStreak
        : 0) + 1;
    await ctx.db.syncState
      .update({
        where: { source: table },
        data: {
          isRunning: false,
          lastError: message,
          cursor: toJsonValue({ ...cursor, errorStreak }),
        },
      })
      .catch(() => undefined);
    logger.error({ table, err: message }, "synchro Link Affi : table en erreur");
    return { table, ok: false, rows: imported, error: message };
  }
}

/** Recalcule les statistiques des messages touchés (idempotent, depuis les joueurs rattachés). */
export async function recomputePostStats(db: Db, postIds: Iterable<string>) {
  for (const postId of postIds) {
    const players = await db.player.findMany({
      where: { click: { postId } },
      select: { ftdAt: true, depositCount: true, depositTotal: true, registeredAt: true },
    });
    const registrations = players.filter((p) => p.registeredAt).length;
    const ftds = players.filter((p) => p.ftdAt).length;
    const deposits = players.reduce((s, p) => s + p.depositCount, 0);
    const depositAmount = players.reduce((s, p) => s + Number(p.depositTotal), 0);
    await db.postStats.upsert({
      where: { postId },
      create: { postId, registrations, ftds, deposits, depositAmount },
      update: { registrations, ftds, deposits, depositAmount },
    });
  }
}

/** Lance un passage de synchronisation (toutes les tables ou une sélection). Ne lève jamais. */
export async function runSync(opts: SyncOptions = {}): Promise<TableResult[]> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? (() => new Date());
  if (!process.env.LINKAFFI_API_KEY && !opts.client) {
    logger.warn("LINKAFFI_API_KEY absente : synchronisation Link Affi ignorée");
    return [];
  }
  const client = opts.client ?? new LinkAffiClient();
  const ctx = new SyncContext(db, now);
  await ctx.loadCaches();
  const wanted = opts.tables?.length ? new Set(opts.tables) : null;
  const results: TableResult[] = [];
  for (const t of SYNC_TABLES) {
    if (wanted && !wanted.has(t.table)) continue;
    results.push(
      t.table === "stats"
        ? await syncStatsTable(ctx, client, opts.full === true)
        : await syncTable(ctx, client, t.table, t.dateCol, opts.full === true),
    );
  }
  // Offres sans fiches joueurs (applis de rencontre…) : inscriptions et premiers dépôts tenus depuis la table `stats`
  // (voir aggregate-players.ts) ; leurs jours changés sont recalculés comme les commissions.
  if (!wanted || wanted.has("stats") || wanted.has("players")) {
    try {
      for (const day of await reconcileAggregatePlayers(db)) ctx.dirtyDays.add(day);
    } catch (err) {
      logger.error({ err: (err as Error).message }, "joueurs agrégés (offres sans fiches joueurs)");
    }
  }
  // Commissions changées (CPA créditée ou annulée, revshare corrigé) : leurs jours seront repris au prochain recalcul
  // des statistiques journalières, même s'ils sortent de sa fenêtre habituelle de 3 jours.
  if (ctx.dirtyDays.size > 0)
    await markDailyStatsDirty(db, [...ctx.dirtyDays].sort()[0]!).catch((err: Error) =>
      logger.error(
        { err: err.message },
        "statistiques journalières : marquage des jours à recalculer",
      ),
    );
  if (ctx.touchedPostIds.size > 0)
    await recomputePostStats(db, ctx.touchedPostIds).catch((err: Error) =>
      logger.error({ err: err.message }, "recalcul PostStats"),
    );
  // Campagnes Telegram des affiliés (phase 13) : lecture toutes les 10 minutes, après les joueurs. Hors `results` et
  // hors `SyncState` : une table Telegram absente chez Link Affi n'est jamais une erreur de synchro.
  if (!wanted || wanted.has(TELEGRAM_SYNC_NAME)) {
    if (await telegramCampaignsDue(db, now(), opts.full === true)) {
      const campaigns = results.find((r) => r.table === "campaigns");
      await syncTelegramCampaigns({
        db,
        client,
        now,
        campaignRows: campaigns?.ok && !campaigns.skipped ? ctx.telegramCampaignRows : null,
      });
    }
  }
  const total = results.reduce((s, r) => s + r.rows, 0);
  logger.info(
    { total, errors: results.filter((r) => !r.ok).map((r) => r.table) },
    "synchro Link Affi terminée",
  );
  return results;
}

export type { Prisma };
