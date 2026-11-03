// Tour de l'assistant (contrat §3.10) : mineur → plafond → appel au modèle (« écrit… » pendant l'appel) → lecture et
// contrôle → un seul nouvel essai → repli sûr ; pannes : un nouvel essai après 2 s, modèle de repli, puis texte fixe
// sûr (aveu ou présentation) ou « je reviens vers toi » et nouvel essai (3 passages au plus) ; relecture avant le
// premier envoi (reprise par l'équipe, messages regroupés, âge déclaré) ; envoi dans l'ordre avec le bouton d'offre sur
// le dernier message quand le lien part. Aucune persistance ici : l'appelant enregistre le résultat.
import { isAssistantOnlyUniverse, offerButtonTextFor } from "@linkaffipro/core";
import { detectHandoffIn } from "./handoff";
import { canSendOffer, decideStage, offerAllowedNow } from "./journey";
import { linkNudgeAt, nextFollowUpAt } from "./follow-ups";
import { mergeFacts } from "./memory";
import { detectMinorIn } from "./minor";
import { asksForOfferAccess } from "./offer-request";
import { mentionsStopRequest } from "./stop-request";
import { parseTurnOutput } from "./parse";
import { buildSummaryRequest, buildSystemPrompt, buildTurnMessages, cleanSummary } from "./prompt";
import {
  LIVE_WINDOW_MS,
  openingDelayMs,
  pauseBetweenMs,
  typingDelayMs,
  withTyping,
} from "./rhythm";
import { parisWallClock } from "./paris-time";
import {
  ARMED_LINK_FACT,
  announcesLink,
  extractPseudo,
  stripAppDescription,
  stripLinkAnnouncement,
} from "./pseudo";
import {
  applyAction,
  decideFlirt,
  encodeProgress,
  type FlirtAction,
  type FlirtDecision,
} from "./flirt";
import { turnOutputJsonSchema, type TurnOutput } from "./schema";
import { mergeStyle, replyLanguage } from "./style";
import { fixedText, type FixedTextKey } from "./texts";
import { wordsForm } from "./text-utils";
import { personaIdentity, personaIllusion } from "./turn-types";
import type {
  ChatButton,
  NeedsHumanSignal,
  PersonaInput,
  SendResult,
  SentPart,
  StageChange,
  TurnDeps,
  TurnEvent,
  TurnInbound,
  TurnInput,
  TurnResult,
} from "./turn-types";
import {
  isTransientVeniceError,
  VeniceError,
  type ChatLang,
  type ConversationStage,
  type LlmRequest,
  type LlmResponse,
  type UsagePurpose,
} from "./types";
import {
  asksIfBot,
  botQuestionInsists,
  openBotQuestion,
  validateTurnOutput,
  type RejectCode,
} from "./validate";
import {
  announcedBook,
  announcesRegistrationLink,
  announcesVipAccess,
  booksMentioned,
  confirmsDeposit,
  depositBook,
  isVipManagerPersona,
  mentionsDeposit,
  normalizeBookKey,
  stripEmojis,
  talksAboutVip,
  VIP_SCRIPT_LINK,
  VIP_SCRIPT_PITCH,
} from "./vip";

/** Attente avant le nouvel essai sur le même modèle après une panne passagère. */
export const TRANSIENT_RETRY_DELAY_MS = 2000;
/** Nouvel essai du tour après une panne de l'IA. */
export const RETRY_LATER_MS = 5 * 60_000;
/**
 * « Je reviens vers toi dans un instant » : au plus une fois par heure et par conversation, et seulement si la personne
 * a écrit depuis le dernier (jamais deux d'affilée sans réponse de sa part).
 */
export const NEUTRAL_MESSAGE_INTERVAL_MS = 60 * 60_000;
/** Passages d'un même tour en panne (le premier + 2 nouveaux essais) : ensuite échec définitif, sans nouvel essai. */
export const MAX_TURN_ATTEMPTS = 3;
/**
 * Gérant du VIP : nouvel essai bien plus tôt, sans aucun message d'attente (il ne fait jamais patienter) ; au dernier
 * passage, l'équipe prend le relais (texte fixe + conversation « à traiter ») au lieu du silence.
 */
export const VIP_RETRY_LATER_MS = 45_000;

/** Texte du bouton du canal VIP (Paris sportifs, phase 36), envoyé après un dépôt confirmé. */
export const VIP_BUTTON_TEXT = "Accéder au canal VIP 🔑";
/** Pannes qui arrêtent tout de suite, sans aucun message (clé refusée, solde vide, pas de clé). */
const FATAL_CODES = new Set<string>(["auth", "balance", "no_key"]);
/**
 * Pannes qui se reproduiraient à l'identique (requête refusée, contenu refusé, modèle inconnu), constatées après le
 * modèle de repli : échec définitif tout de suite, sans nouvel essai ni message.
 */
const PERMANENT_CODES = new Set<string>(["bad_request", "content_policy", "bad_model"]);

type CallResult =
  | { ok: true; res: LlmResponse; model: string; attempt: number }
  | { ok: false; code: string; fatal: boolean; transient: boolean; cap: boolean };

type Generation =
  | { kind: "ok"; output: TurnOutput; messages: string[]; model: string }
  | { kind: "minor" }
  | { kind: "rejected"; codes: RejectCode[] }
  | { kind: "error"; code: string; fatal: boolean }
  | { kind: "cap" };

type Run = {
  input: TurnInput;
  deps: TurnDeps;
  lang: ChatLang;
  attempts: number;
  rejected: string[];
  /** Messages de la personne arrivés pendant la préparation et regroupés dans ce tour. */
  extraMemberMessages: number;
  startedAt: Date;
  /** Décision de la série de photos pour ce tour (calculée une fois). */
  flirt?: FlirtDecision;
};

function purposeOf(input: TurnInput, summary = false): UsagePurpose {
  if (input.usagePurpose) return input.usagePurpose;
  if (summary) return "SUMMARY";
  return input.kind === "follow_up" ? "FOLLOW_UP" : "REPLY";
}

function primaryModel(input: TurnInput): string {
  return input.persona.model?.trim() || input.settings.defaultModel;
}

/** Une ligne de coût par appel au modèle (réussi, refusé ou en panne). Jamais bloquant. */
async function recordUsage(
  run: Run,
  call: {
    model: string;
    res: LlmResponse | null;
    ok: boolean;
    error: string | null;
    attempt: number;
    purpose?: UsagePurpose;
  },
): Promise<void> {
  const usage = call.res?.usage ?? { inputTokens: 0, outputTokens: 0 };
  try {
    const costEur = run.deps.costEur(
      call.res?.model || call.model,
      usage,
      call.res?.costUsd ?? null,
    );
    await run.deps.recordUsage({
      purpose: call.purpose ?? purposeOf(run.input),
      model: call.res?.model || call.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costEur: Number.isFinite(costEur) ? costEur : 0,
      ok: call.ok,
      error: call.error,
      attempt: call.attempt,
      requestId: call.res?.requestId ?? null,
    });
  } catch {
    // le journal des coûts ne doit jamais casser une conversation
  }
}

/** Un appel au modèle, plafond vérifié juste avant. Les échecs sont journalisés ici ; les succès après contrôle. */
async function callLlm(run: Run, req: LlmRequest): Promise<CallResult> {
  if (await run.deps.capReached())
    return { ok: false, code: "cap_reached", fatal: false, transient: false, cap: true };
  const attempt = ++run.attempts;
  try {
    const res = await run.deps.llm.complete(req);
    return { ok: true, res, model: req.model, attempt };
  } catch (err) {
    const code = err instanceof VeniceError ? err.code : "network";
    await recordUsage(run, { model: req.model, res: null, ok: false, error: code, attempt });
    return {
      ok: false,
      code,
      fatal: FATAL_CODES.has(code),
      transient: err instanceof VeniceError ? isTransientVeniceError(err.code) : true,
      cap: false,
    };
  }
}

/** Panne passagère : un nouvel essai après 2 s sur le même modèle ; puis le modèle de repli (une fois). */
async function completeWithRecovery(
  run: Run,
  build: (model: string) => LlmRequest,
): Promise<CallResult> {
  const primary = primaryModel(run.input);
  const fallback = run.input.settings.fallbackModel?.trim();
  let r = await callLlm(run, build(primary));
  if (r.ok || r.cap || r.fatal) return r;
  if (r.transient) {
    await run.deps.sleep(TRANSIENT_RETRY_DELAY_MS);
    r = await callLlm(run, build(primary));
    if (r.ok || r.cap || r.fatal) return r;
  }
  if (fallback && fallback !== primary) r = await callLlm(run, build(fallback));
  return r;
}

/** Casino / Paris sportifs (phase 25) : fiche d'informations, lien VIP, passage à un humain. */
function universeAssistant(input: TurnInput): boolean {
  return isAssistantOnlyUniverse(input.persona.universe);
}

