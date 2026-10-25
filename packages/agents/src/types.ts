/**
 * Types partagés de l'organisation des agents (phase 19, docs/AGENTS-ARCHITECTURE.md).
 * Le Grand Chef et les Chefs sont de la logique programmée ; seuls certains agents appellent une IA, toujours par
 * `ctx.providers` (faux fournisseurs en test et en simulation).
 */
import type { SiteOpsClient } from "./site/contract";
import type { Db } from "@linkaffipro/db";
import type { ImageProvider } from "./providers/image";
import type { VideoProvider } from "./providers/video";
import type { OddsProvider } from "./providers/odds";
import type { OddsCache } from "./providers/odds-cache";

/** Client Prisma des agents : le client partagé de `@linkaffipro/db` (colonnes omises par défaut comprises). */
export type AgentsPrisma = Db;

export const TEAM_KEYS = ["dating", "casino", "sports", "algo"] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];

export function isTeamKey(v: unknown): v is TeamKey {
  return typeof v === "string" && (TEAM_KEYS as readonly string[]).includes(v);
}

/** Libellés affichés (site, Telegram). */
export const TEAM_LABELS: Record<TeamKey, string> = {
  dating: "Rencontres",
  casino: "Casino",
  sports: "Paris sportifs",
  algo: "Algorithme",
};

/** Univers d'un canal (`Channel.vertical`) → équipe. */
export const TEAM_OF_VERTICAL: Record<"DATING" | "CASINO" | "SPORTS", TeamKey> = {
  DATING: "dating",
  CASINO: "casino",
  SPORTS: "sports",
};

