import { revshareRowWhere } from "@linkaffipro/core";
import { prisma, type AdPlatform, type Prisma } from "@linkaffipro/db";
import { cachedDashboard } from "@/lib/dashboard/cache";
import {
  periodDates,
  periodEnd,
  periodStart,
  previousPeriod,
  variationOf,
  type Period,
} from "@/lib/periods";
import { isImportedShell } from "./ad-link";
import {
  campaignOfferClickWhere,
  campaignPlayerWhere,
  jsonIds,
  scopeFromCampaign,
  type CampaignScope,
} from "./attribution";
import { computeMetrics, type CampaignMetrics, type CampaignTotals } from "./metrics";
import { affiliateIdOf, markOurOffers } from "./wizard";

export type MetricKey = keyof CampaignMetrics;

/** Variations en % de chaque indicateur entre deux périodes (null si non calculable). */
export type CampaignDeltas = Partial<Record<MetricKey, number | null>>;

export function campaignDeltas(
  current: CampaignMetrics,
  previous: CampaignMetrics,
): CampaignDeltas {
  const out: CampaignDeltas = {};
  for (const k of Object.keys(current) as MetricKey[])
    out[k] = variationOf(current[k], previous[k]);
  return out;
}

export type CampaignRow = {
  id: string;
  name: string;
  adPlatform: string | null;
  vertical: string | null;
  status: string;
  channels: string[];
  links: number;
  /** Nombre d'offres Link Affi rattachées. */
  offers: number;
  /** Campagne pub importée automatiquement depuis un compte connecté (phase 7), pas encore rattachée : plateforme. */
  importedFrom: AdPlatform | null;
  /** D'où viennent les coûts : compte connecté (api), fichier CSV (file), saisie (manual), ou aucun. */
  source: "api" | "file" | "manual" | null;
  metrics: CampaignMetrics;
  /** Période précédente (seulement si demandée). */
  previous: CampaignMetrics | null;
  deltas: CampaignDeltas | null;
};

/** Liste des campagnes et ligne Total (joueurs, clics et adhésions distincts de toutes les campagnes). */
export type CampaignList = {
  rows: CampaignRow[];
  total: CampaignMetrics;
  /** Total de la période précédente (seulement si demandé). */
  previousTotal: CampaignMetrics | null;
};

/** Liste des campagnes avec leurs indicateurs sur la période (et la précédente si `compare`), mise en cache 60 s. */
export const listCampaigns: (period: Period, compare: boolean) => Promise<CampaignList> =
  // Clé « v3 » : la forme du résultat a changé (phase 10 : commissions et gains), une ancienne entrée ne doit jamais
  // resservir.
  cachedDashboard("campaigns-v3", (period: Period, compare: boolean) =>
    listCampaignsUncached(period, compare),
  );

/** Relations qui forment le périmètre d'une campagne (liens d'entrée, liens traqués, pubs) : voir `scopeFromCampaign`. */
export const campaignScopeInclude = {
  inviteLinks: { select: { id: true } },
  trackingLinks: { select: { id: true } },
  adSets: { select: { ads: { select: { inviteLinkId: true, trackingLinkId: true } } } },
} satisfies Prisma.CampaignInclude;

/** Source affichée pour les coûts d'une campagne : « API » seulement s'il existe vraiment des coûts reçus par l'API. */
export function costSourceOf(sources: ReadonlySet<string> | undefined): CampaignRow["source"] {
  if (sources?.has("API")) return "api";
  if (sources?.has("CSV")) return "file";
  if (sources?.has("MANUAL")) return "manual";
  return null;
}

