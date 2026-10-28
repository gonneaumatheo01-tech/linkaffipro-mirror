/**
 * Joueurs agrégés (28 octobre 2026) : certaines offres Link Affi n'ont aucune fiche joueur. Les applis de rencontre
 * (Spiice, JM Rencontre… par JetLead) et quelques programmes à postbacks agrégés ne remontent que des totaux par jour
 * dans la table `stats` (`AffiliateDailyStat` chez nous : `signups`, `deposits`). Toute la plateforme compte les
 * inscriptions et premiers dépôts sur les joueurs (`Player.registeredAt` / `ftdAt`) : ces offres affichaient donc
 * toujours 0, même avec des inscriptions chez Link Affi.
 *
 * Règle : pour chaque offre rattachée à une de nos campagnes et SANS aucun vrai joueur, la synchro tient, jour par
 * jour, autant de joueurs agrégés que d'inscriptions du jour, dont autant avec un premier dépôt que de dépôts du jour
 * (plus de dépôts que d'inscriptions → joueurs ajoutés avec seulement un premier dépôt). Un joueur agrégé :
 * `externalPlayerId` = `agg:<jour>:<n>`, `subIdSource` = "aggregate", inscription et premier dépôt à midi (Paris) du
 * jour Link Affi, jamais de clic, de membre, de canal ni de pub (Link Affi ne le dit pas), aucun montant.
 * Dès qu'une offre reçoit un vrai joueur, ses joueurs agrégés sont retirés (jamais de double compte).
 */
import { collectAffiliateCampaignIds } from "@linkaffipro/core";
import type { prisma as prismaClient } from "@linkaffipro/db";
import { parisMidnightUtc } from "../stats/aggregate";

type Db = typeof prismaClient;

export const AGGREGATE_SOURCE = "aggregate";
const PREFIX = "agg:";

export type DayTotals = { day: string; signups: number; deposits: number };
export type AggregatePlayerSpec = {
  externalPlayerId: string;
  registeredAt: Date | null;
  ftdAt: Date | null;
};

/** Midi de Paris du jour `AAAA-MM-JJ` : aucune bascule de jour possible à l'affichage. */
export function noonOfDay(day: string): Date {
  return new Date(parisMidnightUtc(day).getTime() + 12 * 3_600_000);
}

/** Pur : joueurs agrégés attendus pour des totaux journaliers (un jour sans inscription ni dépôt n'en a aucun). */
export function aggregatePlayersFor(days: readonly DayTotals[]): AggregatePlayerSpec[] {
  const out: AggregatePlayerSpec[] = [];
  for (const d of days) {
    const signups = Math.max(0, Math.trunc(d.signups));
    const deposits = Math.max(0, Math.trunc(d.deposits));
    const at = noonOfDay(d.day);
    for (let i = 1; i <= Math.max(signups, deposits); i++)
      out.push({
        externalPlayerId: `${PREFIX}${d.day}:${i}`,
        registeredAt: i <= signups ? at : null,
        ftdAt: i <= deposits ? at : null,
      });
  }
  return out;
}

/** Jour `AAAA-MM-JJ` d'un identifiant `agg:<jour>:<n>`, sinon null. */
export function dayOfAggregateId(externalPlayerId: string): string | null {
  const m = /^agg:(\d{4}-\d{2}-\d{2}):\d+$/.exec(externalPlayerId);
  return m ? m[1]! : null;
}

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Met les joueurs agrégés de nos offres en accord avec `AffiliateDailyStat`. Rend les jours (Paris) qui ont changé,
 * à recalculer dans les statistiques journalières.
 */
export async function reconcileAggregatePlayers(db: Db): Promise<Set<string>> {
  const changed = new Set<string>();
  const campaigns = await db.campaign.findMany({ select: { affiliateCampaignIds: true } });
  const offers = collectAffiliateCampaignIds(campaigns);
  if (offers.length === 0) return changed;
  const known = await db.affiliateCampaign.findMany({ where: { id: { in: offers } }, select: { id: true } });
  for (const { id: offerId } of known) {
    const real = await db.player.count({
      where: {
        affiliateCampaignId: offerId,
        OR: [{ subIdSource: null }, { subIdSource: { not: AGGREGATE_SOURCE } }],
      },
    });
    const existing = await db.player.findMany({
      where: { affiliateCampaignId: offerId, subIdSource: AGGREGATE_SOURCE },
      select: { id: true, externalPlayerId: true, registeredAt: true, ftdAt: true },
    });
    let wanted: AggregatePlayerSpec[] = [];
    if (real === 0) {
      const rows = await db.affiliateDailyStat.groupBy({
        by: ["date"],
        where: { affiliateCampaignId: offerId },
        _sum: { signups: true, deposits: true },
      });
      wanted = aggregatePlayersFor(
        rows.map((r) => ({
          day: r.date.toISOString().slice(0, 10),
          signups: r._sum.signups ?? 0,
          deposits: r._sum.deposits ?? 0,
        })),
      );
    }
    const byExternal = new Map(existing.map((p) => [p.externalPlayerId, p]));
    for (const w of wanted) {
      const cur = byExternal.get(w.externalPlayerId);
      byExternal.delete(w.externalPlayerId);
      if (cur && sameTime(cur.registeredAt, w.registeredAt) && sameTime(cur.ftdAt, w.ftdAt)) continue;
      await db.player.upsert({
        where: { affiliateCampaignId_externalPlayerId: { affiliateCampaignId: offerId, externalPlayerId: w.externalPlayerId } },
        create: {
          affiliateCampaignId: offerId,
          externalPlayerId: w.externalPlayerId,
          subIdSource: AGGREGATE_SOURCE,
          registeredAt: w.registeredAt,
          ftdAt: w.ftdAt,
          raw: { source: "stats", note: "joueur agrégé : Link Affi ne donne que des totaux par jour pour cette offre" },
        },
        update: { registeredAt: w.registeredAt, ftdAt: w.ftdAt },
      });
      changed.add(dayOfAggregateId(w.externalPlayerId)!);
    }
    // Restes : jour corrigé à la baisse, offre passée aux vrais joueurs, ou identifiant inattendu.
    const stale = [...byExternal.values()];
    if (stale.length) {
      await db.player.deleteMany({ where: { id: { in: stale.map((p) => p.id) }, subIdSource: AGGREGATE_SOURCE } });
      for (const p of stale) {
        const day = dayOfAggregateId(p.externalPlayerId);
        if (day) changed.add(day);
      }
    }
  }
  return changed;
}
