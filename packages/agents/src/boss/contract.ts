/**
 * Phase 26 — contrat FIGÉ du Boss (bot dédié au dialogue avec l'admin). Les types et noms ci-dessous sont partagés par
 * trois chantiers ; ne pas les renommer. Qui fournit quoi :
 *
 * - Chantier B (`packages/agents/src/boss/` : catalog, interpret, answer, memory, execute, confirm, llm, fast) :
 *   `bossFastPath`, `bossAiTurn`, `handleBossCallback`, `isBossCallbackData`, `loadBossLlm`, `createFakeBossLlm`,
 *   `BOSS_CATALOG` (`BossAction[]`).
 * - Chantier C (`packages/agents/src/boss/` : guide, help, unmet, nudge) : `bossStartReply`, `bossHelpText`,
 *   `recordBossUnmet`, `bossDailyNudge`, `bossSetupSteps`. Appelés par le catalogue de B (`commencer`, `aide`,
 *   besoin non couvert) et par le worker (relance quotidienne).
 * - Chantier A (`packages/telegram`, `apps/worker`, `apps/web` Réglages → Bots, `pnpm tg:diag`) : choix du bot
 *   (`adminBot()`, `CHANNEL_BOT_WHERE`), réception des messages, envoi de la réponse, tâche `boss-text`.
 *
 * Ordre de traitement d'un message de l'admin (règle 2 de la phase) : secret → réponse à une question ouverte →
 * OUI / NON / annule → commande exacte → interprète IA. Les quatre premiers sont dans `bossFastPath` (instantané,
 * gratuit, appelé dans le webhook) ; le dernier dans `bossAiTurn` (appelé par le worker, tâche `boss-text`).
 */
import type { AiToolDef, AiToolUse } from "@linkaffipro/ai";
import type { AdminButton, AgentsDeps } from "../types";
import type { TelegramTextEntity } from "../admin/entities-html";

/** Clé d'équipe des dépenses IA du Boss dans `AgentUsage` (provider `llm`). */
export const BOSS_TEAM_KEY = "boss";
/** `Setting` : `{ monthlyCents: number }`, 1 000 (10 €) par défaut, alerte à 80 %. */
export const BOSS_BUDGET_SETTING = "boss.budget";
export const BOSS_DEFAULT_MONTHLY_CENTS = 1000;
/** `Setting` : confirmation en attente (`BossPending`), une seule à la fois. */
export const BOSS_PENDING_SETTING = "boss.pending";
/** Une confirmation expire après 10 minutes. */
export const BOSS_PENDING_TTL_MS = 10 * 60_000;
/** Mémoire envoyée à l'IA : 20 tours au plus, 24 heures au plus. */
export const BOSS_MEMORY_TURNS = 20;
export const BOSS_MEMORY_HOURS = 24;
/** Boutons de confirmation : `bsc:<pendingId>:yes|no`. */
export const BOSS_CALLBACK_PREFIX = "bsc:";

export type BossSource = "text" | "voice" | "button";

export type BossInput = {
  /** Texte de l'admin, ou transcription d'un vocal (`source: "voice"`, jamais pris pour un secret). */
  text: string;
  messageId: number;
  replyToMessageId?: number | null;
  source: BossSource;
  entities?: readonly TelegramTextEntity[] | null;
  /** Vocal : transcription brute (pour un « oui » strict). */
  spokenText?: string;
  /**
   * Message transféré (ou contenu venant d'ailleurs) : ce sont des DONNÉES. Jamais exécuté ; le Boss répond qu'il a
   * bien reçu un message transféré et ne fait rien (règle 7).
   */
  forwarded?: boolean;
};

export type BossReply = {
  /** HTML Telegram, 6 lignes au plus en général. */
  reply?: string;
  buttons?: AdminButton[][];
  /** Le message de l'admin contenait un secret : à supprimer de la conversation. */
  deleteMessage?: boolean;
  /** À appeler APRÈS l'envoi de la réponse (question suivante, par exemple). */
  followUp?: () => Promise<void>;
  /**
   * Message de confirmation : le bot doit appeler `rememberBossPendingMessage(deps, pendingId, messageId)` avec
   * l'identifiant du message envoyé (boutons OUI / NON).
   */
  pendingId?: string;
};

/** Résultat du chemin rapide : réponse immédiate, ou passage à l'interprète (tâche `boss-text` du worker). */
export type BossFastResult = (BossReply & { handled: true }) | { handled: false; needsAi: true };

/** Interprète injecté : un appel d'outil au plus. Les tests utilisent `createFakeBossLlm` (aucun réseau). */
export type BossLlm = {
  interpret(req: { system: string; user: string; tools: AiToolDef[] }): Promise<{
    toolUse: AiToolUse | null;
    text: string;
    costCents: number;
  }>;
  /** Rédaction d'une réponse courte à partir d'un JSON de chiffres (contrôlée ensuite : aucun chiffre inventé). */
  write(req: { system: string; user: string }): Promise<{ text: string; costCents: number }>;
};

