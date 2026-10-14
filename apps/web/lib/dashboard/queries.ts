import { jsonIds, revshareRowWhere, sumRevshareByDay } from "@linkaffipro/core";
import {
  ourAffiliateCampaignIds,
  prisma,
  ourPlayers,
  type Prisma,
  type Vertical,
} from "@linkaffipro/db";
import { affiliateScope } from "@/lib/affiliates/campaigns";
import { affiliateMembershipWhere, affiliatePlayerWhere } from "@/lib/affiliates/scope";
import { campaignOfferClickWhere, campaignPlayerWhere } from "@/lib/campaigns/attribution";
import { periodDates, periodDayKeys, periodEnd, periodStart, type Period } from "@/lib/periods";
import { aggregateByDay, type DaySeries } from "./aggregate";
import { cachedDashboard } from "./cache";
import { campaignScope } from "./campaign-scope";

export type DashboardFilters = {
  period: Period;
  vertical: Vertical | "";
  channelId: string;
  /** Campagne (la nôtre) : périmètre via `campaignScope` (lib/dashboard/campaign-scope.ts). */ campaignId?: string;
  /**
   * Affilié Link Affi (phase 13) : demandes de ses membres dans les canaux de ses campagnes, clics d'offre portant une
   * de ses clés (paramètre `tg`), ses joueurs (clic portant une de ses clés, ou membre rattaché) ; ni clic pub, ni
   * dépense, ni part du revenu (rien de cela ne se rattache à un affilié).
   */
  affiliateId?: string;
};

/** Groupe d'affichage : parcours Telegram (demandes → départs) ou argent (clics pub → NGR). */
export type MetricGroup = "telegram" | "argent";
export type Metric = {
  key: string;
  label: string;
  series: DaySeries;
  money?: boolean;
  group: MetricGroup;
  /** Précision affichée sous le chiffre (ex. filtre canal : commissions sans la part du revenu). */
  note?: string;
};

/** Filtre canal : la part de revshare n'existe que par offre, la dépense que par campagne (rien par canal). */
export const CHANNEL_COMMISSIONS_NOTE =
  "Primes des joueurs seulement : la part du revenu et la dépense pub ne se rattachent pas à un canal.";

/** Filtre affilié (phase 13) : même règle qu'un canal, la part du revenu et la dépense pub ne s'y rattachent pas. */
export const AFFILIATE_COMMISSIONS_NOTE =
  "Primes de ses joueurs seulement : la part du revenu et la dépense pub ne se rattachent pas à un affilié.";

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Offres Link Affi dont la part de revshare compte dans la vue filtrée (même règle que les statistiques journalières
 * du worker) : une campagne → ses offres ; un univers → les offres de ses campagnes ; rien → toutes nos offres ; un canal
 * → aucune (null). Avec campagne ET univers, les offres de la campagne si elle est de cet univers.
 */
async function revshareOffers(
  f: DashboardFilters,
  scopeOffers: string[] | null,
): Promise<string[] | null> {
  if (f.channelId || f.affiliateId) return null;
  if (scopeOffers) {
    if (!f.vertical) return scopeOffers;
    const c = await prisma.campaign.findFirst({
      where: { id: f.campaignId, vertical: f.vertical },
      select: { id: true },
    });
    return c ? scopeOffers : [];
  }
  if (f.vertical) {
    const campaigns = await prisma.campaign.findMany({
      where: { vertical: f.vertical },
      select: { affiliateCampaignIds: true },
    });
    return [...new Set(campaigns.flatMap((c) => jsonIds(c.affiliateCampaignIds)))];
  }
  return ourAffiliateCampaignIds();
}

/** Dépense pub de la vue filtrée (`AdCost` au niveau campagne, groupe ou pub) ; null avec un filtre canal. */
function costWhere(f: DashboardFilters): Prisma.AdCostWhereInput | null {
  if (f.channelId || f.affiliateId) return null;
  const campaign: Prisma.CampaignWhereInput = {
    ...(f.campaignId ? { id: f.campaignId } : {}),
    ...(f.vertical ? { vertical: f.vertical } : {}),
  };
  if (!f.campaignId && !f.vertical) return {};
  return {
    OR: [{ campaign }, { adSet: { campaign } }, { ad: { adSet: { campaign } } }],
  };
}

