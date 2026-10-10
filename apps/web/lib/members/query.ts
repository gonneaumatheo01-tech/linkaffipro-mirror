import { prisma, type Prisma } from "@linkaffipro/db";
import { aggregatePlayers, computeSpendLevel, parseSpendThresholds, SPEND_LEVELS, type SpendLevel, type SpendThresholds } from "@linkaffipro/core";
import { campaignMemberWhere, type CampaignScope } from "@/lib/campaigns/attribution";
import { campaignScope } from "@/lib/dashboard/campaign-scope";

export const PAGE_SIZE = 50;

export type MemberFilters = {
  q: string;
  channelId: string;
  status: string;
  inviteLinkId: string;
  /** Campagne (la nôtre) : membres arrivés par un de ses liens d'entrée. */
  campaignId: string;
  level: SpendLevel | "";
  language: string;
  /** Étiquette (nom exact du registre ou posée par une automatisation). */
  tag: string;
  since: string;
  until: string;
  sort: "lastSeen" | "firstSeen" | "name";
  page: number;
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseMemberFilters(sp: SP): MemberFilters {
  const level = one(sp.level);
  const sort = one(sp.sort);
  return {
    q: one(sp.q).trim(),
    channelId: one(sp.channelId),
    status: one(sp.status),
    inviteLinkId: one(sp.inviteLinkId),
    campaignId: one(sp.campaignId),
    level: (SPEND_LEVELS as readonly string[]).includes(level) ? (level as SpendLevel) : "",
    language: one(sp.language).trim().toLowerCase(),
    tag: one(sp.tag).trim(),
    since: one(sp.since),
    until: one(sp.until),
    sort: sort === "firstSeen" || sort === "name" ? sort : "lastSeen",
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
}

export function filtersToQuery(f: MemberFilters, overrides: Partial<MemberFilters> = {}): string {
  const merged = { ...f, ...overrides };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === "" || v === undefined || (k === "page" && v === 1) || (k === "sort" && v === "lastSeen")) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Clause Prisma des filtres (fonction pure) ; `scope` = périmètre de la campagne filtrée, s'il y en a une. */
export function buildWhere(f: MemberFilters, scope?: CampaignScope | null): Prisma.MemberWhereInput {
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
  if (f.channelId || f.status || f.inviteLinkId) {
    and.push({
      memberships: {
        some: {
          ...(f.channelId ? { channelId: f.channelId } : {}),
          ...(f.status ? { status: f.status as Prisma.EnumMembershipStatusFilter["equals"] } : {}),
          ...(f.inviteLinkId ? { inviteLinkId: f.inviteLinkId } : {}),
        },
      },
    });
  }
  if (f.language) and.push({ languageCode: { startsWith: f.language } });
  if (f.tag) and.push({ tags: { array_contains: [f.tag] } });
  if (f.since) and.push({ firstSeenAt: { gte: new Date(f.since) } });
  if (f.until) and.push({ firstSeenAt: { lte: new Date(`${f.until}T23:59:59.999+02:00`) } });
  if (and.length) where.AND = and;
  return where;
}

export async function getSpendThresholds(): Promise<SpendThresholds> {
  const s = await prisma.setting.findUnique({ where: { key: "spend.thresholds" } }).catch(() => null);
  return parseSpendThresholds(s?.value);
}

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
  memberships: { orderBy: { requestedAt: "desc" as const }, include: { channel: { select: { title: true } }, inviteLink: { select: { name: true, adName: true } } } },
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
export async function listMembers(f: MemberFilters, opts: { all?: boolean } = {}): Promise<{ rows: MemberRow[]; total: number; pages: number }> {
  const [thresholds, scope] = await Promise.all([getSpendThresholds(), f.campaignId ? campaignScope(f.campaignId) : null]);
  const where = buildWhere(f, scope);
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
