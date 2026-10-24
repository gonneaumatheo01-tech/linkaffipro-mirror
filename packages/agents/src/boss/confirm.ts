/**
 * Confirmations du Boss (phase 26, règle 4) : une seule action en attente (`Setting` `boss.pending`), expirée après
 * 10 minutes ; une nouvelle de l'admin remplace la précédente et le dit toujours (« la confirmation précédente … est
 * annulée »). Une demande d'un MEMBRE ne remplace jamais une confirmation encore valable : elle est mise de côté
 * (`Setting` `boss.pending.deferred`) et montrée à l'admin dès que la sienne est réglée. Message = résumé en 2 lignes +
 * boutons OUI / NON (`bsc:<id>:yes|no`) ; « OUI », « oui », « ouais », « vas-y », « confirme » en texte confirment
 * (jamais « ok », « go » ni 👍), « NON » / « annule » annulent ; « OUI » sans rien → « Rien à confirmer. ». Un « OUI »
 * sans « Répondre » ne vaut que dans la conversation où la confirmation a été montrée (`BossPending.chatId`). Seul
 * l'admin confirme (`adminTelegramId`).
 */
import { randomUUID } from "node:crypto";
import {
  BOSS_CALLBACK_PREFIX,
  BOSS_PENDING_SETTING,
  BOSS_PENDING_TTL_MS,
  type BossActor,
  type BossDeps,
  type BossPending,
  type BossReply,
} from "./contract";
import { adminTelegramId, agentAudit, esc, nowOf, readSetting, telegramActorUserId, writeSetting } from "../admin/journal";
import { normalizeText } from "../human/answer";
import type { AdminButton } from "../types";

export const NOTHING_TO_CONFIRM = "Rien à confirmer.";
export const NOTHING_TO_CANCEL = "Rien à annuler.";
export const PENDING_EXPIRED = "Trop tard : la confirmation a expiré (10 minutes). Redemande-moi si tu veux toujours.";
export const PENDING_CANCELLED = "D'accord, j'annule : rien n'a changé.";

/** Mots qui confirment. Jamais « ok », « go », « d'accord » ni un emoji : trop faciles à écrire sans y penser. */
const YES_WORDS = new Set(["oui", "ouais", "ouai", "yes", "oui oui", "oui vas y", "oui vas-y", "vas y", "vas-y", "confirme", "je confirme", "oui je confirme"]);
const NO_WORDS = new Set(["non", "no", "nope", "non merci", "laisse tomber", "pas question", "👎", "❌"]);
const CANCEL_WORDS = new Set(["annule", "annuler", "annulé", "annulez", "stop", "cancel", "laisse tomber"]);

function clean(text: string): string {
  return normalizeText(text).replace(/^["«»\s]+|["«»\s]+$/g, "").replace(/[!.]+$/g, "").trim();
}

/** « oui » / « non » / « annule » d'une confirmation du Boss (pur). */
export function confirmWordOf(text: string): "yes" | "no" | "cancel" | null {
  const n = clean(text);
  if (YES_WORDS.has(n)) return "yes";
  if (CANCEL_WORDS.has(n)) return "cancel";
  if (NO_WORDS.has(n)) return "no";
  return null;
}

function isPending(v: unknown): v is BossPending {
  if (!v || typeof v !== "object") return false;
  const o = v as BossPending;
  return typeof o.id === "string" && typeof o.actionKey === "string" && typeof o.expiresAt === "string";
}

/** Confirmation en attente (même expirée : `expired` le dit), ou null. */
export async function readBossPending(deps: BossDeps): Promise<(BossPending & { expired: boolean }) | null> {
  const v = await readSetting(deps, BOSS_PENDING_SETTING);
  if (!isPending(v)) return null;
  return { ...v, expired: new Date(v.expiresAt).getTime() <= nowOf(deps).getTime() };
}

export async function clearBossPending(deps: BossDeps, id?: string): Promise<boolean> {
  if (id) {
    const cur = await readBossPending(deps);
    if (!cur || cur.id !== id) return false;
  }
  const r = await deps.prisma.setting.deleteMany({ where: { key: BOSS_PENDING_SETTING } });
  return r.count > 0;
}