/** Toutes les clés d'agents prévues ; seules celles de `PHASE19_AGENT_KEYS` ont un agent réel dans cette phase. */
export const AGENT_KEYS = [
  "mediatheque",
  "media-ia",
  "redaction",
  "cotes",
  "capture",
  "planification",
  "controle",
  "publication",
  "posts",
  "horaires",
  "conversations",
  "experimentation",
  "synthese",
  "ads",
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const PHASE19_AGENT_KEYS = [
  "mediatheque",
  "redaction",
  "planification",
  "controle",
  "publication",
] as const satisfies readonly AgentKey[];

/** Agents réellement écrits à ce jour (phase 19 + Média IA de la phase 20) ; les autres arrivent avec leur phase. */
export const IMPLEMENTED_AGENT_KEYS = [
  ...PHASE19_AGENT_KEYS,
  "media-ia",
  // Équipe Algorithme (phase 21) : tournent par le Chef Algorithme (file `agents-algo`), pas dans une mission.
  "posts",
  "horaires",
  "conversations",
  "experimentation",
  "synthese",
  // Équipe Paris sportifs (phase 23).
  "cotes",
  "capture",
] as const satisfies readonly AgentKey[];

export const AGENT_LABELS: Record<AgentKey, string> = {
  mediatheque: "Médiathèque",
  "media-ia": "Média IA",
  redaction: "Rédaction",
  cotes: "Cotes et sélection",
  capture: "Capture écran",
  planification: "Planification",
  controle: "Contrôle qualité",
  publication: "Publication",
  posts: "Posts",
  horaires: "Horaires",
  conversations: "Conversations",
  experimentation: "Expérimentation",
  synthese: "Synthèse et réglages",
  ads: "Ads",
};

export function isAgentKey(v: unknown): v is AgentKey {
  return typeof v === "string" && (AGENT_KEYS as readonly string[]).includes(v);
}

/** Files du worker (une par niveau, pas une par agent). Dans une file d'équipe, nom de la tâche = clé de l'agent. */
export const TEAM_QUEUES: Record<TeamKey, "agents-dating" | "agents-casino" | "agents-sports" | "agents-algo"> = {
  dating: "agents-dating",
  casino: "agents-casino",
  sports: "agents-sports",
  algo: "agents-algo",
};

export type ProviderKey = "llm" | "video" | "image" | "odds" | "screenshot";
export const PROVIDER_KEYS: readonly ProviderKey[] = ["llm", "video", "image", "odds", "screenshot"];

export type MissionKind = "POST" | "BET" | "REPORT" | "ANALYSIS";
export type MissionStatus =
  | "PENDING"
  | "RUNNING"
  | "WAITING_VALIDATION"
  | "WAITING_HUMAN"
  | "DONE"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED_BUDGET";

export type StepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

/** Une étape de `AgentMission.steps`. */
export type MissionStep = {
  agent: AgentKey;
  status: StepStatus;
  startedAt?: string | null;
  endedAt?: string | null;
  /** Résumé court (jamais le texte complet d'un post). */
  summary?: string | null;
  costCents?: number;
  error?: string | null;
  /** Relectures d'un fournisseur déjà faites (étape en attente, phase 20). */
  waits?: number;
};

/** Charge utile d'une mission POST (`AgentMission.payload`). */
export type MissionPayload = {
  /** Type de post choisi (mélange du canal). */
  format?: "video" | "photo" | "text";
  /** Texte HTML Telegram produit par Rédaction (ou corrigé par l'admin). */
  text?: string;
  hook?: string;
  topic?: string;
  mediaAssetId?: string | null;
  /** ISO, créneau choisi par Planification. */
  slot?: string | null;
  /** Verdict du Contrôle qualité. */
  verdict?: "publish" | "redo" | "validate";
  /** Motifs (contrôle, validation, refus). */
  reasons?: string[];
  /** Rédaction déjà refaite une fois. */
  redone?: boolean;
  /** Validation humaine accordée. */
  approved?: boolean;
  /** Canal réellement visé (le canal Test est utilisé en simulation). */
  targetChannelId?: string;
  publishChannelId?: string;
  simulation?: boolean;
  [k: string]: unknown;
};

/** Vue d'une mission telle que la reçoit un agent. */
export type Mission = {
  id: string;
  teamKey: TeamKey;
  kind: MissionKind;
  channelId: string | null;
  status: MissionStatus;
  currentStep: number;
  steps: MissionStep[];
  payload: MissionPayload;
  costCents: number;
  postId: string | null;
  scheduledFor: Date | null;
  isTest: boolean;
  attempts: number;
};

/** Tâches des files d'agents (définies aussi dans `@linkaffipro/queue`, copie structurelle ici pour rester sans Redis). */
export type AgentsOrchestratorJob =
  | { type: "cycle"; teamKey?: TeamKey }
  /** Phase 27 : lecture d'un canal de référence, transmise aussitôt à la file `agents-algo` (`inspiration-read`). */
  | { type: "inspiration-read"; referenceChannelId: string }
  /** Phase 27 (Kevin) : une réponse pour un lot de posts transférés, une minute après le premier ; `analyzeRefId` : analyse à lancer. */
  | { type: "inspiration-forward-ack"; chatKey: string; analyzeRefId?: string }
  | { type: "resume" }
  /** Phase 33 : suivi des ordres de Kevin (progression, fin, reprise), toutes les 10 minutes. */
  | { type: "orders-tick" }
  | { type: "report"; force?: boolean }
  | { type: "human-requests" }
  | { type: "validations" }
  /** Banc d'essai vidéo (phase 20) : lancement (`personaId`, `count`) puis relectures (`benchId`). */
  | { type: "bench"; personaId?: string; count?: number; benchId?: string }
  /** Vocal de l'admin (phase 20, chantier B) : téléchargé, transcrit et traité comme un texte par le worker. */
  | { type: "admin-voice"; botId: string; fileId: string; messageId: number; chatId: number; replyToMessageId?: number | null; mimeType?: string | null }
  /**
   * Message de l'admin au Boss qui demande l'interprète IA (phase 26) : traité par `bossAiTurn` dans le worker, réponse
   * dans la même conversation par le même bot. Jamais un secret (le chemin rapide du webhook les retient avant).
   */
  | {
      type: "boss-text";
      botId: string;
      chatId: number;
      messageId: number;
      text: string;
      replyToMessageId?: number | null;
      source?: "text" | "voice";
      forwarded?: boolean;
      entities?: Array<{ type: string; offset: number; length: number; url?: string; language?: string; custom_emoji_id?: string }> | null;
      /**
       * Phase 26 (Kevin en équipe) : auteur du message (identifiant Telegram en texte) et type de conversation. Absents =
       * l'admin en privé (chemin historique). Le worker revérifie toujours qui parle (admin ou membre présenté) et que le
       * groupe est bien celui enregistré.
       */
      fromTelegramId?: string;
      chatType?: "private" | "group";
      mentions?: Array<{ telegramUserId?: string | null; username?: string | null; firstName?: string | null }>;
    };
/** `poll` : numéro de relecture d'une étape qui attend un fournisseur (identifiant de tâche distinct à chaque fois). */
export type AgentStepJob = { type: "step"; missionId: string; index: number; poll?: number };

/** Mise en file injectée (le worker et le site fournissent la vraie, les tests une fausse). */
export type AgentsEnqueue = {
  orchestrator(job: AgentsOrchestratorJob, opts?: { jobId?: string; delayMs?: number }): Promise<void>;
  /** `name` = clé de l'agent, `jobId` = `<missionId>:<index>` (idempotent). */
  step(teamKey: TeamKey, agent: AgentKey, job: AgentStepJob, opts?: { delayMs?: number }): Promise<void>;
};

/** Bouton inline envoyé avec un message à l'admin. */
export type AdminButton = { text: string; callbackData: string };

/** Envoi au seul identifiant admin (`Setting` `admin.telegramUserId`) par le bot du dialogue admin. */
export type AdminMessenger = {
  send(
    html: string,
    opts?: { buttons?: AdminButton[][]; mediaAssetId?: string | null; replyToMessageId?: number },
  ): Promise<{ messageId: number } | null>;
  deleteMessage?(messageId: number): Promise<void>;
  /**
   * Phase 26 (Kevin en équipe) : envoi par le même bot dans une autre conversation (le groupe de l'équipe, ou le privé
   * d'un membre présenté qui a fait /start). Absent : seul l'envoi à l'admin existe (le groupe n'est jamais utilisé).
   */
  sendTo?(
    chatId: bigint,
    html: string,
    opts?: { buttons?: AdminButton[][]; mediaAssetId?: string | null; replyToMessageId?: number },
  ): Promise<{ messageId: number } | null>;
  /** Phase 26 : suppression d'un message dans une autre conversation (secret collé dans le groupe). */
  deleteIn?(chatId: bigint, messageId: number): Promise<boolean>;
};

export type Logger = {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
};

/** Dépendances communes des services (site, worker, bot) : base, horloge, files, messager admin. */
export type AgentsDeps = {
  prisma: AgentsPrisma;
  now?: () => Date;
  enqueue: AgentsEnqueue;
  admin?: AdminMessenger;
  logger?: Logger;
  /**
   * Phase 34 : opérations du site (« tout par Kevin »). Worker : client signé de `POST /api/internal/site-ops` ; site
   * (chemin rapide du webhook) : appel direct du registre, sans réseau. Absent : Kevin dit que le site est injoignable.
   */
  siteOps?: SiteOpsClient;
};

/** Image jointe à une demande d'IA (contrôle des médias, phase 20) : octets en base64. */
export type LlmImage = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };

