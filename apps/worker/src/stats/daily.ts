import {
  buildCampaignIndex,
  campaignsOfMember,
  campaignsOfOfferClick,
  campaignsOfPlayer,
  scopeFromCampaign,
  type CampaignIndex,
} from "@linkaffipro/core";
import { prisma, ourPlayers, type Prisma } from "@linkaffipro/db";
import { logger } from "../logger";
import {
  METRIC_KEYS,
  aggregateDaily,
  dayKey,
  dayKeysBetween,
  parisMidnightUtc,
  type DailyRow,
  type StatEvent,
} from "./aggregate";

/** Setting : heure et nature du dernier recalcul réussi (affiché « Chiffres calculés le … » dans l'onglet Campagnes). */
export const DAILY_LAST_RUN_KEY = "stats.daily.lastRunAt";

/** Dates antérieures : valeurs de remplacement (date absente chez Link Affi), jamais un vrai premier jour de données. */
const PLAUSIBLE_SINCE = new Date("2020-01-01T00:00:00Z");

const ZERO = {
  requests: 0,
  approved: 0,
  joined: 0,
  left: 0,
  entryClicks: 0,
  offerClicks: 0,
  registrations: 0,
  ftds: 0,
  deposits: 0,
  depositAmount: 0,
  ngr: 0,
  spend: 0,
};

/**
 * Recalcule `DailyStat` pour une fenêtre de jours (Paris), toutes dimensions confondues.
 * Idempotent : chaque (jour, dimension) est écrit par upsert ; les lignes de la fenêtre qui n'ont plus d'événement
 * sont remises à zéro. En mode complet (`full`), la fenêtre commence au premier jour de nos données et TOUTES les
 * lignes existantes sont reprises, y compris celles d'avant ce jour (anciens totaux Link Affi globaux, par exemple).
 */
export async function recomputeDailyStats(
  opts: { days?: number; full?: boolean } = {},
): Promise<{ days: number; rows: number }> {
  const now = new Date();
  const todayKey = dayKey(now);
  let fromKey: string;
  if (opts.full) {
    fromKey = (await earliestDataDay()) ?? todayKey;
  } else {
    const days = Math.max(1, Math.min(opts.days ?? 3, 400));
    fromKey = dayKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  }
  const start = parisMidnightUtc(fromKey);
  const dayList = dayKeysBetween(start, now);
  const events = await loadEvents(start);
  const rows = aggregateDaily(events, dayList);

  const existing = await prisma.dailyStat.findMany({
    where: opts.full ? {} : { date: { gte: new Date(`${fromKey}T00:00:00Z`) } },
    select: {
      id: true,
      date: true,
      dimension: true,
      requests: true,
      approved: true,
      joined: true,
      left: true,
      entryClicks: true,
      offerClicks: true,
      registrations: true,
      ftds: true,
      deposits: true,
      depositAmount: true,
      ngr: true,
      spend: true,
    },
  });
  const known = new Map(
    existing.map((e) => [`${e.date.toISOString().slice(0, 10)}|${e.dimension}`, e]),
  );
  const sameAs = (e: (typeof existing)[number], r: Record<(typeof METRIC_KEYS)[number], number>) =>
    METRIC_KEYS.every((k) => Number(e[k]) === r[k]);

  // Remise à zéro des lignes existantes qui n'ont plus d'événement (celles déjà à zéro ne sont pas réécrites).
  const produced = new Set(rows.map((r) => `${r.date}|${r.dimension}`));
  const toZero = existing.filter(
    (e) => !produced.has(`${e.date.toISOString().slice(0, 10)}|${e.dimension}`) && !sameAs(e, ZERO),
  );
  if (toZero.length > 0) {
    await prisma.dailyStat.updateMany({
      where: { id: { in: toZero.map((e) => e.id) } },
      data: ZERO,
    });
  }

  let written = 0;
  for (const r of rows) {
    const prev = known.get(`${r.date}|${r.dimension}`);
    if (prev && sameAs(prev, r)) continue; // inchangée : pas d'écriture
    await writeRow(r);
    written++;
  }
  // Heure du recalcul réussi, écrite même si aucune ligne n'a changé : les lignes inchangées ne sont pas réécrites, leur
  // `updatedAt` ne dit donc pas quand le dernier calcul a tourné.
  const lastRun = {
    at: new Date().toISOString(),
    full: opts.full === true,
    from: fromKey,
    rows: rows.length,
    written,
    zeroed: toZero.length,
  };
  await prisma.setting.upsert({
    where: { key: DAILY_LAST_RUN_KEY },
    create: { key: DAILY_LAST_RUN_KEY, value: lastRun },
    update: { value: lastRun },
  });
  logger.info({ ...lastRun, to: todayKey }, "statistiques journalières recalculées");
  return { days: dayList.length, rows: rows.length };
}