export function confirmButtons(id: string): AdminButton[][] {
  return [
    [
      { text: "✅ OUI", callbackData: `${BOSS_CALLBACK_PREFIX}${id}:yes` },
      { text: "❌ NON", callbackData: `${BOSS_CALLBACK_PREFIX}${id}:no` },
    ],
  ];
}

/** Première ligne d'un résumé, courte (« Passer l'équipe Casino en vrai ? »). */
function firstLine(summary: string): string {
  const l = (summary.split("\n")[0] ?? "").trim();
  return l.length > 90 ? `${l.slice(0, 89)}…` : l;
}

/**
 * Crée la confirmation (remplace la précédente, en le disant) et rend le message à envoyer (résumé + OUI / NON).
 * `chatId` : conversation où elle sera montrée (un « OUI » sans « Répondre » n'y vaut que là).
 */
export async function createBossPending(
  deps: BossDeps,
  input: {
    actionKey: string;
    params: Record<string, unknown>;
    summary: string;
    chatId?: bigint | string | null;
    requestedBy?: { telegramUserId: bigint | string; firstName: string } | null;
  },
): Promise<BossReply> {
  const previous = await readBossPending(deps);
  const now = nowOf(deps);
  const pending: BossPending = {
    id: randomUUID().replace(/-/g, "").slice(0, 16),
    actionKey: input.actionKey,
    params: JSON.parse(JSON.stringify(input.params)) as Record<string, unknown>,
    summary: input.summary,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + BOSS_PENDING_TTL_MS).toISOString(),
    messageId: null,
    chatId: input.chatId != null ? String(input.chatId) : null,
    requestedBy: input.requestedBy ? { telegramUserId: String(input.requestedBy.telegramUserId), firstName: input.requestedBy.firstName } : null,
  };
  await writeSetting(deps, BOSS_PENDING_SETTING, pending);
  const replaced =
    previous && !previous.expired
      ? `(La confirmation précédente${previous.requestedBy ? ` demandée par ${esc(previous.requestedBy.firstName)}` : ""} est annulée : « ${esc(firstLine(previous.summary))} ».)\n`
      : "";
  const summary = input.summary.split("\n").slice(0, 2).map(esc).join("\n");
  return {
    reply: `${replaced}${summary}\nOUI pour confirmer, NON pour annuler (10 minutes).`,
    buttons: confirmButtons(pending.id),
    pendingId: pending.id,
  };
}

/**
 * Ce « OUI » / « NON » vise-t-il la confirmation en attente (pur) ? Même conversation (ou conversation inconnue), et
 * sans « Répondre » ou en réponse au message de la confirmation. Une question CONFIRM / CHOICE posée APRÈS la
 * confirmation (ou une réponse à un autre message) garde la priorité.
 */
export function pendingTargeted(
  pending: Pick<BossPending, "createdAt" | "messageId" | "chatId"> & { expired?: boolean },
  input: { replyTo: number | null; chatId?: bigint | null; current?: { kind: string; askedAt?: Date | null } | null },
): "target" | "question-first" | "other-chat" | "other-message" {
  const sameChat = !pending.chatId || input.chatId == null || pending.chatId === String(input.chatId);
  const cur = input.current;
  const questionFirst =
    !!cur &&
    (cur.kind === "CONFIRM" || cur.kind === "CHOICE") &&
    ((input.replyTo !== null && input.replyTo !== pending.messageId) ||
      (input.replyTo === null && (cur.askedAt?.getTime() ?? 0) > new Date(pending.createdAt).getTime()));
  if (questionFirst) return "question-first";
  if (!sameChat) return "other-chat";
  if (input.replyTo === null || input.replyTo === pending.messageId || pending.expired) return "target";
  return "other-message";
}

export const PENDING_OTHER_CHAT =
  "La confirmation en attente a été montrée dans une autre conversation : appuie sur son bouton OUI, ou réponds « OUI » à ce message-là.";

