// Tour de l'assistant (contrat §3.10) : mineur → plafond → appel au modèle (« écrit… » pendant l'appel) → lecture et
// contrôle → un seul nouvel essai → repli sûr ; pannes : un nouvel essai après 2 s, modèle de repli, puis texte fixe
// sûr (aveu ou présentation) ou « je reviens vers toi » et nouvel essai (3 passages au plus) ; relecture avant le
// premier envoi (reprise par l'équipe, messages regroupés, âge déclaré) ; envoi dans l'ordre avec le bouton d'offre sur
// le dernier message quand le lien part. Aucune persistance ici : l'appelant enregistre le résultat.
import { canSendOffer, decideStage } from "./journey";
import { nextFollowUpAt } from "./follow-ups";
import { mergeFacts } from "./memory";
import { detectMinorIn } from "./minor";
import { parseTurnOutput } from "./parse";
import { buildSummaryRequest, buildSystemPrompt, buildTurnMessages, cleanSummary } from "./prompt";
import { pauseBetweenMs, typingDelayMs, withTyping } from "./rhythm";
import { turnOutputJsonSchema, type TurnOutput } from "./schema";
import { mergeStyle, replyLanguage } from "./style";
import { fixedText, type FixedTextKey } from "./texts";
import type {
  ChatButton,
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
import { asksIfBot, validateTurnOutput, type RejectCode } from "./validate";

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
/** Pannes qui arrêtent tout de suite, sans aucun message (clé refusée, solde vide, pas de clé). */
const FATAL_CODES = new Set<string>(["auth", "balance", "no_key"]);
/**
 * Pannes qui se reproduiraient à l'identique (requête refusée, contenu refusé, modèle inconnu), constatées après le
 * modèle de repli : échec définitif tout de suite, sans nouvel essai ni message.
 */
const PERMANENT_CODES = new Set<string>(["bad_request", "content_policy", "bad_model"]);
const DEFAULT_OFFER_BUTTON = "Découvrir l'app";

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
  });
  return {
    model,
    messages: buildTurnMessages({ system, history: input.history, inbound }),
    temperature: input.persona.temperature ?? input.settings.temperature,
    maxTokens: input.settings.maxTokens,
    jsonSchema: turnOutputJsonSchema(),
    reasoning: input.settings.modelSupportsReasoning(model),
  };
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
  if (parsed.output.minor_suspected) {
    await recordUsage(run, {
      model: call.model,
      res: call.res,
      ok: true,
      error: null,
      attempt: call.attempt,
    });
    return { kind: "minor" };
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
    turnInboundTexts: input.kind === "reply" ? inbound.map((m) => m.text) : [],
    facts: conv.facts,
    isFirstAssistantMessage: conv.isFirstAssistantTurn,
  });
  if (!v.ok) {
    await recordUsage(run, {
      model: call.model,
      res: call.res,
      ok: false,
      error: `rejected:${v.codes.join(",")}`,
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
  const r = await safeSend(() => run.deps.sender.sendText(text));
  const stage = stageEvents(conv.stage, "CLOSED");
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
    events: [{ type: "minor", payload: { source, age } }, ...stage.events],
    deferredInbound: deferred,
    closeReason: "MINOR",
    sendError: r.ok ? null : { blocked: r.blocked, unreachable: r.unreachable, error: r.error },
  };
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
function safeFallbackKey(run: Run, inbound: TurnInbound[]): FixedTextKey | null {
  if (run.input.kind !== "reply") return null;
  if (inbound.some((m) => asksIfBot(m.text))) return "isAssistant";
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
    const r = await safeSend(() => deps.sender.sendText(text));
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
  opts: { withOffer: boolean; fixedKey: FixedTextKey | null },
): Promise<{
  sent: SentPart[];
  offerSent: { subId: string; url: string } | null;
  sendError: TurnResult["sendError"];
  unsentOfferSubId: string | null;
}> {
  const { deps, input } = run;
  const persona = input.persona;
  const sent: SentPart[] = [];
  let offerSent: { subId: string; url: string } | null = null;
  let sendError: TurnResult["sendError"] = null;
  let unsentOfferSubId: string | null = null;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i] ?? "";
    const isLast = i === texts.length - 1;
    await safeTyping(run);
    let delay = typingDelayMs(text);
    // Premier message : le temps de préparation compte déjà comme « écrit… » (pas d'attente pénible).
    if (i === 0) delay = Math.max(0, delay - (deps.now().getTime() - run.startedAt.getTime()));
    if (delay > 0) await deps.sleep(delay);

    let link: { url: string; subId: string } | null = null;
    if (isLast && opts.withOffer) {
      try {
        link = await deps.createOfferLink();
      } catch {
        link = null;
      }
    }
    const buttons: ChatButton[][] | undefined = link
      ? [[{ text: persona.offerButtonText?.trim() || DEFAULT_OFFER_BUTTON, url: link.url }]]
      : undefined;
    const mediaAssetId = link && persona.offerMediaAssetId ? persona.offerMediaAssetId : null;
    const r = await safeSend(() =>
      mediaAssetId
        ? deps.sender.sendMedia({ mediaAssetId }, text, { buttons })
        : deps.sender.sendText(text, buttons ? { buttons } : undefined),
    );
    if (!r.ok) {
      sendError = { blocked: r.blocked, unreachable: r.unreachable, error: r.error };
      if (link) unsentOfferSubId = link.subId;
      break;
    }
    sent.push({
      index: i,
      text,
      telegramMessageId: r.telegramMessageId,
      offerSubId: link?.subId ?? null,
      mediaAssetId,
      fixedKey: opts.fixedKey,
    });
    if (link) offerSent = { subId: link.subId, url: link.url };
    if (!isLast) await deps.sleep(pauseBetweenMs(deps.random));
  }
  return { sent, offerSent, sendError, unsentOfferSubId };
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

/** Un tour complet de l'assistant (contrat §3.10). */
export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  const conv = input.conversation;
  const run: Run = {
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
  let inbound: TurnInbound[] = input.kind === "reply" ? [...input.inbound] : [];

  // Jamais de réponse à une conversation fermée ou à un mineur (l'appelant ne devrait pas appeler).
  if (conv.isMinor || conv.stage === "CLOSED")
    return { ...baseResult(run, inbound), outcome: "aborted" };

  // 1. Âge déclaré de moins de 18 ans : arrêt avant tout appel au modèle.
  const minor = detectMinorIn(inbound.map((m) => m.text));
  if (minor.minor) return stopForMinor(run, inbound, "code", minor.age);

  // 2. Plafond mensuel : aucun appel, aucun message.
  if (await deps.capReached()) return capResult(run, inbound);

  // 3. Génération avec « écrit… » ; relecture avant le premier envoi (reprise, messages regroupés une fois).
  let gen = await withTyping(
    () => deps.sender.sendTyping(),
    () => generate(run, inbound),
    deps.timers,
  );
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
    if (regenerated || gen.kind === "error") {
      deferred = check.newInbound;
      break;
    }
    // Messages arrivés pendant la préparation : regroupés dans ce tour, réponse refaite une fois.
    regenerated = true;
    inbound = [...inbound, ...check.newInbound];
    run.extraMemberMessages += check.newInbound.length;
    gen = await withTyping(
      () => deps.sender.sendTyping(),
      () => generate(run, inbound),
      deps.timers,
    );
  }

  // 4. Réponse à envoyer : celle du modèle, ou un repli sûr (texte fixe, jamais de lien) après deux refus ou une panne.
  let texts: string[];
  let output: TurnOutput | null = null;
  let fixedKey: FixedTextKey | null = null;
  let model: string | null = null;
  const events: TurnEvent[] = [];
  if (gen.kind === "ok") {
    output = gen.output;
    texts = gen.messages;
    model = gen.model;
  } else {
    const code = gen.kind === "error" ? gen.code : "invalid_output";
    fixedKey = safeFallbackKey(run, inbound);
    if (!fixedKey) return retryLater(run, inbound, deferred, code);
    texts = [
      fixedText(run.lang, fixedKey, { name: input.persona.name, gender: input.persona.gender }),
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
  };
  const withOffer = output ? canSendOffer(offerConv, input.persona, output, input.kind) : false;
  const sending = await sendParts(run, texts, { withOffer, fixedKey });
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
  const next =
    anySent && !closeReason
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
  const summary = anySent && !sending.sendError ? await rollingSummary(run) : undefined;

  return {
    ...baseResult(run, inbound),
    outcome: anySent ? "replied" : "failed",
    sent: sending.sent,
    newStage,
    stageChanges: stage.changes,
    style: output ? mergeStyle(conv.style, output.style_update, now) : conv.style,
    facts: output ? mergeFacts(conv.facts, output.memory_facts) : conv.facts,
    ...(summary ? { summary } : {}),
    offerSent: sending.offerSent,
    events,
    model,
    note: output?.note_interne?.trim() || null,
    deferredInbound: deferred,
    followUpCount,
    nextFollowUpAt: next,
    closeReason,
    sendError: sending.sendError,
    unsentOfferSubId: sending.unsentOfferSubId,
  };
}
