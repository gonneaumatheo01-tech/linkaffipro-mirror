/**
 * Phase 27, chantier C — posts transférés à Kevin (privé de l'admin, privé d'un membre présenté, groupe enregistré).
 * Seul un message transféré d'un CANAL (`forward_origin.type === "channel"`, ou l'ancien `forward_from_chat` de type
 * canal) qui n'est pas un des nôtres est rangé comme post de référence (voie FORWARDED) ; c'est une DONNÉE : son texte
 * n'est jamais envoyé à l'interprète ni exécuté, jamais journalisé (règle 7 de la phase 26). Un transfert d'une
 * personne (même masquée) ou d'un groupe garde le traitement de la phase 26 (« message transféré », médiathèque).
 * - plusieurs transferts dans la même minute → UNE réponse (tâche différée `inspiration-forward-ack`, 60 s), envoyée
 *   dans la conversation de la personne qui transfère : « 12 posts de @x rangés (il en faut 20 pour l'analyse) » ;
 * - un canal inconnu (sans nom public le plus souvent) transféré pendant une collecte ouverte par Kevin
 *   (« transfère-moi 10 à 30 posts de @x ») est rangé sous la référence demandée ;
 * - à 20 posts ou plus avec un canal cible : analyse (`afterReferenceRead`) dans la tâche différée (worker).
 */