/** Liste des campagnes avec leurs indicateurs sur la période, sans cache (plusieurs requêtes par campagne : lourd). */
export async function listCampaignsUncached(
  period: Period,
  compare = false,
): Promise<CampaignList> {
  const prev = compare ? previousPeriod(period) : null;
  const [campaigns, channels] = await Promise.all([
    prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, include: campaignScopeInclude }),
    prisma.channel.findMany({ select: { id: true, title: true } }),
  ]);
  const channelTitle = new Map(channels.map((c) => [c.id, c.title]));
  const costSources = await prisma.adCost.groupBy({
    by: ["campaignId", "source"],
    where: { campaignId: { not: null } },
  });
  const sourcesByCampaign = new Map<string, Set<string>>();
  for (const row of costSources) {
    if (!row.campaignId) continue;
    const set = sourcesByCampaign.get(row.campaignId) ?? new Set<string>();
    set.add(row.source);
    sourcesByCampaign.set(row.campaignId, set);
  }
  const scoped = campaigns.map((c) => ({ c, campaignId: c.id, scope: scopeFromCampaign(c) }));
  const rows: CampaignRow[] = [];
  for (const { c, scope } of scoped) {
    const [totals, prevTotals] = await Promise.all([
      campaignTotals(c.id, scope, period),
      prev ? campaignTotals(c.id, scope, prev) : Promise.resolve(null),
    ]);
    const metrics = computeMetrics(totals);
    const previous = prevTotals ? computeMetrics(prevTotals) : null;
    rows.push({
      id: c.id,
      name: c.name,
      adPlatform: c.adPlatform,
      vertical: c.vertical,
      status: c.status,
      channels: scope.channelIds.map((id) => channelTitle.get(id) ?? "?"),
      links: scope.inviteLinkIds.length,
      offers: scope.affiliateCampaignIds.length,
      importedFrom: c.adPlatform && isImportedShell(c) ? c.adPlatform : null,
      source: costSourceOf(sourcesByCampaign.get(c.id)),
      metrics,
      previous,
      deltas: previous ? campaignDeltas(metrics, previous) : null,
    });
  }
  const [total, previousTotal] = await Promise.all([
    totalsForScopes(scoped, period).then(computeMetrics),
    prev ? totalsForScopes(scoped, prev).then(computeMetrics) : Promise.resolve(null),
  ]);
  return { rows, total, previousTotal };
}