/** Gérant du VIP (Paris sportifs) : règles codées de `vip.ts`, jamais appliquées à une autre persona. */
function vipOf(input: TurnInput): boolean {
  return isVipManagerPersona(input.persona);
}

/** Variables des textes fixes de la persona : prénom, rôle, identité, registre du gérant du VIP. */
function textVars(input: TurnInput) {
  return {
    name: input.persona.name,
    gender: input.persona.gender,
    identity: personaIdentity(input.persona),
    illusion: personaIllusion(input.persona),
    vipManager: vipOf(input),
  };
}

/**
 * Passage à l'équipe : gérant du VIP dont le dernier message annonçait déjà ce passage → une autre phrase (« l'équipe a
 * ton message »), jamais deux fois la même d'affilée. Les autres personas gardent la phrase habituelle.
 */
function handoffKey(run: Run): "handoff" | "handoffAgain" {
  const { input } = run;
  if (!vipOf(input)) return "handoff";
  const last = [...input.history]
    .reverse()
    .find((m) => m.direction === "OUT" && m.author === "ASSISTANT");
  if (!last) return "handoff";
  const said = wordsForm(last.text);
  const vars = textVars(input);
  const known = (["handoff", "handoffAgain"] as const).flatMap((k) => [
    fixedText(run.lang, k, vars),
    fixedText(run.lang, k),
  ]);
  return known.some((t) => wordsForm(t) === said) ? "handoffAgain" : "handoff";
}

/** Passage de ce tour (1 au premier) et dernier passage permis : plus de nouvel essai après lui. */
function turnPass(run: Run, code: string): { pass: number; final: boolean } {
  const pass = Math.max(0, Math.floor(run.input.retryCount ?? 0)) + 1;
  return { pass, final: pass >= MAX_TURN_ATTEMPTS || PERMANENT_CODES.has(code) };
}

/** Derniers messages de l'assistant (les 3 plus récents) : le bookmaker dont il parlait, le dépôt qu'il demandait. */
function lastAssistantTexts(input: TurnInput): string[] {
  return input.history
    .filter((m) => m.direction === "OUT" && m.author === "ASSISTANT")
    .slice(-3)
    .map((m) => m.text);
}

/**
 * Gérant du VIP : la personne dit à ce tour avoir fait son dépôt. Une simple confirmation (« c'est bon ») compte quand
 * il venait de lui parler du dépôt.
 */
function depositClaimed(run: Run, inbound: readonly TurnInbound[]): boolean {
  const { input } = run;
  if (!vipOf(input) || input.kind !== "reply") return false;
  return confirmsDeposit(
    inbound.map((m) => m.text),
    { askedDeposit: mentionsDeposit(lastAssistantTexts(input)) },
  );
}

/** La personne demande l'accès VIP, le lien ou l'inscription dans ce tour (Casino / Paris seulement). */
function memberAskedOffer(run: Run, inbound: readonly TurnInbound[]): boolean {
  return (
    universeAssistant(run.input) &&
    run.input.kind === "reply" &&
    inbound.some((m) => asksForOfferAccess(m.text))
  );
}

/** Textes de la fiche d'informations (questions et réponses), sources permises des chiffres. */
function faqTexts(input: TurnInput): string[] {
  return (input.persona.faq ?? []).flatMap((e) => [e.q, e.a]);
}

function memberMessagesNow(run: Run): number {
  return run.input.conversation.memberMessages + run.extraMemberMessages;
}

/** Série de photos de chauffe (fille avec photos) : le lien, les relances et le silence suivent la série (`flirt.ts`). */
function flirtSeries(input: TurnInput): boolean {
  return personaIdentity(input.persona) === "GIRL" && (input.persona.flirtPhotos ?? []).length > 0;
}

/** Photo envoyée par la personne à ce tour. */
function hasMemberPhoto(inbound: readonly TurnInbound[]): boolean {
  return inbound.some((m) => m.media?.kind === "photo");
}

/** Conversation vue par les règles générales du lien (`canSendOffer`). */
function offerConvOf(run: Run, inbound: readonly TurnInbound[]) {
  const conv = run.input.conversation;
  return {
    memberMessages: memberMessagesNow(run),
    offerSends: conv.offerSends,
    isMinor: conv.isMinor,
    isFirstAssistantTurn: conv.isFirstAssistantTurn,
    memberAskedOffer: memberAskedOffer(run, inbound),
  };
}

/**
 * Série de photos : le lien peut-il partir à ce tour ? Oui quand la série en est à l'app (OFFER : une annonce le fait
 * partir tout de suite), ou après le lien si les règles générales permettent de le renvoyer. Jamais avant la chauffe
 * (NONE, PHOTOS) ni après un refus.
 */
function seriesLinkMayLeave(run: Run, output: TurnOutput, inbound: readonly TurnInbound[]): boolean {
  const { input } = run;
  if (!input.persona.hasOffer || !run.flirt) return false;
  const phase = run.flirt.state.phase;
  if (phase === "OFFER") return true;
  return (
    phase === "LINKED" && canSendOffer(offerConvOf(run, inbound), input.persona, output, input.kind)
  );
}

/**
 * Série de photos : codes que le code corrige lui-même, sans nouvel appel au modèle. Action non permise : ramenée à ce
 * qui est permis (sauf une photo non permise, que le texte annonce : régénérée). Texte qui refuse pendant que la photo
 * part : la photo ne part pas, le texte reste.
 */
function seriesSoftCodes(codes: readonly RejectCode[], output: TurnOutput): RejectCode[] {
  return codes.filter(
    (c) => c === "contradiction" || (c === "action_interdite" && output.action !== "photo"),
  );
}

function buildRequest(
  run: Run,
  model: string,
  inbound: TurnInbound[],
  retryCodes: readonly string[],
): LlmRequest {
  const { input } = run;
  const conv = input.conversation;
  const silenceFrom = conv.lastAssistantAt ?? conv.lastInboundAt ?? null;
  const system = buildSystemPrompt({
    persona: input.persona,
    lang: run.lang,
    kind: input.kind,
    stage: conv.stage,
    style: conv.style,
    facts: conv.facts,
    summary: conv.summary,
    isFirstAssistantTurn: conv.isFirstAssistantTurn,
    memberMessages: memberMessagesNow(run),
    offerSends: conv.offerSends,
    isMinor: conv.isMinor,
    followUpNumber: conv.followUpCount + 1,
    silenceHours: silenceFrom
      ? (run.deps.now().getTime() - silenceFrom.getTime()) / 3_600_000
      : null,
    retryCodes,
    memberAskedOffer: memberAskedOffer(run, inbound),
    memberPhoto: input.kind === "reply" && hasMemberPhoto(inbound),
    noButtons: !run.deps.sender.capabilities.canSendButtons,
    flirt: run.flirt
      ? {
          allow: run.flirt.allow,
          photoSlot: run.flirt.photoSlot,
          directive: run.flirt.directive,
          photo:
            input.persona.flirtPhotos?.find((x) => x.slot === run.flirt?.photoSlot)?.description ??
            null,
          phase: run.flirt.state.phase,
        }
      : undefined,
  });
  return {
    model,
    messages: buildTurnMessages({ system, history: input.history, inbound }),
    temperature: input.persona.temperature ?? input.settings.temperature,
    maxTokens: input.settings.maxTokens,
    jsonSchema: turnOutputJsonSchema(input.persona.universe),
    reasoning: input.settings.modelSupportsReasoning(model),
    // Série de photos : le début du prompt est le même pour toute la persona (voir `buildSystemPrompt`).
    ...(flirtSeries(input) ? { cacheKey: `persona:${input.persona.name}` } : {}),
  };
}

/**
 * Textes où chercher la question « bot / IA / vraie personne ? » : messages du tour, et question restée sans aveu dans
 * l'historique (`openBotQuestion`). Jamais pour une relance.
 */
function botQuestionTexts(input: TurnInput, inbound: TurnInbound[]): string[] {
  if (input.kind !== "reply") return [];
  const open = openBotQuestion(input.history);
  return [...(open ? [open] : []), ...inbound.map((m) => m.text)];
}

