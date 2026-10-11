import {
  prisma,
  type AdPlatform,
  type ApprovalRule,
  type ChatType,
  type InviteLinkKind,
  type Prisma,
  type Vertical,
} from "@linkaffipro/db";
import {
  entryRuleFromRow,
  gateChannelChoices,
  type EntryRule,
  type GateChannelChoice,
} from "./entry-rule";
import type { ExceptionItem } from "./exceptions";
import { MEMBER_STATUSES, OPEN_REQUEST_STATUSES } from "./requests";

/**
 * Lectures des écrans Canaux (liste et fiche). Mêmes définitions que les onglets de la fiche :
 * « membres » = adhésions acceptées et toujours présentes (APPROVED) ; « demandes » = demandes en cours
 * (`OPEN_REQUEST_STATUSES`) ; règle = règle par défaut du canal (`isDefault`), relue comme le formulaire.
 */

export type ChannelListItem = {
  id: string;
  title: string;
  username: string | null;
  type: ChatType;
  vertical: Vertical | null;
  language: string;
  primaryBotId: string | null;
  isActive: boolean;
  isTest: boolean;
  isMediaLibrary: boolean;
  telegramChatId: string;
  createdAt: Date;
  /** Nos bots administrateurs (droits non retirés), par @nom. */
  botAdmins: string[];
  /** Règle par défaut du canal, ou null. */
  rule: EntryRule | null;
  /** Exceptions actives selon la provenance (phase 11). */
  exceptions: number;
  members: number;
  pending: number;
};

/** Exceptions selon la provenance : toute règle qui n'est pas la règle par défaut, avec une portée d'exception. */
const EXCEPTION_WHERE = {
  isDefault: false,
  scope: { not: "DEFAULT" },
} satisfies Prisma.ApprovalRuleWhereInput;

function countsBy(
  rows: Array<{ channelId: string; _count: { _all: number } }>,
): Map<string, number> {
  return new Map(rows.map((r) => [r.channelId, r._count._all]));
}

/** Tous les canaux (plus récents d'abord) avec leurs bots, leur règle d'entrée, leurs membres et demandes en cours. */
export async function loadChannelList(): Promise<ChannelListItem[]> {
  const [channels, rules, exceptions, approved, pending] = await Promise.all([
    prisma.channel.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        botAdmins: {
          where: { revokedAt: null },
          orderBy: { detectedAt: "asc" },
          select: { bot: { select: { username: true } } },
        },
      },
    }),
    prisma.approvalRule.findMany({
      where: { isDefault: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.approvalRule.groupBy({
      by: ["channelId"],
      where: { ...EXCEPTION_WHERE, isActive: true },
      _count: { _all: true },
    }),
    prisma.membership.groupBy({
      by: ["channelId"],
      where: { status: "APPROVED" },
      _count: { _all: true },
    }),
    prisma.membership.groupBy({
      by: ["channelId"],
      where: { status: { in: [...OPEN_REQUEST_STATUSES] } },
      _count: { _all: true },
    }),
  ]);
  const ruleOf = new Map<string, EntryRule>();
  for (const r of rules) if (!ruleOf.has(r.channelId)) ruleOf.set(r.channelId, entryRuleFromRow(r));
  const members = countsBy(approved);
  const open = countsBy(pending);
  const exceptionCount = countsBy(exceptions);
  return channels.map((c) => ({
    id: c.id,
    title: c.title,
    username: c.username,
    type: c.type,
    vertical: c.vertical,
    language: c.language,
    primaryBotId: c.primaryBotId,
    isActive: c.isActive,
    isTest: c.isTest,
    isMediaLibrary: c.isMediaLibrary,
    telegramChatId: c.telegramChatId.toString(),
    createdAt: c.createdAt,
    botAdmins: c.botAdmins.map((a) => a.bot.username),
    rule: ruleOf.get(c.id) ?? null,
    exceptions: exceptionCount.get(c.id) ?? 0,
    members: members.get(c.id) ?? 0,
    pending: open.get(c.id) ?? 0,
  }));
}

/** Membres présents et demandes en cours d'un canal (en-tête et onglets de la fiche). */
export async function loadChannelCounts(
  channelId: string,
): Promise<{ members: number; pending: number }> {
  const [members, pending] = await Promise.all([
    prisma.membership.count({ where: { channelId, status: "APPROVED" } }),
    prisma.membership.count({
      where: { channelId, status: { in: [...OPEN_REQUEST_STATUSES] } },
    }),
  ]);
  return { members, pending };
}

/** Lignes par page de l'onglet « Membres » de la fiche canal (même taille que les autres listes longues). */
export const CHANNEL_MEMBERS_PAGE_SIZE = 50;

const channelMemberInclude = {
  member: { select: { id: true, firstName: true, lastName: true, username: true } },
} satisfies Prisma.MembershipInclude;

export type ChannelMembersPage = {
  rows: Prisma.MembershipGetPayload<{ include: typeof channelMemberInclude }>[];
  /** Adhésions abouties listées (présents + partis + exclus). */
  total: number;
  present: number;
  left: number;
  kicked: number;
  page: number;
  pages: number;
};

/**
 * Onglet « Membres » de la fiche canal : une page d'adhésions abouties (`MEMBER_STATUSES` : acceptés, partis, exclus),
 * les plus récemment acceptées d'abord, avec le compte par état pour l'en-tête. Une page trop grande revient à la
 * dernière.
 */
