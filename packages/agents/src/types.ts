/**
 * Types partagés de l'organisation des agents (phase 19, docs/AGENTS-ARCHITECTURE.md).
 * Le Grand Chef et les Chefs sont de la logique programmée ; seuls certains agents appellent une IA, toujours par
 * `ctx.providers` (faux fournisseurs en test et en simulation).
 */
import type { Db } from "@linkaffipro/db";

/** Client Prisma des agents : le client partagé de `@linkaffipro/db` (colonnes omises par défaut comprises). */
export type AgentsPrisma = Db;

export const TEAM_KEYS = ["dating", "casino", "sports", "algo"] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];

export function isTeamKey(v: unknown): v is TeamKey {
  return typeof v === "string" && (TEAM_KEYS as readonly string[]).includes(v);
}

/** Libellés affichés (site, Telegram). */
export const TEAM_LABELS: Record<TeamKey, string> = {
  dating: "Dating",
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
  | { type: "resume" }
  | { type: "report"; force?: boolean }
  | { type: "human-requests" }
  | { type: "validations" };
export type AgentStepJob = { type: "step"; missionId: string; index: number };

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
};

/** Réponse d'un fournisseur d'IA texte (au-dessus de `@linkaffipro/ai`). */
export type LlmRequest = { model: string; system: string; user: string; maxTokens: number };
export type LlmResponse = { text: string; costCents: number };
export type LlmProvider = { complete(req: LlmRequest): Promise<LlmResponse> };

/** Fournisseurs externes ; seul `llm` a une vraie implémentation en phase 19. */
export type Providers = {
  llm: LlmProvider | null;
  video?: unknown;
  image?: unknown;
  odds?: unknown;
  screenshot?: unknown;
};

/** Contexte d'un agent : tout ce qui touche au réseau passe par `providers`. */
export type AgentContext = AgentsDeps & {
  now: () => Date;
  providers: Providers;
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
};

export type AgentDefinition = {
  key: AgentKey;
  run(mission: Mission, ctx: AgentContext): Promise<AgentResult>;
};
