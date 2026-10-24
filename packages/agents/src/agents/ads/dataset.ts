/**
 * Lecture des données de l'Agent Ads (LECTURE SEULE : aucune écriture ici, aucun appel aux plateformes pub).
 * Tout vient de ce que la plateforme a déjà synchronisé et calculé : `DailyStat` (recalcul horaire du worker,
 * attribution pub → membre → joueur existante), `AdCost` (impressions et clics des connecteurs, CSV ou saisie),
 * structure Campagne → Groupe → Pub, comptes connectés.
 */
import { ourPlayerWhere, collectAffiliateCampaignIds, landingAdByInviteLink } from "@linkaffipro/core";
import type { AgentsPrisma } from "../../types";
import { addDaysToDay, parisDay } from "../../rules/time";
import type { AdsRaw } from "./metrics";
import type { CohortCommission, CohortMember } from "./cohorts";
import { COHORT_WINDOW_DAYS } from "./cohorts";
import { dateKey, dayDate } from "./periods";
import { ADS_VERTICALS } from "./thresholds";

export type AdsCampaignRef = { id: string; name: string; vertical: string | null; budgetDaily: number | null; status: string };
export type AdsAdSetRef = { id: string; name: string; campaignId: string };
export type AdsAdRef = { id: string; name: string; adSetId: string };
export type AdsStatRow = { dimension: string; day: string; raw: Partial<AdsRaw> };
export type AdsCostRow = { day: string; adId: string | null; adSetId: string | null; campaignId: string | null; spend: number; impressions: number; clicks: number };
export type AdsFirstSpend = { adId: string | null; adSetId: string | null; campaignId: string | null; day: string };

/** Données d'une analyse (pures après lecture) : `stats` et `costs` couvrent `from` → `to`. */
export type AdsDataset = {
  /** Jour de Paris du calcul (aujourd'hui) : jamais compté dans une période. */
  today: string;
  from: string;
  to: string;
  campaigns: AdsCampaignRef[];
  adSets: AdsAdSetRef[];
  ads: AdsAdRef[];
  stats: AdsStatRow[];
  costs: AdsCostRow[];
  firstSpend: AdsFirstSpend[];
  activeConnections: number;
};

/** Dimension `DailyStat` sans doublon « toutes campagnes » (écrite par le worker depuis la phase 8). */
export const UNION_DIMENSION = "campaigns";
/** Même ligne sans doublon, par univers (`campaigns:CASINO`…). */
export const verticalUnionDimension = (vertical: string) => `campaigns:${vertical}`;

const n = (v: unknown) => Number(v ?? 0) || 0;

/** Lit `days` jours complets jusqu'à hier (plus aujourd'hui, pour les alertes). */
export async function loadAdsDataset(prisma: AgentsPrisma, now: Date, days: number): Promise<AdsDataset> {
  const today = parisDay(now);
  const from = addDaysToDay(today, -days);
  const to = today;
  const [campaigns, adSets, ads, activeConnections] = await Promise.all([
    prisma.campaign.findMany({ select: { id: true, name: true, vertical: true, budgetDaily: true, status: true } }),
    prisma.adSet.findMany({ select: { id: true, name: true, campaignId: true } }),
    prisma.ad.findMany({ select: { id: true, name: true, adSetId: true } }),
    prisma.adAccountConnection.count({ where: { status: "ACTIVE" } }),
  ]);
  // `campaigns:<univers>` : total sans doublon par univers (la part du revenu d'une offre partagée par deux campagnes
  // du même univers n'y compte qu'une fois).
  const dims = [UNION_DIMENSION, ...ADS_VERTICALS.map(verticalUnionDimension), ...campaigns.map((c) => `campaign:${c.id}`), ...ads.map((a) => `ad:${a.id}`)];
  const range = { gte: dayDate(from), lte: dayDate(to) };
  const [statRows, costRows, firstRows] = await Promise.all([
    prisma.dailyStat.findMany({
      where: { dimension: { in: dims }, date: range },
      select: {
        dimension: true,
        date: true,
        requests: true,
        joined: true,
        entryClicks: true,
        offerClicks: true,
        registrations: true,
        ftds: true,
        deposits: true,
        spend: true,
        commissions: true,
      },
    }),
    prisma.adCost.findMany({
      where: { date: range },
      select: { date: true, adId: true, adSetId: true, campaignId: true, spend: true, impressions: true, clicks: true },
    }),
    // Âge d'une pub : premier jour avec une dépense (tout l'historique, une ligne par niveau).
    prisma.adCost.findMany({
      where: { spend: { gt: 0 } },
      orderBy: { date: "asc" },
      distinct: ["levelKey"],
      select: { adId: true, adSetId: true, campaignId: true, date: true },
    }),
  ]);
  return {
    today,
    from,
    to,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, vertical: c.vertical ?? null, budgetDaily: c.budgetDaily === null ? null : n(c.budgetDaily), status: String(c.status) })),
    adSets,
    ads,
    stats: statRows.map((r) => ({
      dimension: r.dimension,
      day: dateKey(r.date),
      raw: {
        spend: n(r.spend),
        landingVisits: r.entryClicks,
        telegramJoins: r.requests,
        members: r.joined,
        offerClicks: r.offerClicks,
        registrations: r.registrations,
        ftds: r.ftds,
        deposits: r.deposits,
        commissions: n(r.commissions),
      },
    })),
    costs: costRows.map((c) => ({ day: dateKey(c.date), adId: c.adId, adSetId: c.adSetId, campaignId: c.campaignId, spend: n(c.spend), impressions: c.impressions, clicks: c.clicks })),
    firstSpend: firstRows.map((r) => ({ adId: r.adId, adSetId: r.adSetId, campaignId: r.campaignId, day: dateKey(r.date) })),
    activeConnections,
  };
}