async function writeRow(r: DailyRow): Promise<void> {
  const date = new Date(`${r.date}T00:00:00Z`);
  const dims = parseDimension(r.dimension);
  const data = {
    requests: r.requests,
    approved: r.approved,
    joined: r.joined,
    left: r.left,
    entryClicks: r.entryClicks,
    offerClicks: r.offerClicks,
    registrations: r.registrations,
    ftds: r.ftds,
    deposits: r.deposits,
    depositAmount: r.depositAmount,
    ngr: r.ngr,
    spend: r.spend,
  };
  await prisma.dailyStat.upsert({
    where: { date_dimension: { date, dimension: r.dimension } },
    create: { date, dimension: r.dimension, ...dims, ...data },
    update: data,
  });
}

const VERTICALS = new Set(["CASINO", "SPORTS", "DATING"]);

function parseDimension(dim: string): {
  channelId?: string;
  campaignId?: string;
  adId?: string;
  vertical?: Prisma.DailyStatCreateInput["vertical"];
} {
  const [kind, id] = dim.split(":") as [string, string | undefined];
  if (kind === "channel" && id) return { channelId: id };
  if (kind === "campaign" && id) return { campaignId: id };
  if (kind === "ad" && id) return { adId: id };
  if ((kind === "vertical" || kind === "campaigns") && id && VERTICALS.has(id))
    return { vertical: id as Prisma.DailyStatCreateInput["vertical"] };
  return {};
}

/**
 * Premier jour de nos données : adhésions, clics, dépenses et « nos » joueurs (inscription, FTD, événements datés),
 * y compris les joueurs rattachés seulement par l'offre d'une campagne (inscrits parfois bien avant notre premier clic).
 */
