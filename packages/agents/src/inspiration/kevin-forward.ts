/**
 * Phase 27, chantier C — posts transférés à Kevin (privé de l'admin, privé d'un membre présenté, groupe enregistré).
 * Un message transféré d'un CANAL (qui n'est pas un des nôtres) est rangé comme post de référence (voie FORWARDED) ;
 * c'est une DONNÉE : son texte n'est jamais envoyé à l'interprète ni exécuté, jamais journalisé (règle 7 de la phase 26).
 * - plusieurs transferts dans la même minute → UNE réponse (tâche différée `inspiration-forward-ack`, 60 s) :
 *   « 12 posts de @x rangés (il en faut 20 pour l'analyse) » ;
 * - origine masquée → rangés à part, Kevin demande UNE fois le nom du canal et range le reste sous ce nom ;
 *   (une collecte ouverte par Kevin, « transfère-moi 10 à 30 posts de @x », les range directement sous @x) ;
 * - à 20 posts ou plus avec un canal cible : analyse (`afterReferenceRead`) dans la tâche différée (worker).
 */
import { agentEvent, esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import type { BossChat, BossReply, BossSpeaker } from "../boss/contract";
import type { AgentsDeps } from "../types";
import { INSPIRATION_LIMITS } from "./contract";
import { afterReferenceRead, readCollect } from "./kevin";
import { forwardedToReferencePost, normalizeChannelUsername, storeReferencePosts, type ForwardedMessage } from "./kevin-ports";
import {
  askerOf,
  createReference,
  findReference,
  loadReferenceRow,
  referenceLabel,
  referencePostCount,
  rememberAsker,
  sendToAsker,
  targetIdsOf,
  type ReferenceRow,
} from "./kevin-refs";

export const INSPIRATION_FORWARD_PREFIX = "inspiration.forward.";
export const FORWARD_ACK_JOB = "inspiration-forward-ack";
/** Délai de regroupement des transferts : une seule réponse par minute. */
export const FORWARD_BATCH_MS = 60_000;

export type ForwardBatch = {
  /** Posts rangés depuis la dernière réponse, par référence. */
  counts: Record<string, number>;
  firstAt: string;
  ackPending: boolean;
  /** Référence sans nom (transferts masqués) dont Kevin attend le nom. */
  pendingNameRefId: string | null;
  askedName: boolean;
  /** Qui transfère (seule cette personne donne le nom). */
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
  const ch = await deps.prisma.channel.findFirst({ where: { telegramChatId: chatId } });
  return !!ch;
}

export type ForwardInput = { message: ForwardedMessage; chat: BossChat; speaker: BossSpeaker };
export type ForwardOutcome = { handled: false } | { handled: true; reply?: BossReply };

/**
 * Range un post transféré. `handled: false` : pas un post de canal tiers (transfert d'une personne, d'un de nos canaux) :
 * le traitement habituel continue. Aucune réponse immédiate (elle part une minute après, pour tout le lot).
 */
export async function kevinForwardedPost(deps: AgentsDeps, input: ForwardInput): Promise<ForwardOutcome> {
  const parsed = forwardedToReferencePost(input.message);
  if (!parsed) return { handled: false };
  const o = input.message.forward_origin;
  // Transfert d'une personne (identifiée) ou d'un groupe : ce n'est pas un post de canal.
  if (!parsed.origin && o && o.type !== "hidden_user") return { handled: false };
  if (parsed.origin && (await isOurChannel(deps, parsed.origin.chatId))) return { handled: false };
  const chatKey = input.chat.chatId.toString();
  const now = nowOf(deps);
  const batch: ForwardBatch = (await readForwardBatch(deps, chatKey)) ?? {
    counts: {},
    firstAt: now.toISOString(),
    ackPending: false,
    pendingNameRefId: null,
    askedName: false,
    fromTelegramId: null,
    lastRefId: null,
  };
  let ref: ReferenceRow | null = null;
  if (parsed.origin) {
    ref = await findReference(deps, { username: parsed.origin.username, chatId: parsed.origin.chatId });
    ref ??= await createReference(deps, { username: parsed.origin.username, chatId: parsed.origin.chatId, title: parsed.origin.title, via: "FORWARDED", universe: "", addedBy: input.speaker.telegramUserId });
  } else {
    const collect = await readCollect(deps, chatKey);
    ref = collect ? await loadReferenceRow(deps, collect.referenceChannelId) : null;
    if (!ref && batch.pendingNameRefId) ref = await loadReferenceRow(deps, batch.pendingNameRefId);
    if (!ref) {
      ref = await createReference(deps, { via: "FORWARDED", universe: "", addedBy: input.speaker.telegramUserId });
      batch.pendingNameRefId = ref.id;
      batch.askedName = false;
    }
  }
  await storeReferencePosts(deps, ref.id, [parsed.post], "FORWARDED", parsed.origin ? { title: parsed.origin.title, username: parsed.origin.username, chatId: parsed.origin.chatId } : {});
  if (!(await readAskerSet(deps, ref.id))) await rememberAsker(deps, ref.id, askerOf(input.speaker, input.chat, null));
  batch.counts[ref.id] = (batch.counts[ref.id] ?? 0) + 1;
  batch.lastRefId = ref.id;
  batch.fromTelegramId = input.speaker.telegramUserId.toString();
  await agentEvent(deps, "agents.inspiration.forward_stored", { referenceChannelId: ref.id, masked: !parsed.origin });
  if (batch.ackPending) {
    await writeBatch(deps, chatKey, batch);
    return { handled: true };
  }
  batch.ackPending = true;
  batch.firstAt = now.toISOString();
  await writeBatch(deps, chatKey, batch);
  try {
    await deps.enqueue.orchestrator({ type: FORWARD_ACK_JOB, chatKey }, { jobId: `${FORWARD_ACK_JOB}-${chatKey}-${now.getTime()}`, delayMs: FORWARD_BATCH_MS });
    return { handled: true };
  } catch (err) {
    // File indisponible : réponse tout de suite (jamais de silence).
    deps.logger?.warn({ err: (err as Error).message }, "[inspiration] réponse groupée non mise en file");
    const text = await flushBatch(deps, chatKey, { analyze: false });
    return { handled: true, ...(text ? { reply: { reply: text } } : {}) };
  }
}

async function readAskerSet(deps: AgentsDeps, refId: string): Promise<boolean> {
  return (await readSetting(deps, `inspiration.asker.${refId}`)) !== undefined;
}

/** Ligne de réponse pour une référence du lot (pure, HTML échappé). */
export function forwardAckLine(ref: Pick<ReferenceRow, "username" | "title">, added: number, total: number, hasTarget: boolean): string {
  const label = esc(referenceLabel(ref));
  const n = `${added} post${added > 1 ? "s" : ""} de ${label} rangé${added > 1 ? "s" : ""}`;
  if (!hasTarget) return `${n} (${total} en tout). C'est pour quel canal ? Écris par exemple « c'est pour le canal Roulette ».`;
  if (total < INSPIRATION_LIMITS.minPostsForAnalysis) return `${n} (il en faut ${INSPIRATION_LIMITS.minPostsForAnalysis} pour l'analyse${total !== added ? `, j'en ai ${total}` : ""}).`;
  return `${n} (${total} en tout) : je lance l'analyse, je reviens dans quelques minutes.`;
}

export const ASK_NAME_TEXT = (n: number) =>
  `J'ai rangé ${n} post${n > 1 ? "s" : ""} transféré${n > 1 ? "s" : ""}, mais je ne vois pas de quel canal ${n > 1 ? "ils viennent" : "il vient"} : écris-moi son nom (par exemple @nomducanal).`;

/** Réponse du lot (et analyse si `analyze` et assez de posts) ; rend le texte, ou null s'il n'y a rien à dire. */
async function flushBatch(deps: AgentsDeps, chatKey: string, opts: { analyze: boolean }): Promise<string | null> {
  const batch = await readForwardBatch(deps, chatKey);
  if (!batch || !batch.ackPending) return null;
  const counts = batch.counts;
  const lines: string[] = [];
  const toAnalyze: string[] = [];
  for (const [refId, added] of Object.entries(counts)) {
    const ref = await loadReferenceRow(deps, refId);
    if (!ref) continue;
    const total = await referencePostCount(deps, refId);
    if (!ref.username && !ref.title && refId === batch.pendingNameRefId) {
      if (!batch.askedName) {
        lines.push(ASK_NAME_TEXT(added));
        batch.askedName = true;
      }
      continue;
    }
    const hasTarget = targetIdsOf(ref).length > 0;
    lines.push(forwardAckLine(ref, added, total, hasTarget));
    if (hasTarget && total >= INSPIRATION_LIMITS.minPostsForAnalysis) toAnalyze.push(refId);
  }
  await writeBatch(deps, chatKey, { ...batch, counts: {}, ackPending: false });
  if (opts.analyze) for (const id of toAnalyze) await afterReferenceRead(deps, id);
  return lines.length ? lines.join("\n") : null;
}

/** Tâche différée `inspiration-forward-ack` (worker, file du Grand Chef) : une réponse pour tout le lot. */
export async function inspirationForwardAck(deps: AgentsDeps, job: { chatKey?: unknown; analyzeRefId?: unknown }): Promise<{ sent: boolean }> {
  const chatKey = typeof job.chatKey === "string" ? job.chatKey : null;
  if (!chatKey) return { sent: false };
  const batch = await readForwardBatch(deps, chatKey);
  const refForSend = batch?.lastRefId ?? (typeof job.analyzeRefId === "string" ? job.analyzeRefId : null);
  const text = await flushBatch(deps, chatKey, { analyze: false });
  let sent = false;
  if (text && refForSend) sent = await sendToAsker(deps, refForSend, text, { actionKey: "inspiration_transfert" });
  // Analyse après la réponse (le résumé part en second message).
  if (typeof job.analyzeRefId === "string") await afterReferenceRead(deps, job.analyzeRefId);
  else if (text && batch) {
    for (const refId of Object.keys(batch.counts)) {
      const ref = await loadReferenceRow(deps, refId);
      if (ref && targetIdsOf(ref).length && (await referencePostCount(deps, refId)) >= INSPIRATION_LIMITS.minPostsForAnalysis) await afterReferenceRead(deps, refId);
    }
  }
  return { sent };
}

/**
 * Réponse au nom demandé (origine masquée) : « @nomducanal » (ou un lien t.me) de la personne qui a transféré, dans la
 * même conversation. Range le lot sous ce nom (fusion si la référence existe déjà). Rend la réponse, ou null.
 */
export async function inspirationNameAnswer(deps: AgentsDeps, input: { text: string; chat?: BossChat | null; speaker?: BossSpeaker | null }): Promise<BossReply | null> {
  if (!input.chat) return null;
  const chatKey = input.chat.chatId.toString();
  const batch = await readForwardBatch(deps, chatKey);
  if (!batch?.pendingNameRefId || !batch.askedName) return null;
  if (input.speaker && batch.fromTelegramId && input.speaker.telegramUserId.toString() !== batch.fromTelegramId) return null;
  const token = input.text.trim().split(/\s+/).find((w) => /^@|t\.me\//i.test(w)) ?? (/^\S+$/.test(input.text.trim()) ? input.text.trim() : null);
  const username = token ? normalizeChannelUsername(token) : null;
  if (!username) return null;
  const pending = await loadReferenceRow(deps, batch.pendingNameRefId);
  if (!pending) return null;
  const existing = await findReference(deps, { username });
  let ref: ReferenceRow;
  if (existing && existing.id !== pending.id) {
    await deps.prisma.referencePost.updateMany({ where: { referenceChannelId: pending.id }, data: { referenceChannelId: existing.id } });
    const n = await referencePostCount(deps, existing.id);
    await deps.prisma.referenceChannel.update({ where: { id: existing.id }, data: { postCount: n } });
    await deps.prisma.referenceChannel.update({ where: { id: pending.id }, data: { removedAt: nowOf(deps), postCount: 0 } });
    ref = (await loadReferenceRow(deps, existing.id))!;
  } else {
    ref = (await deps.prisma.referenceChannel.update({ where: { id: pending.id }, data: { username } })) as ReferenceRow;
  }
  await rememberAsker(deps, ref.id, askerOf(input.speaker, input.chat, null));
  await writeBatch(deps, chatKey, { ...batch, pendingNameRefId: null, askedName: false, lastRefId: ref.id });
  const total = await referencePostCount(deps, ref.id);
  const hasTarget = targetIdsOf(ref).length > 0;
  const head = `C'est noté : ${total} post${total > 1 ? "s" : ""} rangé${total > 1 ? "s" : ""} sous ${esc(referenceLabel(ref))}.`;
  let tail: string;
  if (!hasTarget) tail = "C'est pour quel canal ? Écris par exemple « c'est pour le canal Roulette ».";
  else if (total < INSPIRATION_LIMITS.minPostsForAnalysis) tail = `Il m'en faut ${INSPIRATION_LIMITS.minPostsForAnalysis} pour l'analyse : transfère-m'en d'autres.`;
  else {
    tail = "Je lance l'analyse, je reviens dans quelques minutes.";
    await deps.enqueue.orchestrator({ type: FORWARD_ACK_JOB, chatKey, analyzeRefId: ref.id }, { jobId: `${FORWARD_ACK_JOB}-${chatKey}-a${nowOf(deps).getTime()}` }).catch(() => undefined);
  }
  await agentEvent(deps, "agents.inspiration.forward_named", { referenceChannelId: ref.id });
  return { reply: `${head}\n${tail}` };
}
