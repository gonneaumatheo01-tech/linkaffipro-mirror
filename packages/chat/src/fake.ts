// Faux client du modèle et faux envoi (contrat §3) : tests sans réseau, et bouton « Tester » du site (conversation
// simulée dans la page, sans Telegram). Horloge simulée : `sleep` avance le temps sans attendre.
import type { StyleUpdate, TurnOutput } from "./schema";
import type {
  ChatButton,
  ChatCapabilities,
  ChatSender,
  ConversationState,
  PersonaInput,
  SendResult,
  TurnDeps,
  TurnInbound,
  TurnSettings,
  TypingTimers,
} from "./turn-types";
import type { LlmClient, LlmRequest, LlmResponse, LlmUsage, UsageRecord } from "./types";

// ------------------------------------------------------------------
// Sorties du modèle
// ------------------------------------------------------------------

export type FakeOutputInput = Partial<Omit<TurnOutput, "messages" | "style_update">> & {
  messages?: (string | { text: string })[];
  style_update?: Partial<StyleUpdate>;
};

/** Sortie de tour complète et conforme, à partir de quelques champs. */
export function fakeOutput(over: FakeOutputInput = {}): TurnOutput {
  return {
    messages: (over.messages ?? ["Coucou 😊"]).map((m) =>
      typeof m === "string" ? { text: m } : m,
    ),
    style_update: {
      length: "short",
      emojis: "few",
      register: "casual",
      language: "fr",
      tone: "direct",
      interest: 5,
      ...over.style_update,
    },
    stage: over.stage ?? "CHAT",
    send_offer: over.send_offer ?? false,
    memory_facts: over.memory_facts ?? [],
    minor_suspected: over.minor_suspected ?? false,
    note_interne: over.note_interne ?? "",
  };
}

// ------------------------------------------------------------------
// Faux client du modèle
// ------------------------------------------------------------------

/**
 * Une réponse prévue : texte brut renvoyé tel quel, sortie de tour (objet avec `messages`, sérialisée en JSON),
 * réponse partielle (`{ response }`), ou erreur levée (`Error`, `{ error }`).
 */
export type FakeLlmReply =
  string | FakeOutputInput | { response: Partial<LlmResponse> } | { error: Error } | Error;

export type FakeLlmScript =
  | readonly FakeLlmReply[]
  | ((req: LlmRequest, index: number) => FakeLlmReply | Promise<FakeLlmReply>);

export type FakeLlm = LlmClient & {
  /** Requêtes reçues, dans l'ordre. */
  requests: LlmRequest[];
  readonly calls: number;
};

export type FakeLlmOptions = {
  usage?: LlmUsage;
  costUsd?: number | null;
  requestId?: string | null;
};

/** Faux client : réponses scriptées (liste ou fonction), journal des requêtes, erreurs simulées. */
export function createFakeLlm(script: FakeLlmScript, opts: FakeLlmOptions = {}): FakeLlm {
  const requests: LlmRequest[] = [];
  const usage = opts.usage ?? { inputTokens: 800, outputTokens: 120 };
  const fake: FakeLlm = {
    requests,
    get calls() {
      return requests.length;
    },
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const index = requests.length;
      requests.push(req);
      const reply = typeof script === "function" ? await script(req, index) : script[index];
      if (reply === undefined) throw new Error("Faux client : plus aucune réponse prévue.");
      if (reply instanceof Error) throw reply;
      const base: LlmResponse = {
        text: "",
        model: req.model,
        finishReason: "stop",
        usage,
        costUsd: opts.costUsd ?? null,
        requestId: opts.requestId ?? `fake-${index + 1}`,
      };
      if (typeof reply === "string") return { ...base, text: reply };
      if ("error" in reply && reply.error instanceof Error) throw reply.error;
      if ("response" in reply && reply.response) return { ...base, ...reply.response };
      return { ...base, text: JSON.stringify(fakeOutput(reply as FakeOutputInput)) };
    },
  };
  return fake;
}

// ------------------------------------------------------------------
// Faux envoi
// ------------------------------------------------------------------

export type FakeSendEntry =
  | { kind: "typing"; seq: number }
  | { kind: "text"; seq: number; text: string; buttons?: ChatButton[][]; offerSubId?: string | null }
  | {
      kind: "media";
      seq: number;
      mediaAssetId: string;
      text: string;
      buttons?: ChatButton[][];
      offerSubId?: string | null;
    };

export type FakeSender = ChatSender & {
  /** Tout ce qui a été fait, dans l'ordre (« écrit… » compris). */
  log: FakeSendEntry[];
  /** Messages envoyés (texte et légendes), dans l'ordre. */
  messages(): Extract<FakeSendEntry, { kind: "text" | "media" }>[];
  typingCount(): number;
  /** Texte fixe annoncé à chaque envoi (`SendOptions.fixedKey`, null pour une réponse du modèle), dans l'ordre. */
  fixedKeys(): (string | null)[];
};