async function earliestDataDay(): Promise<string | null> {
  const ours = await ourPlayers();
  const [m, c, reg, ftd, ev, a] = await Promise.all([
    prisma.membership.findFirst({ orderBy: { requestedAt: "asc" }, select: { requestedAt: true } }),
    prisma.click.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.player.findFirst({
      where: { AND: [ours, { registeredAt: { gte: PLAUSIBLE_SINCE } }] },
      orderBy: { registeredAt: "asc" },
      select: { registeredAt: true },
    }),
    prisma.player.findFirst({
      where: { AND: [ours, { ftdAt: { gte: PLAUSIBLE_SINCE } }] },
      orderBy: { ftdAt: "asc" },
      select: { ftdAt: true },
    }),
    prisma.playerEvent.findFirst({
      where: { occurredAt: { gte: PLAUSIBLE_SINCE }, player: ours },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    }),
    prisma.adCost.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const dates = [
    m?.requestedAt,
    c?.createdAt,
    reg?.registeredAt,
    ftd?.ftdAt,
    ev?.occurredAt,
    a?.date,
  ].filter((d): d is Date => d instanceof Date);
  if (dates.length === 0) return null;
  return dayKey(new Date(Math.min(...dates.map((d) => d.getTime()))));
}

/** Champs « campagne » d'un événement : la première campagne, les autres (offre partagée) et leurs univers. */
function campaignFields(
  index: CampaignIndex,
  ids: string[],
): Pick<StatEvent, "campaignId" | "extraCampaignIds" | "campaignVerticals"> {
  return {
    campaignId: ids[0] ?? null,
    extraCampaignIds: ids.length > 1 ? ids.slice(1) : null,
    campaignVerticals: ids.map((id) => index.vertical.get(id)).filter((v): v is string => !!v),
  };
}

/** Charge les événements sources depuis `start` et les enrichit de leurs dimensions. */
async function loadEvents(start: Date): Promise<StatEvent[]> {
  const events: StatEvent[] = [];

  // Nos campagnes : liens d'entrée, liens traqués et offres Link Affi — même règle que le site (@linkaffipro/core).
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      vertical: true,
      channelIds: true,
      affiliateCampaignIds: true,
      inviteLinks: { select: { id: true } },
      trackingLinks: { select: { id: true } },
      adSets: { select: { ads: { select: { inviteLinkId: true, trackingLinkId: true } } } },
    },
  });
  const index = buildCampaignIndex(
    campaigns.map((c) => ({ id: c.id, vertical: c.vertical, scope: scopeFromCampaign(c) })),
  );

  // Pubs précises : lien d'invitation / lien traqué → pub (dimension `ad:`).
  const ads = await prisma.ad.findMany({
    select: { id: true, inviteLinkId: true, trackingLinkId: true },
  });
  const adByInvite = new Map<string, string>();
  const adByTracking = new Map<string, string>();
  for (const a of ads) {
    if (a.inviteLinkId) adByInvite.set(a.inviteLinkId, a.id);
    if (a.trackingLinkId) adByTracking.set(a.trackingLinkId, a.id);
  }
  const channels = await prisma.channel.findMany({ select: { id: true, vertical: true } });
  const channelVertical = new Map(channels.map((c) => [c.id, c.vertical as string | null]));
  const offers = await prisma.affiliateCampaign.findMany({
    where: { vertical: { not: null } },
    select: { id: true, vertical: true },
  });
  const offerVertical = new Map(offers.map((o) => [o.id, o.vertical as string | null]));
  /** Dimensions d'un événement ; l'univers vient du canal, sinon de la campagne, sinon de l'offre Link Affi. */
  const dimsFor = (
    channelId: string | null | undefined,
    campaignIds: string[],
    adId: string | null | undefined,
    offerId?: string | null,
  ) => {
    const fields = campaignFields(index, campaignIds);
    return {
      channelId: channelId ?? null,
      ...fields,
      adId: adId ?? null,
      vertical:
        (channelId ? channelVertical.get(channelId) : null) ??
        fields.campaignVerticals?.[0] ??
        (offerId ? offerVertical.get(offerId) : null) ??
        null,
    };
  };

  // Liens d'entrée par membre (toutes ses demandes) et pub d'origine (dernière demande par un lien de pub).
  const allMemberships = await prisma.membership.findMany({
    where: { inviteLinkId: { not: null } },
    orderBy: { requestedAt: "asc" },
    select: { memberId: true, inviteLinkId: true, channelId: true },
  });
  const memberInvites = new Map<string, string[]>();
  const memberAd = new Map<string, { adId: string; channelId: string }>();
  for (const m of allMemberships) {
    if (!m.inviteLinkId) continue;
    const list = memberInvites.get(m.memberId) ?? [];
    list.push(m.inviteLinkId);
    memberInvites.set(m.memberId, list);
    const adId = adByInvite.get(m.inviteLinkId);
    if (adId) memberAd.set(m.memberId, { adId, channelId: m.channelId });
  }
  const invitesOf = (memberId: string | null | undefined) =>
    memberId ? (memberInvites.get(memberId) ?? []) : [];

  // Adhésions (demande, acceptation, entrée, départ) : rattachées à la campagne et à la pub de leur lien d'entrée.
  const memberships = await prisma.membership.findMany({
    where: {
      OR: [
        { requestedAt: { gte: start } },
        { approvedAt: { gte: start } },
        { joinedAt: { gte: start } },
        { leftAt: { gte: start } },
      ],
    },
    select: {
      memberId: true,
      channelId: true,
      inviteLinkId: true,
      requestedAt: true,
      approvedAt: true,
      joinedAt: true,
      leftAt: true,
      status: true,
    },
  });
  for (const m of memberships) {
    const base = dimsFor(
      m.channelId,
      m.inviteLinkId ? campaignsOfMember(index, [m.inviteLinkId]) : [],
      m.inviteLinkId ? adByInvite.get(m.inviteLinkId) : null,
    );
    if (m.requestedAt >= start) events.push({ kind: "request", at: m.requestedAt, ...base });
    if (m.approvedAt && m.approvedAt >= start)
      events.push({ kind: "approved", at: m.approvedAt, ...base });
    if (m.joinedAt && m.joinedAt >= start) events.push({ kind: "joined", at: m.joinedAt, ...base });
    if (m.leftAt && m.leftAt >= start) events.push({ kind: "left", at: m.leftAt, ...base });
  }

  // Clics : entrée (lien traqué AD_ENTRY → campagne et pub du lien) et offres (même règle que la fiche campagne).
  const clicks = await prisma.click.findMany({
    where: { createdAt: { gte: start }, isBot: false },
    select: {
      createdAt: true,
      subId: true,
      memberId: true,
      trackingLinkId: true,
      trackingLink: {
        select: { kind: true, channelId: true, campaignId: true, affiliateCampaignId: true },
      },
      post: { select: { channelId: true } },
    },
  });
  for (const c of clicks) {
    if (c.trackingLink.kind === "AD_ENTRY") {
      events.push({
        kind: "entryClick",
        at: c.createdAt,
        ...dimsFor(
          c.trackingLink.channelId,
          index.byTracking.get(c.trackingLinkId) ?? [],
          adByTracking.get(c.trackingLinkId),
        ),
      });
    } else if (c.subId) {
      const origin = c.memberId ? memberAd.get(c.memberId) : undefined;
      const ids = campaignsOfOfferClick(index, {
        trackingLinkId: c.trackingLinkId,
        trackingLinkCampaignId: c.trackingLink.campaignId,
        trackingLinkAffiliateCampaignId: c.trackingLink.affiliateCampaignId,
        memberInviteLinkIds: invitesOf(c.memberId),
      });
      events.push({
        kind: "offerClick",
        at: c.createdAt,
        ...dimsFor(
          c.post?.channelId ?? origin?.channelId,
          ids,
          origin?.adId,
          c.trackingLink.affiliateCampaignId,
        ),
      });
    }
  }

  // Joueurs : inscriptions, FTD (dates Link Affi du joueur), dépôts et NGR (événements datés).
  // « Nos » joueurs seulement (phase 8) : un clic à nous, ou une campagne Link Affi rattachée à une de nos campagnes ;
  // un joueur rattaché par l'offre (sans clic, ou venu d'un ancien bouton Offre sans campagne) remplit la ligne de
  // chaque campagne qui porte cette offre, comme son clic.
  const ours = await ourPlayers();
  const players = await prisma.player.findMany({
    where: {
      AND: [
        ours,
        {
          OR: [
            { registeredAt: { gte: start } },
            { ftdAt: { gte: start } },
            { events: { some: { occurredAt: { gte: start } } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      affiliateCampaignId: true,
      clickId: true,
      memberId: true,
      registeredAt: true,
      ftdAt: true,
      click: {
        select: {
          trackingLinkId: true,
          trackingLink: { select: { campaignId: true } },
          post: { select: { channelId: true } },
        },
      },
      events: {
        where: { occurredAt: { gte: start } },
        select: { type: true, amount: true, occurredAt: true },
      },
    },
  });
  for (const p of players) {
    const origin = p.memberId ? memberAd.get(p.memberId) : undefined;
    const ids = campaignsOfPlayer(index, {
      affiliateCampaignId: p.affiliateCampaignId,
      clickId: p.clickId,
      clickTrackingLinkId: p.click?.trackingLinkId ?? null,
      clickTrackingLinkCampaignId: p.click?.trackingLink.campaignId ?? null,
      memberInviteLinkIds: invitesOf(p.memberId),
    });
    const base = dimsFor(
      p.click?.post?.channelId ?? origin?.channelId,
      ids,
      origin?.adId,
      p.affiliateCampaignId,
    );
    if (p.registeredAt && p.registeredAt >= start)
      events.push({ kind: "registration", at: p.registeredAt, ...base });
    if (p.ftdAt && p.ftdAt >= start) events.push({ kind: "ftd", at: p.ftdAt, ...base });
    for (const e of p.events) {
      if (e.type === "DEPOSIT" || e.type === "REDEPOSIT" || e.type === "FTD")
        events.push({ kind: "deposit", at: e.occurredAt, amount: Number(e.amount ?? 0), ...base });
      if (e.type === "NGR")
        events.push({ kind: "ngr", at: e.occurredAt, amount: Number(e.amount ?? 0), ...base });
    }
  }

  // Dépenses publicitaires : remontées au niveau pub / campagne (pas de rattachement par canal).
  const costs = await prisma.adCost.findMany({
    where: { date: { gte: new Date(`${dayKey(start)}T00:00:00Z`) } },
    select: {
      date: true,
      spend: true,
      adId: true,
      adSetId: true,
      campaignId: true,
      ad: { select: { adSet: { select: { campaignId: true } } } },
      adSet: { select: { campaignId: true } },
    },
  });
  for (const c of costs) {
    const campaignId = c.campaignId ?? c.adSet?.campaignId ?? c.ad?.adSet.campaignId ?? null;
    // Le jour est celui de la date (déjà un jour civil) : on le place à midi Paris pour éviter les bascules.
    const at = new Date(
      parisMidnightUtc(c.date.toISOString().slice(0, 10)).getTime() + 12 * 3_600_000,
    );
    const fields = campaignFields(index, campaignId ? [campaignId] : []);
    events.push({
      kind: "spend",
      at,
      amount: Number(c.spend),
      ...fields,
      adId: c.adId ?? null,
      vertical: fields.campaignVerticals?.[0] ?? null,
    });
  }

  return events;
}