/** Lecture + contrôle d'une réponse ; le coût est journalisé avec le verdict. */
async function checkResponse(
  run: Run,
  call: Extract<CallResult, { ok: true }>,
  inbound: TurnInbound[],
): Promise<Generation> {
  const { input } = run;
  const conv = input.conversation;
  const parsed = parseTurnOutput(call.res);
  if (!parsed.ok) {
    await recordUsage(run, {
      model: call.model,
      res: call.res,
      ok: false,
      error: parsed.code,
      attempt: call.attempt,
    });
    run.rejected.push(parsed.code);
    return { kind: "rejected", codes: [parsed.code] };
  }
  const handoff = universeAssistant(input) ? parsed.output.handoff : undefined;
  if (parsed.output.minor_suspected || (handoff?.needed && handoff.reason === "minor")) {
    await recordUsage(run, {
      model: call.model,
      res: call.res,
      ok: true,
      error: null,
      attempt: call.attempt,
    });
    return { kind: "minor" };
  }
  // Passage à un humain demandé par le modèle : ses messages ne partiront pas (réponse neutre fixe), inutile de les
  // contrôler ni de les refaire.
  if (handoff?.needed) {
    await recordUsage(run, {
      model: call.model,
      res: call.res,
      ok: true,
      error: null,
      attempt: call.attempt,
    });
    return { kind: "ok", output: parsed.output, messages: [], model: call.res.model || call.model };
  }
  const vip = vipOf(input);
  // Gérant du VIP : jamais d'emoji. Le code les retire (ce n'est pas un motif de refus) ; un message vidé disparaît.
  if (vip)
    parsed.output.messages = parsed.output.messages
      .map((m) => ({ ...m, text: stripEmojis(m.text) }))
      .filter((m) => m.text.length > 0);
  const memberTexts = [
    ...(input.summaryMessages ?? []).filter((m) => m.direction === "IN").map((m) => m.text),
    ...input.history.filter((m) => m.direction === "IN").map((m) => m.text),
    ...inbound.map((m) => m.text),
  ];
  const v = validateTurnOutput(parsed.output, {
    personaName: input.persona.name,
    offerPitch: input.persona.hasOffer ? input.persona.offerPitch : "",
    memberTexts,
    turnInboundTexts: botQuestionTexts(input, inbound),
    selfTexts: [
      input.persona.name,
      input.persona.age == null ? null : String(input.persona.age),
      input.persona.personality,
      input.persona.tone,
      input.persona.extraPrompt,
    ],
    facts: conv.facts,
    universe: input.persona.universe ?? null,
    faqTexts: faqTexts(input),
    isFirstAssistantMessage: conv.isFirstAssistantTurn,
    privateTexts: [input.persona.extraPrompt, input.persona.personality, input.persona.tone],
    allowedActions: run.flirt?.allow,
    identity: personaIdentity(input.persona),
    illusion: personaIllusion(input.persona),
    interest: input.conversation.style.interest ?? 0,
    vipManager: vip,
    noEmojis: vip,
    // Gérant du VIP : un lien ou un accès annoncé doit pouvoir partir à ce message.
    ...(vip
      ? {
          linkAllowedNow: offerAllowedNow(offerConvOf(run, inbound), input.persona, input.kind),
          vipAccessAllowed: conv.offerSends > 0,
          depositClaimed: depositClaimed(run, inbound),
        }
      : {}),
    botInsists:
      input.kind === "reply" &&
      botQuestionInsists(
        input.history,
        inbound.map((m) => m.text),
      ),
  });
  const series = flirtSeries(input);
  const soft = !v.ok && series ? seriesSoftCodes(v.codes, parsed.output) : [];
  if (!v.ok && soft.length < v.codes.length) {
    await recordUsage(run, {
      model: call.model,
      res: call.res,
      ok: false,
      error: `rejected:${v.codes.join(",")} ${v.details.join(" | ")} :: ${v.messages.join(" / ")}`,
      attempt: call.attempt,
    });
    run.rejected.push(...v.codes);
    return { kind: "rejected", codes: v.codes };
  }
  // Codes corrigés par le code (série de photos) : gardés au journal du tour, sans nouvel appel.
  run.rejected.push(...soft);
  if (soft.includes("contradiction")) parsed.output.action = "rien";
  let messages = v.messages;
  // Série de photos : jamais une annonce du lien sans le lien. S'il ne peut pas partir à ce tour, l'annonce est retirée,
  // et la réponse est refaite s'il ne reste rien.
  if (series && announcesLink(messages) && !seriesLinkMayLeave(run, parsed.output, inbound)) {
    const kept = stripLinkAnnouncement(messages);
    if (kept.length === 0) {
      await recordUsage(run, {
        model: call.model,
        res: call.res,
        ok: false,
        error: `rejected:link_announce :: ${messages.join(" / ")}`,
        attempt: call.attempt,
      });
      run.rejected.push("link_announce");
      return { kind: "rejected", codes: ["link_announce"] };
    }
    messages = kept;
  }
  await recordUsage(run, {
    model: call.model,
    res: call.res,
    ok: true,
    error: null,
    attempt: call.attempt,
  });
  return {
    kind: "ok",
    output: parsed.output,
    messages,
    model: call.res.model || call.model,
  };
}

/** Génération complète : appel (avec reprise sur panne), contrôle, un seul nouvel essai avec consigne de correction. */
async function generate(run: Run, inbound: TurnInbound[]): Promise<Generation> {
  const first = await completeWithRecovery(run, (model) => buildRequest(run, model, inbound, []));
  if (!first.ok)
    return first.cap ? { kind: "cap" } : { kind: "error", code: first.code, fatal: first.fatal };
  const checked = await checkResponse(run, first, inbound);
  if (checked.kind !== "rejected") return checked;
  const second = await callLlm(run, buildRequest(run, first.model, inbound, checked.codes));
  if (!second.ok) {
    if (second.cap) return { kind: "cap" };
    if (second.fatal) return { kind: "error", code: second.code, fatal: true };
    return checked;
  }
  return checkResponse(run, second, inbound);
}