const ZERO_TOTALS: Required<CampaignTotals> = {
  spend: 0,
  members: 0,
  registrations: 0,
  ftds: 0,
  revenue: 0,
  entryClicks: 0,
  offerClicks: 0,
  deposits: 0,
  depositAmount: 0,
  cpaCommissions: 0,
  revshareCommissions: 0,
};

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Totaux d'une campagne sur la période : dépense, clics d'entrée, membres, clics d'offre, inscriptions, FTD, dépôts, NGR,
 * et nos commissions (phase 10) : CPA de ses joueurs (événements CPA / CPA_REVERSAL datés : + au crédit, − le jour de
 * l'annulation) et part de revshare de ses offres Link Affi (agrégat par offre et par jour, `revshareRowWhere`).
 * Membres = demandes d'adhésion passées par ses liens d'entrée. Joueurs = rattachés à un clic de ses liens, à un de
 * ses membres, OU (sans clic) appartenant à une de ses campagnes Link Affi (voir `campaignPlayerWhere`).
 * Toutes les dates sont celles de Link Affi : inscription (`registeredAt`), premier dépôt (`ftdAt`), événements
 * (`occurredAt`) ; le NGR est la somme des événements NGR datés dans la période, jamais le cumul du joueur.
 */
export async function campaignTotals(
  campaignId: string,
  scope: CampaignScope,
  period: Period,
): Promise<Required<CampaignTotals>> {
  return totalsForScopes([{ campaignId, scope }], period);
}

function union(lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

/**
 * Totaux sur la réunion de plusieurs campagnes (ligne Total de /campaigns) : chaque joueur, clic, adhésion et
 * événement n'est compté qu'une fois, même si deux campagnes partagent une offre ou un lien.
 */
export async function totalsForScopes(
  items: ReadonlyArray<{ campaignId: string; scope: CampaignScope }>,
  period: Period,
): Promise<Required<CampaignTotals>> {
  if (items.length === 0) return { ...ZERO_TOTALS };
  const since = periodStart(period);
  const until = periodEnd(period);
  const { dateFrom, dateTo } = periodDates(period);
  const within = { gte: since, lt: until };
  const campaignIds = items.map((i) => i.campaignId);
  const inviteLinkIds = union(items.map((i) => i.scope.inviteLinkIds));
  const trackingLinkIds = union(items.map((i) => i.scope.trackingLinkIds));
  const offerIds = union(items.map((i) => i.scope.affiliateCampaignIds));
  const single = items.length === 1 ? items[0]! : null;
  const playerWhere = (
    single
      ? campaignPlayerWhere(single.scope)
      : { OR: items.map((i) => campaignPlayerWhere(i.scope)) }
  ) as Prisma.PlayerWhereInput;
  const offerClickWhere = (
    single
      ? campaignOfferClickWhere(single.scope)
      : { OR: items.map((i) => campaignOfferClickWhere(i.scope)) }
  ) as Prisma.ClickWhereInput;
  const [
    spendAgg,
    members,
    registrations,
    ftds,
    entryClicks,
    offerClicks,
    depositEvents,
    ngrEvents,
    cpaEvents,
    revshare,
  ] = await Promise.all([
    prisma.adCost.aggregate({
      _sum: { spend: true },
      where: {
        date: { gte: dateFrom, lte: dateTo },
        OR: [
          { campaignId: { in: campaignIds } },
          { adSet: { campaignId: { in: campaignIds } } },
          { ad: { adSet: { campaignId: { in: campaignIds } } } },
        ],
      },
    }),
    inviteLinkIds.length
      ? prisma.membership.count({
          where: {
            inviteLinkId: { in: inviteLinkIds },
            requestedAt: within,
            status: { in: ["APPROVED", "LEFT", "KICKED"] },
          },
        })
      : 0,
    prisma.player.count({ where: { AND: [playerWhere, { registeredAt: within }] } }),
    prisma.player.count({ where: { AND: [playerWhere, { ftdAt: within }] } }),
    trackingLinkIds.length
      ? prisma.click.count({
          where: {
            trackingLinkId: { in: trackingLinkIds },
            trackingLink: { kind: "AD_ENTRY" },
            isBot: false,
            createdAt: within,
          },
        })
      : 0,
    prisma.click.count({ where: { AND: [offerClickWhere, { createdAt: within }] } }),
    prisma.playerEvent.aggregate({
      _count: { _all: true },
      _sum: { amount: true },
      where: {
        type: { in: ["FTD", "DEPOSIT", "REDEPOSIT"] },
        occurredAt: within,
        player: playerWhere,
      },
    }),
    prisma.playerEvent.aggregate({
      _sum: { amount: true },
      where: { type: "NGR", occurredAt: within, player: playerWhere },
    }),
    prisma.playerEvent.aggregate({
      _sum: { amount: true },
      where: { type: { in: ["CPA", "CPA_REVERSAL"] }, occurredAt: within, player: playerWhere },
    }),
    offerIds.length
      ? prisma.affiliateDailyStat.aggregate({
          _sum: { revshareRevenue: true },
          where: revshareRowWhere(
            { dateFrom, dateTo, since, until },
            offerIds,
          ) as Prisma.AffiliateDailyStatWhereInput,
        })
      : Promise.resolve(null),
  ]);
  return {
    spend: Number(spendAgg._sum.spend ?? 0),
    members,
    registrations,
    ftds,
    revenue: Number(ngrEvents._sum.amount ?? 0),
    entryClicks,
    offerClicks,
    deposits: depositEvents._count._all,
    depositAmount: Number(depositEvents._sum.amount ?? 0),
    cpaCommissions: round2(Number(cpaEvents._sum.amount ?? 0)),
    revshareCommissions: round2(Number(revshare?._sum.revshareRevenue ?? 0)),
  };
}

/**
 * Campagnes dont les coûts arrivent par l'API d'un compte connecté : rattachées à une campagne pub (identifiant
 * externe ET compte), ou qui ont déjà reçu des coûts de source API. L'import CSV ignore leurs lignes (l'API a
 * priorité) ; un simple compte choisi sans campagne pub ne suffit pas.
 */
export async function apiFedCampaignIds(): Promise<Set<string>> {
  const [linked, withApiCosts] = await Promise.all([
    prisma.campaign.findMany({
      where: { externalCampaignId: { not: null }, connectionId: { not: null } },
      select: { id: true },
    }),
    prisma.adCost.groupBy({
      by: ["campaignId"],
      where: { source: "API", campaignId: { not: null } },
    }),
  ]);
  const ids = new Set(linked.map((c) => c.id));
  for (const r of withApiCosts) if (r.campaignId) ids.add(r.campaignId);
  return ids;
}

/** Arbre campagne → groupes → pubs (pour la correspondance à l'import). */
export async function campaignTree() {
  const campaigns = await prisma.campaign.findMany({
    select: {
      id: true,
      name: true,
      adSets: { select: { id: true, name: true, ads: { select: { id: true, name: true } } } },
    },
  });
  return campaigns;
}

/** Liens d'entrée non encore rattachés à une pub précise. */
export async function unattachedEntryLinks() {
  return prisma.inviteLink.findMany({
    where: { kind: "AD_ENTRY", ad: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, adPlatform: true, channel: { select: { title: true } } },
  });
}

export type ImportedShellOption = {
  id: string;
  name: string;
  adPlatform: AdPlatform | null;
  externalCampaignId: string;
  connectionId: string | null;
  connectionName: string | null;
};

/**
 * Campagnes pub importées par la synchro d'un compte connecté et pas encore rattachées à une de nos campagnes
 * (voir `isImportedShell`), éventuellement limitées à un compte. `exceptId` : la campagne en cours (jamais proposée).
 */
export async function listImportedShells(
  opts: { connectionId?: string; exceptId?: string } = {},
): Promise<ImportedShellOption[]> {
  const rows = await prisma.campaign.findMany({
    where: {
      externalCampaignId: { not: null },
      ...(opts.connectionId ? { connectionId: opts.connectionId } : {}),
      ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      adPlatform: true,
      externalCampaignId: true,
      adExternalIds: true,
      affiliateCampaignIds: true,
      channelIds: true,
      connectionId: true,
      connection: { select: { name: true } },
    },
  });
  return rows.filter(isImportedShell).map((r) => ({
    id: r.id,
    name: r.name,
    adPlatform: r.adPlatform,
    externalCampaignId: r.externalCampaignId!,
    connectionId: r.connectionId,
    connectionName: r.connection?.name ?? null,
  }));
}

export type OfferOption = { id: string; name: string; programName: string };
export type CampaignOptionWithOffers = {
  id: string;
  name: string;
  vertical: string | null;
  status: string;
  offers: OfferOption[];
};

/**
 * Nos campagnes avec leurs offres Link Affi (pour le bouton « Offre » des messages et envois, et les filtres).
 * Les offres inactives ou supprimées côté Link Affi sont ignorées.
 */
export async function listCampaignOptions(): Promise<CampaignOptionWithOffers[]> {
  const [campaigns, offers] = await Promise.all([
    prisma.campaign.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, vertical: true, status: true, affiliateCampaignIds: true },
    }),
    prisma.affiliateCampaign.findMany({
      where: { isActive: true },
      select: { id: true, name: true, program: { select: { name: true } } },
    }),
  ]);
  const byId = new Map(
    offers.map((o) => [o.id, { id: o.id, name: o.name, programName: o.program.name }]),
  );
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    vertical: c.vertical,
    status: c.status,
    offers: jsonIds(c.affiliateCampaignIds)
      .map((id) => byId.get(id))
      .filter((o): o is OfferOption => !!o),
  }));
}

