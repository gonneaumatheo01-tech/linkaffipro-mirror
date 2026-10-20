/**
 * Règles pures du worker de l'assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md §5) : contrôles
 * avant tout appel au modèle, relances, nouvel essai après une panne, historique et résumé, enregistrement du résultat
 * d'un tour, lien d'offre. Testées sans base (`rules.test.ts`) ; la lecture et l'écriture en base sont dans `turn.ts`.
 */
import { createHash } from "node:crypto";
import {
  HISTORY_LIMIT,
  MAX_FOLLOW_UPS,
  MAX_TURN_ATTEMPTS,
  MIN_HOURS_BETWEEN_FOLLOW_UPS,
  canAssistantReply,
  followUpsAllowed,
  isQuietHour,
  shiftOutOfQuietHours,
  type AssistantActivation,
  type ConversationStage,
  type HistoryMessage,
  type PersonaInput,
  type TurnKind,
  type TurnResult,
} from "@linkaffipro/chat";

/** Durée de vie du verrou d'une conversation (prolongé pendant le tour ; libéré tout seul si le worker s'arrête). */
export const CHAT_LOCK_TTL_MS = 90_000;
/** Verrou pris par un autre tour : nouvel essai dans 3 s. */
export const CHAT_LOCK_BUSY_RETRY_MS = 3_000;
/** Résumé roulant demandé au-delà de 30 messages hors du résumé (les 20 derniers restent en clair). */
export const SUMMARY_TRIGGER_MESSAGES = 30;
/** Messages anciens lus au plus pour un résumé. */
export const SUMMARY_MAX_MESSAGES = 200;
/** Balayage : conversations traitées au plus par règle et par passage. */
export const SWEEP_BATCH = 50;
/** Balayage : message reçu non traité depuis plus de 60 s (tâche perdue) → nouveau tour. */
export const UNCLAIMED_AFTER_MS = 60_000;
/** Balayage : jamais de réponse à un message reçu il y a plus de 24 h (assistant activé tard, panne longue). */
export const UNCLAIMED_MAX_AGE_MS = 24 * 3_600_000;
/** Balayage : tour réclamé depuis plus de 3 min sans aucune partie envoyée (worker arrêté en plein tour) → libéré. */
export const STUCK_TURN_AFTER_MS = 3 * 60_000;
/** Balayage : tours bloqués cherchés sur les 7 derniers jours. */
export const STUCK_TURN_LOOKBACK_MS = 7 * 24 * 3_600_000;
/**
 * Tour planté (erreur de la base, worker arrêté) avant tout envoi : ses messages sont rendus et repris, au plus 2 fois ;
 * au-delà, ils sont marqués traités (une erreur qui se reproduit à l'identique ne tourne jamais en boucle).
 */
export const MAX_TURN_CRASHES = 2;
/** Tour planté : nouvel essai 30 s plus tard. */
export const CRASH_RETRY_DELAY_MS = 30_000;

const HOUR_MS = 3_600_000;

/** Clé Redis du verrou d'une conversation. */
export function chatLockKey(conversationId: string): string {
  return `chat:lock:${conversationId}`;
}

// ------------------------------------------------------------------
// Persona telle que le moteur la lit
// ------------------------------------------------------------------

export type PersonaRow = {
  name: string;
  /** `Persona.identityKind` (phase 18) : "GIRL" ou "ASSISTANT" (défaut). */
  identityKind?: string | null;
  /** `Persona.illusion` (phase 18) : vraie fille, sans effet hors GIRL. */
  illusion?: boolean | null;
  /** `Persona.styleExamples` (phase 18) : échanges à imiter. */
  styleExamples?: string | null;
  age?: number | null;
  gender: string;
  personality: string;
  tone: string;
  languages: string[];
  interests: string[];
  extraPrompt: string | null;
  model: string | null;
  temperature: number | null;
  minExchangesBeforeOffer: number;
  requireInterest: boolean;
  maxOfferSends: number;
  followUpAfterHours: number;
  followUpsMax: number;
  affiliateCampaignId: string | null;
  offerPitch: string;
  offerButtonText: string;
  offerMediaAssetId: string | null;
};