async function safeSend(send: () => Promise<SendResult>): Promise<SendResult> {
  try {
    return await send();
  } catch (err) {
    return {
      ok: false,
      blocked: false,
      unreachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Temps que la personne a mis pour repondre (ms) : null si on ne sait pas. */
function peerDelay(input: TurnInput): number | null {
  const dernier = input.conversation.lastInboundAt;
  const avant = input.conversation.lastAssistantAt;
  if (!dernier || !avant) return null;
  return Math.max(0, dernier.getTime() - avant.getTime());
}

/** Discussion chaude : la personne est tres interesse ou dragueuse, elle repond plus vite. */
/** La personne a repondu il y a moins de deux minutes : elle est encore la, elle repond aussitot. */
function isLive(input: TurnInput): boolean {
  const p = peerDelay(input);
  return p !== null && p <= LIVE_WINDOW_MS;
}

function isHot(input: TurnInput): boolean {
  return (
    (input.conversation.style.interest ?? 0) >= 7 || input.conversation.style.tone === "flirty"
  );
}

async function safeTyping(run: Run): Promise<void> {
  try {
    await run.deps.sender.sendTyping();
  } catch {
    // « écrit… » est un confort
  }
}

function baseResult(run: Run, inbound: TurnInbound[]): TurnResult {
  const conv = run.input.conversation;
  return {
    outcome: "failed",
    sent: [],
    newStage: conv.stage,
    stageChanges: [],
    style: conv.style,
    facts: conv.facts,
    offerSent: null,
    events: [],
    language: run.lang,
    model: null,
    rejected: run.rejected,
    note: null,
    inboundUsed: inbound,
    deferredInbound: [],
    followUpCount: conv.followUpCount,
    nextFollowUpAt: null,
    neutralSent: false,
    closeReason: null,
    sendError: null,
    unsentOfferSubId: null,
  };
}

function stageEvents(
  from: ConversationStage,
  to: ConversationStage,
): { changes: StageChange[]; events: TurnEvent[] } {
  if (from === to) return { changes: [], events: [] };
  return {
    changes: [{ from, to }],
    events: [{ type: "stage_changed", payload: { fromStage: from, toStage: to } }],
  };
}

/** Arrêt mineur : texte fixe, aucun lien, conversation fermée (l'appelant marque isMinor, CLOSED, MINOR). */
async function stopForMinor(
  run: Run,
  inbound: TurnInbound[],
  source: "code" | "model",
  age: number | null,
  deferred: TurnInbound[] = [],
): Promise<TurnResult> {
  const conv = run.input.conversation;
  const text = fixedText(run.lang, "minorStop", textVars(run.input));
  const r = await safeSend(() => run.deps.sender.sendText(text, { fixedKey: "minorStop" }));
  const stage = stageEvents(conv.stage, "CLOSED");
  // Casino / Paris : la conversation est aussi signalée à l'équipe (« à traiter »), en plus de l'arrêt.
  const needsHuman: NeedsHumanSignal | null = universeAssistant(run.input)
    ? { reason: "minor", source }
    : null;
  return {
    ...baseResult(run, inbound),
    outcome: "minor",
    sent: r.ok
      ? [
          {
            index: 0,
            text,
            telegramMessageId: r.telegramMessageId,
            offerSubId: null,
            mediaAssetId: null,
            fixedKey: "minorStop",
          },
        ]
      : [],
    newStage: "CLOSED",
    stageChanges: stage.changes,
    events: [
      { type: "minor", payload: { source, age } },
      ...(needsHuman ? [needsHumanEvent(needsHuman)] : []),
      ...stage.events,
    ],
    deferredInbound: deferred,
    closeReason: "MINOR",
    needsHuman,
    sendError: r.ok ? null : { blocked: r.blocked, unreachable: r.unreachable, error: r.error },
  };
}

function needsHumanEvent(signal: NeedsHumanSignal): TurnEvent {
  return { type: "needs_human", payload: { reason: signal.reason, source: signal.source } };
}

function capResult(run: Run, inbound: TurnInbound[], deferred: TurnInbound[] = []): TurnResult {
  return {
    ...baseResult(run, inbound),
    outcome: "skipped_cap",
    events: [{ type: "cap_reached", payload: {} }],
    deferredInbound: deferred,
  };
}

/**
 * Repli sûr quand le modèle n'a rien donné d'envoyable (deux refus, ou panne) : l'aveu fixe si la personne demande si
 * c'est un bot (il contient aussi le prénom et « assistante », donc vaut présentation au premier message), la
 * présentation fixe au premier message ; sinon rien (nouvel essai plus tard). Jamais pour une relance.
 */
function safeFallbackKey(
  run: Run,
  inbound: TurnInbound[],
  rejectedCodes: readonly string[] = [],
): FixedTextKey | null {
  if (run.input.kind !== "reply") return null;
  if (botQuestionTexts(run.input, inbound).some((t) => asksIfBot(t))) return "isAssistant";
  // Casino / Paris : un chiffre hors des fiches refusé deux fois → la question est transmise à l'équipe.
  if (universeAssistant(run.input) && rejectedCodes.includes("invented_number")) return "handoff";
  if (run.input.conversation.isFirstAssistantTurn && !run.input.persona.vipManager) return "intro";
  return null;
}

/** Dernier message connu de la personne (état de la conversation ou messages du tour). */
function lastMemberMessageAt(run: Run, inbound: TurnInbound[]): number | null {
  const times = [run.input.conversation.lastInboundAt, ...inbound.map((m) => m.at)]
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
    .map((d) => d.getTime());
  return times.length > 0 ? Math.max(...times) : null;
}

/**
 * Panne de l'IA non fatale : nouvel essai dans 5 min, au plus `MAX_TURN_ATTEMPTS` passages (échec définitif tout de
 * suite pour une panne qui se reproduirait). « Je reviens vers toi » (réponses seulement) : au plus une fois par heure,
 * seulement si la personne a écrit depuis le dernier, jamais quand aucun nouvel essai n'est prévu.
 */
async function retryLater(
  run: Run,
  inbound: TurnInbound[],
  deferred: TurnInbound[],
  code: string,
): Promise<TurnResult> {
  const { input, deps } = run;
  const now = deps.now();
  const { pass, final } = turnPass(run, code);
  const last = input.conversation.lastNeutralAt;
  const lastMember = lastMemberMessageAt(run, inbound);
  const wroteSinceNeutral = !last || (lastMember !== null && lastMember > last.getTime());
  // Gérant du VIP : jamais de « je reviens » (il ne fait pas patienter) ; le nouvel essai vient vite, sans message.
  const vip = vipOf(input);
  const canNeutral =
    !vip &&
    input.kind === "reply" &&
    !final &&
    wroteSinceNeutral &&
    (!last || now.getTime() - last.getTime() >= NEUTRAL_MESSAGE_INTERVAL_MS);
  const sent: SentPart[] = [];
  let sendError: TurnResult["sendError"] = null;
  if (canNeutral) {
    const text = fixedText(run.lang, "retryLater");
    await safeTyping(run);
    const r = await safeSend(() => deps.sender.sendText(text, { fixedKey: "retryLater" }));
    if (r.ok)
      sent.push({
        index: 0,
        text,
        telegramMessageId: r.telegramMessageId,
        offerSubId: null,
        mediaAssetId: null,
        fixedKey: "retryLater",
      });
    else sendError = { blocked: r.blocked, unreachable: r.unreachable, error: r.error };
  }
  return {
    ...baseResult(run, inbound),
    outcome: "failed",
    sent,
    events: [
      {
        type: "ai_failed",
        payload: { code, attempts: run.attempts, neutral: sent.length > 0, final, pass },
      },
    ],
    ...(final
      ? {}
      : {
          retryAt: new Date(now.getTime() + (vip ? VIP_RETRY_LATER_MS : RETRY_LATER_MS)),
          retryCount: pass,
        }),
    deferredInbound: deferred,
    neutralSent: sent.length > 0,
    sendError,
    closeReason: sendError?.blocked ? "BLOCKED" : sendError?.unreachable ? "UNREACHABLE" : null,
  };
}

/** Envoi des parties dans l'ordre : « écrit… », délai selon la longueur, pause entre messages, bouton sur le dernier. */
async function sendParts(
  run: Run,
  texts: string[],
  opts: {
    withOffer: boolean;
    fixedKey: FixedTextKey | null;
    /** Photo de la serie de chauffe a joindre au dernier message. */
    photoAssetId?: string | null;
    /** Phase 36 : clé du bookmaker partenaire (Paris sportifs VIP). */
    bookKey?: string | null;
    /** Phase 36 : lien du canal VIP à envoyer en bouton (après dépôt confirmé). */
    vipLink?: string | null;
    /** Ne pas séparer le texte du bouton d'offre (fin de conversation par pseudo). */
    noSplit?: boolean;
    /** Lien d'offre déjà créé avant l'envoi (gérant du VIP) : utilisé tel quel au lieu d'en créer un. */
    offerLink?: { url: string; subId: string } | null;
  },
): Promise<{
  sent: SentPart[];
  offerSent: { subId: string; url: string } | null;
  sendError: TurnResult["sendError"];
  unsentOfferSubId: string | null;
  /** Phase 36 : lien VIP envoyé (canal Telegram du bookmaker). */
  vipLinkSent?: string | null;
}> {
  const { deps, input } = run;
  const persona = input.persona;
  const sent: SentPart[] = [];
  let offerSent: { subId: string; url: string } | null = null;
  let sendError: TurnResult["sendError"] = null;
  let unsentOfferSubId: string | null = null;
  let vipLinkSent: string | null = null;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i] ?? "";
    const isLast = i === texts.length - 1;
    if (i === 0) {
      // Ouverture : elle n'a pas le telephone dans la main. Aucun « ecrit… » pendant cette attente,
      // et le temps de preparation du tour compte dedans (le contact ne voit pas de trou en plus).
      const opening = openingDelayMs(
        {
          peerDelayMs: peerDelay(input),
          isFirst: input.conversation.assistantTurns === 0,
          hot: isHot(input),
          cold: false,
          refused: input.conversation.appRefused === true,
          live: isLive(input),
          followUp: input.kind === "follow_up",
          nowHourParis: parisWallClock(deps.now()).hour,
          personaDelay: persona.responseDelay ?? null,
        },
        deps.random,
      );
      const reste = Math.max(0, opening - (deps.now().getTime() - run.startedAt.getTime()));
      if (reste > 0) await deps.sleep(reste);
      await withTyping(
        () => deps.sender.sendTyping(),
        () => deps.sleep(typingDelayMs(text, isHot(input) || isLive(input), deps.random)),
        deps.timers,
      );
    } else {
      await safeTyping(run);
      const delay = typingDelayMs(text, false, deps.random);
      if (delay > 0) await deps.sleep(delay);
    }

    let link: { url: string; subId: string } | null = null;
    if (isLast && opts.withOffer) {
      try {
        link = opts.offerLink ?? (await deps.createOfferLink(opts.bookKey ?? undefined));
      } catch {
        link = null;
      }
    }
    const canButtons = deps.sender.capabilities.canSendButtons;

    // Phase 25 bis : texte du bouton d'offre (toujours au niveau persona).
    const offerBtnText = offerButtonTextFor(persona.universe, persona.offerButtonText);

    // Phase 36 : lien du canal VIP du bookmaker (après dépôt confirmé), en bouton sous le dernier message.
    const vipLink = isLast && opts.vipLink ? opts.vipLink : null;
    const vipBtn = vipLink && canButtons ? { text: VIP_BUTTON_TEXT, url: vipLink } : null;

    const offerBtn = link && canButtons ? { text: offerBtnText, url: link.url } : null;

    const buttons: ChatButton[][] | undefined =
      offerBtn && vipBtn
        ? [[offerBtn], [vipBtn]]
        : offerBtn
          ? [[offerBtn]]
          : vipBtn
            ? [[vipBtn]]
            : undefined;

    // Sans boutons (compte réel, aperçu « Tester ») : les adresses vont à la fin du texte, ou seules s'il n'y a pas
    // de texte. Avec des boutons, le lien seul part sous une flèche (Telegram refuse un message vide).
    const inlineUrls = canButtons
      ? []
      : [link?.url, vipLink].filter((u): u is string => Boolean(u));
    const linkOnly = inlineUrls.length > 0 ? inlineUrls.join("\n") : "👇";
    const outgoing =
      !text.trim() && (link || inlineUrls.length > 0)
        ? linkOnly
        : inlineUrls.length > 0
          ? `${text}\n\n${linkOnly}`
          : text;
    const sendOpts = { buttons, fixedKey: opts.fixedKey, offerSubId: link?.subId ?? null };
    const mediaAssetId =
      link && persona.offerMediaAssetId
        ? persona.offerMediaAssetId
        : isLast && opts.photoAssetId
          ? opts.photoAssetId
          : null;

    // #2 : photo de chauffe envoyée dans un message séparé (après le texte).
    // #3 : lien d'offre envoyé dans un message séparé (après le texte) : l'adresse seule (ou le bouton sous une flèche),
    //       sans texte autour, SAUF quand le visuel de l'offre est joint ou quand noSplit est demandé (pseudo → fin de
    //       conversation, texte et lien restent ensemble).
    const splitPhoto = mediaAssetId && !link && outgoing.trim().length > 0;
    // Sans boutons, le lien du canal VIP part seul lui aussi, juste après le texte.
    const splitOffer =
      (link || (vipLink && !canButtons)) && text.trim().length > 0 && !mediaAssetId && !opts.noSplit;

    if (splitPhoto || splitOffer) {
      // 1) texte seul (sans l'adresse du lien, qui part ensuite seule)
      const firstText = splitOffer ? text : outgoing;
      const textR = await safeSend(() =>
        deps.sender.sendText(firstText, { fixedKey: opts.fixedKey, offerSubId: null }),
      );
      if (!textR.ok) {
        sendError = { blocked: textR.blocked, unreachable: textR.unreachable, error: textR.error };
        if (link) unsentOfferSubId = link.subId;
        break;
      }
      sent.push({
        index: i,
        text: firstText,
        telegramMessageId: textR.telegramMessageId,
        offerSubId: null,
        mediaAssetId: null,
        fixedKey: opts.fixedKey,
      });

      // 2) pause + typing avant l'envoi séparé
      await deps.sleep(pauseBetweenMs(deps.random, isLive(input)));
      await safeTyping(run);
      const shortDelay = typingDelayMs("...", false, deps.random);
      if (shortDelay > 0) await deps.sleep(shortDelay);

      // 3) photo seule ou lien seul
      const splitR = await safeSend(() =>
        splitPhoto
          ? deps.sender.sendMedia({ mediaAssetId: mediaAssetId! }, "", {
              fixedKey: null,
              offerSubId: null,
            })
          : deps.sender.sendText(linkOnly, sendOpts),
      );
      if (!splitR.ok) {
        sendError = {
          blocked: splitR.blocked,
          unreachable: splitR.unreachable,
          error: splitR.error,
        };
        if (link) unsentOfferSubId = link.subId;
        break;
      }
      sent.push({
        index: i,
        text: splitPhoto ? "" : linkOnly,
        telegramMessageId: splitR.telegramMessageId,
        offerSubId: link?.subId ?? null,
        mediaAssetId: splitPhoto ? mediaAssetId : null,
        fixedKey: null,
      });
    } else {
      const r = await safeSend(() =>
        mediaAssetId
          ? deps.sender.sendMedia({ mediaAssetId }, outgoing, sendOpts)
          : deps.sender.sendText(outgoing, sendOpts),
      );
      if (!r.ok) {
        sendError = { blocked: r.blocked, unreachable: r.unreachable, error: r.error };
        if (link) unsentOfferSubId = link.subId;
        break;
      }
      sent.push({
        index: i,
        text: outgoing,
        telegramMessageId: r.telegramMessageId,
        offerSubId: link?.subId ?? null,
        mediaAssetId,
        fixedKey: opts.fixedKey,
      });
    }
    if (link) offerSent = { subId: link.subId, url: link.url };
    // Compté seulement une fois le message parti (un échec d'envoi ne vaut pas conversion).
    if (vipLink) vipLinkSent = vipLink;
    if (!isLast) await deps.sleep(pauseBetweenMs(deps.random, isLive(input)));
  }
  return { sent, offerSent, sendError, unsentOfferSubId, vipLinkSent };
}

/**
 * Bookmaker du tour (Paris sportifs VIP) : la clé donnée par le modèle si la persona la connaît ; une clé inconnue ne
 * vaut rien. Lien d'inscription demandé sans clé : le premier bookmaker de la liste (sinon le bouton manquerait).
 * Avec `hints` (gérant du VIP) : le bookmaker nommé juste après l'annonce du lien prime (la personne lit le texte),
 * puis la clé du modèle, puis le dernier bookmaker dont il parlait (`asked`), puis le premier de la liste.
 */
export function pickBook(
  persona: PersonaInput,
  selected: string | undefined,
  withOffer: boolean,
  hints?: { texts?: readonly string[]; asked?: readonly string[] },
): string | null {
  const books = persona.bookmakers ?? [];
  if (books.length === 0) return null;
  if (hints) {
    // Le bookmaker nommé juste après l'annonce du lien est celui que la personne lit : il prime sur la clé du modèle.
    const named = announcedBook(hints.texts ?? [], books);
    if (named) return named;
    const key = normalizeBookKey(selected, books);
    if (key) return key;
    if (!withOffer) return null;
    // Sans clé : le bookmaker dont il parlait juste avant (celui où la personne n'a pas de compte).
    const asked = booksMentioned(hints.asked ?? [], books);
    if (asked.length > 0) return asked[asked.length - 1]!;
  } else {
    const key = selected?.trim();
    if (key && books.some((b) => b.bookmakerKey === key)) return key;
    if (!withOffer) return null;
  }
  return [...books].sort((a, b) => a.priority - b.priority)[0]?.bookmakerKey ?? null;
}

/**
 * Bookmaker du lien du canal VIP (gérant du VIP) : celui où la personne dit avoir déposé, sinon celui du dernier lien
 * d'inscription envoyé, sinon la clé du modèle, sinon le dernier nommé dans le texte.
 */
function vipBook(
  input: TurnInput,
  selected: string | undefined,
  texts: readonly string[],
  inbound: readonly TurnInbound[],
): string | null {
  const books = input.persona.bookmakers ?? [];
  const fromMember = depositBook(
    inbound.map((m) => m.text),
    books,
  );
  if (fromMember) return fromMember;
  const last = input.conversation.lastOfferBookKey ?? null;
  if (last && books.some((b) => b.bookmakerKey === last)) return last;
  const key = normalizeBookKey(selected, books);
  if (key) return key;
  const said = booksMentioned(texts, books);
  return said.length > 0 ? said[said.length - 1]! : null;
}

/** Résumé roulant après les envois (modèle de repli) : un échec est sans conséquence. */
async function rollingSummary(run: Run): Promise<string | undefined> {
  const { input, deps } = run;
  if (!input.needsSummary || !input.summaryMessages || input.summaryMessages.length === 0)
    return undefined;
  try {
    if (await deps.capReached()) return undefined;
    const model = input.settings.fallbackModel?.trim() || primaryModel(input);
    const req = buildSummaryRequest({
      model,
      personaName: input.persona.name,
      identity: personaIdentity(input.persona),
      illusion: personaIllusion(input.persona),
      previousSummary: input.conversation.summary,
      messages: input.summaryMessages,
      reasoning: input.settings.modelSupportsReasoning(model),
    });
    const attempt = ++run.attempts;
    try {
      const res = await deps.llm.complete(req);
      const summary = cleanSummary(res.text);
      await recordUsage(run, {
        model,
        res,
        ok: Boolean(summary),
        error: summary ? null : "invalid_output",
        attempt,
        purpose: purposeOf(input, true),
      });
      return summary ?? undefined;
    } catch (err) {
      const code = err instanceof VeniceError ? err.code : "network";
      await recordUsage(run, {
        model,
        res: null,
        ok: false,
        error: code,
        attempt,
        purpose: purposeOf(input, true),
      });
      return undefined;
    }
  } catch {
    return undefined;
  }
}

function newRun(input: TurnInput, deps: TurnDeps): Run {
  const conv = input.conversation;
  return {
    input,
    deps,
    lang: replyLanguage({
      style: conv.style,
      memberLanguageCode: conv.memberLanguageCode,
      personaLanguages: input.persona.languages,
    }),
    attempts: 0,
    rejected: [],
    extraMemberMessages: 0,
    startedAt: deps.now(),
  };
}

/**
 * Résumé roulant fait APRÈS l'enregistrement du tour (`TurnInput.deferSummary`) : même règle que dans le tour (au-delà
 * de 30 messages, modèle de repli, plafond vérifié, coût journalisé) ; un échec est sans conséquence (undefined).
 */
export async function summarizeAfterTurn(
  input: TurnInput,
  deps: TurnDeps,
): Promise<string | undefined> {
  return rollingSummary(newRun(input, deps));
}

/** Un tour complet de l'assistant (contrat §3.10). */
export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  const conv = input.conversation;
  const run = newRun(input, deps);
  let inbound: TurnInbound[] = input.kind === "reply" ? [...input.inbound] : [];

  const recents = [
    ...input.history
      .filter((m) => m.direction === "IN" && m.author === "MEMBER")
      .map((m) => m.text),
    ...input.inbound.map((m) => m.text),
  ];
  const series = flirtSeries(input);
  const vip = vipOf(input);
  // Lien armé au tour précédent (fille seulement — série : vendu sans lien ; sinon : annoncé sans envoi) : il part à ce
  // tour.
  const linkWasArmed =
    personaIdentity(input.persona) === "GIRL" && conv.facts.includes(ARMED_LINK_FACT);
  // Script de chauffe : uniquement une fille avec série de photos. Jamais calculé ailleurs (Paris sportifs, Casino,
  // persona sans photos) : aucune de ses règles ne peut toucher ces conversations.
  const flirt: FlirtDecision | null = series
    ? (run.flirt = decideFlirt({
        step: conv.flirt?.step ?? "NONE",
        teases: conv.flirt?.teases ?? 0,
        recent: recents.slice(-4, -1),
        text: recents[recents.length - 1] ?? "",
        hasPhotos: (input.persona.flirtPhotos ?? []).map((x) => x.slot),
        isMinor: conv.isMinor,
        linkArmed: linkWasArmed,
        hasOffer: input.persona.hasOffer,
      }))
    : null;
  // Hors série, les règles générales gardent la main sur le lien ; dans la série, c'est l'action qui décide (jamais
  // de lien avant la chauffe : seulement après le lien, pour le renvoyer s'il l'a perdu).
  const lienLibre = flirt ? flirt.state.phase === "LINKED" : true;

  // Jamais de réponse à une conversation fermée ou à un mineur (l'appelant ne devrait pas appeler).
  if (conv.isMinor || conv.stage === "CLOSED")
    return { ...baseResult(run, inbound), outcome: "aborted" };

  // Pseudo connu (fille, inscription confirmée) : plus de réponse tant que le pseudo est dans les faits.
  if (personaIdentity(input.persona) === "GIRL" && extractPseudo(conv.facts) !== null)
    return { ...baseResult(run, inbound), outcome: "aborted" };

  // 1. Âge déclaré de moins de 18 ans : arrêt avant tout appel au modèle.
  const minor = detectMinorIn(inbound.map((m) => m.text));
  if (minor.minor) return stopForMinor(run, inbound, "code", minor.age);

  if (flirt) {
    // Refus ferme et photos épuisées (DONE) : sa dernière ligne est partie, plus aucune réponse ni relance, même s'il
    // insiste (ce n'est pas un /stop : la conversation reste ouverte, rien ne part).
    if (flirt.silent) return { ...baseResult(run, inbound), outcome: "aborted" };
    // Relance après le lien : une seule, courte (« t la ? »), texte fixe sans appel au modèle ; ensuite silence. Les
    // autres relances de la série suivent les règles générales.
    if (input.kind === "follow_up" && flirt.state.phase === "LINKED") {
      if (conv.followUpCount > 0 || conv.offerSends === 0)
        return { ...baseResult(run, inbound), outcome: "aborted" };
      return linkNudge(run, inbound);
    }
    if (input.kind === "follow_up" && (flirt.state.phase === "WRAP" || flirt.state.phase === "DONE"))
      return { ...baseResult(run, inbound), outcome: "aborted" };
    // Photo reçue sans un mot : « t'es mignon hihi », texte fixe sans appel au modèle (consigne du client : elle ne
    // regarde pas la photo). La série n'avance pas.
    if (input.kind === "reply" && hasMemberPhoto(inbound) && inbound.every((m) => !m.text.trim()))
      return photoReaction(run, inbound);
  }

  // 1 bis. Casino / Paris : demande d'argent, réclamation ou insulte repérée par le code → réponse neutre fixe et
  // passage à l'équipe, sans appel au modèle (aucun coût, aucune réponse risquée).
  if (universeAssistant(input) && input.kind === "reply") {
    const reason = detectHandoffIn(inbound.map((m) => m.text));
    if (reason) return handoffByCode(run, inbound, { reason, source: "code" });
  }

  // 2. Plafond mensuel : aucun appel, aucun message.
  if (await deps.capReached()) return capResult(run, inbound);

  // 3. Génération (sans « écrit » : il part a l'envoi, jamais pendant l'attente) ; relecture (reprise, messages regroupés une fois).
  let gen = await generate(run, inbound);
  let regenerated = false;
  let deferred: TurnInbound[] = [];
  for (;;) {
    if (gen.kind === "minor") return stopForMinor(run, inbound, "model", null);
    if (gen.kind === "cap") return capResult(run, inbound);
    // Panne définitive (clé refusée, solde vide) : aucun message… sauf pour le gérant du VIP, qui passe la main à
    // l'équipe plus bas (jamais de silence).
    if (gen.kind === "error" && gen.fatal && !(vip && input.kind === "reply"))
      return {
        ...baseResult(run, inbound),
        outcome: "failed",
        events: [
          {
            type: "ai_failed",
            payload: { code: gen.code, attempts: run.attempts, neutral: false, final: true },
          },
        ],
      };
    const check = await deps.beforeSend();
    if (check.abort)
      return { ...baseResult(run, inbound), outcome: "aborted", deferredInbound: check.newInbound };
    if (check.newInbound.length === 0) break;
    // Âge déclaré dans un message arrivé pendant la préparation : arrêt avant tout envoi, même s'il n'est pas regroupé.
    const lateMinor = detectMinorIn(check.newInbound.map((m) => m.text));
    if (lateMinor.minor)
      return stopForMinor(run, [...inbound, ...check.newInbound], "code", lateMinor.age);
    // La personne écrit pendant la préparation d'une relance : la relance n'a plus lieu d'être. Rien ne part ; ses
    // messages sont rendus pour un vrai tour de réponse (aveu exigé si elle demande « bot ? »).
    if (input.kind === "follow_up")
      return {
        ...baseResult(run, inbound),
        outcome: "aborted",
        deferredInbound: check.newInbound,
      };
    if (regenerated || gen.kind === "error") {
      deferred = check.newInbound;
      break;
    }
    // Messages arrivés pendant la préparation : regroupés dans ce tour, réponse refaite une fois.
    regenerated = true;
    inbound = [...inbound, ...check.newInbound];
    run.extraMemberMessages += check.newInbound.length;
    gen = await generate(run, inbound);
  }

  // 4. Réponse à envoyer : celle du modèle, ou un repli sûr (texte fixe, jamais de lien) après deux refus ou une panne.
  let texts: string[];
  let output: TurnOutput | null = null;
  let fixedKey: FixedTextKey | null = null;
  let model: string | null = null;
  let needsHuman: NeedsHumanSignal | null = null;
  const events: TurnEvent[] = [];
  if (gen.kind === "ok" && gen.output.handoff?.needed && universeAssistant(input)) {
    // Passage à un humain demandé par le modèle : réponse neutre fixe, jamais de lien.
    output = gen.output;
    fixedKey = handoffKey(run);
    texts = [fixedText(run.lang, fixedKey, textVars(input))];
    const reason = gen.output.handoff.reason === "none" ? "off_faq" : gen.output.handoff.reason;
    needsHuman = { reason, source: "model" };
  } else if (gen.kind === "ok") {
    output = gen.output;
    texts = gen.messages;
    model = gen.model;
  } else {
    const code = gen.kind === "error" ? gen.code : "invalid_output";
    fixedKey = safeFallbackKey(run, inbound, gen.kind === "rejected" ? gen.codes : []);
    // Gérant du VIP : jamais de silence. Panne définitive ou dernier passage → l'équipe prend le relais (texte fixe,
    // conversation « à traiter »), au lieu d'un message sans réponse.
    const lastChance =
      vip &&
      input.kind === "reply" &&
      ((gen.kind === "error" && gen.fatal) || turnPass(run, code).final);
    if (!fixedKey && lastChance) fixedKey = "handoff";
    if (!fixedKey) return retryLater(run, inbound, deferred, code);
    if (fixedKey === "handoff") {
      fixedKey = handoffKey(run);
      needsHuman = { reason: "off_faq", source: "check" };
    }
    texts = [fixedText(run.lang, fixedKey, textVars(input))];
    events.push({
      type: "ai_failed",
      payload: { code, attempts: run.attempts, neutral: false, final: false, fallback: fixedKey },
    });
  }

  const offerConv = offerConvOf(run, inbound);
  // Une seule action permise autre que « rien » (série : le lien armé) : obligatoire, mais seulement avec un texte du
  // modèle (jamais collée à un texte fixe de repli).
  const forced =
    flirt && flirt.allow.length === 1 && flirt.allow[0] !== "rien" ? flirt.allow[0]! : null;
  // Action retenue : hors série, lien armé → "lien" ; sinon l'action obligatoire, ou celle du modèle si elle est
  // permise, sinon « rien » (toujours « rien » hors série : le lien suit alors les règles générales).
  let action: FlirtAction =
    !series && linkWasArmed && input.persona.hasOffer
      ? "lien"
      : forced && output && !needsHuman
        ? forced
        : flirt && output?.action && flirt.allow.includes(output.action)
          ? output.action
          : "rien";
  // Série : un lien annoncé quand la série en est à l'app part à ce tour, avec son annonce (les autres annonces ont été
  // retirées au contrôle de la réponse).
  if (
    flirt &&
    output &&
    !needsHuman &&
    action !== "lien" &&
    flirt.state.phase === "OFFER" &&
    input.persona.hasOffer &&
    announcesLink(texts)
  )
    action = "lien";
  const photoAssetId =
    flirt && action === "photo" && flirt.photoSlot
      ? (input.persona.flirtPhotos?.find((x) => x.slot === flirt.photoSlot)?.assetId ?? null)
      : null;
  let withOffer =
    output && !needsHuman
      ? action === "lien" && input.persona.hasOffer
        ? true
        : canSendOffer(offerConv, input.persona, output, input.kind) && lienLibre
      : false;
  // Gérant du VIP : le lien d'inscription annoncé dans le texte part (le modèle oublie parfois send_offer). Une annonce
  // qui ne pouvait pas partir a déjà été refusée au contrôle de la réponse.
  if (
    vip &&
    output &&
    !needsHuman &&
    !withOffer &&
    announcesRegistrationLink(texts) &&
    offerAllowedNow(offerConv, input.persona, input.kind)
  )
    withOffer = true;

  // Pseudo donné dans ce tour (fille) : message de fin, lien forcé si pas encore parti.
  let pseudoGiven = false;
  if (output && personaIdentity(input.persona) === "GIRL") {
    const candidateFacts = mergeFacts(conv.facts, output.memory_facts);
    if (extractPseudo(candidateFacts) !== null && extractPseudo(conv.facts) === null) {
      pseudoGiven = true;
      texts = ["bon bah on se parle là-bas 😊"];
      fixedKey = null;
      if (!withOffer && conv.offerSends === 0 && input.persona.hasOffer) withOffer = true;
    }
  }

  // Série : le lien n'est jamais balancé (consigne du client) : sa réponse (à sa question d'abord) l'amène, puis il part
  // juste après, seul dans son propre message. Ce qui dit ce qu'est l'app est retiré (« elle envoie juste le lien ») ;
  // s'il ne reste rien, une petite phrase fixe l'amène.
  if (series && withOffer && !pseudoGiven && !needsHuman && fixedKey === null) {
    const kept = stripAppDescription(texts);
    if (kept.length === 0) {
      texts = [fixedText(run.lang, "linkLead")];
      fixedKey = "linkLead";
    } else texts = kept;
  }

  // Série : photo reçue avec des mots → « t'es mignon hihi » part d'abord, puis la réponse (elle ne regarde pas la photo).
  const photoLine = fixedText(run.lang, "photoReaction");
  if (
    series &&
    input.kind === "reply" &&
    hasMemberPhoto(inbound) &&
    fixedKey === null &&
    !pseudoGiven &&
    !needsHuman &&
    !texts.some((t) => t.toLowerCase().includes(photoLine.toLowerCase()))
  )
    texts = [photoLine, ...texts];

  // Phase 25 bis : bookmaker partenaire (Paris sportifs VIP) et lien VIP. Gérant du VIP : le bookmaker nommé dans le
  // texte prime (c'est celui que la personne lit), sinon celui dont il parlait juste avant.
  const selectedBook = pickBook(
    input.persona,
    output?.selected_book,
    withOffer,
    vip ? { texts, asked: lastAssistantTexts(input) } : undefined,
  );
  // Lien VIP : seulement après un lien d'inscription déjà envoyé, jamais pendant un passage à l'équipe. Gérant du VIP :
  // aussi quand il donne l'accès dans son texte alors que la personne confirme son dépôt (send_vip_link oublié).
  const wantsVip =
    output !== null &&
    !needsHuman &&
    conv.offerSends > 0 &&
    (output.send_vip_link === true ||
      (depositClaimed(run, inbound) && announcesVipAccess(texts)));
  const vipBookKey = wantsVip
    ? vip
      ? vipBook(input, output?.selected_book, texts, inbound)
      : selectedBook
    : null;
  let vipLink: string | null = null;
  if (wantsVip && vipBookKey && deps.resolveVipLink) {
    try {
      const found = await deps.resolveVipLink(vipBookKey);
      vipLink = found?.url ?? null;
    } catch {
      vipLink = null;
    }
  }
  // Gérant du VIP : accès promis mais aucun lien du canal VIP trouvé → jamais d'annonce sans lien : l'équipe l'envoie.
  if (vip && wantsVip && !vipLink) {
    texts = [fixedText(run.lang, "vipPending", textVars(input))];
    fixedKey = "vipPending";
    withOffer = false;
    needsHuman = { reason: "off_faq", source: "check" };
  }

  // Gérant du VIP : le script du client, mot pour mot (en français) : l'envoi du lien d'inscription, et le premier
  // message quand il parle du VIP (une réponse à tout autre sujet reste celle du modèle).
  if (vip && output && !needsHuman && fixedKey === null && run.lang === "fr") {
    if (withOffer && !vipLink) texts = [VIP_SCRIPT_LINK];
    else if (conv.isFirstAssistantTurn && !withOffer && !vipLink && talksAboutVip(texts))
      texts = [VIP_SCRIPT_PITCH];
  }

  // Gérant du VIP : le lien d'inscription est créé AVANT tout envoi, pour ne jamais annoncer un lien qui ne part pas.
  // Impossible à créer : rien ne part, nouvel essai bientôt ; au dernier passage, l'équipe prend le relais.
  let offerLink: { url: string; subId: string } | null = null;
  if (vip && withOffer) {
    try {
      offerLink = await deps.createOfferLink(selectedBook ?? undefined);
    } catch {
      offerLink = null;
    }
    if (!offerLink) {
      if (!turnPass(run, "offer_link").final) return retryLater(run, inbound, deferred, "offer_link");
      withOffer = false;
      vipLink = null;
      fixedKey = handoffKey(run);
      texts = [fixedText(run.lang, fixedKey, textVars(input))];
      needsHuman = { reason: "off_faq", source: "check" };
    }
  }

  const sending = await sendParts(run, texts, {
    withOffer,
    fixedKey,
    photoAssetId,
    bookKey: selectedBook,
    vipLink,
    noSplit: pseudoGiven,
    offerLink,
  });
  const anySent = sending.sent.length > 0;
  // La série n'avance que sur une action réellement partie.
  const nextFlirt = flirt ? (anySent ? applyAction(flirt.state, action) : flirt.state) : null;

  // Lien armé pour le tour suivant. Série : posé au tour où elle vend l'app sans lien, gardé tant qu'il n'est pas parti
  // et que la série en est à l'app. Ailleurs (fille sans série) : lien annoncé dans le texte mais pas parti.
  const armLink = flirt
    ? !pseudoGiven &&
      !sending.offerSent &&
      input.persona.hasOffer &&
      flirt.state.phase === "OFFER" &&
      (flirt.armLink === true ? anySent : linkWasArmed)
    : !pseudoGiven &&
      !linkWasArmed &&
      !sending.offerSent &&
      input.persona.hasOffer &&
      personaIdentity(input.persona) === "GIRL" &&
      announcesLink(texts);

  // 5. Étape, événements, style, faits, relance.
  let newStage = anySent
    ? decideStage({
        current: conv.stage,
        proposed: output?.stage ?? null,
        offerSent: Boolean(sending.offerSent),
        kind: input.kind,
        isFirstAssistantTurn: conv.isFirstAssistantTurn,
        offerSendsBefore: conv.offerSends,
      })
    : conv.stage;
  if (pseudoGiven && anySent) newStage = "CONVERTED";
  const stage = stageEvents(conv.stage, newStage);
  events.push(...stage.events);
  if (needsHuman && anySent) events.push(needsHumanEvent(needsHuman));
  if (sending.offerSent)
    events.push({
      type: "offer_sent",
      payload: {
        subId: sending.offerSent.subId,
        offerSends: conv.offerSends + 1,
        ...(selectedBook ? { bookmakerKey: selectedBook } : {}),
      },
    });

  const now = deps.now();
  const followUpCount = anySent
    ? input.kind === "follow_up"
      ? conv.followUpCount + 1
      : 0
    : conv.followUpCount;
  const closeReason = pseudoGiven && anySent
    ? ("PSEUDO" as const)
    : sending.sendError?.blocked
      ? ("BLOCKED" as const)
      : sending.sendError?.unreachable
        ? ("UNREACHABLE" as const)
        : null;
  // « Arrête de m'écrire », « unsubscribe »… au milieu d'un message : réponse polie, puis aucune relance.
  const stopAsked = input.kind === "reply" && inbound.some((m) => mentionsStopRequest(m.text));
  // Conversation passée à l'équipe ou pseudo donné : aucune relance de l'assistante.
  // Série : rien après le refus ferme (WRAP, DONE) ; le lien vient de partir → une seule relance courte, 1 à 2 h après.
  const next =
    anySent && !closeReason && !stopAsked && !needsHuman && !pseudoGiven
      ? nextFlirt && (nextFlirt.phase === "WRAP" || nextFlirt.phase === "DONE")
        ? null
        : nextFlirt && sending.offerSent
          ? linkNudgeAt(now, deps.random)
          : nextFollowUpAt(
              {
                status: "BOT",
                stage: newStage,
                isMinor: false,
                stoppedAt: null,
                followUpCount,
                lastAssistantAt: now,
              },
              input.persona,
              deps.random,
            )
      : null;
  const summary =
    anySent && !sending.sendError && !input.deferSummary ? await rollingSummary(run) : undefined;

  return {
    ...baseResult(run, inbound),
    outcome: anySent ? "replied" : "failed",
    sent: sending.sent,
    newStage,
    ...(nextFlirt
      ? { newFlirtStep: nextFlirt.phase, flirtTeases: encodeProgress(nextFlirt) }
      : {}),
    stageChanges: stage.changes,
    style: output ? mergeStyle(conv.style, output.style_update, now) : conv.style,
    facts: (() => {
      let f = output ? mergeFacts(conv.facts, output.memory_facts) : [...conv.facts];
      f = f.filter((x) => x !== ARMED_LINK_FACT);
      if (armLink) f.push(ARMED_LINK_FACT);
      return f;
    })(),
    ...(summary ? { summary } : {}),
    offerSent: sending.offerSent
      ? { ...sending.offerSent, ...(selectedBook ? { bookmakerKey: selectedBook } : {}) }
      : null,
    events,
    model,
    note: output?.note_interne?.trim() || null,
    appRefused: output?.app_refused === true,
    deferredInbound: deferred,
    followUpCount,
    nextFollowUpAt: next,
    closeReason,
    sendError: sending.sendError,
    // Lien créé d'avance mais jamais parti (envoi du texte en échec) : à retirer aussi.
    unsentOfferSubId:
      sending.unsentOfferSubId ?? (offerLink && !sending.offerSent ? offerLink.subId : null),
    needsHuman: needsHuman && anySent ? needsHuman : null,
    vipLinkSent:
      sending.vipLinkSent && vipBookKey
        ? { url: sending.vipLinkSent, bookmakerKey: vipBookKey }
        : null,
  };
}