export type ChannelRow = {
  channelId: string;
  title: string;
  requests: number;
  approved: number;
  joined: number;
  left: number;
  offerClicks: number;
  registrations: number;
  ftds: number;
  depositAmount: number;
};

export type DashboardData = { metrics: Metric[]; channels: ChannelRow[]; keys: string[] };

/** Indicateurs du tableau de bord, mis en cache 60 s par période et filtres (voir ./cache.ts). */
// « v2 » : commissions, dépense pub et gains ajoutés (phase 10) ; une ancienne entrée ne doit jamais resservir.
export const loadDashboard: (f: DashboardFilters) => Promise<DashboardData> = cachedDashboard(
  "overview-v2",
  (f: DashboardFilters) => loadDashboardUncached(f),
);

/**
 * Adhésion « d'origine » d'un membre : passée par le lien d'invitation d'une pub. Le canal d'un joueur ou d'un clic
 * d'offre est celui du message cliqué, à défaut celui de cette adhésion (la plus récente) : même règle que les
 * statistiques journalières du worker (apps/worker/src/stats/daily.ts), pour que la vue d'ensemble filtrée par canal
 * donne les mêmes chiffres que la ligne du canal et que l'entonnoir.
 */
const AD_MEMBERSHIP = { inviteLink: { ad: { isNot: null } } } satisfies Prisma.MembershipWhereInput;

/** Membre arrivé par une pub dans un des canaux (MemberWhereInput). */
function arrivedByAdIn(channelIds: string[]): Prisma.MemberWhereInput {
  return { memberships: { some: { ...AD_MEMBERSHIP, channelId: { in: channelIds } } } };
}

/**
 * Périmètre des joueurs selon les filtres univers / canal, règle du worker : clic depuis un message d'un des canaux
 * filtrés, OU (clic sans message ou aucun clic) membre arrivé par une pub dans un de ces canaux. Filtre univers seul :
 * aussi les joueurs sans clic rattachés par l'offre Link Affi d'une de nos campagnes de cet univers (le worker leur
 * donne l'univers de leur campagne), sans quoi la somme des univers serait inférieure au total. Un filtre canal ne les
 * reprend pas : rien ne dit de quel canal ils viennent (le worker ne les met dans aucune ligne de canal).
 */
async function channelPlayerFilter(
  f: DashboardFilters,
  channelIds: string[],
): Promise<Prisma.PlayerWhereInput | null> {
  if (!f.channelId && !f.vertical) return null;
  const or: Prisma.PlayerWhereInput[] = [
    { click: { post: { channelId: { in: channelIds } } } },
    {
      OR: [{ clickId: null }, { click: { postId: null } }],
      member: arrivedByAdIn(channelIds),
    },
  ];
  if (!f.channelId) {
    const campaigns = await prisma.campaign.findMany({
      where: { vertical: f.vertical || undefined },
      select: { affiliateCampaignIds: true },
    });
    const offers = new Set(campaigns.flatMap((c) => jsonIds(c.affiliateCampaignIds)));
    if (offers.size > 0) or.push({ clickId: null, affiliateCampaignId: { in: [...offers] } });
  }
  return { OR: or };
}