export type OfferCandidateRow = {
  id: string;
  name: string;
  programName: string;
  campaignKey: string | null;
  externalId: string;
  trackingUrlTemplate: string;
  vertical: string | null;
  /** Affilié Link Affi propriétaire de l'offre (`raw.affiliate_id`), si connu. */
  affiliateId: string | null;
  /** Offre à nous : elle porte déjà nos clics (sub-ID), ou elle appartient au même affilié qu'une telle offre. */
  ours: boolean;
};

/**
 * Campagnes Link Affi synchronisées et actives, pour choisir les offres d'une campagne, avec leur affilié et un repère
 * « à nous ». La synchro lit toutes les campagnes de Link Affi (tous affiliés) : sans ce repère, on pourrait rattacher
 * par erreur l'offre d'un autre affilié et faire entrer ses joueurs dans nos statistiques. Nos affiliés se déduisent
 * des offres qui portent nos clics : joueurs retrouvés par sub-ID, ou clics avec sub-ID sur nos boutons Offre.
 */
export async function listOfferCandidates(): Promise<OfferCandidateRow[]> {
  const [rows, withPlayers, withClicks] = await Promise.all([
    prisma.affiliateCampaign.findMany({
      where: { isActive: true },
      orderBy: [{ program: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        campaignKey: true,
        externalId: true,
        trackingUrlTemplate: true,
        vertical: true,
        raw: true,
        program: { select: { name: true } },
      },
    }),
    prisma.player.groupBy({ by: ["affiliateCampaignId"], where: { clickId: { not: null } } }),
    prisma.trackingLink.findMany({
      where: {
        kind: "OFFER",
        affiliateCampaignId: { not: null },
        clickRecords: { some: { subId: { not: null }, isBot: false } },
      },
      select: { affiliateCampaignId: true },
      distinct: ["affiliateCampaignId"],
    }),
  ]);
  const ourOfferIds = new Set<string>(withPlayers.map((p) => p.affiliateCampaignId));
  for (const l of withClicks) if (l.affiliateCampaignId) ourOfferIds.add(l.affiliateCampaignId);
  // Les offres qui portent nos clics peuvent être inactives aujourd'hui : on relit leur affilié séparément.
  const owners = ourOfferIds.size
    ? await prisma.affiliateCampaign.findMany({
        where: { id: { in: [...ourOfferIds] } },
        select: { raw: true },
      })
    : [];
  const ourAffiliateIds = new Set(
    owners.map((o) => affiliateIdOf(o.raw)).filter((x): x is string => !!x),
  );
  return markOurOffers(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      programName: r.program.name,
      campaignKey: r.campaignKey,
      externalId: r.externalId,
      trackingUrlTemplate: r.trackingUrlTemplate,
      vertical: r.vertical,
      affiliateId: affiliateIdOf(r.raw),
    })),
    ourOfferIds,
    ourAffiliateIds,
  );
}

export type ConnectionOption = {
  id: string;
  platform: AdPlatform;
  name: string;
  externalId: string;
};

/** Comptes publicitaires connectés et actifs (phase 7), pour rattacher une campagne à son compte. */
export async function listActiveConnections(): Promise<ConnectionOption[]> {
  return prisma.adAccountConnection.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ platform: "asc" }, { name: "asc" }],
    select: { id: true, platform: true, name: true, externalId: true },
  });
}