/**
 * Membres acquis par chaque pub depuis 90 jours (lien d'invitation de la pub ou lien de ses pages d'atterrissage,
 * même règle que le recalcul des statistiques) et commissions CPA datées de « nos » joueurs.
 */
export async function loadAdsCohortInputs(prisma: AgentsPrisma, now: Date): Promise<{ members: CohortMember[]; commissions: CohortCommission[] }> {
  const since = new Date(now.getTime() - COHORT_WINDOW_DAYS * 86_400_000);
  const [ads, landingLinks, campaigns] = await Promise.all([
    prisma.ad.findMany({ where: { inviteLinkId: { not: null } }, select: { id: true, inviteLinkId: true } }),
    prisma.inviteLink.findMany({ where: { kind: "LANDING", landingAdId: { not: null } }, select: { id: true, landingAdId: true } }),
    prisma.campaign.findMany({ select: { affiliateCampaignIds: true } }),
  ]);
  const adByInvite = new Map<string, string>();
  for (const a of ads) if (a.inviteLinkId) adByInvite.set(a.inviteLinkId, a.id);
  for (const [linkId, adId] of landingAdByInviteLink(landingLinks)) if (!adByInvite.has(linkId)) adByInvite.set(linkId, adId);
  if (!adByInvite.size) return { members: [], commissions: [] };
  const memberships = await prisma.membership.findMany({
    where: { inviteLinkId: { in: [...adByInvite.keys()] }, requestedAt: { gte: since } },
    orderBy: { requestedAt: "asc" },
    select: { memberId: true, inviteLinkId: true, requestedAt: true },
  });
  // Première arrivée par une pub dans la fenêtre : un membre n'appartient qu'à une cohorte.
  const members = new Map<string, CohortMember>();
  for (const m of memberships) {
    const adId = m.inviteLinkId ? adByInvite.get(m.inviteLinkId) : undefined;
    if (adId && !members.has(m.memberId)) members.set(m.memberId, { memberId: m.memberId, adId, arrivedAt: m.requestedAt });
  }
  if (!members.size) return { members: [], commissions: [] };
  const players = await prisma.player.findMany({
    where: { AND: [ourPlayerWhere(collectAffiliateCampaignIds(campaigns)), { memberId: { in: [...members.keys()] } }] },
    select: { memberId: true, events: { where: { type: { in: ["CPA", "CPA_REVERSAL"] } }, select: { amount: true, occurredAt: true } } },
  });
  const commissions: CohortCommission[] = [];
  for (const p of players) for (const e of p.events) if (p.memberId) commissions.push({ memberId: p.memberId, amount: n(e.amount), at: e.occurredAt });
  return { members: [...members.values()], commissions };
}
