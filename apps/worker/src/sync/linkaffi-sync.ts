/**
 * Synchronisation Link Affi → notre base (lecture seule côté Link Affi).
 * Voir docs/LINKAFFI-SYNC.md pour la correspondance, l'ordre et les curseurs.
 */
import { prisma, recordEvent, toJsonValue, type Prisma } from "@linkaffipro/db";
import {
  LinkAffiClient,
  PAGE_LIMIT,
  SYNC_TABLES,
  buildRateTable,
  computeWindow,
  cursorAfterPage,
  cursorAfterSuccess,
  mapCampaign,
  mapCasino,
  mapClick,
  mapDepositSnapshot,
  mapFtdInvalidation,
  mapPlayer,
  mapPlayerEvent,
  mapRevshareSnapshot,
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
  type RateTable,
  type SubIdSource,
  type SyncCursor,
  type SyncTable,
} from "@linkaffipro/linkaffi";
import { logger } from "../logger";
import { applyPlayerRow, type ExistingPlayer } from "./player-apply";

type Db = typeof prisma;

export type SyncOptions = { full?: boolean; tables?: string[]; now?: () => Date; client?: LinkAffiClient; db?: Db };
export type TableResult = { table: string; ok: boolean; rows: number; error?: string; skipped?: boolean };

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
  constructor(
    public db: Db,
    public now: () => Date,
  ) {}

  async loadCaches() {
    const programs = await this.db.affiliateProgram.findMany({ where: { source: "LINKAFFI" }, select: { id: true, externalId: true } });
    for (const p of programs) if (p.externalId) this.programIdByExternal.set(p.externalId, p.id);
    const campaigns = await this.db.affiliateCampaign.findMany({ select: { id: true, externalId: true, programId: true } });
    for (const c of campaigns) {
      this.campaignIdByExternal.set(c.externalId, c.id);
      this.campaignProgramByCampaignId.set(c.id, c.programId);
    }
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
      create: { source: "LINKAFFI", externalId: key, name: externalId ? `(programme ${externalId.slice(0, 8)})` : "(programme inconnu)", isActive: externalId !== null },
      update: {},
      select: { id: true },
    });
    this.programIdByExternal.set(key, p.id);
    return p.id;
  }

  async ensureCampaign(externalId: string | null, programExternalId: string | null): Promise<string> {
    const key = externalId ?? `unknown:${programExternalId ?? UNKNOWN_PROGRAM}`;
    const hit = this.campaignIdByExternal.get(key);
    if (hit) return hit;
    const programId = await this.ensureProgram(programExternalId);
    const c = await this.db.affiliateCampaign.upsert({
      where: { programId_externalId: { programId, externalId: key } },
      create: { programId, externalId: key, name: externalId ? `(campagne ${externalId.slice(0, 8)})` : "(campagne inconnue)", trackingUrlTemplate: "", isActive: false },
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
    return this.db.player.findFirst({ where: { externalPlayerId, affiliateCampaign: { programId } }, select: { id: true, memberId: true, ngr: true, depositTotal: true, ftdAt: true, clickId: true } });
  }
}

// ---------- Traitements par table ----------

async function handleCasinos(ctx: SyncContext, rows: LaCasino[]) {
  for (const row of rows) {
    const m = mapCasino(row);
    if (!m) continue;
    const p = await ctx.db.affiliateProgram.upsert({
      where: { source_externalId: { source: "LINKAFFI", externalId: m.externalId } },
      create: { source: "LINKAFFI", externalId: m.externalId, name: m.name, isActive: m.isActive, raw: toJsonValue(m.raw) },
      update: { name: m.name, isActive: m.isActive, raw: toJsonValue(m.raw) },
      select: { id: true },
    });
    ctx.programIdByExternal.set(m.externalId, p.id);
  }
}

async function handleCampaigns(ctx: SyncContext, rows: LaCampaign[]) {
  for (const row of rows) {
    const m = mapCampaign(row);
    if (!m) continue;
    const programId = await ctx.ensureProgram(m.programExternalId);
    const c = await ctx.db.affiliateCampaign.upsert({
      where: { programId_externalId: { programId, externalId: m.externalId } },
      create: { programId, externalId: m.externalId, campaignKey: m.campaignKey, name: m.name, trackingUrlTemplate: m.trackingUrlTemplate, isActive: m.isActive, raw: toJsonValue(m.raw) },
      update: { campaignKey: m.campaignKey, name: m.name, trackingUrlTemplate: m.trackingUrlTemplate, raw: toJsonValue(m.raw) },
      select: { id: true },
    });
    ctx.campaignIdByExternal.set(m.externalId, c.id);
    ctx.campaignProgramByCampaignId.set(c.id, programId);
  }
}

async function handleCurrencyRates(ctx: SyncContext, rows: LaCurrencyRate[]) {
  ctx.rates = buildRateTable(rows);
}

/** Rattache un joueur à notre clic (sub-ID) : clickId, memberId ; retourne le postId touché. */
async function attachBySubId(ctx: SyncContext, playerId: string, subId: string | null): Promise<{ memberId: string | null; postId: string | null }> {
  if (!subId) return { memberId: null, postId: null };
  const click = await ctx.db.click.findUnique({ where: { subId }, select: { id: true, memberId: true, postId: true } });
  if (!click) return { memberId: null, postId: null };
  await ctx.db.player.update({ where: { id: playerId }, data: { clickId: click.id, memberId: click.memberId } });
  if (click.postId) ctx.touchedPostIds.add(click.postId);
  return { memberId: click.memberId, postId: click.postId };
}

async function handlePlayers(ctx: SyncContext, rows: LaPlayer[]) {
  await ctx.loadPlayerIds();
  for (const row of rows) {
    const m = mapPlayer(row, ctx.rates);
    if (!m) continue;
    const campaignId = await ctx.ensureCampaign(m.campaignExternalId, m.programExternalId);
    const existingRow = await ctx.db.player.findUnique({
      where: { affiliateCampaignId_externalPlayerId: { affiliateCampaignId: campaignId, externalPlayerId: m.externalPlayerId } },
      select: { id: true, subId: true, subIdSource: true, updatedAt: true, registeredAt: true, ftdAt: true, depositCount: true, depositTotal: true, ngr: true, memberId: true, clickId: true, raw: true },
    });
    const existing: ExistingPlayer | null = existingRow
      ? {
          id: existingRow.id,
          subId: existingRow.subId,
          subIdSource: existingRow.subIdSource as SubIdSource,
          updatedAt: ((existingRow.raw as { updated_at?: string } | null)?.updated_at ? new Date((existingRow.raw as { updated_at: string }).updated_at) : null),
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
    const player = await ctx.db.player.upsert({
      where: { affiliateCampaignId_externalPlayerId: { affiliateCampaignId: campaignId, externalPlayerId: m.externalPlayerId } },
      create: { affiliateCampaignId: campaignId, externalPlayerId: m.externalPlayerId, ...change.data, raw: toJsonValue(change.data.raw) },
      update: { ...change.data, raw: toJsonValue(change.data.raw) },
      select: { id: true, memberId: true, clickId: true },
    });
    ctx.playerIdByLaId.set(m.externalId, player.id);
    let memberId = player.memberId;
    if (change.subIdChanged || (change.data.subId && !player.clickId)) {
      const att = await attachBySubId(ctx, player.id, change.data.subId);
      memberId = att.memberId ?? memberId;
    } else if (player.clickId) {
      const click = await ctx.db.click.findUnique({ where: { id: player.clickId }, select: { postId: true } });
      if (click?.postId && change.events.length > 0) ctx.touchedPostIds.add(click.postId);
    }
    for (const ev of change.events) {
      await recordEvent({ type: ev.type, memberId, payload: { playerId: player.id, externalPlayerId: m.externalPlayerId, campaignId, amount: ev.amount ?? null, subId: change.data.subId, subIdSource: change.data.subIdSource } });
    }
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
      create: { playerId, type: m.type, amount: m.amount, currency: m.currency, occurredAt: m.occurredAt, externalId: m.externalId, raw: toJsonValue(m.raw) },
      update: { type: m.type, amount: m.amount, currency: m.currency, occurredAt: m.occurredAt, raw: toJsonValue(m.raw) },
    });
  }
}