/** Indicateurs du tableau de bord sur la période choisie (requêtes agrégées, bornées par la période), sans cache. */
export async function loadDashboardUncached(f: DashboardFilters): Promise<DashboardData> {
  const start = periodStart(f.period);
  const end = periodEnd(f.period);
  const keys = periodDayKeys(f.period);
  const within = { gte: start, lt: end };
  const channelWhere = {
    ...(f.channelId ? { id: f.channelId } : {}),
    ...(f.vertical ? { vertical: f.vertical } : {}),
  };
  const channels = await prisma.channel.findMany({
    where: { isActive: true, ...channelWhere },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
  const channelIds = channels.map((c) => c.id);
  const filtered = Boolean(f.channelId || f.vertical);
  // Filtre canal / univers appliqué même si la liste est vide (univers sans canal : rien, pas tout).
  const byChannel: Prisma.MembershipWhereInput = filtered ? { channelId: { in: channelIds } } : {};

  // Filtre Campagne (la nôtre) : adhésions par ses liens d'entrée (comme sa fiche et sa ligne de l'onglet Campagnes :
  // un canal peut servir à plusieurs campagnes), clics pub par ses liens, clics d'offre et joueurs selon la règle
  // commune (@linkaffipro/core, campaign-attribution).
  const scope = f.campaignId ? await campaignScope(f.campaignId) : null;
  const membershipScope: Prisma.MembershipWhereInput = scope
    ? { inviteLinkId: { in: scope.inviteLinkIds } }
    : {};
  // Filtre Affilié Link Affi (phase 13) : ses membres dans les canaux de ses campagnes, ses clics d'offre, ses joueurs.
  const affiliate = f.affiliateId ? await affiliateScope(f.affiliateId) : null;
  const affiliateMemberships: Prisma.MembershipWhereInput = affiliate
    ? (affiliateMembershipWhere(affiliate.campaigns) as Prisma.MembershipWhereInput)
    : {};
  const membershipWhere = (date: Prisma.MembershipWhereInput): Prisma.MembershipWhereInput => ({
    AND: [date, byChannel, membershipScope, affiliateMemberships],
  });
  const entryClickWhere: Prisma.ClickWhereInput = {
    createdAt: within,
    isBot: false,
    trackingLink: { kind: "AD_ENTRY", ...(filtered ? { channelId: { in: channelIds } } : {}) },
    ...(scope ? { trackingLinkId: { in: scope.trackingLinkIds } } : {}),
  };
  const offerClickWhere: Prisma.ClickWhereInput = {
    AND: [
      { createdAt: within, isBot: false, subId: { not: null } },
      filtered
        ? {
            OR: [
              { post: { channelId: { in: channelIds } } },
              { postId: null, member: arrivedByAdIn(channelIds) },
            ],
          }
        : {},
      scope ? (campaignOfferClickWhere(scope) as Prisma.ClickWhereInput) : {},
      affiliate ? { linkaffiTelegramCampaignKey: { in: affiliate.keys } } : {},
    ],
  };

  // « Nos » joueurs seulement (phase 8) : rattachés à un de nos clics, ou à une campagne Link Affi d'une de nos campagnes.
  const ours = await ourPlayers();
  const channelFilter = await channelPlayerFilter(f, channelIds);
  const playerAnd: Prisma.PlayerWhereInput[] = [
    ours,
    ...(channelFilter ? [channelFilter] : []),
    ...(scope ? [campaignPlayerWhere(scope) as Prisma.PlayerWhereInput] : []),
    ...(affiliate ? [affiliatePlayerWhere(affiliate.keys) as Prisma.PlayerWhereInput] : []),
  ];
  const playerScope = { player: { AND: playerAnd } };
  // Canal d'arrivée par une pub (la plus récente), pour le tableau par canal.
  const adOrigin = {
    select: {
      memberships: {
        where: AD_MEMBERSHIP,
        orderBy: { requestedAt: "desc" },
        take: 1,
        select: { channelId: true },
      },
    },
  } as const;
  const channelOfPlayer = {
    click: { select: { post: { select: { channelId: true } } } },
    member: adOrigin,
  } as const;
  type WithOrigin = {
    click?: { post: { channelId: string } | null } | null;
    post?: { channelId: string } | null;
    member: { memberships: Array<{ channelId: string }> } | null;
  };
  /** Canal du message cliqué, à défaut celui d'arrivée par une pub (règle du worker). */
  const channelOf = (x: WithOrigin) =>
    x.post?.channelId ?? x.click?.post?.channelId ?? x.member?.memberships[0]?.channelId;
  const [
    requested,
    approved,
    joined,
    left,
    entryClicks,
    offerClicks,
    registrations,
    ftds,
    deposits,
    ngrEvents,
    cpaEvents,
  ] = await Promise.all([
    prisma.membership.findMany({
      where: membershipWhere({ requestedAt: within }),
      select: { requestedAt: true, channelId: true },
    }),
    prisma.membership.findMany({
      where: membershipWhere({ approvedAt: within }),
      select: { approvedAt: true, channelId: true },
    }),
    prisma.membership.findMany({
      where: membershipWhere({ joinedAt: within }),
      select: { joinedAt: true, channelId: true },
    }),
    prisma.membership.findMany({
      where: membershipWhere({ leftAt: within }),
      select: { leftAt: true, channelId: true },
    }),
    // Un affilié n'a pas de pub : aucun clic pub.
    affiliate
      ? Promise.resolve([] as Array<{ createdAt: Date }>)
      : prisma.click.findMany({ where: entryClickWhere, select: { createdAt: true } }),
    prisma.click.findMany({
      where: offerClickWhere,
      select: { createdAt: true, post: { select: { channelId: true } }, member: adOrigin },
    }),
    // Inscriptions et FTD : une seule source, comme les statistiques journalières du worker — dates Link Affi du joueur
    // (`registeredAt`, `ftdAt`) ; un FTD annulé par Link Affi (ftdAt remis à vide) ne compte plus.
    prisma.player.findMany({
      where: { AND: [...playerAnd, { registeredAt: within }] },
      select: { registeredAt: true, ...channelOfPlayer },
    }),
    prisma.player.findMany({
      where: { AND: [...playerAnd, { ftdAt: within }] },
      select: { ftdAt: true, ...channelOfPlayer },
    }),
    prisma.playerEvent.findMany({
      where: { type: { in: ["FTD", "DEPOSIT", "REDEPOSIT"] }, occurredAt: within, ...playerScope },
      select: { occurredAt: true, amount: true, player: { select: channelOfPlayer } },
    }),
    // NGR daté : somme des variations (`PlayerEvent` NGR) dans la période, jamais le cumul du joueur.
    prisma.playerEvent.findMany({
      where: { type: "NGR", occurredAt: within, ...playerScope },
      select: { occurredAt: true, amount: true },
    }),
    // Commissions CPA (phase 10) : + le jour du crédit, − le jour de l'annulation ; mêmes joueurs que le reste.
    prisma.playerEvent.findMany({
      where: { type: { in: ["CPA", "CPA_REVERSAL"] }, occurredAt: within, ...playerScope },
      select: { occurredAt: true, amount: true },
    }),
  ]);

  // Part de revshare de nos offres (agrégat Link Affi par offre et par jour) et dépense pub : rien par canal.
  const { dateFrom, dateTo } = periodDates(f.period);
  const offers = await revshareOffers(f, scope ? scope.affiliateCampaignIds : null);
  const costScope = costWhere(f);
  const [revshareRows, costs] = await Promise.all([
    offers && offers.length
      ? prisma.affiliateDailyStat.findMany({
          where: revshareRowWhere(
            { dateFrom, dateTo, since: start, until: end },
            offers,
          ) as Prisma.AffiliateDailyStatWhereInput,
          select: {
            date: true,
            sourceCreatedAt: true,
            affiliateCampaignId: true,
            revshareRevenue: true,
          },
        })
      : Promise.resolve([]),
    costScope
      ? prisma.adCost.findMany({
          where: { AND: [{ date: { gte: dateFrom, lte: dateTo } }, costScope] },
          select: { date: true, spend: true },
        })
      : Promise.resolve(null),
  ]);
  const revshareByDay = sumRevshareByDay(revshareRows, new Set(offers ?? []));
  const cpaSeries = aggregateByDay(
    cpaEvents.map((e) => ({ at: e.occurredAt, value: Number(e.amount ?? 0) })),
    keys,
  );
  const commissionValues = keys.map((k, i) =>
    round2((cpaSeries.values[i] ?? 0) + (revshareByDay.get(k) ?? 0)),
  );
  const spendByDay = new Map<string, number>();
  for (const c of costs ?? []) {
    const k = c.date.toISOString().slice(0, 10);
    spendByDay.set(k, (spendByDay.get(k) ?? 0) + Number(c.spend));
  }
  const spendValues = keys.map((k) => round2(spendByDay.get(k) ?? 0));
  /** Montant jour par jour (total au centime). */
  const money = (key: string, label: string, values: number[], note?: string): Metric => ({
    key,
    label,
    group: "argent",
    money: true,
    series: { keys, values, total: round2(values.reduce((a, b) => a + b, 0)) },
    ...(note ? { note } : {}),
  });

  // Deux lignes, dans l'ordre du parcours : Telegram (demandes → départs) puis argent (clics pub → NGR).
  const metrics: Metric[] = [
    {
      key: "requests",
      label: "Demandes",
      group: "telegram",
      series: aggregateByDay(
        requested.map((m) => m.requestedAt),
        keys,
      ),
    },
    {
      key: "approved",
      label: "Acceptés",
      group: "telegram",
      series: aggregateByDay(
        approved.map((m) => m.approvedAt!),
        keys,
      ),
    },
    {
      key: "joined",
      label: "Entrées",
      group: "telegram",
      series: aggregateByDay(
        joined.map((m) => m.joinedAt!),
        keys,
      ),
    },
    {
      key: "left",
      label: "Départs",
      group: "telegram",
      series: aggregateByDay(
        left.map((m) => m.leftAt!),
        keys,
      ),
    },
    {
      key: "entryClicks",
      label: "Clics pub",
      group: "argent",
      series: aggregateByDay(
        entryClicks.map((c) => c.createdAt),
        keys,
      ),
    },
    {
      key: "offerClicks",
      label: "Clics offre",
      group: "argent",
      series: aggregateByDay(
        offerClicks.map((c) => c.createdAt),
        keys,
      ),
    },
    {
      key: "registrations",
      label: "Inscriptions",
      group: "argent",
      series: aggregateByDay(
        registrations.map((p) => p.registeredAt!),
        keys,
      ),
    },
    {
      key: "ftds",
      label: "Premiers dépôts",
      group: "argent",
      series: aggregateByDay(
        ftds.map((p) => p.ftdAt!),
        keys,
      ),
    },
    {
      key: "depositAmount",
      label: "Dépôts (€)",
      group: "argent",
      money: true,
      series: aggregateByDay(
        deposits.map((e) => ({ at: e.occurredAt, value: Number(e.amount ?? 0) })),
        keys,
      ),
    },
    {
      key: "ngr",
      label: "Revenu net (€)",
      group: "argent",
      money: true,
      series: aggregateByDay(
        ngrEvents.map((e) => ({ at: e.occurredAt, value: Number(e.amount ?? 0) })),
        keys,
      ),
    },
    // Gains (phase 10) = commissions − dépense pub ; avec un filtre canal, commissions sans la part du revenu et ni
    // dépense ni gains (ils ne se rattachent pas à un canal).
    ...(costs ? [money("spend", "Dépense pub (€)", spendValues)] : []),
    money(
      "commissions",
      "Commissions (€)",
      commissionValues,
      f.channelId
        ? CHANNEL_COMMISSIONS_NOTE
        : f.affiliateId
          ? AFFILIATE_COMMISSIONS_NOTE
          : undefined,
    ),
    ...(costs
      ? [
          money(
            "gains",
            "Gains (€)",
            keys.map((_, i) => round2(commissionValues[i]! - spendValues[i]!)),
          ),
        ]
      : []),
  ];

  const rows = new Map<string, ChannelRow>(
    channels.map((c) => [
      c.id,
      {
        channelId: c.id,
        title: c.title,
        requests: 0,
        approved: 0,
        joined: 0,
        left: 0,
        offerClicks: 0,
        registrations: 0,
        ftds: 0,
        depositAmount: 0,
      },
    ]),
  );
  const bump = (
    id: string | null | undefined,
    k: keyof Omit<ChannelRow, "channelId" | "title">,
    v = 1,
  ) => {
    if (!id) return;
    const r = rows.get(id);
    if (r) r[k] += v;
  };
  for (const m of requested) bump(m.channelId, "requests");
  for (const m of approved) bump(m.channelId, "approved");
  for (const m of joined) bump(m.channelId, "joined");
  for (const m of left) bump(m.channelId, "left");
  for (const c of offerClicks) bump(channelOf(c), "offerClicks");
  for (const p of registrations) bump(channelOf(p), "registrations");
  for (const p of ftds) bump(channelOf(p), "ftds");
  for (const e of deposits) bump(channelOf(e.player), "depositAmount", Number(e.amount ?? 0));

  return {
    metrics,
    channels: [...rows.values()].filter(
      (r) =>
        r.requests ||
        r.approved ||
        r.joined ||
        r.left ||
        r.offerClicks ||
        r.registrations ||
        r.ftds ||
        r.depositAmount ||
        f.channelId,
    ),
    keys,
  };
}
