// Phase 10 : reprise des gains (gains = nos commissions − dépense pub). Idempotente, relançable sans risque, même
// pendant que le worker tourne.
//   pnpm db:phase10:gains                                   (base de `.env.local`)
//   railway ssh --service web -- pnpm db:phase10:gains      (production)
//
// 1) Commissions CPA des joueurs déjà importés : la synchro ne relit un joueur que s'il change chez Link Affi
//    (`updated_at`), les CPA déjà créditées ou annulées avant la phase 10 n'arriveraient donc jamais. Pour chaque joueur,
//    `Player.cpaStatus`, `cpaAmount`, `cpaCreditedAt`, `cpaReversedAt` et ses événements `CPA` (+montant, jour du
//    crédit) / `CPA_REVERSAL` (−montant, jour de l'annulation) sont recalculés depuis sa ligne Link Affi déjà gardée
//    (`Player.raw` : cpa_status, cpa_affiliate_amount, cpa_credited_at, cpa_reversed_at, qualified_at,
//    disqualified_at, updated_at), avec la MÊME règle que la synchro (@linkaffipro/core : `cpaStateFromRow`,
//    `cpaEvents`, `diffCpaEvents` ; montants convertis avec la dernière table de taux gardée par la synchro, Setting
//    `linkaffi.currencyRates`). Rien n'est lu chez Link Affi. Chaque commission ou annulation ajoutée d'un de NOS
//    joueurs (rattaché à un de nos clics, ou d'une offre de nos campagnes) est journalisée (`Event`, à sa date réelle) ;
//    celles des joueurs des autres affiliés restent dans `PlayerEvent` sans entrée de journal. Un résumé va dans le
//    journal des actions (`maintenance.phase10_gains`).
// 2) Part de revshare : la table Link Affi `stats` est lue par le worker (historique complet de notre affilié au premier
//    passage). Si REDIS_URL est présent, le script demande tout de suite une synchro complète de cette table.
// 3) Recalcul complet des statistiques journalières (`stats` { type: "daily", full: true }) si REDIS_URL est présent.
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  CURRENCY_RATES_SETTING_KEY,
  collectAffiliateCampaignIds,
  cpaEvents,
  cpaStateFromRow,
  diffCpaEvents,
  effectiveCpaDates,
  isOurPlayer,
  type CpaRates,
  type CpaState,
} from "@linkaffipro/core";

export const GAINS_SUMMARY_ACTION = "maintenance.phase10_gains";

export type GainsReport = {
  /** Joueurs relus. */
  players: number;
  /** Joueurs avec une commission (créditée, éventuellement annulée). */
  withCommission: number;
  /** Joueurs dont les champs CPA ou les événements ont été écrits par ce passage. */
  playersUpdated: number;
  /** Événements de commission créés ou réécrits. */
  eventsWritten: number;
  /** Événements de commission retirés (Link Affi ne les porte plus). */
  eventsRemoved: number;
  /** Premier jour (Paris) touché par ce passage, null si rien n'a changé. */
  firstDay: string | null;
};

/**
 * État CPA d'un joueur depuis sa ligne Link Affi gardée (`Player.raw`) ; null sans identifiant Link Affi. Même règle
 * que la synchro (`cpaStateFromRow` de @linkaffipro/core, montant converti en euros avec `rates`).
 */
export function cpaStateFromRaw(raw: unknown, rates?: CpaRates): CpaState | null {
  return cpaStateFromRow(raw, rates);
}

/** Dernière table de taux Link Affi gardée par la synchro (EUR = 1 si elle n'a jamais tourné). */
export async function storedRates(db: PrismaClient): Promise<CpaRates> {
  const row = await db.setting.findUnique({ where: { key: CURRENCY_RATES_SETTING_KEY } });
  const v = row?.value;
  const out: Record<string, number> = { EUR: 1 };
  if (v && typeof v === "object" && !Array.isArray(v))
    for (const [k, rate] of Object.entries(v as Record<string, unknown>))
      if (typeof rate === "number" && rate > 0) out[k.toUpperCase()] = rate;
  return out;
}