async function handlePlayerFinancials(ctx: SyncContext, rows: LaPlayerFinancials[]) {
  await ctx.loadPlayerIds();
  for (const row of rows) {
    const laId = typeof row.player_id === "string" ? row.player_id : null;
    const playerId = laId ? ctx.playerIdByLaId.get(laId) : undefined;
    if (!playerId) continue;
    const existing = await ctx.db.player.findUnique({ where: { id: playerId }, select: { raw: true } });
    const raw = ((existing?.raw as Record<string, unknown> | null) ?? {});
    await ctx.db.player.update({ where: { id: playerId }, data: { raw: toJsonValue({ ...raw, financials: row }) } });
  }
}

async function handleRevshareSnapshots(ctx: SyncContext, rows: LaSnapshot[]) {
  for (const row of rows) {
    const m = mapRevshareSnapshot(row, ctx.rates);
    if (!m) continue;
    const player = await ctx.findPlayerByExternal(m.programExternalId, m.externalPlayerId);
    if (!player) continue;
    if (Number(player.ngr) === m.ngr) continue;
    await ctx.db.player.update({ where: { id: player.id }, data: { ngr: m.ngr, lastEventAt: m.at ?? undefined } });
    await recordEvent({ type: "player.ngr_updated", memberId: player.memberId, payload: { playerId: player.id, ngr: m.ngr, previous: Number(player.ngr) } });
  }
}