/**
 * Série de photos : relance unique après le lien (« t la ? »), texte fixe sans appel au modèle. Relecture avant l'envoi
 * (reprise par l'équipe, /stop, message arrivé entre-temps : la relance n'a plus lieu d'être). Ensuite plus de relance.
 */
async function linkNudge(run: Run, inbound: TurnInbound[]): Promise<TurnResult> {
  const { input, deps } = run;
  const conv = input.conversation;
  const check = await deps.beforeSend();
  if (check.abort || check.newInbound.length > 0)
    return { ...baseResult(run, inbound), outcome: "aborted", deferredInbound: check.newInbound };
  const sending = await sendParts(run, [fixedText(run.lang, "linkNudge")], {
    withOffer: false,
    fixedKey: "linkNudge",
  });
  const anySent = sending.sent.length > 0;
  const newStage = anySent
    ? decideStage({
        current: conv.stage,
        proposed: null,
        offerSent: false,
        kind: "follow_up",
        isFirstAssistantTurn: conv.isFirstAssistantTurn,
        offerSendsBefore: conv.offerSends,
      })
    : conv.stage;
  const stage = stageEvents(conv.stage, newStage);
  return {
    ...baseResult(run, inbound),
    outcome: anySent ? "replied" : "failed",
    sent: sending.sent,
    newStage,
    stageChanges: stage.changes,
    events: stage.events,
    followUpCount: anySent ? conv.followUpCount + 1 : conv.followUpCount,
    nextFollowUpAt: null,
    closeReason: sending.sendError?.blocked
      ? "BLOCKED"
      : sending.sendError?.unreachable
        ? "UNREACHABLE"
        : null,
    sendError: sending.sendError,
  };
}

