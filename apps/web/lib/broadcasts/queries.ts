import { ACTIVE_CHANNEL_BOT_WHERE, prisma, type Prisma } from "@linkaffipro/db";
import {
  aggregatePlayers,
  buildMemberWhere,
  computeSpendLevel,
  matchesSpendLevels,
  parseSpendThresholds,
  withReachableBy,
  type Segment,
} from "@linkaffipro/core";
import { campaignBroadcastWhere } from "@/lib/campaigns/attribution";
import { listCampaignOptions, type CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import { campaignScope } from "@/lib/dashboard/campaign-scope";
import { groupLanguages } from "@/lib/members/query";

/** Nombre de membres joignables (canDm sur ce bot) correspondant au segment. */
export async function countTargets(segment: Segment, botId: string): Promise<number> {
  const where = withReachableBy(buildMemberWhere(segment), botId) as Prisma.MemberWhereInput;
  if (!segment.spendLevels) return prisma.member.count({ where });
  const thresholds = parseSpendThresholds(
    (await prisma.setting.findUnique({ where: { key: "spend.thresholds" } }).catch(() => null))
      ?.value,
  );
  let cursor: string | undefined;
  let n = 0;
  for (;;) {
    const rows = await prisma.member.findMany({
      where,
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        players: { select: { registeredAt: true, depositCount: true, depositTotal: true } },
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    for (const m of rows) {
      const players = m.players.map((p) => ({
        registeredAt: p.registeredAt,
        depositCount: p.depositCount,
        depositTotal: Number(p.depositTotal),
      }));
      if (matchesSpendLevels(computeSpendLevel(aggregatePlayers(players), thresholds), segment))
        n++;
    }
    if (rows.length < 1000) break;
  }
  return n;
}

/**
 * Options du formulaire « Écrire à un groupe » (bots, canaux et campagnes avec leur univers, pubs, campagnes et leurs
 * offres, catégories, médias, campagnes Link Affi, langues des membres). Lecture seule.
 */
export async function loadBroadcastOptions(): Promise<{
  bots: Array<{ id: string; name: string; username: string; vertical: string | null }>;
  channels: Array<{ id: string; title: string; vertical: string | null }>;
  /** Pubs (liens d'entrée) : nom de la pub s'il existe, sinon nom du lien ; campagne de la pub. */
  inviteLinks: Array<{ id: string; name: string; label: string; campaignName: string | null }>;
  campaigns: Array<{ id: string; name: string; vertical: string | null }>;
  /** Nos campagnes avec leurs offres (bouton « Offre » : on choisit la campagne, qui détermine le lien Link Affi). */
  ourCampaigns: CampaignOptionWithOffers[];
  categories: Array<{ id: string; name: string }>;
  media: Array<{ id: string; filename: string; mimeType: string }>;
  affiliateCampaigns: Array<{ id: string; name: string; programName: string }>;
  /** Langues des membres (code de base), de la plus fréquente à la moins fréquente. */
  languages: Array<{ code: string; count: number }>;
}> {
  const [bots, channels, inviteLinks, campaigns, categories, media, affiliateCampaigns, ourCampaigns, langs] =
    await Promise.all([
      // Jamais un bot assistant de conversation (phase 17) : il n'écrit qu'aux personnes qui lui parlent.
      prisma.bot.findMany({
        where: ACTIVE_CHANNEL_BOT_WHERE,
        orderBy: { name: "asc" },
        select: { id: true, name: true, username: true, vertical: true },
      }),
      prisma.channel.findMany({
        where: { isActive: true },
        orderBy: { title: "asc" },
        select: { id: true, title: true, vertical: true },
      }),
      prisma.inviteLink.findMany({
        where: { kind: "AD_ENTRY", isActive: true },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, name: true, adName: true, campaign: { select: { name: true } } },
      }),
      prisma.campaign.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, vertical: true },
      }),
      prisma.messageCategory.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      }),
      prisma.mediaAsset.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, filename: true, mimeType: true },
      }),
      prisma.affiliateCampaign.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, program: { select: { name: true } } },
      }),
      listCampaignOptions(),
      prisma.member.groupBy({
        by: ["languageCode"],
        where: { anonymizedAt: null, languageCode: { not: null } },
        _count: { _all: true },
      }),
    ]);
  return {
    bots,
    channels,
    inviteLinks: inviteLinks.map((l) => ({
      id: l.id,
      name: l.name,
      label: l.adName || l.name,
      campaignName: l.campaign?.name ?? null,
    })),
    campaigns,
    ourCampaigns,
    categories,
    media,
    affiliateCampaigns: affiliateCampaigns.map((c) => ({
      id: c.id,
      name: c.name,
      programName: c.program.name,
    })),
    languages: groupLanguages(
      langs.map((l) => ({ code: l.languageCode ?? "", count: l._count._all })),
    ),
  };
}

export type BroadcastRow = Prisma.BroadcastGetPayload<{
  include: {
    bot: { select: { username: true; name: true } };
    createdBy: { select: { name: true } };
  };
}>;

export const BROADCASTS_PAGE_SIZE = 50;

/**
 * Envois groupés du plus récent au plus ancien, paginés par 50, filtrables par statut et par campagne
 * (segment visant la campagne ou un de ses canaux).
 */
export async function listBroadcasts(
  page = 1,
  status?: string,
  campaignId?: string,
): Promise<{ rows: BroadcastRow[]; total: number; pages: number; page: number }> {
  const current = Math.max(1, page);
  const where: Prisma.BroadcastWhereInput = {
    ...(status && status in BROADCAST_STATUS_LABELS
      ? { status: status as Prisma.EnumBroadcastStatusFilter["equals"] }
      : {}),
    ...(campaignId ? (campaignBroadcastWhere(campaignId, await campaignScope(campaignId)) as Prisma.BroadcastWhereInput) : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.broadcast.count({ where }),
    prisma.broadcast.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (current - 1) * BROADCASTS_PAGE_SIZE,
      take: BROADCASTS_PAGE_SIZE,
      include: {
        bot: { select: { username: true, name: true } },
        createdBy: { select: { name: true } },
      },
    }),
  ]);
  return {
    rows,
    total,
    pages: Math.max(1, Math.ceil(total / BROADCASTS_PAGE_SIZE)),
    page: current,
  };
}

export function progressOf(b: {
  targeted: number;
  sent: number;
  failed: number;
  blocked: number;
}): { done: number; pct: number } {
  const done = b.sent + b.failed + b.blocked;
  return { done, pct: b.targeted > 0 ? Math.min(100, Math.round((done / b.targeted) * 100)) : 0 };
}

export const BROADCAST_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  SCHEDULED: "Programmé",
  SENDING: "Envoi en cours",
  SENT: "Envoyé",
  CANCELLED: "Annulé",
};