import { adminTelegramId, agentEvent, esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import type { BossChat, BossReply, BossSpeaker } from "../boss/contract";
import type { AgentsDeps } from "../types";
import { INSPIRATION_LIMITS } from "./contract";
import { afterReferenceRead, readCollect } from "./kevin";
import { forwardedToReferencePost, storeReferencePosts, type ForwardedMessage } from "./kevin-ports";
import { askerOf, createReference, findReference, loadReferenceRow, readAsker, referenceLabel, referencePostCount, rememberAsker, targetIdsOf, type ReferenceRow } from "./kevin-refs";

export const INSPIRATION_FORWARD_PREFIX = "inspiration.forward.";
export const FORWARD_ACK_JOB = "inspiration-forward-ack";
/** Délai de regroupement des transferts : une seule réponse par minute. */
export const FORWARD_BATCH_MS = 60_000;
/** Une réponse groupée attendue depuis plus de 5 minutes (tâche perdue) ne bloque plus le lot suivant. */
export const FORWARD_ACK_STALE_MS = 5 * 60_000;

export type ForwardBatch = {
  /** Posts rangés depuis la dernière réponse, par référence. */
  counts: Record<string, number>;
  firstAt: string;
  ackPending: boolean;
  /** Qui transfère (la réponse lui revient, dans cette conversation). */
  fromTelegramId: string | null;
  /** Dernière référence alimentée dans cette conversation (« ces posts »). */
  lastRefId: string | null;
};

const keyOf = (chatKey: string) => `${INSPIRATION_FORWARD_PREFIX}${chatKey}`;

export async function readForwardBatch(deps: AgentsDeps, chatKey: string): Promise<ForwardBatch | null> {
  const v = (await readSetting(deps, keyOf(chatKey))) as ForwardBatch | undefined;
  return v && typeof v === "object" && v.counts && typeof v.counts === "object" ? v : null;
}

async function writeBatch(deps: AgentsDeps, chatKey: string, b: ForwardBatch): Promise<void> {
  await writeSetting(deps, keyOf(chatKey), b);
}

/** Le canal d'origine est-il un des nôtres (ajout d'un canal, phase 8 : pas un post de référence) ? */
async function isOurChannel(deps: AgentsDeps, chatId: bigint): Promise<boolean> {
  return !!(await deps.prisma.channel.findFirst({ where: { telegramChatId: chatId } }));
}

/** Le message est-il transféré d'un canal (pur) ? Jamais une personne, même masquée, ni un groupe. */
export function isChannelForward(m: Pick<ForwardedMessage, "forward_origin" | "forward_from_chat">): boolean {
  if (m.forward_origin) return m.forward_origin.type === "channel";
  return m.forward_from_chat?.type === "channel";
}

export type ForwardInput = { message: ForwardedMessage; chat: BossChat; speaker: BossSpeaker };
export type ForwardOutcome = { handled: false } | { handled: true; reply?: BossReply };

/**
 * Range un post transféré d'un canal tiers. `handled: false` : pas un post de canal tiers : le traitement habituel
 * continue. Aucune réponse immédiate (elle part une minute après, pour tout le lot).
 */
export async function kevinForwardedPost(deps: AgentsDeps, input: ForwardInput): Promise<ForwardOutcome> {
  if (!isChannelForward(input.message)) return { handled: false };
  const parsed = forwardedToReferencePost(input.message);
  if (!parsed?.origin) return { handled: false };
  if (await isOurChannel(deps, parsed.origin.chatId)) return { handled: false };
  const chatKey = input.chat.chatId.toString();
  const now = nowOf(deps);
  const prev = await readForwardBatch(deps, chatKey);
  const batch: ForwardBatch = prev ?? { counts: {}, firstAt: now.toISOString(), ackPending: false, fromTelegramId: null, lastRefId: null };
  // Tâche de réponse perdue : le lot repart (jamais bloqué).
  if (batch.ackPending && now.getTime() - new Date(batch.firstAt).getTime() > FORWARD_ACK_STALE_MS) batch.ackPending = false;
  let ref = await findReference(deps, { username: parsed.origin.username, chatId: parsed.origin.chatId });
  if (!ref) {
    // Kevin a demandé des posts d'un canal précis (privé, illisible) à cette personne : un canal encore inconnu est
    // celui-là, tant que la référence demandée n'a pas déjà un autre identifiant Telegram ou un autre nom.
    const collect = await readCollect(deps, chatKey);
    const asked = collect && (!collect.telegramUserId || collect.telegramUserId === input.speaker.telegramUserId.toString()) ? await loadReferenceRow(deps, collect.referenceChannelId) : null;
    if (asked && (asked.telegramChatId === null || asked.telegramChatId === parsed.origin.chatId) && (!asked.username || !parsed.origin.username)) ref = asked;
  }
  ref ??= await createReference(deps, { username: parsed.origin.username, chatId: parsed.origin.chatId, title: parsed.origin.title, via: "FORWARDED", universe: "", addedBy: input.speaker.telegramUserId });
  await storeReferencePosts(deps, ref.id, [parsed.post], "FORWARDED", { title: parsed.origin.title, username: parsed.origin.username, chatId: parsed.origin.chatId });
  if (!(await readAsker(deps, ref.id))) await rememberAsker(deps, ref.id, askerOf(input.speaker, input.chat, null));
  if (!batch.ackPending) {
    batch.counts = {};
    batch.firstAt = now.toISOString();
  }
  batch.counts[ref.id] = (batch.counts[ref.id] ?? 0) + 1;
  batch.lastRefId = ref.id;
  batch.fromTelegramId = input.speaker.telegramUserId.toString();
  await agentEvent(deps, "agents.inspiration.forward_stored", { referenceChannelId: ref.id });
  if (batch.ackPending) {
    await writeBatch(deps, chatKey, batch);
    return { handled: true };
  }
  batch.ackPending = true;
  await writeBatch(deps, chatKey, batch);
  try {
    await deps.enqueue.orchestrator({ type: FORWARD_ACK_JOB, chatKey }, { jobId: `${FORWARD_ACK_JOB}-${chatKey}-${now.getTime()}`, delayMs: FORWARD_BATCH_MS });
    return { handled: true };
  } catch (err) {
    // File indisponible : réponse tout de suite (jamais de silence), sans lancer l'analyse ici (webhook).
    deps.logger?.warn({ err: (err as Error).message }, "[inspiration] réponse groupée non mise en file");
    const text = (await flushBatch(deps, chatKey))?.text;
    return { handled: true, ...(text ? { reply: { reply: text } } : {}) };
  }
}

/** Ligne de réponse pour une référence du lot (pure, HTML échappé). */
export function forwardAckLine(ref: Pick<ReferenceRow, "username" | "title">, added: number, total: number, hasTarget: boolean): string {
  const label = esc(referenceLabel(ref));
  const n = `${added} post${added > 1 ? "s" : ""} de ${label} rangé${added > 1 ? "s" : ""}`;
  if (!hasTarget) return `${n} (${total} en tout). C'est pour quel canal ? Écris par exemple « c'est pour le canal Roulette ».`;
  if (total < INSPIRATION_LIMITS.minPostsForAnalysis) return `${n} (il en faut ${INSPIRATION_LIMITS.minPostsForAnalysis} pour l'analyse${total !== added ? `, j'en ai ${total}` : ""}).`;
  return `${n} (${total} en tout) : je lance l'analyse, je reviens dans quelques minutes.`;
}

/** Réponse du lot ; rend le texte et les références à analyser, ou null s'il n'y a rien à dire. */
async function flushBatch(deps: AgentsDeps, chatKey: string): Promise<{ text: string; toAnalyze: string[]; fromTelegramId: string | null } | null> {
  const batch = await readForwardBatch(deps, chatKey);
  if (!batch || !batch.ackPending) return null;
  const lines: string[] = [];
  const toAnalyze: string[] = [];
  for (const [refId, added] of Object.entries(batch.counts)) {
    const ref = await loadReferenceRow(deps, refId);
    if (!ref) continue;
    const total = await referencePostCount(deps, refId);
    const hasTarget = targetIdsOf(ref).length > 0;
    lines.push(forwardAckLine(ref, added, total, hasTarget));
    if (hasTarget && total >= INSPIRATION_LIMITS.minPostsForAnalysis) toAnalyze.push(refId);
  }
  await writeBatch(deps, chatKey, { ...batch, counts: {}, ackPending: false });
  return lines.length ? { text: lines.join("\n"), toAnalyze, fromTelegramId: batch.fromTelegramId } : null;
}

/** Envoi dans la conversation du lot (privé de l'admin : son messager ; groupe ou membre : la même conversation). */
async function sendToChat(deps: AgentsDeps, chatKey: string, html: string): Promise<boolean> {
  try {
    const admin = await adminTelegramId(deps);
    const sent = admin && admin.toString() === chatKey ? await deps.admin?.send(html) : await deps.admin?.sendTo?.(BigInt(chatKey), html);
    if (sent) return true;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[inspiration] réponse aux transferts non envoyée");
  }
  return false;
}

/** Tâche différée `inspiration-forward-ack` (worker, file du Grand Chef) : une réponse pour tout le lot, puis l'analyse. */
export async function inspirationForwardAck(deps: AgentsDeps, job: { chatKey?: unknown; analyzeRefId?: unknown }): Promise<{ sent: boolean }> {
  const chatKey = typeof job.chatKey === "string" ? job.chatKey : null;
  if (!chatKey) return { sent: false };
  const out = await flushBatch(deps, chatKey);
  let sent = false;
  if (out) {
    sent = await sendToChat(deps, chatKey, out.text);
    // Le résumé revient à la personne qui a transféré, dans cette conversation.
    for (const refId of out.toAnalyze) {
      const asker = await readAsker(deps, refId);
      if (asker && asker.chatId !== chatKey) await rememberAsker(deps, refId, { ...asker, chatId: chatKey, chatType: chatKey.startsWith("-") ? "group" : "private", telegramUserId: out.fromTelegramId });
      await afterReferenceRead(deps, refId);
    }
  }
  if (typeof job.analyzeRefId === "string") await afterReferenceRead(deps, job.analyzeRefId);
  return { sent };
}