/**
 * Série de photos : photo reçue sans un mot → « t'es mignon hihi », texte fixe sans appel au modèle (elle ne regarde
 * pas la photo). La série n'avance pas, le lien armé le reste. Messages arrivés pendant la relecture : rendus pour un
 * vrai tour de réponse.
 */
async function photoReaction(run: Run, inbound: TurnInbound[]): Promise<TurnResult> {
  const { input, deps } = run;
  const conv = input.conversation;
  const check = await deps.beforeSend();
  if (check.abort)
    return { ...baseResult(run, inbound), outcome: "aborted", deferredInbound: check.newInbound };
  const lateMinor = detectMinorIn(check.newInbound.map((m) => m.text));
  if (lateMinor.minor)
    return stopForMinor(run, [...inbound, ...check.newInbound], "code", lateMinor.age);
  const sending = await sendParts(run, [fixedText(run.lang, "photoReaction")], {
    withOffer: false,
    fixedKey: "photoReaction",
  });
  const anySent = sending.sent.length > 0;
  const newStage = anySent
    ? decideStage({
        current: conv.stage,
        proposed: null,
        offerSent: false,
        kind: "reply",
        isFirstAssistantTurn: conv.isFirstAssistantTurn,
        offerSendsBefore: conv.offerSends,
      })
    : conv.stage;
  const stage = stageEvents(conv.stage, newStage);
  const closeReason = sending.sendError?.blocked
    ? ("BLOCKED" as const)
    : sending.sendError?.unreachable
      ? ("UNREACHABLE" as const)
      : null;
  const now = deps.now();
  return {
    ...baseResult(run, inbound),
    outcome: anySent ? "replied" : "failed",
    sent: sending.sent,
    newStage,
    stageChanges: stage.changes,
    events: stage.events,
    deferredInbound: check.newInbound,
    followUpCount: anySent ? 0 : conv.followUpCount,
    nextFollowUpAt:
      anySent && !closeReason
        ? nextFollowUpAt(
            {
              status: "BOT",
              stage: newStage,
              isMinor: false,
              stoppedAt: null,
              followUpCount: 0,
              lastAssistantAt: now,
            },
            input.persona,
            deps.random,
          )
        : null,
    closeReason,
    sendError: sending.sendError,
  };
}

