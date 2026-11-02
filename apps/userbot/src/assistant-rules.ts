/**
 * Compte réel d'une persona Casino / Paris sportifs (gérant du VIP : Mehdi) : règles du tour qui s'ajoutent à turn.ts
 * (nouvel essai après une panne de l'IA ou un envoi raté, passage à l'équipe, journal, messages repris après un
 * redémarrage). Copie réduite des règles du worker (`apps/worker/src/assistant/rules.ts`, `events.ts`) : un compte réel
 * ne passe jamais par le worker. Une persona Rencontres (série de photos : Léa) n'utilise rien de ce fichier, son tour
 * reste celui d'avant.
 */
import type { ConversationStage, TurnResult } from "@linkaffipro/chat";
import {
  isAssistantOnlyUniverse,
  needsHumanSilencesAssistant,
  type NeedsHumanReason,
} from "@linkaffipro/core";

/** Persona Casino / Paris sportifs : tour du compte réel avec les règles de ce fichier. */
export function isUniversePersona(p: { universe?: string | null } | null | undefined): boolean {
  return isAssistantOnlyUniverse(p?.universe ?? null);
}

/** Balayage : un message reçu n'est repris qu'après 20 s (le tour normal le prend tout de suite). */
export const SWEEP_MIN_AGE_MS = 20_000;
/** Jamais de réponse à un message reçu il y a plus de 24 h (comme le worker). */
export const SWEEP_MAX_AGE_MS = 24 * 3_600_000;
/** Tour d'un process arrêté : ses messages sont repris 2 min au plus tôt après leur arrivée. */
export const DEAD_TURN_MIN_AGE_MS = 2 * 60_000;
/**
 * Recherche de ces tours : 1 min après le démarrage au plus tôt (l'ancien process a fini de s'arrêter : jamais deux
 * réponses au même message), puis toutes les 2 min.
 */
export const DEAD_TURN_CHECK_AFTER_START_MS = 60_000;
export const DEAD_TURN_CHECK_EVERY_MS = 2 * 60_000;
/** Un message repris 2 fois (tour planté à chaque fois) n'est plus repris : jamais de boucle. */
export const MAX_TURN_RECOVERIES = 2;
/** Envoi refusé par Telegram sans raison définitive (réseau, attente imposée) : nouvel essai dans 2 min, 2 fois au plus. */
export const SEND_RETRY_MS = 2 * 60_000;
export const MAX_SEND_RETRIES = 2;

/** Erreur rendue au moteur quand il n'a plus la parole (reprise par l'équipe, /stop…) : jamais un nouvel essai. */
export const NOT_OURS_ERROR = "conversation reprise ou arrêtée";

export type ConversationGate = {
  status: string;
  stoppedAt: Date | null;
  isMinor: boolean;
  needsHumanAt: Date | null;
  needsHumanReason: string | null;
};

/**
 * Raison de ne pas répondre (null : tour permis), dans l'ordre du worker : statut BOT (pas reprise par l'équipe ni
 * fermée), pas de /stop, pas mineur, pas passée à l'équipe pour un motif qui la fait taire (argent, réclamation,
 * insulte, mineur ; une simple question hors fiche ne la fait pas taire).
 */
export function universeSkipReason(c: ConversationGate): string | null {
  if (c.status !== "BOT") return "not_bot_status";
  if (c.stoppedAt) return "stopped";
  if (c.isMinor) return "minor";
  if (c.needsHumanAt && needsHumanSilencesAssistant(c.needsHumanReason)) return "needs_human";
  return null;
}

// ------------------------------------------------------------------
// Nouvel essai (copie du worker)
// ------------------------------------------------------------------

/** Nouveaux essais déjà faits : échecs enregistrés depuis le dernier message de la personne. */
export function retryCountSince(
  failures: ReadonlyArray<{ createdAt: Date }>,
  lastInboundAt: Date | null,
): number {
  if (!lastInboundAt) return failures.length;
  return failures.filter((f) => f.createdAt.getTime() > lastInboundAt.getTime()).length;
}

