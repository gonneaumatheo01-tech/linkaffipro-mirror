import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import {
  canInviteFromRights,
  createPrismaGateLinkDeps,
  resolveGateLink,
  webBotApi,
  type ChannelInfo,
  type FirstBot,
} from "@linkaffipro/telegram";
import { actingBotFor } from "@/lib/approval/telegram";
import { entryRuleFromRow, hasGate, isRuleInForce, type EntryRule } from "./entry-rule";
import {
  gateLinkRows,
  gateLinksSummary,
  type GateCheckResult,
  type GateLinkRow,
} from "./gate-links";

/**
 * Liens des canaux à rejoindre côté serveur (fiche canal → « Qui peut entrer et quand ») :
 * - `verifyGateLinks` crée tout de suite les liens manquants (bot qui traite les demandes du canal, puis chacun de nos
 *   bots administrateurs du canal à rejoindre) et journalise le résultat (`channel.gate_links_checked`) ;
 * - `loadGateLinkView` lit l'état de chaque canal pour l'éditeur, sans appel à Telegram.
 */

const channelInfoSelect = {
  id: true,
  title: true,
  username: true,
  language: true,
  telegramChatId: true,
  primaryBotId: true,
  isActive: true,
} as const;

/** Canaux à rejoindre de la règle par défaut d'un canal, dans l'ordre de la règle (canaux supprimés ignorés). */
async function gateChannels(channelId: string, rule: EntryRule): Promise<ChannelInfo[]> {
  const ids = rule.gateChannelIds.filter((id) => id !== channelId);
  if (ids.length === 0) return [];
  const rows = await prisma.channel.findMany({
    where: { id: { in: ids } },
    select: channelInfoSelect,
  });
  return ids.map((id) => rows.find((r) => r.id === id)).filter((c): c is ChannelInfo => !!c);
}

async function defaultRule(
  channelId: string,
): Promise<{ rule: EntryRule; updatedAt: Date } | null> {
  const row = await prisma.approvalRule.findFirst({
    where: { channelId, isDefault: true },
    orderBy: { updatedAt: "desc" },
  });
  return row ? { rule: entryRuleFromRow(row), updatedAt: row.updatedAt } : null;
}

/**
 * Crée et vérifie les liens de chaque canal à rejoindre de la règle par défaut. Aucun envoi aux membres.
 * `solutionBot` : bot à ajouter comme administrateur (celui qui traite les demandes du canal).
 */
export async function verifyGateLinks(
  channelId: string,
  opts: { userId?: string | null } = {},
): Promise<{ results: GateCheckResult[]; solutionBot: string | null }> {
  const [found, source, acting] = await Promise.all([
    defaultRule(channelId),
    prisma.channel.findUnique({ where: { id: channelId }, select: channelInfoSelect }),
    actingBotFor(channelId),
  ]);
  const solutionBot = acting?.username ?? null;
  if (!found || !source || !isRuleInForce(found.rule) || !hasGate(found.rule))
    return { results: [], solutionBot };
  const deps = createPrismaGateLinkDeps();
  const api = acting ? await webBotApi(acting.id) : null;
  const first: FirstBot | null =
    acting && api ? { botId: acting.id, username: acting.username, api } : null;
  const results: GateCheckResult[] = [];
  for (const gate of await gateChannels(channelId, found.rule)) {
    const r = await resolveGateLink(deps, source, gate, first);
    if ("problem" in r) {
      results.push({
        channelId: gate.id,
        title: gate.title,
        status: "no_link",
        tried: r.problem.tried,
      });
      continue;
    }
    const isPublic = gate.username !== null && r.button.url === `https://t.me/${gate.username}`;
    let status: GateCheckResult["status"] = isPublic ? "public" : "ok";
    if (isPublic && found.rule.gateMode === "REQUIRED") {
      const admins = await deps.adminBots(gate.id);
      if (admins.length === 0) status = "cannot_verify";
    }
    results.push({ channelId: gate.id, title: gate.title, status, tried: [] });
  }
  await recordEvent({
    type: "channel.gate_links_checked",
    channelId,
    botId: acting?.id ?? null,
    payload: toJsonValue({ byUserId: opts.userId ?? null, results }),
  });
  return { results, solutionBot };
}

/** Dernière vérification enregistrée pour ce canal (résultats relus prudemment). */
function lastCheckOf(payload: unknown): GateCheckResult[] | null {
  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  return results.filter(
    (r): r is GateCheckResult =>
      !!r &&
      typeof r === "object" &&
      typeof (r as GateCheckResult).channelId === "string" &&
      typeof (r as GateCheckResult).status === "string" &&
      Array.isArray((r as GateCheckResult).tried),
  );
}

export type GateLinkView = {
  rows: GateLinkRow[];
  summary: { ok: boolean; text: string };
};

/** État des liens des canaux à rejoindre pour l'éditeur (lecture seule), ou null sans canaux à rejoindre. */
export async function loadGateLinkView(
  channelId: string,
  rule: EntryRule | null,
): Promise<GateLinkView | null> {
  if (!isRuleInForce(rule) || !hasGate(rule)) return null;
  const ids = rule.gateChannelIds.filter((id) => id !== channelId);
  const [channels, links, admins, last, acting] = await Promise.all([
    prisma.channel.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, username: true },
    }),
    prisma.inviteLink.findMany({
      where: {
        kind: "GATE",
        sourceChannelId: channelId,
        channelId: { in: ids },
        isActive: true,
        bot: { isActive: true },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        channelId: true,
        botId: true,
        bot: { select: { username: true } },
      },
    }),
    prisma.channelBotAdmin.findMany({
      where: { channelId: { in: ids }, bot: { isActive: true } },
      select: {
        channelId: true,
        botId: true,
        rights: true,
        revokedAt: true,
        bot: { select: { username: true } },
      },
    }),
    prisma.event.findFirst({
      where: { channelId, type: "channel.gate_links_checked" },
      orderBy: { occurredAt: "desc" },
      select: { payload: true },
    }),
    actingBotFor(channelId),
  ]);
  const revoked = new Set(
    admins.filter((a) => a.revokedAt).map((a) => `${a.channelId}:${a.botId}`),
  );
  const linkBy: Record<string, string | null> = {};
  for (const l of links) {
    // Lien valide : son bot n'a pas perdu ses droits sur le canal à rejoindre (même règle que le bot).
    if (l.channelId in linkBy || revoked.has(`${l.channelId}:${l.botId}`)) continue;
    linkBy[l.channelId] = l.bot.username;
  }
  const adminBy: Record<string, Array<{ username: string; canInvite: boolean | null }>> = {};
  for (const a of admins) {
    if (a.revokedAt) continue;
    (adminBy[a.channelId] ??= []).push({
      username: a.bot.username,
      canInvite: canInviteFromRights(a.rights),
    });
  }
  const ordered = ids
    .map((id) => channels.find((c) => c.id === id))
    .filter((c): c is { id: string; title: string; username: string | null } => !!c);
  const rows = gateLinkRows({
    gateMode: rule.gateMode,
    channels: ordered,
    links: linkBy,
    admins: adminBy,
    lastCheck: lastCheckOf(last?.payload),
    solutionBot: acting?.username ?? null,
  });
  return { rows, summary: gateLinksSummary(rows) };
}