/** Réponse d'un fournisseur d'IA texte (au-dessus de `@linkaffipro/ai`). */
export type LlmRequest = { model: string; system: string; user: string; maxTokens: number; images?: LlmImage[] };
export type LlmResponse = { text: string; costCents: number };
export type LlmProvider = { complete(req: LlmRequest): Promise<LlmResponse> };

/**
 * Fournisseurs externes. `video` / `image` (phase 20) : imposés par les tests ; sinon choisis par
 * `providers/registry.ts` selon les clés (fal.ai, Magic Hour, faux fournisseur en simulation sans clé).
 */
export type Providers = {
  llm: LlmProvider | null;
  video?: VideoProvider | null;
  /** Repli vidéo (Magic Hour) imposé par les tests. */
  videoFallback?: VideoProvider | null;
  image?: ImageProvider | null;
  /** Cotes (phase 23) : imposées par les tests, sinon choisies par `providers/odds-registry.ts`. */
  odds?: OddsProvider | null;
  screenshot?: unknown;
};

/** Contexte d'un agent : tout ce qui touche au réseau passe par `providers`. */
export type AgentContext = AgentsDeps & {
  now: () => Date;
  providers: Providers;
  /** Extraction d'images d'une vidéo (worker : ffmpeg) ; absente ailleurs. */
  frames?: FrameExtractor;
  /** `fetch` des fournisseurs de médias (tests : réponses enregistrées). */
  fetch?: typeof fetch;
  /** Cache des cotes (phase 23 : Redis dans le worker, mémoire ailleurs). */
  oddsCache?: OddsCache | null;
  /** Réglages de l'équipe (`AgentTeamConfig`) et modèles (`Setting` `agents.models`). */
  settings: TeamSettings;
};

export type TeamSettings = {
  teamKey: TeamKey;
  simulation: boolean;
  paused: boolean;
  autonomyLevel: 0 | 1 | 2;
  monthlyBudgetCents: Partial<Record<ProviderKey, number>>;
  styleGuidelines: string;
  forbiddenWords: string[];
  maxTextLength: number;
  quietHours: { start: string; end: string }[];
  models: { fast: string; strong: string };
  similarityThreshold: number;
  settings: Record<string, unknown>;
};

export type AgentResult = {
  ok: boolean;
  /** Fusionné dans `AgentMission.payload`. */
  output?: Partial<MissionPayload>;
  costCents?: number;
  /** Résumé court pour `AgentRun.outputSummary` et `MissionStep.summary`. */
  summary?: string;
  needsValidation?: { reason: string };
  /** Le Chef doit renvoyer la mission à une étape antérieure (Contrôle → Rédaction, une fois). */
  goTo?: AgentKey;
  retryable?: boolean;
  error?: string;
  /**
   * Étape en attente d'un fournisseur (phase 20, travail asynchrone) : ni finie ni échouée ; le moteur enregistre la
   * charge utile et ré-enfile la même étape après `delayMs`.
   */
  wait?: { delayMs: number };
  /** Rien à faire pour ce format (post texte, par exemple) : l'étape est marquée « sautée ». */
  skipped?: boolean;
  /** Poste de dépense du coût de l'étape quand l'agent en a plusieurs (`media-ia` : video ou image). */
  costProvider?: ProviderKey;
};

export type AgentDefinition = {
  key: AgentKey;
  run(mission: Mission, ctx: AgentContext): Promise<AgentResult>;
};

/** Extraction d'images d'une vidéo (phase 20, `ffmpeg` dans le worker) : début, milieu, fin, en JPEG. */
export type FrameExtractor = (
  video: { bytes: Uint8Array; mimeType: string },
  count: number,
) => Promise<{ frames: Uint8Array[]; durationSec: number | null; width?: number | null; height?: number | null } | null>;

/** Transcription d'un vocal (phase 20, vocaux de l'admin ; même fournisseur que les comptes réels de la phase 18). */
export type Transcriber = (audio: { bytes: Uint8Array; mimeType: string }) => Promise<string | null>;