/**
 * Attendre l'heure du nouvel essai ? Oui si un nouvel essai est prévu plus tard et qu'aucun des messages à traiter
 * n'est arrivé après le dernier échec (ce sont ceux rendus par le tour en échec). Un nouveau message relance tout de
 * suite.
 */
export function shouldWaitForRetry(input: {
  retryAt: Date | null;
  now: Date;
  lastFailureAt: Date | null;
  claimedAt: readonly Date[];
}): boolean {
  if (!input.retryAt || input.retryAt.getTime() <= input.now.getTime()) return false;
  if (!input.lastFailureAt) return false;
  const last = input.lastFailureAt.getTime();
  return input.claimedAt.every((d) => d.getTime() <= last);
}

/**
 * Délai de réponse qui reste (ms) : le délai de la persona compte depuis le plus ancien message en attente. Un message
 * repris après un redémarrage, ou au nouvel essai, n'attend jamais une seconde fois le délai entier.
 */
export function remainingDelayMs(delayMs: number, oldestAt: Date | null, now: Date): number {
  if (delayMs <= 0) return 0;
  if (!oldestAt) return delayMs;
  return Math.max(0, delayMs - (now.getTime() - oldestAt.getTime()));
}

// ------------------------------------------------------------------
// Messages restés sans réponse dans un tour d'un process arrêté
// ------------------------------------------------------------------

function metaOf(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

/** `meta.fixedKey` d'un message (null sans texte fixe). */
export function fixedKeyOf(meta: unknown): string | null {
  const k = metaOf(meta).fixedKey;
  return typeof k === "string" ? k : null;
}

export type RecentMessage = {
  id: string;
  direction: string;
  turnId: string | null;
  meta: unknown;
  createdAt: Date;
};

/**
 * Messages reçus pris par un tour du compte réel d'un AUTRE process (arrêté pendant le tour, ou ancienne version qui
 * gardait les messages après « attends je reviens 2 sec ») et jamais marqués traités ; `rows` = derniers messages de la
 * conversation, du plus ancien au plus récent :
 * - `release` : ceux arrivés APRÈS la dernière vraie réponse (« je reviens » n'en est pas une), il y a plus de 2 min et
 *   moins de 24 h : à rendre au tour suivant. Jamais une vieille question à laquelle une réponse plus récente a répondu ;
 * - `answeredBefore` : heure de cette dernière vraie réponse (les messages d'avant sont à marquer traités).
 */
export function deadInbound(
  rows: readonly RecentMessage[],
  opts: { ownTurnPrefix: string; now: Date },
): { release: string[]; answeredBefore: Date | null } {
  let lastAnswer = -1;
  rows.forEach((r, i) => {
    if (r.direction === "OUT" && fixedKeyOf(r.meta) !== "retryLater") lastAnswer = i;
  });
  const release: string[] = [];
  rows.forEach((r, i) => {
    if (i <= lastAnswer || r.direction !== "IN" || !r.turnId) return;
    if (!r.turnId.startsWith("ub_") || r.turnId.startsWith(opts.ownTurnPrefix)) return;
    if (metaOf(r.meta).turnDone === true) return;
    const age = opts.now.getTime() - r.createdAt.getTime();
    if (age >= DEAD_TURN_MIN_AGE_MS && age <= SWEEP_MAX_AGE_MS) release.push(r.id);
  });
  return { release, answeredBefore: lastAnswer >= 0 ? rows[lastAnswer]!.createdAt : null };
}

// ------------------------------------------------------------------
// Journal (copie de apps/worker/src/assistant/events.ts)
// ------------------------------------------------------------------

/** Clés de payload refusées (garde-fou : aucun texte de conversation ne doit finir dans le journal). */
const TEXT_KEYS = new Set([
  "text",
  "texts",
  "message",
  "messages",
  "caption",
  "summary",
  "facts",
  "note",
]);

/** Payload sans texte de conversation (les clés de texte sont retirées). */
export function eventPayload(payload: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload))
    if (!TEXT_KEYS.has(k) && v !== undefined) out[k] = v;
  return out;
}

// ------------------------------------------------------------------
// Enregistrement du résultat d'un tour
// ------------------------------------------------------------------

export type PlannedEvent = {
  type: string;
  fromStage?: ConversationStage | null;
  toStage?: ConversationStage | null;
  payload: Record<string, unknown>;
};

