import { prisma, ourPlayers, type Prisma } from "@linkaffipro/db";
import { logger } from "../logger";
import { aggregateDaily, dayKey, dayKeysBetween, parisMidnightUtc, type StatEvent } from "./aggregate";

/**
 * Recalcule `DailyStat` pour une fenêtre de jours (Paris), toutes dimensions confondues.
 * Idempotent : chaque (jour, dimension) est écrit par upsert ; les lignes de la fenêtre
 * qui n'ont plus d'événement sont remises à zéro.
 */
export async function recomputeDailyStats(opts: { days?: number; full?: boolean } = {}): Promise<{ days: number; rows: number }> {
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

  // Remise à zéro des lignes existantes de la fenêtre qui n'ont plus d'événement.
  const existing = await prisma.dailyStat.findMany({ where: { date: { gte: new Date(`${fromKey}T00:00:00Z`) } }, select: { id: true, date: true, dimension: true } });
  const produced = new Set(rows.map((r) => `${r.date}|${r.dimension}`));
  const toZero = existing.filter((e) => !produced.has(`${e.date.toISOString().slice(0, 10)}|${e.dimension}`));
  if (toZero.length > 0) {
    await prisma.dailyStat.updateMany({ where: { id: { in: toZero.map((e) => e.id) } }, data: { requests: 0, approved: 0, joined: 0, left: 0, entryClicks: 0, offerClicks: 0, registrations: 0, ftds: 0, deposits: 0, depositAmount: 0, ngr: 0, spend: 0 } });
  }

  for (const r of rows) {
    const date = new Date(`${r.date}T00:00:00Z`);
    const dims = parseDimension(r.dimension);
    const data = { requests: r.requests, approved: r.approved, joined: r.joined, left: r.left, entryClicks: r.entryClicks, offerClicks: r.offerClicks, registrations: r.registrations, ftds: r.ftds, deposits: r.deposits, depositAmount: r.depositAmount, ngr: r.ngr, spend: r.spend };
    await prisma.dailyStat.upsert({
      where: { date_dimension: { date, dimension: r.dimension } },
      create: { date, dimension: r.dimension, ...dims, ...data },
      update: data,
    });
  }
  logger.info({ from: fromKey, to: todayKey, rows: rows.length, zeroed: toZero.length }, "statistiques journalières recalculées");
  return { days: dayList.length, rows: rows.length };
}

function parseDimension(dim: string): { channelId?: string; campaignId?: string; adId?: string; vertical?: Prisma.DailyStatCreateInput["vertical"] } {
  const [kind, id] = dim.split(":") as [string, string | undefined];
  if (kind === "channel" && id) return { channelId: id };
  if (kind === "campaign" && id) return { campaignId: id };
  if (kind === "ad" && id) return { adId: id };
  if (kind === "vertical" && (id === "CASINO" || id === "SPORTS" || id === "DATING")) return { vertical: id };
  return {};
}