// ------------------------------------------------------------------------------------- demandes de membres en attente

/** `Setting` : demandes de membres mises de côté pendant qu'une confirmation de l'admin attend (10 au plus). */
export const BOSS_DEFERRED_SETTING = "boss.pending.deferred";
const DEFERRED_MAX = 10;
const DEFERRED_TTL_MS = 24 * 3600_000;

export type BossDeferred = {
  actionKey: string;
  params: Record<string, unknown>;
  summary: string;
  /** Message pour l'admin (« @Mathéo Léa demande : … OUI ? »). */
  text: string;
  /** Où le montrer : le groupe (chaîne d'un BigInt), ou null = le privé de l'admin. */
  chatId: string | null;
  requestedBy: { telegramUserId: string; firstName: string };
  createdAt: string;
};

async function readDeferred(deps: BossDeps): Promise<BossDeferred[]> {
  const v = await readSetting(deps, BOSS_DEFERRED_SETTING);
  return Array.isArray(v) ? (v as BossDeferred[]).filter((d) => d && typeof d.actionKey === "string") : [];
}

/** Met de côté la demande d'un membre (une confirmation de l'admin attend). */
export async function deferBossPending(deps: BossDeps, item: Omit<BossDeferred, "createdAt">): Promise<void> {
  const list = (await readDeferred(deps)).filter(
    (d) => !(d.actionKey === item.actionKey && d.requestedBy.telegramUserId === item.requestedBy.telegramUserId && JSON.stringify(d.params) === JSON.stringify(item.params)),
  );
  list.push({ ...item, params: JSON.parse(JSON.stringify(item.params)) as Record<string, unknown>, createdAt: nowOf(deps).toISOString() });
  await writeSetting(deps, BOSS_DEFERRED_SETTING, list.slice(-DEFERRED_MAX));
}

/**
 * Montre à l'admin la plus ancienne demande de membre mise de côté (si aucune confirmation n'attend) : nouvelle
 * confirmation dans la conversation d'origine, boutons OUI / NON. Rend vrai si une demande a été montrée.
 */
export async function sendNextDeferredBossPending(deps: BossDeps): Promise<boolean> {
  const cur = await readBossPending(deps);
  if (cur && !cur.expired) return false;
  const now = nowOf(deps).getTime();
  const list = (await readDeferred(deps)).filter((d) => now - new Date(d.createdAt).getTime() < DEFERRED_TTL_MS);
  const next = list.shift();
  await writeSetting(deps, BOSS_DEFERRED_SETTING, list);
  if (!next) return false;
  const admin = await adminTelegramId(deps);
  const chatId = next.chatId ?? (admin ? admin.toString() : null);
  const r = await createBossPending(deps, { actionKey: next.actionKey, params: next.params, summary: next.summary, chatId, requestedBy: next.requestedBy });
  const text = `${next.text}\nOUI pour confirmer, NON pour annuler (10 minutes).`;
  try {
    const sent = next.chatId ? ((await deps.admin?.sendTo?.(BigInt(next.chatId), text, { buttons: r.buttons })) ?? null) : ((await deps.admin?.send(text, { buttons: r.buttons })) ?? null);
    if (sent && r.pendingId) await rememberBossPendingMessage(deps, r.pendingId, sent.messageId);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] demande mise de côté non envoyée");
  }
  return true;
}

/** Suite à donner après une confirmation réglée : la demande de membre mise de côté, s'il y en a une. */
export async function bossDeferredFollowUp(deps: BossDeps): Promise<(() => Promise<void>) | undefined> {
  if (!(await readDeferred(deps)).length) return undefined;
  return async () => {
    await sendNextDeferredBossPending(deps);
  };
}

/** Le bot donne l'identifiant du message de confirmation envoyé (une réponse « OUI » à ce message confirme). */
export async function rememberBossPendingMessage(deps: BossDeps, pendingId: string, messageId: number): Promise<void> {
  const cur = await readBossPending(deps);
  if (!cur || cur.id !== pendingId) return;
  const { expired: _expired, ...rest } = cur;
  await writeSetting(deps, BOSS_PENDING_SETTING, { ...rest, messageId });
}