/**
 * Persona du moteur. `offerUsable` : offre Link Affi liée, active et avec son adresse de suivi ; sinon le moteur ne parle
 * jamais du lien (aucun lien ne pourrait partir).
 */
export function toPersonaInput(
  p: PersonaRow,
  extras: { offerUsable: boolean; channelTitle: string | null; botName: string | null },
): PersonaInput {
  return {
    name: p.name,
    identity: p.identityKind === "GIRL" ? "GIRL" : "ASSISTANT",
    illusion: p.illusion === true,
    age: p.age ?? null,
    gender: p.gender,
    personality: p.personality,
    tone: p.tone,
    languages: p.languages,
    interests: p.interests,
    extraPrompt: p.extraPrompt,
    styleExamples: p.styleExamples ?? null,
    model: p.model,
    temperature: p.temperature,
    minExchangesBeforeOffer: p.minExchangesBeforeOffer,
    requireInterest: p.requireInterest,
    maxOfferSends: p.maxOfferSends,
    followUpAfterHours: p.followUpAfterHours,
    followUpsMax: p.followUpsMax,
    offerPitch: p.offerPitch,
    offerButtonText: p.offerButtonText,
    hasOffer: Boolean(p.affiliateCampaignId) && extras.offerUsable,
    offerMediaAssetId: extras.offerUsable ? p.offerMediaAssetId : null,
    channelTitle: extras.channelTitle,
    botName: extras.botName,
  };
}

// ------------------------------------------------------------------
// Contrôles avant tout appel au modèle
// ------------------------------------------------------------------

export type PrecheckInput = {
  bot: { mode: string; isActive: boolean } | null;
  persona: { isActive: boolean } | null;
  activation: AssistantActivation;
  isTeamMember: boolean;
  conversation: { status: string; stoppedAt: Date | null; isMinor: boolean };
  /** La personne a bloqué le bot (`MemberBotState.blockedAt`). */
  blocked: boolean;
  /** Messages de l'assistant envoyés aujourd'hui (Paris). */
  assistantMessagesToday: number;
  dailyLimit: number;
  /** Dépense IA du mois (Paris), en euros. */
  monthSpendEur: number;
  monthlyCapEur: number;
  /** Dépense IA de CETTE conversation aujourd'hui (Paris), en euros (absent : pas de contrôle). */
  conversationSpendTodayEur?: number;
};

export type PrecheckReason =
  | "bot_not_assistant"
  | "bot_inactive"
  | "no_persona"
  | "persona_inactive"
  | "not_enabled"
  | "not_bot_status"
  | "stopped"
  | "minor"
  | "blocked"
  | "daily_limit"
  | "daily_cost"
  | "cap_reached";

export type PrecheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: PrecheckReason;
      /** Messages rendus (`turnId` NULL) : seulement quand l'assistant n'est pas encore activé pour cette personne. */
      release: boolean;
      /** Événement de conversation à enregistrer (une fois par jour au plus). */
      event: "daily_limit" | "cap_reached" | null;
    };

/**
 * Contrôles avant tout appel au modèle, dans l'ordre : bot en mode assistant et actif, persona liée active, activation pour
 * cette personne (désactivé / équipe / tout le monde), statut BOT, pas de /stop, pas mineur, bot non bloqué, limite du
 * jour (messages, puis dépense IA de la conversation : `conversationDailyCostCapEur`), plafond du mois. Un échec laisse
 * les messages réclamés (pas de boucle), sauf « pas encore activé » (rendus : ils seront traités si l'assistant est
 * activé dans les 24 h).
 */