export type UniversePatch = {
  stage?: ConversationStage;
  styleProfile: unknown;
  facts: string[];
  language: string;
  assistantTurnsIncrement?: number;
  offerSendsIncrement?: number;
  lastAssistantAt?: Date;
  followUpCount?: number;
  /** Aucune relance programmée sur un compte réel Casino / Paris (seule la série de photos en a une). */
  nextFollowUpAt?: null;
  retryAt?: Date | null;
  /** Passage à l'équipe : motif à fusionner avec l'état relu sous verrou (`mergeNeedsHuman`). */
  needsHuman?: NeedsHumanReason;
  isMinor?: boolean;
  status?: "CLOSED";
  closedAt?: Date;
  closedReason?: string;
};

export type UniversePlan = {
  patch: UniversePatch;
  events: PlannedEvent[];
  /** Messages reçus rendus au tour suivant (`turnId` NULL). */
  releaseIds: string[];
};

/**
 * Ce qu'il faut écrire après un tour (même règle que `planTurnPersistence` du worker, tour de réponse) : étape et passages
 * d'étape, style, faits, langue, compteurs, nouvel essai (messages du tour rendus), lien du VIP parti (conversion),
 * passage à l'équipe, fermeture (mineur, personne qui a bloqué le compte, injoignable). Sur un compte réel, rien n'est
 * écrit au moment de l'envoi : le lien d'inscription parti (`offer_sent`, avec son bookmaker) est journalisé ici.
 * Envoi refusé sans raison définitive et rien de parti : nouvel essai dans 2 min (`sendFailuresBefore` : envois ratés
 * depuis le dernier message de la personne ; au-delà de 2, ses messages restent sans réponse et l'échec est journalisé).
 */
export function planUniverseTurn(input: {
  stage: ConversationStage;
  result: TurnResult;
  now: Date;
  sendFailuresBefore: number;
}): UniversePlan {
  const { result: r, now } = input;
  const anySent = r.sent.length > 0;
  const patch: UniversePatch = {
    styleProfile: r.style,
    facts: r.facts,
    language: r.language,
    retryAt: r.retryAt ?? null,
  };
  const events: PlannedEvent[] = [];
  for (const e of r.events) {
    // Lien du VIP : journalisé plus bas avec le passage à CONVERTED.
    if (e.type === "vip_link_sent") continue;
    if (e.type === "stage_changed") {
      const p = e.payload as { fromStage?: ConversationStage; toStage?: ConversationStage };
      events.push({
        type: e.type,
        fromStage: p.fromStage ?? null,
        toStage: p.toStage ?? null,
        payload: {},
      });
      continue;
    }
    events.push({ type: e.type, payload: { ...e.payload, kind: "reply" } });
  }
  let stage = r.newStage;
  if (stage !== input.stage) patch.stage = stage;
  if (anySent) {
    patch.lastAssistantAt = now;
    patch.followUpCount = r.followUpCount;
    patch.nextFollowUpAt = null;
  }
  if (r.outcome === "replied") patch.assistantTurnsIncrement = 1;
  if (r.offerSent) patch.offerSendsIncrement = 1;

  const releaseIds = r.deferredInbound.map((m) => m.id).filter((id): id is string => Boolean(id));
  const releaseUsed = () => {
    for (const m of r.inboundUsed) if (m.id && !releaseIds.includes(m.id)) releaseIds.push(m.id);
  };
  // Panne de l'IA avec nouvel essai : les messages du tour sont rendus au tour suivant.
  if (r.retryAt) releaseUsed();

  // Envoi refusé sans raison définitive (ni blocage ni compte supprimé) et rien n'est parti : nouvel essai. Jamais quand
  // l'envoi a été arrêté parce que la conversation a changé de mains pendant le tour.
  const transient =
    !anySent &&
    r.sendError !== null &&
    !r.sendError.blocked &&
    !r.sendError.unreachable &&
    r.sendError.error !== NOT_OURS_ERROR;
  if (transient && !r.retryAt) {
    const retry = input.sendFailuresBefore < MAX_SEND_RETRIES;
    events.push({
      type: "send_failed",
      payload: { error: r.sendError!.error.slice(0, 160), retry, kind: "reply" },
    });
    if (retry) {
      patch.retryAt = new Date(now.getTime() + SEND_RETRY_MS);
      releaseUsed();
    }
  }

  // Lien du canal VIP parti : la personne a déposé, elle est admise → CONVERTED.
  if (r.vipLinkSent && stage !== "CONVERTED" && stage !== "CLOSED") {
    events.push({ type: "stage_changed", fromStage: stage, toStage: "CONVERTED", payload: {} });
    events.push({
      type: "vip_link_sent",
      payload: { url: r.vipLinkSent.url, bookmakerKey: r.vipLinkSent.bookmakerKey },
    });
    stage = "CONVERTED";
    patch.stage = "CONVERTED";
  }

  if (r.needsHuman) {
    patch.needsHuman = r.needsHuman.reason;
    // L'équipe va répondre : aucun nouvel essai de l'assistant.
    patch.retryAt = null;
  }

  const closeReason = r.outcome === "minor" ? "MINOR" : r.closeReason;
  if (closeReason) {
    patch.status = "CLOSED";
    patch.closedAt = now;
    patch.closedReason = closeReason;
    patch.retryAt = null;
    if (closeReason === "MINOR") patch.isMinor = true;
    if (stage !== "CLOSED") {
      events.push({ type: "stage_changed", fromStage: stage, toStage: "CLOSED", payload: {} });
      stage = "CLOSED";
      patch.stage = "CLOSED";
    }
    if (closeReason === "BLOCKED") events.push({ type: "blocked", payload: { kind: "reply" } });
    else if (closeReason === "UNREACHABLE")
      events.push({ type: "closed", payload: { reason: "UNREACHABLE", kind: "reply" } });
  }
  // Nouvel essai annulé (fermée, passée à l'équipe) : les messages du tour restent traités.
  const cancelled = Boolean(r.retryAt) && !patch.retryAt;
  return { patch, events, releaseIds: cancelled ? [] : releaseIds };
}

