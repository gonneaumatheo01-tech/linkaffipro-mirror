import { jsonIds } from "@linkaffipro/core";
import { prisma, ourPlayers, type Prisma, type Vertical } from "@linkaffipro/db";
import { campaignOfferClickWhere, campaignPlayerWhere } from "@/lib/campaigns/attribution";
import { periodDayKeys, periodEnd, periodStart, type Period } from "@/lib/periods";
import { aggregateByDay, type DaySeries } from "./aggregate";
import { cachedDashboard } from "./cache";
import { campaignScope } from "./campaign-scope";

export type DashboardFilters = {
  period: Period;
  vertical: Vertical | "";
  channelId: string;
  /** Campagne (la nôtre) : périmètre via `campaignScope` (lib/dashboard/campaign-scope.ts). */ campaignId?: string;
};

/** Groupe d'affichage : parcours Telegram (demandes → départs) ou argent (clics pub → NGR). */
export type MetricGroup = "telegram" | "argent";
export type Metric = {
  key: string;
  label: string;
  series: DaySeries;
  money?: boolean;
  group: MetricGroup;
};

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
export const loadDashboard: (f: DashboardFilters) => Promise<DashboardData> = cachedDashboard(
  "overview",
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
  const membershipWhere = (date: Prisma.MembershipWhereInput): Prisma.MembershipWhereInput => ({
    AND: [date, byChannel, membershipScope],
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
    ],
  };

  // « Nos » joueurs seulement (phase 8) : rattachés à un de nos clics, ou à une campagne Link Affi d'une de nos campagnes.
  const ours = await ourPlayers();
  const channelFilter = await channelPlayerFilter(f, channelIds);
  const playerAnd: Prisma.PlayerWhereInput[] = [
    ours,
    ...(channelFilter ? [channelFilter] : []),
    ...(scope ? [campaignPlayerWhere(scope) as Prisma.PlayerWhereInput] : []),
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
    prisma.click.findMany({ where: entryClickWhere, select: { createdAt: true } }),
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
  ]);

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