async function handleDepositSnapshots(ctx: SyncContext, rows: LaSnapshot[]) {
  for (const row of rows) {
    const m = mapDepositSnapshot(row, ctx.rates);
    if (!m) continue;
    const player = await ctx.findPlayerByExternal(m.programExternalId, m.externalPlayerId);
    if (!player || Number(player.depositTotal) >= m.depositTotal) continue;
    await ctx.db.player.update({ where: { id: player.id }, data: { depositTotal: m.depositTotal } });
    await recordEvent({ type: "player.deposit", memberId: player.memberId, payload: { playerId: player.id, amount: m.depositTotal - Number(player.depositTotal), source: "deposit_snapshots" } });
  }
}

async function handleFtdInvalidations(ctx: SyncContext, rows: LaFtdInvalidation[]) {
  for (const row of rows) {
    const m = mapFtdInvalidation(row);
    if (!m) continue;
    const player = await ctx.findPlayerByExternal(m.programExternalId, m.externalPlayerId);
    if (!player) continue;
    const already = await ctx.db.playerEvent.findUnique({ where: { playerId_externalId: { playerId: player.id, externalId: m.externalId } }, select: { id: true } });
    if (already) continue;
    await ctx.db.playerEvent.create({ data: { playerId: player.id, type: "OTHER", occurredAt: m.at, externalId: m.externalId, raw: toJsonValue(row) } });
    if (player.ftdAt) {
      await ctx.db.player.update({ where: { id: player.id }, data: { ftdAt: null, ftdAmount: null } });
      await recordEvent({ type: "player.ftd_invalidated", memberId: player.memberId, payload: { playerId: player.id, reason: m.reason } });
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
    const click = await ctx.db.click.findUnique({ where: { subId: m.subId }, select: { id: true } });
    if (click) matched++;
    else unmatched++;
  }
  if (matched + unmatched > 0) logger.info({ matched, unmatched }, "clics Link Affi avec sub_id rapprochés");
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
};

// ---------- Boucle par table avec SyncState ----------

async function syncTable(ctx: SyncContext, client: LinkAffiClient, table: SyncTable, dateCol: string | null, full: boolean): Promise<TableResult> {
  const now = ctx.now();
  const state = await ctx.db.syncState.upsert({ where: { source: table }, create: { source: table }, update: {} });
  if (state.isRunning && state.lastRunAt && now.getTime() - state.lastRunAt.getTime() < STALE_LOCK_MS) {
    return { table, ok: true, rows: 0, skipped: true };
  }
  const cursor: SyncCursor = full ? {} : ((state.cursor as SyncCursor | null) ?? {});
  const w = computeWindow(dateCol, cursor, now, full);
  await ctx.db.syncState.update({ where: { source: table }, data: { isRunning: true, lastRunAt: now, lastError: null, cursor: toJsonValue(full ? {} : cursor) } });
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
        data: { rowsImported: { increment: page.rows.length }, cursor: toJsonValue(done ? cursorAfterSuccess(w) : cursorAfterPage(cursor, w, offset)) },
      });
      if (done) break;
    }
    await ctx.db.syncState.update({ where: { source: table }, data: { isRunning: false, lastSuccessAt: ctx.now(), lastError: null } });
    return { table, ok: true, rows: imported };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Compteur d'échecs consécutifs (lu par l'alerte `sync_failed`) ; remis à zéro au prochain succès.
    const errorStreak = (typeof (cursor as { errorStreak?: unknown }).errorStreak === "number" ? (cursor as { errorStreak: number }).errorStreak : 0) + 1;
    await ctx.db.syncState
      .update({ where: { source: table }, data: { isRunning: false, lastError: message, cursor: toJsonValue({ ...cursor, errorStreak }) } })
      .catch(() => undefined);
    logger.error({ table, err: message }, "synchro Link Affi : table en erreur");
    return { table, ok: false, rows: imported, error: message };
  }
}

/** Recalcule les statistiques des messages touchés (idempotent, depuis les joueurs rattachés). */
export async function recomputePostStats(db: Db, postIds: Iterable<string>) {
  for (const postId of postIds) {
    const players = await db.player.findMany({ where: { click: { postId } }, select: { ftdAt: true, depositCount: true, depositTotal: true, registeredAt: true } });
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
    results.push(await syncTable(ctx, client, t.table, t.dateCol, opts.full === true));
  }
  if (ctx.touchedPostIds.size > 0) await recomputePostStats(db, ctx.touchedPostIds).catch((err: Error) => logger.error({ err: err.message }, "recalcul PostStats"));
  const total = results.reduce((s, r) => s + r.rows, 0);
  logger.info({ total, errors: results.filter((r) => !r.ok).map((r) => r.table) }, "synchro Link Affi terminée");
  return results;
}

export type { Prisma };