/**
 * Faux envoi : journal des envois, identifiants de message croissants. `results` : résultat de chaque envoi (texte ou
 * média, dans l'ordre ; absent = réussi), ou fonction.
 */
export function createFakeSender(
  opts: {
    results?:
      | readonly (SendResult | undefined)[]
      | ((index: number, text: string) => SendResult | undefined);
    capabilities?: Partial<ChatCapabilities>;
  } = {},
): FakeSender {
  const log: FakeSendEntry[] = [];
  const keys: (string | null)[] = [];
  let seq = 0;
  let sends = 0;
  const result = (text: string): SendResult => {
    const index = sends++;
    const r =
      typeof opts.results === "function" ? opts.results(index, text) : opts.results?.[index];
    return r ?? { ok: true, telegramMessageId: 1000 + index };
  };
  return {
    capabilities: {
      canInitiate: false,
      canMarkRead: false,
      canSendButtons: true,
      ...opts.capabilities,
    },
    log,
    messages: () =>
      log.filter(
        (e): e is Extract<FakeSendEntry, { kind: "text" | "media" }> => e.kind !== "typing",
      ),
    typingCount: () => log.filter((e) => e.kind === "typing").length,
    fixedKeys: () => [...keys],
    async sendTyping() {
      log.push({ kind: "typing", seq: ++seq });
    },
    async sendText(text, o) {
      log.push({
        kind: "text",
        seq: ++seq,
        text,
        offerSubId: o?.offerSubId ?? null,
        ...(o?.buttons ? { buttons: o.buttons } : {}),
      });
      keys.push(o?.fixedKey ?? null);
      return result(text);
    },
    async sendMedia(media, caption, o) {
      log.push({
        kind: "media",
        seq: ++seq,
        mediaAssetId: media.mediaAssetId,
        text: caption,
        offerSubId: o?.offerSubId ?? null,
        ...(o?.buttons ? { buttons: o.buttons } : {}),
      });
      keys.push(o?.fixedKey ?? null);
      return result(caption);
    },
  };
}

// ------------------------------------------------------------------
// Fausses dépendances d'un tour
// ------------------------------------------------------------------

export type FakeTimers = TypingTimers & { active(): number; started(): number };

/** Minuteries simulées (« écrit… ») : rien ne s'exécute tout seul ; `active()` vérifie qu'aucune n'est restée. */
export function createFakeTimers(): FakeTimers {
  let next = 0;
  const live = new Set<number>();
  return {
    setInterval: () => {
      const id = ++next;
      live.add(id);
      return id;
    },
    clearInterval: (handle) => {
      live.delete(handle as number);
    },
    active: () => live.size,
    started: () => next,
  };
}

export type FakeTurnDeps = TurnDeps & {
  sender: FakeSender;
  timers: FakeTimers;
  /** Attentes demandées (ms), dans l'ordre. */
  sleeps: number[];
  usages: UsageRecord[];
  offerLinks: { url: string; subId: string }[];
  beforeSendCalls(): number;
  capChecks(): number;
};

export type FakeTurnDepsOptions = {
  llm: LlmClient;
  sender?: FakeSender;
  /** Heure de départ de l'horloge simulée. */
  startAt?: Date;
  capReached?: boolean | (() => boolean | Promise<boolean>);
  /** Résultats successifs de `beforeSend` (absent = rien de nouveau). */
  beforeSend?: readonly { abort?: boolean; newInbound?: TurnInbound[] }[];
  /** null : aucun lien ne peut être créé. */
  offerBaseUrl?: string | null;
  random?: () => number;
};

/**
 * Dépendances simulées POUR LES TESTS : horloge qui avance à chaque `sleep`, liens d'offre numérotés, coûts journalisés
 * en mémoire seulement, plafond jamais atteint par défaut et prix fictif. Ne pas s'en servir pour le bouton « Tester » :
 * voir `createTestTurnDeps` (plafond, coût et journal des coûts réels obligatoires).
 */
export function createFakeTurnDeps(opts: FakeTurnDepsOptions): FakeTurnDeps {
  let t = (opts.startAt ?? new Date("2026-10-18T12:00:00.000Z")).getTime();
  const sleeps: number[] = [];
  const usages: UsageRecord[] = [];
  const offerLinks: { url: string; subId: string }[] = [];
  let beforeSendCalls = 0;
  let capChecks = 0;
  const base = opts.offerBaseUrl === undefined ? "https://go.goolink.eu/a/" : opts.offerBaseUrl;
  return {
    llm: opts.llm,
    sender: opts.sender ?? createFakeSender(),
    timers: createFakeTimers(),
    sleeps,
    usages,
    offerLinks,
    beforeSendCalls: () => beforeSendCalls,
    capChecks: () => capChecks,
    now: () => new Date(t),
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    random: opts.random ?? (() => 0.5),
    createOfferLink: async () => {
      if (base === null) return null;
      const subId = `TEST${String(offerLinks.length + 1).padStart(8, "0")}`;
      const link = { url: `${base}${subId}`, subId };
      offerLinks.push(link);
      return link;
    },
    beforeSend: async () => {
      const step = opts.beforeSend?.[beforeSendCalls++];
      return { abort: step?.abort ?? false, newInbound: step?.newInbound ?? [] };
    },
    recordUsage: async (u) => {
      usages.push(u);
    },
    capReached: async () => {
      capChecks++;
      const c = opts.capReached;
      return typeof c === "function" ? await c() : Boolean(c);
    },
    costEur: (_model, usage, costUsd) =>
      costUsd !== null
        ? costUsd * 0.92
        : ((usage.inputTokens + usage.outputTokens) / 1_000_000) * 0.92,
  };
}