export function precheck(s: PrecheckInput): PrecheckResult {
  const fail = (
    reason: PrecheckReason,
    opts: { release?: boolean; event?: "daily_limit" | "cap_reached" } = {},
  ): PrecheckResult => ({
    ok: false,
    reason,
    release: opts.release ?? false,
    event: opts.event ?? null,
  });
  if (!s.bot || s.bot.mode !== "ASSISTANT") return fail("bot_not_assistant");
  if (!s.bot.isActive) return fail("bot_inactive");
  if (!s.persona) return fail("no_persona");
  if (!s.persona.isActive) return fail("persona_inactive");
  if (!canAssistantReply(s.activation, { isTeamMember: s.isTeamMember }))
    return fail("not_enabled", { release: true });
  if (s.conversation.status !== "BOT") return fail("not_bot_status");
  if (s.conversation.stoppedAt) return fail("stopped");
  if (s.conversation.isMinor) return fail("minor");
  if (s.blocked) return fail("blocked");
  if (s.assistantMessagesToday >= s.dailyLimit)
    return fail("daily_limit", { event: "daily_limit" });
  if (
    s.conversationSpendTodayEur !== undefined &&
    s.conversationSpendTodayEur >= conversationDailyCostCapEur(s.monthlyCapEur)
  )
    return fail("daily_cost", { event: "daily_limit" });
  if (s.monthSpendEur >= s.monthlyCapEur) return fail("cap_reached", { event: "cap_reached" });
  return { ok: true };
}

/**
 * Dépense IA permise par conversation et par jour (Paris) : 1 % du plafond mensuel, 0,10 € au moins (30 € → 0,30 € par
 * jour, soit plus de 100 tours normaux). Une seule personne qui envoie des pavés en rafale ne peut jamais épuiser le
 * plafond commun.
 */
export function conversationDailyCostCapEur(monthlyCapEur: number): number {
  const cap = Number.isFinite(monthlyCapEur) ? monthlyCapEur : 0;
  return Math.max(0.1, Math.round(cap) / 100);
}

// ------------------------------------------------------------------
// Nouvel essai après une panne de l'IA
// ------------------------------------------------------------------

/**
 * Nouveaux essais déjà faits (contrat §7) : `ai_failed` enregistrés depuis le dernier message de la personne ; remis à 0
 * quand elle écrit.
 */
export function retryCountSince(
  failures: ReadonlyArray<{ createdAt: Date }>,
  lastInboundAt: Date | null,
): number {
  if (!lastInboundAt) return failures.length;
  return failures.filter((f) => f.createdAt.getTime() > lastInboundAt.getTime()).length;
}

/**
 * Nouveaux essais déjà faits pour la relance en cours : `ai_failed` d'une relance (`payload.kind = "follow_up"`)
 * enregistrés depuis le dernier message parti de l'assistant (une relance réussie remet le compte à 0). Sans ce compte,
 * une relance en panne serait refaite toutes les 5 minutes, sans fin.
 */
export function followUpRetryCount(
  failures: ReadonlyArray<{ createdAt: Date; payload: unknown }>,
  lastAssistantAt: Date | null,
): number {
  return failures.filter((f) => {
    const kind =
      f.payload && typeof f.payload === "object" && !Array.isArray(f.payload)
        ? (f.payload as { kind?: unknown }).kind
        : undefined;
    if (kind !== "follow_up") return false;
    return !lastAssistantAt || f.createdAt.getTime() > lastAssistantAt.getTime();
  }).length;
}

/**
 * Attendre l'heure du nouvel essai ? Oui si un nouvel essai est prévu plus tard (`retryAt` futur) et qu'aucun des messages
 * réclamés n'est arrivé après la dernière panne (ce sont les messages rendus par le tour en panne). Un nouveau message
 * de la personne relance tout de suite.
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

// ------------------------------------------------------------------
// Relances
// ------------------------------------------------------------------

export type FollowUpCheck = {
  now: Date;
  status: string;
  stoppedAt: Date | null;
  isMinor: boolean;
  stage: ConversationStage;
  nextFollowUpAt: Date | null;
  followUpCount: number;
  lastAssistantAt: Date | null;
  lastInboundAt: Date | null;
  followUpsMax: number;
};

export type FollowUpDecision =
  | { action: "none" }
  | { action: "send" }
  | { action: "cancel"; reason: string }
  | { action: "reschedule"; at: Date; reason: string };

/**
 * Relance due maintenant ? Règle 5 du client, vérifiée ici une seconde fois (en plus de `nextFollowUpAt` calculé par le
 * moteur) : au plus 2 relances (et pas plus que la persona), statut BOT, ni /stop ni mineur, la personne n'a pas écrit
 * depuis le dernier message de l'assistant, jamais à moins de 24 h de la relance précédente, jamais entre 22 h et 9 h
 * (Paris : reportée à 10 h).
 */