/** État de la conversation relu sous verrou juste avant d'enregistrer le tour. */
export type ConversationNow = {
  status: string;
  stoppedAt: Date | null;
  stage: ConversationStage;
  /** L'équipe a pris (et peut-être rendu) la main pendant le tour (événements `taken_over` / `released`). */
  handedOver: boolean;
};

/**
 * Plan ajusté à ce qui a changé PENDANT le tour (comme `reconcileTurnPlan` du worker) : plus au statut BOT, /stop ou
 * équipe passée par là → aucun nouvel essai ni message rendu, et rien à signaler à une équipe qui a la main ; étape
 * changée entre-temps → l'étape du tour n'est pas écrite ni journalisée ; déjà fermée → sa raison et son heure restent.
 */
export function reconcileUniversePlan(
  plan: UniversePlan,
  before: { stage: ConversationStage },
  cur: ConversationNow,
): UniversePlan {
  const open = cur.status === "BOT" && !cur.stoppedAt && !cur.handedOver;
  const alreadyClosed = cur.status === "CLOSED";
  const stageOurs = !alreadyClosed && cur.stage === before.stage;
  if (open && stageOurs) return plan;
  const patch: UniversePatch = { ...plan.patch };
  if (!stageOurs) delete patch.stage;
  if (!open) delete patch.retryAt;
  if (cur.status === "HUMAN" || cur.handedOver) delete patch.needsHuman;
  const events = plan.events.filter(
    (e) => !(e.type === "stage_changed" && !stageOurs) && !(e.type === "closed" && alreadyClosed),
  );
  if (patch.status === "CLOSED") {
    if (alreadyClosed) {
      delete patch.status;
      delete patch.closedAt;
      delete patch.closedReason;
    } else {
      patch.retryAt = null;
      if (!stageOurs && cur.stage !== "CLOSED") {
        patch.stage = "CLOSED";
        events.push({ type: "stage_changed", fromStage: cur.stage, toStage: "CLOSED", payload: {} });
      }
    }
  }
  return { patch, events, releaseIds: open ? plan.releaseIds : [] };
}