// ------------------------------------------------------------------
// Persona, réglages et conversation d'exemple
// ------------------------------------------------------------------

export function fakePersona(over: Partial<PersonaInput> = {}): PersonaInput {
  return {
    name: "Léa",
    gender: "F",
    personality: "Pétillante, curieuse, pleine d'humour",
    tone: "complice, léger",
    languages: ["fr", "en"],
    interests: ["voyages", "musique"],
    extraPrompt: null,
    model: null,
    temperature: null,
    minExchangesBeforeOffer: 4,
    requireInterest: true,
    maxOfferSends: 2,
    followUpAfterHours: 24,
    followUpsMax: 2,
    offerPitch: "Une app de rencontres gratuite à l'inscription, avec des profils vérifiés.",
    offerButtonText: "Découvrir l'app",
    hasOffer: true,
    offerMediaAssetId: null,
    channelTitle: "Rencontres Paris",
    botName: "lea_assistante_bot",
    ...over,
  };
}

export function fakeSettings(over: Partial<TurnSettings> = {}): TurnSettings {
  return {
    defaultModel: "venice-uncensored-role-play",
    fallbackModel: "venice-uncensored-1-2",
    temperature: 0.85,
    maxTokens: 400,
    modelSupportsReasoning: () => false,
    ...over,
  };
}

export function fakeConversation(over: Partial<ConversationState> = {}): ConversationState {
  return {
    stage: "CHAT",
    style: {},
    summary: null,
    facts: [],
    memberMessages: 5,
    assistantTurns: 4,
    offerSends: 0,
    followUpCount: 0,
    isMinor: false,
    isFirstAssistantTurn: false,
    memberLanguageCode: "fr",
    lastInboundAt: null,
    lastAssistantAt: null,
    lastNeutralAt: null,
    ...over,
  };
}

// ------------------------------------------------------------------
// Bouton « Tester » du site
// ------------------------------------------------------------------

export type TestTurnDepsOptions = {
  /** Vrai client du modèle (clé des réglages), ou faux client. */
  llm: LlmClient;
  /** Plafond mensuel réel (même calcul que le worker), vérifié avant CHAQUE appel au modèle (contrat §2). */
  capReached(): Promise<boolean>;
  /** Écriture réelle du coût (AiConversationUsage) : le motif est toujours forcé à TEST (contrat §6). */
  recordUsage(u: UsageRecord): Promise<void>;
  /** Prix réel (cache des modèles des réglages, `cost.usd` de la réponse s'il existe). */
  costEur(model: string, usage: LlmUsage, costUsd: number | null): number;
  startAt?: Date;
  /** Adresse des liens d'offre d'exemple (aucun lien réel n'est créé) ; null : aucun lien. */
  offerBaseUrl?: string | null;
  beforeSend?: FakeTurnDepsOptions["beforeSend"];
};

/**
 * Dépendances du bouton « Tester » (conversation simulée dans la page, sans Telegram) : envoi et horloge simulés (aucune
 * attente réelle), liens d'offre d'exemple, mais plafond, prix et journal des coûts RÉELS, obligatoires. Chaque coût est
 * aussi gardé en mémoire (`usages`) pour l'affichage.
 */
export function createTestTurnDeps(opts: TestTurnDepsOptions): FakeTurnDeps {
  const deps = createFakeTurnDeps({
    llm: opts.llm,
    ...(opts.startAt ? { startAt: opts.startAt } : {}),
    ...(opts.offerBaseUrl !== undefined ? { offerBaseUrl: opts.offerBaseUrl } : {}),
    ...(opts.beforeSend ? { beforeSend: opts.beforeSend } : {}),
  });
  let capChecks = 0;
  return {
    ...deps,
    capChecks: () => capChecks,
    capReached: async () => {
      capChecks++;
      return opts.capReached();
    },
    recordUsage: async (u) => {
      const record: UsageRecord = { ...u, purpose: "TEST" };
      deps.usages.push(record);
      await opts.recordUsage(record);
    },
    costEur: (model, usage, costUsd) => opts.costEur(model, usage, costUsd),
  };
}