export function followUpDecision(c: FollowUpCheck): FollowUpDecision {
  if (!c.nextFollowUpAt || c.nextFollowUpAt.getTime() > c.now.getTime()) return { action: "none" };
  if (c.status !== "BOT" || c.stoppedAt || c.isMinor)
    return { action: "cancel", reason: "conversation_closed" };
  if (c.stage === "CONVERTED" || c.stage === "CLOSED" || c.stage === "WELCOME")
    return { action: "cancel", reason: "stage" };
  if (
    c.followUpCount >= Math.min(MAX_FOLLOW_UPS, followUpsAllowed({ followUpsMax: c.followUpsMax }))
  )
    return { action: "cancel", reason: "max_reached" };
  if (!c.lastAssistantAt) return { action: "cancel", reason: "no_assistant_message" };
  if (c.lastInboundAt && c.lastInboundAt.getTime() > c.lastAssistantAt.getTime())
    return { action: "cancel", reason: "member_wrote" };
  if (c.followUpCount >= 1) {
    const earliest = c.lastAssistantAt.getTime() + MIN_HOURS_BETWEEN_FOLLOW_UPS * HOUR_MS;
    if (c.now.getTime() < earliest)
      return {
        action: "reschedule",
        at: shiftOutOfQuietHours(new Date(earliest)),
        reason: "too_soon",
      };
  }
  if (isQuietHour(c.now))
    return { action: "reschedule", at: shiftOutOfQuietHours(c.now), reason: "quiet_hours" };
  return { action: "send" };
}

// ------------------------------------------------------------------
// Historique et résumé roulant
// ------------------------------------------------------------------

export type HistoryRow = {
  id: string;
  direction: "IN" | "OUT";
  author: "MEMBER" | "ASSISTANT" | "TEAM" | "SYSTEM";
  text: string;
  media: HistoryMessage["media"];
  createdAt: Date;
};

export function toHistoryMessage(r: HistoryRow): HistoryMessage {
  return {
    direction: r.direction,
    author: r.author,
    text: r.text,
    media: r.media,
    at: r.createdAt,
  };
}

/**
 * Résumé roulant (contrat §3.5) : `rows` = messages hors du résumé (après le dernier message déjà résumé), du plus ancien
 * au plus récent, sans ceux du tour. Plus de 30 : les plus anciens au-delà des 20 derniers sont à résumer ; `markId` =
 * dernier message résumé (repère enregistré quand le résumé réussit).
 */
export function summaryPlan(rows: readonly HistoryRow[]): {
  needsSummary: boolean;
  summaryMessages: HistoryMessage[];
  markId: string | null;
} {
  if (rows.length <= SUMMARY_TRIGGER_MESSAGES)
    return { needsSummary: false, summaryMessages: [], markId: null };
  const old = rows.slice(0, rows.length - HISTORY_LIMIT);
  return {
    needsSummary: old.length > 0,
    summaryMessages: old.map(toHistoryMessage),
    markId: old[old.length - 1]?.id ?? null,
  };
}

// ------------------------------------------------------------------
// Enregistrement du résultat d'un tour
// ------------------------------------------------------------------

export type ConversationBefore = {
  stage: ConversationStage;
  followUpCount: number;
};

export type PlannedEvent = {
  type: string;
  fromStage?: ConversationStage | null;
  toStage?: ConversationStage | null;
  payload: Record<string, unknown>;
};

export type ConversationPatch = {
  stage?: ConversationStage;
  styleProfile?: unknown;
  facts?: string[];
  summary?: string;
  language?: string;
  assistantTurnsIncrement?: number;
  offerSendsIncrement?: number;
  lastAssistantAt?: Date;
  followUpCount?: number;
  nextFollowUpAt?: Date | null;
  retryAt?: Date | null;
  isMinor?: boolean;
  status?: "CLOSED";
  closedAt?: Date;
  closedReason?: string;
};