const sameDate = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Champs CPA et événements de commission de chaque joueur, alignés sur sa ligne Link Affi. */
export async function backfillCommissions(db: PrismaClient): Promise<GainsReport> {
  const [rates, campaigns] = await Promise.all([
    storedRates(db),
    db.campaign.findMany({ select: { affiliateCampaignIds: true } }),
  ]);
  const ourOffers = new Set(collectAffiliateCampaignIds(campaigns));
  const players = await db.player.findMany({
    select: {
      id: true,
      memberId: true,
      clickId: true,
      affiliateCampaignId: true,
      externalPlayerId: true,
      raw: true,
      cpaStatus: true,
      cpaAmount: true,
      cpaCreditedAt: true,
      cpaReversedAt: true,
    },
  });
  const report: GainsReport = {
    players: players.length,
    withCommission: 0,
    playersUpdated: 0,
    eventsWritten: 0,
    eventsRemoved: 0,
    firstDay: null,
  };
  for (const p of players) {
    const state = cpaStateFromRaw(p.raw, rates);
    if (!state) continue;
    const desired = cpaEvents(state);
    if (desired.length > 0) report.withCommission++;
    const dates = effectiveCpaDates(state);
    const fields = {
      cpaStatus: state.status,
      cpaAmount: state.amount,
      cpaCreditedAt: dates.creditedAt,
      cpaReversedAt: dates.reversedAt,
    };
    const fieldsChanged =
      p.cpaStatus !== fields.cpaStatus ||
      (p.cpaAmount === null ? null : Number(p.cpaAmount)) !== fields.cpaAmount ||
      !sameDate(p.cpaCreditedAt, fields.cpaCreditedAt) ||
      !sameDate(p.cpaReversedAt, fields.cpaReversedAt);
    const stored = await db.playerEvent.findMany({
      where: { playerId: p.id, type: { in: ["CPA", "CPA_REVERSAL"] } },
      select: { id: true, externalId: true, type: true, amount: true, occurredAt: true },
    });
    const diff = diffCpaEvents(stored, desired, { observedAt: state.observedAt ?? null });
    const nothing =
      diff.upserts.length === 0 && diff.deletes.length === 0 && diff.renames.length === 0;
    if (!fieldsChanged && nothing) continue;
    await db.$transaction([
      ...(fieldsChanged ? [db.player.update({ where: { id: p.id }, data: fields })] : []),
      // Cycle clos gardé (crédit puis annulation, avant un nouveau crédit) : renommé, jamais réécrit.
      ...diff.renames.map((r) =>
        db.playerEvent.update({ where: { id: r.id }, data: { externalId: r.to } }),
      ),
      ...diff.upserts.map((e) =>
        db.playerEvent.upsert({
          where: { playerId_externalId: { playerId: p.id, externalId: e.externalId } },
          create: {
            playerId: p.id,
            type: e.type,
            amount: e.amount,
            currency: "EUR",
            occurredAt: e.occurredAt,
            externalId: e.externalId,
            raw: { source: "phase10-backfill" },
          },
          update: { type: e.type, amount: e.amount, currency: "EUR", occurredAt: e.occurredAt },
        }),
      ),
      ...(diff.deletes.length
        ? [
            db.playerEvent.deleteMany({
              where: { playerId: p.id, externalId: { in: diff.deletes } },
            }),
          ]
        : []),
    ]);
    report.playersUpdated++;
    report.eventsWritten += diff.upserts.length;
    report.eventsRemoved += diff.deletes.length;
    for (const day of diff.days)
      if (!report.firstDay || day < report.firstDay) report.firstDay = day;
    // Journal (append-only) : chaque commission ou annulation nouvelle de nos joueurs, à sa date réelle.
    if (!isOurPlayer(p, ourOffers)) continue;
    for (const e of diff.upserts) {
      if (!diff.created.includes(e.externalId)) continue;
      await db.event.create({
        data: {
          type: e.type === "CPA" ? "player.cpa_credited" : "player.cpa_reversed",
          occurredAt: e.occurredAt,
          memberId: p.memberId,
          payload: {
            playerId: p.id,
            externalPlayerId: p.externalPlayerId,
            amount: e.amount,
            source: "phase10-backfill",
          },
        },
      });
    }
  }
  await db.auditLog.create({
    data: {
      action: GAINS_SUMMARY_ACTION,
      entityType: "System",
      metadata: report as unknown as Prisma.InputJsonValue,
    },
  });
  return report;
}

/** Synchro complète de la table `stats` et recalcul complet des statistiques journalières (si REDIS_URL). */
async function enqueueFollowUps(): Promise<string> {
  if (!process.env.REDIS_URL)
    return "REDIS_URL absente : rien n'est enfilé. Le worker lira la table « Commissions par jour » à son prochain passage ; lancez ensuite « Recalculer les statistiques » (Statistiques → Pubs).";
  // Import par chemin calculé : le paquet db ne dépend pas de la file (qui dépend de lui) ; le script tourne dans le
  // monorepo complet (conteneur web), où packages/queue et ses dépendances sont présents.
  const spec = new URL("../../queue/src/client.ts", import.meta.url).href;
  const queue = (await import(spec)) as {
    enqueue: (
      name: string,
      data: Record<string, unknown>,
      opts?: { jobId?: string; delay?: number },
    ) => Promise<unknown>;
    closeQueues: () => Promise<void>;
  };
  try {
    const at = Date.now();
    await queue.enqueue(
      "sync-linkaffi",
      { type: "tick", full: true, tables: ["casinos", "campaigns", "stats"] },
      { jobId: `sync-linkaffi-phase10-gains-${at}` },
    );
    // Recalcul après la synchro (5 minutes) : il reprend aussi la part de revshare qu'elle vient d'importer.
    await queue.enqueue(
      "stats",
      { type: "daily", full: true },
      { jobId: `stats-daily-full-phase10-gains-${at}`, delay: 5 * 60_000 },
    );
    return "synchro complète de « Commissions par jour » enfilée, recalcul complet des statistiques journalières dans 5 minutes.";
  } finally {
    await queue.closeQueues();
  }
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const r = await backfillCommissions(db);
    console.log(
      `[phase10:gains] ${r.players} joueur(s) relu(s), ${r.withCommission} avec une commission ; ${r.playersUpdated} mis à jour, ${r.eventsWritten} événement(s) de commission écrit(s), ${r.eventsRemoved} retiré(s)${r.firstDay ? ` ; premier jour touché : ${r.firstDay}` : ""}.`,
    );
    console.log(`[phase10:gains] ${await enqueueFollowUps()}`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
