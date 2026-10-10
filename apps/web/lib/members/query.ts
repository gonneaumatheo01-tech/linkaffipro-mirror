import { prisma, type Prisma } from "@linkaffipro/db";
import { aggregatePlayers, computeSpendLevel, parseSpendThresholds, type SpendLevel, type SpendThresholds } from "@linkaffipro/core";
import { campaignMemberWhere, type CampaignScope } from "@/lib/campaigns/attribution";
import { campaignScope } from "@/lib/dashboard/campaign-scope";
import { periodEnd, periodStart, resolvePeriod } from "@/lib/periods";
import type { MemberFilters } from "./filters";

export const PAGE_SIZE = 50;

// Lecture et écriture des filtres : fonctions pures de `./filters` (réexportées ici pour les pages existantes).
export { filtersToQuery, parseMemberFilters, type MemberFilters } from "./filters";

/**
 * Clause Prisma des filtres (fonction pure) ; `scope` = périmètre de la campagne filtrée, s'il y en a une ;
 * `now` = instant de référence de « premier dépôt » (jours de Paris) et « rien fait depuis ».
 */
export function buildWhere(f: MemberFilters, scope?: CampaignScope | null, now: Date = new Date()): Prisma.MemberWhereInput {
  const where: Prisma.MemberWhereInput = {};
  const and: Prisma.MemberWhereInput[] = [];
  if (f.campaignId) and.push(campaignMemberWhere(scope ?? { inviteLinkIds: [] }) as Prisma.MemberWhereInput);
  if (f.q) {
    const asId = /^\d{5,}$/.test(f.q) ? BigInt(f.q) : null;
    and.push({
      OR: [
        { firstName: { contains: f.q, mode: "insensitive" } },
        { lastName: { contains: f.q, mode: "insensitive" } },
        { username: { contains: f.q.replace(/^@/, ""), mode: "insensitive" } },
        ...(asId !== null ? [{ telegramUserId: asId }] : []),
      ],
    });
  }
  // Une même adhésion porte le canal, le statut, le lien d'entrée et l'univers demandés.
  if (f.channelId || f.status || f.inviteLinkId || f.universe) {
    and.push({
      memberships: {
        some: {
          ...(f.channelId ? { channelId: f.channelId } : {}),
          ...(f.status ? { status: f.status as Prisma.EnumMembershipStatusFilter["equals"] } : {}),
          ...(f.inviteLinkId ? { inviteLinkId: f.inviteLinkId } : {}),
          ...(f.universe ? { channel: { vertical: f.universe } } : {}),
        },
      },
    });
  }
  if (f.language) and.push({ languageCode: { startsWith: f.language } });
  if (f.tag) and.push({ tags: { array_contains: [f.tag] } });
  if (f.since) and.push({ firstSeenAt: { gte: new Date(f.since) } });
  if (f.until) and.push({ firstSeenAt: { lte: new Date(`${f.until}T23:59:59.999+02:00`) } });
  // « Ont déposé » : même règle que le niveau de dépense (au moins un dépôt, ou un montant déposé).
  if (f.deposited) and.push({ players: { some: { OR: [{ depositCount: { gt: 0 } }, { depositTotal: { gt: 0 } }] } } });
  if (f.ftd) {
    const p = resolvePeriod({ range: f.ftd }, now);
    and.push({ players: { some: { ftdAt: { gte: periodStart(p), lt: periodEnd(p) } } } });
  }
  // « Rien fait depuis N jours » : même règle que les groupes de membres (`inactiveDays` du segment).
  if (f.inactive) and.push({ lastSeenAt: { lt: new Date(now.getTime() - f.inactive * 86_400_000) } });
  if (and.length) where.AND = and;
  return where;
}

export async function getSpendThresholds(): Promise<SpendThresholds> {
  const s = await prisma.setting.findUnique({ where: { key: "spend.thresholds" } }).catch(() => null);
  return parseSpendThresholds(s?.value);
}

/** D'où vient le membre : sa première demande (canal, lien d'entrée, pub, campagne). */
export type MemberOrigin = {
  at: Date;
  channelTitle: string;
  channelVertical: string | null;
  linkName: string | null;
  adName: string | null;
  adPlatform: string | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignVertical: string | null;
};

export type MemberRow = {
  id: string;
  telegramUserId: string;
  displayName: string;
  username: string | null;
  languageCode: string | null;
  anonymized: boolean;
  tags: string[];
  channels: string[];
  source: string | null;
  /** Première demande d'adhésion (null si le membre n'a jamais demandé à rejoindre un canal). */
  origin: MemberOrigin | null;
  /** Statut de la demande la plus récente, et son canal. */
  status: string | null;
  statusChannel: string | null;
  firstSeenAt: Date;
  lastEventAt: Date | null;
  clicks: number;
  isPlayer: boolean;
  ftdAt: Date | null;
  depositCount: number;
  depositTotal: number;
  level: SpendLevel;
};

export function displayName(m: { firstName: string | null; lastName: string | null; username: string | null; anonymizedAt?: Date | null; telegramUserId: bigint }): string {
  if (m.anonymizedAt) return "Membre anonymisé";
  const n = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  return n || (m.username ? `@${m.username}` : `#${m.telegramUserId.toString()}`);
}

const memberInclude = {
  memberships: {
    orderBy: { requestedAt: "desc" as const },
    include: {
      channel: { select: { title: true, vertical: true } },
      inviteLink: { select: { name: true, adName: true, adPlatform: true, campaign: { select: { id: true, name: true, vertical: true } } } },
    },
  },
  players: { select: { registeredAt: true, ftdAt: true, depositCount: true, depositTotal: true, lastEventAt: true } },
  _count: { select: { clicks: { where: { isBot: false } } } },
} satisfies Prisma.MemberInclude;