export type TurnPersistencePlan = {
  patch: ConversationPatch;
  events: PlannedEvent[];
  /** Messages entrants rendus au tour suivant (`turnId` NULL). */
  releaseIds: string[];
};

/**
 * Faits déjà écrits par l'envoi du worker AU MOMENT où chaque message est parti (`sender.ts`) : heure du dernier
 * message parti, tour compté, lien envoyé (compteur, étape LINK_SENT et son passage d'étape). Ils ne sont jamais écrits
 * une seconde fois à la fin du tour (un arrêt du worker entre les deux ne les perd plus).
 */
export type LiveWrites = {
  lastSentAt: Date | null;
  assistantTurnCounted: boolean;
  offerSends: number;
  /** Passage d'étape fait à l'envoi du lien (null : aucun). */
  stage: { from: ConversationStage; to: ConversationStage } | null;
};

/**
 * Ce qu'il faut écrire après un tour (contrat §5 « Après le tour ») : étape et passages d'étape, style, faits, résumé,
 * langue, compteurs, relance, nouvel essai, fermeture (mineur, bot bloqué, personne injoignable) ; messages rendus au
 * tour suivant. L'événement `offer_sent` n'est PAS repris ici : il est enregistré au moment où le message portant le
 * bouton est réellement parti (envoi du worker).
 */
export function planTurnPersistence(input: {
  kind: TurnKind;
  before: ConversationBefore;
  result: TurnResult;
  now: Date;
  /** Faits déjà écrits à l'envoi (absent : tout est écrit ici). `before.stage` est alors l'étape après l'envoi. */
  live?: LiveWrites;
}): TurnPersistencePlan {
  const { kind, before, result: r, now, live } = input;
  const anySent = r.sent.length > 0;
  const patch: ConversationPatch = {
    styleProfile: r.style,
    facts: r.facts,
    language: r.language,
  };
  if (r.summary) patch.summary = r.summary;
  const events: PlannedEvent[] = [];
  for (const e of r.events) {
    if (e.type === "offer_sent") continue;
    // Passage d'étape déjà journalisé à l'envoi du lien.
    if (e.type === "stage_changed" && live?.stage) continue;
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
    events.push({ type: e.type, payload: { ...e.payload, kind } });
  }
  let stage = r.newStage;
  if (stage !== before.stage) patch.stage = stage;
  if (anySent && !live?.lastSentAt) patch.lastAssistantAt = now;
  if (r.outcome === "replied" && !live?.assistantTurnCounted) patch.assistantTurnsIncrement = 1;
  if (r.offerSent && !(live && live.offerSends > 0)) patch.offerSendsIncrement = 1;

  const releaseIds = r.deferredInbound.map((m) => m.id).filter((id): id is string => Boolean(id));
  if (kind === "reply") {
    patch.followUpCount = r.followUpCount;
    patch.retryAt = r.retryAt ?? null;
    if (anySent) patch.nextFollowUpAt = r.nextFollowUpAt;
    // Panne de l'IA avec nouvel essai : les messages du tour sont rendus au tour suivant.
    if (r.retryAt)
      for (const m of r.inboundUsed) if (m.id && !releaseIds.includes(m.id)) releaseIds.push(m.id);
  } else if (r.outcome === "replied") {
    patch.followUpCount = r.followUpCount;
    patch.nextFollowUpAt = r.nextFollowUpAt;
    events.push({ type: "follow_up_sent", payload: { number: r.followUpCount } });
  } else {
    // Relance non partie : le compteur revient à sa valeur d'avant ; nouvel essai à l'heure prévue par le moteur
    // (jamais pendant les heures calmes), au plus `MAX_TURN_ATTEMPTS` passages, sinon plus de relance.
    patch.followUpCount = before.followUpCount;
    const retryAllowed = Boolean(r.retryAt) && (r.retryCount ?? 0) < MAX_TURN_ATTEMPTS;
    patch.nextFollowUpAt = retryAllowed && r.retryAt ? shiftOutOfQuietHours(r.retryAt) : null;
  }

  const closeReason = r.outcome === "minor" ? "MINOR" : r.closeReason;
  if (closeReason) {
    patch.status = "CLOSED";
    patch.closedAt = now;
    patch.closedReason = closeReason;
    patch.nextFollowUpAt = null;
    patch.retryAt = null;
    if (closeReason === "MINOR") patch.isMinor = true;
    if (stage !== "CLOSED") {
      events.push({ type: "stage_changed", fromStage: stage, toStage: "CLOSED", payload: {} });
      stage = "CLOSED";
      patch.stage = "CLOSED";
    }
    if (closeReason === "BLOCKED") events.push({ type: "blocked", payload: { kind } });
    else if (closeReason === "UNREACHABLE")
      events.push({ type: "closed", payload: { reason: "UNREACHABLE", kind } });
  }
  return { patch, events, releaseIds };
}