export type BossDeps = AgentsDeps & {
  /** Interprète ; null = pas de clé IA (ou plafond atteint) : seules les commandes exactes marchent, le Boss le dit. */
  llm?: BossLlm | null;
};

/** Classe d'une action (règle 4). */
export type BossActionClass = "immediate" | "confirm";

/** Thème d'une action (aide groupée par thème). */
export type BossTheme =
  | "etat"
  | "chiffres"
  | "demandes"
  | "equipes"
  | "canaux"
  | "rencontres"
  | "casino"
  | "paris"
  | "algorithme"
  | "ads"
  | "tests"
  | "guide";

/** Acteur journalisé (`AuditLog` action `boss.<clé>`, utilisateur = l'ADMIN lié au compte Telegram). */
export type BossActor = { userId: string | null; via: "TELEGRAM" };

/** Entrée du catalogue fermé. `params` : schéma JSON strict (envoyé à l'IA) ; `parse` : validation par le code. */
export type BossAction<P = Record<string, unknown>> = {
  key: string;
  /** Une ligne en français (aide et description de l'outil). */
  description: string;
  theme: BossTheme;
  /** Classe de base ; `classify` peut la préciser selon les paramètres (baisse = immédiate, hausse = à confirmer). */
  cls: BossActionClass;
  params: Record<string, unknown>;
  parse(input: unknown): { ok: true; params: P } | { ok: false; error: string };
  classify?(deps: BossDeps, params: P): Promise<BossActionClass>;
  /** Résumé en 2 lignes affiché avant OUI / NON (actions à confirmer). */
  summarize?(deps: BossDeps, params: P): Promise<string>;
  /** Exécute par les fonctions existantes ; rend la réponse (1 ou 2 lignes) ou une question de précision. */
  execute(deps: BossDeps, params: P, actor: BossActor): Promise<BossReply>;
};

/** Confirmation en attente (`Setting` `boss.pending`). */
export type BossPending = {
  id: string;
  actionKey: string;
  params: Record<string, unknown>;
  summary: string;
  createdAt: string;
  expiresAt: string;
  messageId?: number | null;
};

/** Une étape du démarrage guidé (ordre de `docs/A-FAIRE-HUMAIN.md`). */
export type BossSetupStep = {
  key: string;
  label: string;
  done: boolean;
  /** Pourquoi et quoi répondre (une ligne). */
  why: string;
};

/**
 * Phase 26, section 4 — Kevin en équipe (ajout au contrat). Nom affiché : `Setting boss.name` (« Kevin » par défaut) ;
 * dans le code, les identifiants restent `boss`.
 */
export const BOSS_NAME_SETTING = "boss.name";
export const BOSS_DEFAULT_NAME = "Kevin";
/** `Setting` : identifiant du groupe de l'équipe (chaîne d'un BigInt), un seul groupe. */
export const BOSS_GROUP_SETTING = "boss.groupChatId";
/** `Setting` : rapport du matin dans le groupe (`true` par défaut dès qu'un groupe existe). */
export const BOSS_GROUP_MORNING_SETTING = "boss.group.morning";
/** `Setting` : `"group"` (défaut) ou `"private"` : où Kevin pose les questions quand un groupe existe. */
export const BOSS_GROUP_REQUESTS_SETTING = "boss.group.requests";

export type TeamMemberTeam = "dating" | "casino" | "sports" | "algo" | "ads";
export type TeamMemberKind = "media" | "secret" | "choice" | "validation";
export type TeamResponsibilities = { teams: TeamMemberTeam[]; kinds: TeamMemberKind[] };

/** Qui parle à Kevin (résolu par le bot avant tout traitement). Personne d'autre n'est jamais traité. */
export type BossSpeaker =
  | { kind: "admin"; telegramUserId: bigint; firstName: string | null }
  | { kind: "member"; telegramUserId: bigint; memberId: string; role: "ADMIN" | "MANAGER" | "MEMBER"; firstName: string };

/** Où se passe la conversation. */
export type BossChat = { type: "private"; chatId: bigint } | { type: "group"; chatId: bigint };

/**
 * Entrée enrichie pour le groupe et les membres : `BossInput` + qui parle + où. Absents = l'admin en privé (chemin
 * historique). Dans le groupe, seuls les messages qui s'adressent à Kevin arrivent ici (mention, réponse à un de ses
 * messages, son prénom en tête, commande) ; les autres ne quittent jamais la base et ne sont jamais envoyés à l'IA.
 */
export type BossTeamInput = BossInput & {
  speaker?: BossSpeaker;
  chat?: BossChat;
  /** Mentions du message (`@username` ou `text_mention` avec identifiant), pour « voici @lea ». */
  mentions?: { telegramUserId?: bigint | null; username?: string | null; firstName?: string | null }[];
  /** Médias joints (déposés dans le groupe par le responsable : rangés comme en privé par le bot). */
  hasMedia?: boolean;
};
