import { prisma, type ChatType, type Vertical } from "@linkaffipro/db";
import {
  entryRuleFromRow,
  gateChannelChoices,
  type EntryRule,
  type GateChannelChoice,
} from "./entry-rule";
import { OPEN_REQUEST_STATUSES } from "./requests";

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
  members: number;
  pending: number;
};

function countsBy(
  rows: Array<{ channelId: string; _count: { _all: number } }>,
): Map<string, number> {
  return new Map(rows.map((r) => [r.channelId, r._count._all]));
}

/** Tous les canaux (plus récents d'abord) avec leurs bots, leur règle d'entrée, leurs membres et demandes en cours. */
export async function loadChannelList(): Promise<ChannelListItem[]> {
  const [channels, rules, approved, pending] = await Promise.all([
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