// ------------------------------------------------------------------
// Changements faits pendant le tour (/stop, /reset, reprise par l'équipe, conversion)
// ------------------------------------------------------------------

export type GuardReason = "missing" | "not_bot" | "stopped" | "minor" | "reset" | "handed_over";
export type GuardVerdict = { ok: true } | { ok: false; reason: GuardReason };

/**
 * L'assistant peut-il encore envoyer dans ce tour ? Non si la conversation a disparu, n'est plus au statut BOT (reprise
 * par l'équipe, fermée), a reçu /stop, est celle d'un mineur, a été effacée par /reset depuis le début du tour
 * (`resetsAtStart` : nombre d'événements `reset` au début du tour ; null = pas de contrôle), ou si l'équipe a pris PUIS
 * rendu la main depuis le début du tour (statut de nouveau BOT, mais la réponse a été préparée sur l'ancien contexte et
 * doublerait le message de l'équipe : `handoversAtStart`, nombre d'événements `taken_over` / `released`).
 */
export function guardVerdict(
  conv: { status: string; stoppedAt: Date | null; isMinor: boolean } | null,
  resetsNow: number,
  resetsAtStart: number | null,
  handovers: { now: number; atStart: number | null } = { now: 0, atStart: null },
): GuardVerdict {
  if (!conv) return { ok: false, reason: "missing" };
  if (conv.stoppedAt) return { ok: false, reason: "stopped" };
  if (conv.isMinor) return { ok: false, reason: "minor" };
  if (conv.status !== "BOT") return { ok: false, reason: "not_bot" };
  if (resetsAtStart !== null && resetsNow > resetsAtStart) return { ok: false, reason: "reset" };
  if (handovers.atStart !== null && handovers.now > handovers.atStart)
    return { ok: false, reason: "handed_over" };
  return { ok: true };
}

/** État de la conversation relu (sous verrou de ligne) juste avant d'enregistrer le résultat du tour. */
export type ConversationNow = {
  status: string;
  stoppedAt: Date | null;
  stage: ConversationStage;
  /** /reset reçu depuis le début du tour. */
  reset: boolean;
  /** L'équipe a pris puis rendu la main pendant le tour (événements `taken_over` / `released`). */
  handedOver?: boolean;
  /**
   * La personne a écrit pendant le tour (`lastInboundAt` plus récent qu'au début) : pour une relance, ses compteurs
   * (remis à 0 à la réception) ne sont jamais réécrits ; un vrai tour de réponse suit.
   */
  memberWrote?: boolean;
};

/**
 * Plan d'enregistrement ajusté aux changements faits PENDANT le tour (le tour a lu la conversation avant l'appel à l'IA,
 * qui peut durer plusieurs secondes) :
 * - /reset : rien de ce que le tour avait lu ne revient (faits, style, résumé, langue, étape, compteur des tours,
 *   relances, nouvel essai) ; seuls restent les faits établis (heure du dernier message parti, lien envoyé) ;
 * - l'équipe a pris puis rendu la main pendant le tour : ni relance ni nouvel essai écrits (ceux posés en rendant la
 *   main restent) ;
 * - relance pendant laquelle la personne a écrit : ni compteur de relances ni prochaine relance réécrits ;
 * - étape changée entre-temps (/stop → FERMÉ, conversion, /reset) : l'étape du tour n'est pas écrite, ses passages
 *   d'étape ne sont pas journalisés ;
 * - plus au statut BOT ou /stop : ni relance ni nouvel essai programmés ;
 * - déjà fermée : sa raison de fermeture est gardée (jamais remplacée par celle du tour) ; mineur toujours noté.
 */