/**
 * Passage à un humain repéré par le code (Casino / Paris) : relecture avant l'envoi (reprise par l'équipe, /stop, âge
 * déclaré arrivé entre-temps), puis la réponse neutre fixe, sans lien ni relance. Les messages arrivés pendant la
 * relecture sont couverts par ce même passage.
 */
async function handoffByCode(
  run: Run,
  inbound: TurnInbound[],
  signal: NeedsHumanSignal,
): Promise<TurnResult> {
  const { input, deps } = run;
  const conv = input.conversation;
  const check = await deps.beforeSend();
  if (check.abort)
    return { ...baseResult(run, inbound), outcome: "aborted", deferredInbound: check.newInbound };
  const all = [...inbound, ...check.newInbound];
  run.extraMemberMessages += check.newInbound.length;
  const lateMinor = detectMinorIn(check.newInbound.map((m) => m.text));
  if (lateMinor.minor) return stopForMinor(run, all, "code", lateMinor.age);
  const key = handoffKey(run);
  const sending = await sendParts(run, [fixedText(run.lang, key, textVars(input))], {
    withOffer: false,
    fixedKey: key,
  });
  const anySent = sending.sent.length > 0;
  const newStage = anySent
    ? decideStage({
        current: conv.stage,
        proposed: null,
        offerSent: false,
        kind: "reply",
        isFirstAssistantTurn: conv.isFirstAssistantTurn,
        offerSendsBefore: conv.offerSends,
      })
    : conv.stage;
  const stage = stageEvents(conv.stage, newStage);
  return {
    ...baseResult(run, all),
    outcome: anySent ? "replied" : "failed",
    sent: sending.sent,
    newStage,
    stageChanges: stage.changes,
    events: [...stage.events, ...(anySent ? [needsHumanEvent(signal)] : [])],
    followUpCount: anySent ? 0 : conv.followUpCount,
    nextFollowUpAt: null,
    closeReason: sending.sendError?.blocked
      ? "BLOCKED"
      : sending.sendError?.unreachable
        ? "UNREACHABLE"
        : null,
    sendError: sending.sendError,
    needsHuman: anySent ? signal : null,
  };
}
