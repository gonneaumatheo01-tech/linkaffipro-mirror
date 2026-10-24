/**
 * Confirmations du Boss (phase 26, règle 4) : une seule action en attente (`Setting` `boss.pending`), expirée après
 * 10 minutes ; une nouvelle remplace la précédente (« la précédente est annulée »). Message = résumé en 2 lignes +
 * boutons OUI / NON (`bsc:<id>:yes|no`) ; « OUI », « oui », « ouais » en texte confirment, « NON » / « annule »
 * annulent ; « OUI » sans rien → « Rien à confirmer. ». Seul l'admin confirme (`adminTelegramId`).
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

const YES_WORDS = new Set(["oui", "ouais", "ouai", "yes", "oui oui", "oui vas y", "oui vas-y", "vas y", "vas-y", "go", "ok", "okay", "d'accord", "daccord", "confirme", "je confirme", "👍", "✅"]);
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

/** Crée la confirmation (remplace la précédente) et rend le message à envoyer (résumé + OUI / NON). */
export async function createBossPending(
  deps: BossDeps,
  input: { actionKey: string; params: Record<string, unknown>; summary: string },
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
  };
  await writeSetting(deps, BOSS_PENDING_SETTING, pending);
  const replaced = previous && !previous.expired ? "(La confirmation précédente est annulée.)\n" : "";
  const summary = input.summary.split("\n").slice(0, 2).map(esc).join("\n");
  return {
    reply: `${replaced}${summary}\nOUI pour confirmer, NON pour annuler (10 minutes).`,
    buttons: confirmButtons(pending.id),
    pendingId: pending.id,
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
    return { handled: true, reply: word === "yes" ? PENDING_EXPIRED : NOTHING_TO_CANCEL };
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
    return { handled: true, reply: PENDING_CANCELLED };
  }
  const { expired: _e, ...pending } = cur;
  // Import différé : execute → catalog → confirm formerait un cycle au chargement.
  const { runConfirmedAction } = await import("./execute");
  return { handled: true, ...(await runConfirmedAction(deps, pending, actor)) };
}

export function isBossCallbackData(data: string): boolean {
  return data.startsWith(BOSS_CALLBACK_PREFIX);
}

const CALLBACK = /^bsc:([A-Za-z0-9_-]{1,40}):(yes|no)$/;

export type BossCallbackResult = { handled: boolean; toast?: string; reply?: string; removeButtons?: boolean; buttons?: AdminButton[][] };

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
    };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[boss] bouton de confirmation");
    return { handled: true, toast: "Oups", reply: "Oups, je n'ai pas réussi : erreur interne. Réessaie ou écris aide.", removeButtons: true };
  }
}