async function earliestDataDay(): Promise<string | null> {
  const [m, c, p, a] = await Promise.all([
    prisma.membership.findFirst({ orderBy: { requestedAt: "asc" }, select: { requestedAt: true } }),
    prisma.click.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.player.findFirst({ where: { memberId: { not: null } }, orderBy: { registeredAt: "asc" }, select: { registeredAt: true } }),
    prisma.adCost.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const dates = [m?.requestedAt, c?.createdAt, p?.registeredAt, a?.date].filter((d): d is Date => d instanceof Date);
  if (dates.length === 0) return null;
  return dayKey(new Date(Math.min(...dates.map((d) => d.getTime()))));
}

type AdInfo = { adId: string; campaignId: string; vertical: string | null };

/** Charge les événements sources depuis `start` et les enrichit de leurs dimensions. */
async function loadEvents(start: Date): Promise<StatEvent[]> {
  const events: StatEvent[] = [];

  // Pubs : lien d'invitation / lien traqué → pub → campagne.
  const ads = await prisma.ad.findMany({ select: { id: true, inviteLinkId: true, trackingLinkId: true, adSet: { select: { campaign: { select: { id: true, vertical: true } } } } } });
  const adByInvite = new Map<string, AdInfo>();
  const adByTracking = new Map<string, AdInfo>();
  for (const a of ads) {
    const info: AdInfo = { adId: a.id, campaignId: a.adSet.campaign.id, vertical: a.adSet.campaign.vertical };
    if (a.inviteLinkId) adByInvite.set(a.inviteLinkId, info);
    if (a.trackingLinkId) adByTracking.set(a.trackingLinkId, info);
  }
  const channels = await prisma.channel.findMany({ select: { id: true, vertical: true } });
  const channelVertical = new Map(channels.map((c) => [c.id, c.vertical as string | null]));
  const dimsFor = (channelId: string | null | undefined, ad: AdInfo | undefined) => ({
    channelId: channelId ?? null,
    campaignId: ad?.campaignId ?? null,
    adId: ad?.adId ?? null,
    vertical: (channelId ? channelVertical.get(channelId) : null) ?? ad?.vertical ?? null,
  });

  // Adhésions (demande, acceptation, entrée, départ) ; un membre est rattaché à la pub de sa dernière demande.
  const memberships = await prisma.membership.findMany({
    where: { OR: [{ requestedAt: { gte: start } }, { approvedAt: { gte: start } }, { joinedAt: { gte: start } }, { leftAt: { gte: start } }] },
    select: { memberId: true, channelId: true, inviteLinkId: true, requestedAt: true, approvedAt: true, joinedAt: true, leftAt: true, status: true },
  });
  for (const m of memberships) {
    const ad = m.inviteLinkId ? adByInvite.get(m.inviteLinkId) : undefined;
    const base = dimsFor(m.channelId, ad);
    if (m.requestedAt >= start) events.push({ kind: "request", at: m.requestedAt, ...base });
    if (m.approvedAt && m.approvedAt >= start) events.push({ kind: "approved", at: m.approvedAt, ...base });
    if (m.joinedAt && m.joinedAt >= start) events.push({ kind: "joined", at: m.joinedAt, ...base });
    if (m.leftAt && m.leftAt >= start) events.push({ kind: "left", at: m.leftAt, ...base });
  }
  // Pub d'origine d'un membre (dernière demande avec un lien rattaché à une pub).
  const allMemberships = await prisma.membership.findMany({ where: { inviteLinkId: { not: null } }, orderBy: { requestedAt: "asc" }, select: { memberId: true, inviteLinkId: true, channelId: true } });
  const memberAd = new Map<string, { ad: AdInfo; channelId: string }>();
  for (const m of allMemberships) {
    const ad = m.inviteLinkId ? adByInvite.get(m.inviteLinkId) : undefined;
    if (ad) memberAd.set(m.memberId, { ad, channelId: m.channelId });
  }

  // Clics : entrée (par lien traqué AD_ENTRY) et offres (par message).
  const clicks = await prisma.click.findMany({
    where: { createdAt: { gte: start }, isBot: false },
    select: { createdAt: true, subId: true, memberId: true, trackingLinkId: true, trackingLink: { select: { kind: true, channelId: true } }, post: { select: { channelId: true } } },
  });
  for (const c of clicks) {
    if (c.trackingLink.kind === "AD_ENTRY") {
      events.push({ kind: "entryClick", at: c.createdAt, ...dimsFor(c.trackingLink.channelId, adByTracking.get(c.trackingLinkId)) });
    } else if (c.subId) {
      const origin = c.memberId ? memberAd.get(c.memberId) : undefined;
      events.push({ kind: "offerClick", at: c.createdAt, ...dimsFor(c.post?.channelId ?? origin?.channelId, origin?.ad) });
    }
  }

  // Joueurs : inscriptions, FTD, dépôts, NGR (rattachés au membre → pub / canal du clic).
  // « Nos » joueurs seulement (phase 8) : un clic à nous, ou une campagne Link Affi rattachée à une de nos campagnes.
  const ours = await ourPlayers();
  const players = await prisma.player.findMany({
    where: { AND: [ours, { OR: [{ registeredAt: { gte: start } }, { ftdAt: { gte: start } }, { events: { some: { occurredAt: { gte: start } } } }] }] },
    select: { id: true, memberId: true, registeredAt: true, ftdAt: true, click: { select: { post: { select: { channelId: true } } } }, events: { where: { occurredAt: { gte: start } }, select: { type: true, amount: true, occurredAt: true } } },
  });
  for (const p of players) {
    const origin = p.memberId ? memberAd.get(p.memberId) : undefined;
    const base = dimsFor(p.click?.post?.channelId ?? origin?.channelId, origin?.ad);
    if (p.registeredAt && p.registeredAt >= start) events.push({ kind: "registration", at: p.registeredAt, ...base });
    if (p.ftdAt && p.ftdAt >= start) events.push({ kind: "ftd", at: p.ftdAt, ...base });
    for (const e of p.events) {
      if (e.type === "DEPOSIT" || e.type === "REDEPOSIT" || e.type === "FTD") events.push({ kind: "deposit", at: e.occurredAt, amount: Number(e.amount ?? 0), ...base });
      if (e.type === "NGR") events.push({ kind: "ngr", at: e.occurredAt, amount: Number(e.amount ?? 0), ...base });
    }
  }

  // Dépenses publicitaires : remontées au niveau pub / campagne (pas de rattachement par canal).
  const costs = await prisma.adCost.findMany({
    where: { date: { gte: new Date(`${dayKey(start)}T00:00:00Z`) } },
    select: { date: true, spend: true, adId: true, adSetId: true, campaignId: true, ad: { select: { adSet: { select: { campaignId: true } } } }, adSet: { select: { campaignId: true } }, campaign: { select: { vertical: true } } },
  });
  const campaignVertical = new Map<string, string | null>();
  for (const a of ads) campaignVertical.set(a.adSet.campaign.id, a.adSet.campaign.vertical);
  for (const c of costs) {
    const campaignId = c.campaignId ?? c.adSet?.campaignId ?? c.ad?.adSet.campaignId ?? null;
    // Le jour est celui de la date (déjà un jour civil) : on le place à midi Paris pour éviter les bascules.
    const at = new Date(parisMidnightUtc(c.date.toISOString().slice(0, 10)).getTime() + 12 * 3_600_000);
    events.push({ kind: "spend", at, amount: Number(c.spend), campaignId, adId: c.adId ?? null, vertical: c.campaign?.vertical ?? (campaignId ? campaignVertical.get(campaignId) : null) ?? null });
  }

  return events;
}