export function reconcileTurnPlan(
  plan: TurnPersistencePlan,
  before: ConversationBefore,
  cur: ConversationNow,
  kind: TurnKind = "reply",
): TurnPersistencePlan {
  const open = cur.status === "BOT" && !cur.stoppedAt && !cur.handedOver;
  const alreadyClosed = cur.status === "CLOSED";
  // L'étape est encore celle que le tour a lue : ses passages d'étape restent vrais.
  const stageOurs = !cur.reset && !alreadyClosed && cur.stage === before.stage;
  const followUpOverridden = kind === "follow_up" && Boolean(cur.memberWrote);
  if (open && stageOurs && !followUpOverridden) return plan;
  const patch: ConversationPatch = { ...plan.patch };
  if (followUpOverridden) {
    // La personne a répondu pendant la préparation de la relance : compteur et prochaine relance restent ceux posés à
    // la réception (0, aucune) ; son message reçoit un vrai tour de réponse.
    delete patch.followUpCount;
    delete patch.nextFollowUpAt;
  }
  const closing = patch.status === "CLOSED";
  if (cur.reset) {
    delete patch.styleProfile;
    delete patch.facts;
    delete patch.summary;
    delete patch.language;
    delete patch.assistantTurnsIncrement;
    delete patch.followUpCount;
  }
  if (!stageOurs) delete patch.stage;
  if (!open || cur.reset) {
    delete patch.nextFollowUpAt;
    delete patch.retryAt;
  }
  const events = plan.events.filter(
    (e) => !(e.type === "stage_changed" && !stageOurs) && !(e.type === "closed" && alreadyClosed),
  );
  if (closing) {
    if (alreadyClosed) {
      // Déjà fermée (/stop, équipe) : sa raison et son heure de fermeture restent.
      delete patch.status;
      delete patch.closedAt;
      delete patch.closedReason;
    } else {
      patch.nextFollowUpAt = null;
      patch.retryAt = null;
      if (!stageOurs && cur.stage !== "CLOSED") {
        patch.stage = "CLOSED";
        events.push({
          type: "stage_changed",
          fromStage: cur.stage,
          toStage: "CLOSED",
          payload: {},
        });
      }
    }
  }
  return { ...plan, patch, events };
}

// ------------------------------------------------------------------
// Lien d'offre
// ------------------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** 10 caractères [0-9A-Za-z], comme les liens Offre des relances. */
export const ASSISTANT_OFFER_SLUG_LENGTH = 10;

/** Nom court du lien Offre d'une persona : stable pour (persona, offre Link Affi). */
export function assistantOfferSlug(personaId: string, affiliateCampaignId: string): string {
  const digest = createHash("sha256")
    .update(`assistant-offer:${personaId}:${affiliateCampaignId}`)
    .digest();
  let out = "";
  for (let i = 0; i < ASSISTANT_OFFER_SLUG_LENGTH; i++) out += BASE62[digest[i]! % 62];
  return out;
}

/** Nom du lien dans Campagnes → Liens. */
export function assistantOfferLabel(personaName: string): string {
  return `Assistant « ${personaName} »`;
}

/** Adresse des liens suivis : TRACKING_BASE_URL, sinon https://<TRACKING_HOST>, sinon https://go.goolink.eu. */
export function trackingBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const base = env.TRACKING_BASE_URL?.trim();
  if (base) return base.replace(/\/+$/, "");
  const host = env.TRACKING_HOST?.trim();
  if (host) return `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "https://go.goolink.eu";
}

/** Lien envoyé à la personne : `<adresse des liens>/a/<sub-ID>` (première ouverture = clic, voir le site). */
export function assistantOfferUrl(
  subId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return `${trackingBaseUrl(env)}/a/${subId}`;
}
