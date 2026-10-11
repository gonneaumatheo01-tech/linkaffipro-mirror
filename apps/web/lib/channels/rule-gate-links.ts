import { orderRules } from "@linkaffipro/core";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import {
  createPrismaGateLinkDeps,
  resolveGateLink,
  webBotApi,
  type ChannelInfo,
  type FirstBot,
} from "@linkaffipro/telegram";
import { actingBotFor } from "@/lib/approval/telegram";
import { entryRuleFromRow, hasGate } from "./entry-rule";
import type { ExceptionItem } from "./exceptions";
import type { GateCheckResult } from "./gate-links";
import { loadGateLinkView, type GateLinkView } from "./gate-links-server";

/**
 * Liens des canaux à rejoindre de TOUTES les règles actives d'un canal (règle par défaut et exceptions selon la
 * provenance, phase 11) : « Vérifier les liens » et l'enregistrement d'une règle créent tout de suite les liens
 * manquants, avec le bot qui traite les demandes du canal puis chacun de nos bots administrateurs du canal à
 * rejoindre (paquet telegram, `resolveGateLink`). Les liens d'un canal sont les mêmes pour toutes ses règles (lien
 * GATE « canal → canal à rejoindre »). Aucun message n'est envoyé aux membres.
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

/**
 * Canaux à rejoindre demandés par les règles actives du canal (la règle par défaut d'abord, puis les exceptions dans
 * l'ordre du bot), sans doublon ni le canal lui-même. `required` : canaux obligatoires dans au moins une règle (le bot
 * doit alors pouvoir vérifier qu'ils sont rejoints).
 */
export async function channelGateTargets(
  channelId: string,
): Promise<{ ids: string[]; required: Set<string> }> {
  const rows = await prisma.approvalRule.findMany({
    where: { channelId, isActive: true, gateMode: { not: "NONE" } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const usable = rows.filter((r) => (r.isDefault ? true : r.scope !== "DEFAULT"));
  const ordered = [
    ...usable.filter((r) => r.isDefault),
    ...orderRules(usable.filter((r) => !r.isDefault)),
  ];
  const ids: string[] = [];
  const required = new Set<string>();
  for (const row of ordered) {
    const rule = entryRuleFromRow(row);
    if (!hasGate(rule)) continue;
    for (const id of rule.gateChannelIds) {
      if (id === channelId) continue;
      if (!ids.includes(id)) ids.push(id);
      if (rule.gateMode === "REQUIRED") required.add(id);
    }
  }
  return { ids, required };
}

/**
 * Crée et vérifie les liens de chaque canal à rejoindre des règles actives du canal ; journalise le résultat
 * (`channel.gate_links_checked`, même contenu que la vérification de la règle par défaut). `solutionBot` : bot à
 * ajouter comme administrateur (celui qui traite les demandes du canal).
 */
export async function verifyChannelGateLinks(
  channelId: string,
  opts: { userId?: string | null } = {},
): Promise<{ results: GateCheckResult[]; solutionBot: string | null }> {
  const [targets, source, acting] = await Promise.all([
    channelGateTargets(channelId),
    prisma.channel.findUnique({ where: { id: channelId }, select: channelInfoSelect }),
    actingBotFor(channelId),
  ]);
  const solutionBot = acting?.username ?? null;
  if (!source || targets.ids.length === 0) return { results: [], solutionBot };
  const rows = await prisma.channel.findMany({
    where: { id: { in: targets.ids } },
    select: channelInfoSelect,
  });
  const gates = targets.ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((c): c is ChannelInfo => !!c);
  const deps = createPrismaGateLinkDeps();
  const api = acting ? await webBotApi(acting.id) : null;
  const first: FirstBot | null =
    acting && api ? { botId: acting.id, username: acting.username, api } : null;
  const results: GateCheckResult[] = [];
  for (const gate of gates) {
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
    if (isPublic && targets.required.has(gate.id)) {
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

/** État des liens des canaux à rejoindre de chaque exception active qui en demande (lecture seule, sans Telegram). */
export async function loadExceptionGateViews(
  channelId: string,
  exceptions: readonly ExceptionItem[],
): Promise<Record<string, GateLinkView>> {
  const out: Record<string, GateLinkView> = {};
  const withGates = exceptions.filter((e) => e.isActive && hasGate(e.rule));
  const views = await Promise.all(withGates.map((e) => loadGateLinkView(channelId, e.rule)));
  withGates.forEach((e, i) => {
    const view = views[i];
    if (view) out[e.id] = view;
  });
  return out;
}