/**
 * Réponse OUI / NON / annule à la confirmation en attente. La confirmation est retirée AVANT l'exécution (deux « OUI »
 * simultanés n'exécutent jamais deux fois).
 */
export async function resolveBossPending(
  deps: BossDeps,
  word: "yes" | "no" | "cancel",
  opts: { pendingId?: string } = {},
): Promise<BossReply & { handled: boolean }> {
  const cur = await readBossPending(deps);
  if (!cur || (opts.pendingId && cur.id !== opts.pendingId)) {
    if (opts.pendingId) return { handled: true, reply: "Cette confirmation n'existe plus : rien n'a changé." };
    return { handled: false };
  }
  if (cur.expired) {
    await clearBossPending(deps, cur.id);
    return { handled: true, reply: word === "yes" ? PENDING_EXPIRED : NOTHING_TO_CANCEL, followUp: await bossDeferredFollowUp(deps) };
  }
  const claimed = await clearBossPending(deps, cur.id);
  if (!claimed) return { handled: true, reply: "Déjà traité : rien de plus à faire." };
  const actor: BossActor = { userId: await telegramActorUserId(deps), via: "TELEGRAM" };
  if (word !== "yes") {
    await agentAudit(deps, {
      userId: actor.userId,
      action: `boss.${cur.actionKey}`,
      entityType: "BossPending",
      entityId: cur.id,
      metadata: { status: "refused", via: "TELEGRAM" },
    });
    return { handled: true, reply: PENDING_CANCELLED, followUp: await bossDeferredFollowUp(deps) };
  }
  const { expired: _e, ...pending } = cur;
  // Import différé : execute → catalog → confirm formerait un cycle au chargement.
  const { runConfirmedAction } = await import("./execute");
  const r = await runConfirmedAction(deps, pending, actor);
  const next = await bossDeferredFollowUp(deps);
  const followUp =
    r.followUp && next
      ? async () => {
          await r.followUp!();
          await next();
        }
      : (r.followUp ?? next);
  return { handled: true, ...r, ...(followUp ? { followUp } : {}) };
}

export function isBossCallbackData(data: string): boolean {
  return data.startsWith(BOSS_CALLBACK_PREFIX);
}

const CALLBACK = /^bsc:([A-Za-z0-9_-]{1,40}):(yes|no)$/;

export type BossCallbackResult = {
  handled: boolean;
  toast?: string;
  reply?: string;
  removeButtons?: boolean;
  buttons?: AdminButton[][];
  /** À appeler après la réponse (demande d'un membre mise de côté, question suivante). */
  followUp?: () => Promise<void>;
};

/** Bouton OUI / NON : seul l'admin est écouté (toute autre personne : silence). */
export async function handleBossCallback(
  deps: BossDeps,
  input: { data: string; fromTelegramId: bigint | number | string },
): Promise<BossCallbackResult> {
  if (!isBossCallbackData(input.data)) return { handled: false };
  const admin = await adminTelegramId(deps);
  if (!admin || String(admin) !== String(input.fromTelegramId)) return { handled: true };
  const m = CALLBACK.exec(input.data);
  if (!m) return { handled: true, toast: "Bouton inconnu.", removeButtons: true };
  try {
    const r = await resolveBossPending(deps, m[2] === "yes" ? "yes" : "no", { pendingId: m[1]! });
    return {
      handled: true,
      toast: m[2] === "yes" ? "C'est parti" : "Annulé",
      reply: r.reply,
      buttons: r.buttons,
      removeButtons: true,
      ...(r.followUp ? { followUp: r.followUp } : {}),
    };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[boss] bouton de confirmation");
    return { handled: true, toast: "Oups", reply: "Oups, je n'ai pas réussi : erreur interne. Réessaie ou écris aide.", removeButtons: true };
  }
}
