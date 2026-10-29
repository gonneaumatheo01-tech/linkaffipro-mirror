// Tour de l'assistant (contrat §3.10) : mineur → plafond → appel au modèle (« écrit… » pendant l'appel) → lecture et
// contrôle → un seul nouvel essai → repli sûr ; pannes : un nouvel essai après 2 s, modèle de repli, puis texte fixe
// sûr (aveu ou présentation) ou « je reviens vers toi » et nouvel essai (3 passages au plus) ; relecture avant le
// premier envoi (reprise par l'équipe, messages regroupés, âge déclaré) ; envoi dans l'ordre avec le bouton d'offre sur
// le dernier message quand le lien part. Aucune persistance ici : l'appelant enregistre le résultat.
import { isAssistantOnlyUniverse, offerButtonTextFor } from "@linkaffipro/core";
import { detectHandoffIn } from "./handoff";
import { canSendOffer, decideStage } from "./journey";
import { nextFollowUpAt } from "./follow-ups";
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
import { turnOutputJsonSchema, type TurnOutput } from "./schema";
import { mergeStyle, replyLanguage } from "./style";
import { fixedText, type FixedTextKey } from "./texts";
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
  });
  return {
    model,
    messages: buildTurnMessages({ system, history: input.history, inbound }),
    temperature: input.persona.temperature ?? input.settings.temperature,
    maxTokens: input.settings.maxTokens,
    jsonSchema: turnOutputJsonSchema(input.persona.universe),
    reasoning: input.settings.modelSupportsReasoning(model),
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
    identity: personaIdentity(input.persona),
    illusion: personaIllusion(input.persona),
    vipManager: input.persona.vipManager === true && input.persona.universe === "sports",
    botInsists:
      input.kind === "reply" &&
      botQuestionInsists(
        input.history,
        inbound.map((m) => m.text),
      ),
  });
  if (!v.ok) {
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
    messages: v.messages,
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
  const text = fixedText(run.lang, "minorStop");
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
  if (run.input.conversation.isFirstAssistantTurn) return "intro";
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
  const pass = Math.max(0, Math.floor(input.retryCount ?? 0)) + 1;
  const final = pass >= MAX_TURN_ATTEMPTS || PERMANENT_CODES.has(code);
  const last = input.conversation.lastNeutralAt;
  const lastMember = lastMemberMessageAt(run, inbound);
  const wroteSinceNeutral = !last || (lastMember !== null && lastMember > last.getTime());
  const canNeutral =
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
    ...(final ? {} : { retryAt: new Date(now.getTime() + RETRY_LATER_MS), retryCount: pass }),
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
    /** Phase 36 : clé du bookmaker partenaire (Paris sportifs VIP). */
    bookKey?: string | null;
    /** Phase 36 : lien du canal VIP à envoyer en bouton (après dépôt confirmé). */
    vipLink?: string | null;
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
        },
        deps.random,
      );
      const reste = Math.max(0, opening - (deps.now().getTime() - run.startedAt.getTime()));
      if (reste > 0) await deps.sleep(reste);
      await withTyping(
        () => deps.sender.sendTyping(),
        () => deps.sleep(typingDelayMs(text, isHot(input) || isLive(input))),
        deps.timers,
      );
    } else {
      await safeTyping(run);
      const delay = typingDelayMs(text);
      if (delay > 0) await deps.sleep(delay);
    }

    let link: { url: string; subId: string } | null = null;
    if (isLast && opts.withOffer) {
      try {
        link = await deps.createOfferLink(opts.bookKey ?? undefined);
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

    // Sans boutons (aperçu « Tester ») : les adresses vont à la fin du texte.
    const inlineUrls = canButtons
      ? []
      : [link?.url, vipLink].filter((u): u is string => Boolean(u));
    const outgoing = inlineUrls.length > 0 ? `${text}\n\n${inlineUrls.join("\n")}` : text;
    const sendOpts = { buttons, fixedKey: opts.fixedKey, offerSubId: link?.subId ?? null };
    const mediaAssetId = link && persona.offerMediaAssetId ? persona.offerMediaAssetId : null;
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
 */
export function pickBook(
  persona: PersonaInput,
  selected: string | undefined,
  withOffer: boolean,
): string | null {
  const books = persona.bookmakers ?? [];
  if (books.length === 0) return null;
  const key = selected?.trim();
  if (key && books.some((b) => b.bookmakerKey === key)) return key;
  if (!withOffer) return null;
  return [...books].sort((a, b) => a.priority - b.priority)[0]?.bookmakerKey ?? null;
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

  // Jamais de réponse à une conversation fermée ou à un mineur (l'appelant ne devrait pas appeler).
  if (conv.isMinor || conv.stage === "CLOSED")
    return { ...baseResult(run, inbound), outcome: "aborted" };

  // 1. Âge déclaré de moins de 18 ans : arrêt avant tout appel au modèle.
  const minor = detectMinorIn(inbound.map((m) => m.text));
  if (minor.minor) return stopForMinor(run, inbound, "code", minor.age);

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
    if (gen.kind === "error" && gen.fatal)
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
    fixedKey = "handoff";
    texts = [fixedText(run.lang, "handoff")];
    const reason = gen.output.handoff.reason === "none" ? "off_faq" : gen.output.handoff.reason;
    needsHuman = { reason, source: "model" };
  } else if (gen.kind === "ok") {
    output = gen.output;
    texts = gen.messages;
    model = gen.model;
  } else {
    const code = gen.kind === "error" ? gen.code : "invalid_output";
    fixedKey = safeFallbackKey(run, inbound, gen.kind === "rejected" ? gen.codes : []);
    if (!fixedKey) return retryLater(run, inbound, deferred, code);
    if (fixedKey === "handoff") needsHuman = { reason: "off_faq", source: "check" };
    texts = [
      fixedText(run.lang, fixedKey, {
        name: input.persona.name,
        gender: input.persona.gender,
        identity: personaIdentity(input.persona),
        illusion: personaIllusion(input.persona),
        vipManager: input.persona.vipManager === true,
      }),
    ];
    events.push({
      type: "ai_failed",
      payload: { code, attempts: run.attempts, neutral: false, final: false, fallback: fixedKey },
    });
  }

  const offerConv = {
    memberMessages: memberMessagesNow(run),
    offerSends: conv.offerSends,
    isMinor: conv.isMinor,
    isFirstAssistantTurn: conv.isFirstAssistantTurn,
    memberAskedOffer: memberAskedOffer(run, inbound),
  };
  const withOffer =
    output && !needsHuman ? canSendOffer(offerConv, input.persona, output, input.kind) : false;

  // Phase 25 bis : bookmaker partenaire (Paris sportifs VIP) et lien VIP.
  const selectedBook = pickBook(input.persona, output?.selected_book, withOffer);
  let vipLink: string | null = null;
  // Lien VIP : seulement après un lien d'inscription déjà envoyé, jamais pendant un passage à l'équipe.
  if (
    output?.send_vip_link &&
    selectedBook &&
    conv.offerSends > 0 &&
    !needsHuman &&
    deps.resolveVipLink
  ) {
    try {
      const vip = await deps.resolveVipLink(selectedBook);
      vipLink = vip?.url ?? null;
    } catch {
      vipLink = null;
    }
  }

  const sending = await sendParts(run, texts, {
    withOffer,
    fixedKey,
    bookKey: selectedBook,
    vipLink,
  });
  const anySent = sending.sent.length > 0;

  // 5. Étape, événements, style, faits, relance.
  const newStage = anySent
    ? decideStage({
        current: conv.stage,
        proposed: output?.stage ?? null,
        offerSent: Boolean(sending.offerSent),
        kind: input.kind,
        isFirstAssistantTurn: conv.isFirstAssistantTurn,
        offerSendsBefore: conv.offerSends,
      })
    : conv.stage;
  const stage = stageEvents(conv.stage, newStage);
  events.push(...stage.events);
  if (needsHuman && anySent) events.push(needsHumanEvent(needsHuman));
  if (sending.offerSent)
    events.push({
      type: "offer_sent",
      payload: { subId: sending.offerSent.subId, offerSends: conv.offerSends + 1 },
    });

  const now = deps.now();
  const followUpCount = anySent
    ? input.kind === "follow_up"
      ? conv.followUpCount + 1
      : 0
    : conv.followUpCount;
  const closeReason = sending.sendError?.blocked
    ? ("BLOCKED" as const)
    : sending.sendError?.unreachable
      ? ("UNREACHABLE" as const)
      : null;
  // « Arrête de m'écrire », « unsubscribe »… au milieu d'un message : réponse polie, puis aucune relance.
  const stopAsked = input.kind === "reply" && inbound.some((m) => mentionsStopRequest(m.text));
  // Conversation passée à l'équipe : aucune relance de l'assistante.
  const next =
    anySent && !closeReason && !stopAsked && !needsHuman
      ? nextFollowUpAt(
          {
            status: "BOT",
            stage: newStage,
            isMinor: false,
            stoppedAt: null,
            followUpCount,
            lastAssistantAt: now,
          },
          input.persona,
        )
      : null;
  const summary =
    anySent && !sending.sendError && !input.deferSummary ? await rollingSummary(run) : undefined;

  return {
    ...baseResult(run, inbound),
    outcome: anySent ? "replied" : "failed",
    sent: sending.sent,
    newStage,
    stageChanges: stage.changes,
    style: output ? mergeStyle(conv.style, output.style_update, now) : conv.style,
    facts: output ? mergeFacts(conv.facts, output.memory_facts) : conv.facts,
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
    unsentOfferSubId: sending.unsentOfferSubId,
    needsHuman: needsHuman && anySent ? needsHuman : null,
    vipLinkSent:
      sending.vipLinkSent && selectedBook
        ? { url: sending.vipLinkSent, bookmakerKey: selectedBook }
        : null,
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
  const sending = await sendParts(run, [fixedText(run.lang, "handoff")], {
    withOffer: false,
    fixedKey: "handoff",
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