export async function loadChannelMembersPage(
  channelId: string,
  page: number,
  size = CHANNEL_MEMBERS_PAGE_SIZE,
): Promise<ChannelMembersPage> {
  const where: Prisma.MembershipWhereInput = { channelId, status: { in: [...MEMBER_STATUSES] } };
  const groups = await prisma.membership.groupBy({ by: ["status"], where, _count: { _all: true } });
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const present = count("APPROVED");
  const left = count("LEFT");
  const kicked = count("KICKED");
  const total = present + left + kicked;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = total
    ? await prisma.membership.findMany({
        where,
        orderBy: [{ approvedAt: "desc" }, { requestedAt: "desc" }, { id: "asc" }],
        skip: (current - 1) * size,
        take: size,
        include: channelMemberInclude,
      })
    : [];
  return { rows, total, present, left, kicked, page: current, pages };
}

/**
 * Canaux à cocher dans « Les canaux à rejoindre » d'un canal : les autres canaux actifs, précédés des canaux que la
 * règle demande encore mais qui sont inactifs ou supprimés (`gateChannelChoices`), pour qu'ils restent visibles et
 * décochables.
 */
export async function loadGateChannelChoices(
  channelId: string,
  gateIds: readonly string[],
): Promise<GateChannelChoice[]> {
  const active = await prisma.channel.findMany({
    where: { id: { not: channelId }, isActive: true },
    orderBy: { title: "asc" },
    select: { id: true, title: true, vertical: true, isMediaLibrary: true },
  });
  const activeIds = new Set(active.map((c) => c.id));
  const missingIds = gateIds.filter((gid) => !activeIds.has(gid));
  const known = missingIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: missingIds } },
        select: { id: true, title: true, vertical: true, isMediaLibrary: true, isActive: true },
      })
    : [];
  return gateChannelChoices(active, gateIds, known);
}

/** Ligne `ApprovalRule` d'une exception → ce que montre l'écran (sérialisable). */
export function exceptionItemFromRow(row: ApprovalRule): ExceptionItem {
  return {
    id: row.id,
    scope: row.scope === "DEFAULT" ? "SOURCE_KIND" : row.scope,
    isDefault: false,
    isActive: row.isActive,
    inviteLinkId: row.inviteLinkId,
    sourceChannelId: row.sourceChannelId,
    sourceKind: row.sourceKind,
    sortOrder: row.sortOrder,
    label: row.label,
    rule: entryRuleFromRow(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Un de nos canaux, pour les menus et les noms de « Qui peut entrer et quand ». */
export type RulesTabChannel = {
  id: string;
  title: string;
  vertical: Vertical | null;
  isActive: boolean;
  isMediaLibrary: boolean;
};

/** Un lien d'invitation nommé : liens de partage du canal, et liens visés par une exception. */
export type RulesTabLink = {
  id: string;
  name: string;
  kind: InviteLinkKind;
  isActive: boolean;
  sourceChannelId: string | null;
  /** Plateforme d'un lien d'entrée de pub (simulateur : provenance comme le bot). */
  adPlatform: AdPlatform | null;
};

export type RulesTabData = {
  /** Règle par défaut (ligne relue), ou null. */
  defaultRow: ApprovalRule | null;
  defaultRule: EntryRule | null;
  /** Exceptions selon la provenance, actives ou non (ordre : niveau puis `sortOrder`, voir `groupByLevel`). */
  exceptions: ExceptionItem[];
  /** Tous nos canaux (titres et menus ; le canal lui-même compris, pour son nom). */
  channels: RulesTabChannel[];
  links: RulesTabLink[];
  /** Canaux dont une règle active demande de rejoindre ce canal : ils y envoient leurs membres. */
  senders: string[];
};

/**
 * Onglet « Qui peut entrer et quand » : règle par défaut, exceptions selon la provenance, nos canaux, les liens de
 * partage du canal (et ceux visés par une exception) et les canaux qui envoient leurs membres ici.
 */
export async function loadRulesTab(channelId: string): Promise<RulesTabData> {
  const [rules, channels, senderRows] = await Promise.all([
    prisma.approvalRule.findMany({
      where: { channelId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.channel.findMany({
      orderBy: { title: "asc" },
      select: { id: true, title: true, vertical: true, isActive: true, isMediaLibrary: true },
    }),
    prisma.approvalRule.findMany({
      where: {
        channelId: { not: channelId },
        isActive: true,
        gateMode: { not: "NONE" },
        gateChannelIds: { array_contains: [channelId] },
      },
      select: { channelId: true },
      distinct: ["channelId"],
    }),
  ]);
  const defaultRow = rules.find((r) => r.isDefault) ?? null;
  const exceptionRows = rules.filter((r) => !r.isDefault && r.scope !== "DEFAULT");
  const linkIds = exceptionRows.map((r) => r.inviteLinkId).filter((id): id is string => !!id);
  const links = await prisma.inviteLink.findMany({
    where: {
      OR: [{ channelId, kind: "SHARE" }, ...(linkIds.length ? [{ id: { in: linkIds } }] : [])],
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      isActive: true,
      sourceChannelId: true,
      adPlatform: true,
    },
  });
  return {
    defaultRow,
    defaultRule: defaultRow ? entryRuleFromRow(defaultRow) : null,
    exceptions: exceptionRows.map(exceptionItemFromRow),
    channels,
    links,
    senders: senderRows.map((r) => r.channelId),
  };
}