type MemberWithRels = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;

export function toRow(m: MemberWithRels, thresholds: SpendThresholds): MemberRow {
  const players = m.players.map((p) => ({ registeredAt: p.registeredAt, depositCount: p.depositCount, depositTotal: Number(p.depositTotal) }));
  const agg = aggregatePlayers(players);
  const ftd = m.players.map((p) => p.ftdAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const lastPlayerEvent = m.players.map((p) => p.lastEventAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const first = m.memberships[m.memberships.length - 1];
  const latest = m.memberships[0];
  const src = first?.inviteLink ? first.inviteLink.adName || first.inviteLink.name : null;
  return {
    id: m.id,
    telegramUserId: m.telegramUserId.toString(),
    displayName: displayName(m),
    username: m.anonymizedAt ? null : m.username,
    languageCode: m.languageCode,
    anonymized: !!m.anonymizedAt,
    tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [],
    channels: [...new Set(m.memberships.map((x) => x.channel.title))],
    source: src,
    origin: first
      ? {
          at: first.requestedAt,
          channelTitle: first.channel.title,
          channelVertical: first.channel.vertical,
          linkName: first.inviteLink?.name ?? null,
          adName: first.inviteLink?.adName ?? null,
          adPlatform: first.inviteLink?.adPlatform ?? null,
          campaignId: first.inviteLink?.campaign?.id ?? null,
          campaignName: first.inviteLink?.campaign?.name ?? null,
          campaignVertical: first.inviteLink?.campaign?.vertical ?? null,
        }
      : null,
    status: latest?.status ?? null,
    statusChannel: latest?.channel.title ?? null,
    firstSeenAt: m.firstSeenAt,
    lastEventAt: [m.lastSeenAt, lastPlayerEvent].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    clicks: m._count.clicks,
    isPlayer: m.players.length > 0,
    ftdAt: ftd,
    depositCount: agg.depositCount,
    depositTotal: agg.depositTotal,
    level: computeSpendLevel(agg, thresholds),
  };
}

/** Liste paginée. Le filtre « niveau » est appliqué après calcul (dérivé), sur la page courante élargie. */
export async function listMembers(f: MemberFilters, opts: { all?: boolean; now?: Date } = {}): Promise<{ rows: MemberRow[]; total: number; pages: number }> {
  const [thresholds, scope] = await Promise.all([getSpendThresholds(), f.campaignId ? campaignScope(f.campaignId) : null]);
  const where = buildWhere(f, scope, opts.now);
  const orderBy: Prisma.MemberOrderByWithRelationInput =
    f.sort === "name" ? { firstName: "asc" } : f.sort === "firstSeen" ? { firstSeenAt: "desc" } : { lastSeenAt: "desc" };
  const total = await prisma.member.count({ where });
  const take = opts.all ? undefined : f.level ? PAGE_SIZE * 4 : PAGE_SIZE;
  const skip = opts.all ? 0 : (f.page - 1) * (f.level ? PAGE_SIZE * 4 : PAGE_SIZE);
  const members = await prisma.member.findMany({ where, orderBy, take, skip, include: memberInclude });
  let rows = members.map((m) => toRow(m, thresholds));
  if (f.level) rows = rows.filter((r) => r.level === f.level).slice(0, opts.all ? undefined : PAGE_SIZE);
  return { rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export type MemberFilterOptions = {
  channels: Array<{ id: string; title: string; vertical: string | null }>;
  /** Nos campagnes (actives d'abord, puis par nom), comme dans les autres filtres « Campagne ». */
  campaigns: Array<{ id: string; name: string; vertical: string | null }>;
  /** Liens d'entrée (pubs) : nom affiché = nom de la pub s'il existe, sinon nom du lien. */
  inviteLinks: Array<{ id: string; label: string; campaignName: string | null }>;
  /** Langues des membres (code de base « fr », « en »…), de la plus fréquente à la moins fréquente. */
  languages: Array<{ code: string; count: number }>;
};

/**
 * Choix des filtres de la liste (lecture seule) : canaux actifs avec leur univers, campagnes, 200 derniers liens d'entrée,
 * langues présentes chez les membres non anonymisés (regroupées par code de base : « pt-br » compte pour « pt »).
 */
export async function loadMemberFilterOptions(): Promise<MemberFilterOptions> {
  const [channels, campaigns, links, langs] = await Promise.all([
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true, vertical: true } }),
    prisma.campaign.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], select: { id: true, name: true, vertical: true } }),
    prisma.inviteLink.findMany({
      where: { kind: "AD_ENTRY" },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, adName: true, campaign: { select: { name: true } } },
    }),
    prisma.member.groupBy({ by: ["languageCode"], where: { anonymizedAt: null, languageCode: { not: null } }, _count: { _all: true } }),
  ]);
  return {
    channels,
    campaigns,
    inviteLinks: links.map((l) => ({ id: l.id, label: l.adName || l.name, campaignName: l.campaign?.name ?? null })),
    languages: groupLanguages(langs.map((l) => ({ code: l.languageCode ?? "", count: l._count._all }))),
  };
}

/** Regroupe les codes de langue par code de base (« fr-FR » et « fr » → « fr »), du plus fréquent au moins fréquent. */
export function groupLanguages(rows: Array<{ code: string; count: number }>): Array<{ code: string; count: number }> {
  const by = new Map<string, number>();
  for (const r of rows) {
    const base = r.code.trim().toLowerCase().split(/[-_]/)[0] ?? "";
    if (!base) continue;
    by.set(base, (by.get(base) ?? 0) + r.count);
  }
  return [...by.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
