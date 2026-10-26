/**
 * Phase 30 — contrat FIGÉ du QA Global (`docs/prompts/32-phase-30-qa-global.md`). Types, noms et limites partagés par
 * plusieurs chantiers ; ne pas les renommer.
 *
 * Décisions (voir `docs/DECISIONS-TECH.md`, phase 30) :
 * - Modèle UNIQUE `claude-fable-5-1` (accès vérifié en production le 26 octobre : ~1,3 s par vérification courte).
 *   Aucun repli : ni vers un autre modèle, ni par l'option `fallbacks` de l'API (jamais déclarée). Fable 5.1 refuse la
 *   température (400) : la rigueur vient de la consigne, de `output_config.effort` et de la sortie JSON validée par le
 *   code. Un refus du modèle (`stop_reason = "refusal"`), une erreur, un plafond atteint ou un délai dépassé = sortie
 *   BLOQUÉE (`ERROR` / `TIMEOUT`), jamais approuvée.
 * - Portée : tout ce que produisent les AGENTS et l'IA avant de sortir (posts des équipes, shorts, rapports et alertes des
 *   Analystes, recommandations, règles publicitaires, réponses de Kevin rédigées par l'IA). Les contenus écrits par le
 *   client lui-même et les textes fixes de Kevin écrits par le code (confirmations OUI / SUPPRIMER, boutons, accusés)
 *   ne passent pas par le QA : les bloquer arrêterait le système sans rien protéger. Les alertes techniques (worker
 *   arrêté, sauvegarde) ne sont jamais retenues.
 * - Une approbation vaut pour un contenu EXACT (`contentHash`). Le point de sortie (envoi d'un post, aperçu d'un short,
 *   envoi d'un rapport…) vérifie qu'une approbation existe pour l'empreinte actuelle, sinon lance la vérification ;
 *   sans approbation, rien ne sort.
 * - Le QA ne modifie jamais le contenu : il approuve ou refuse avec motifs et corrections ; l'équipe corrige.
 * - Le contenu envoyé au modèle et gardé dans `QaCheck.content` est masqué (`redactForQa` : jetons, clés, mots de passe,
 *   courriels, téléphones, identifiants internes longs) et tronqué.
 *
 * Qui fournit quoi :
 * - Chantier A, MOTEUR (`qa/{qa-global,qa-system-prompt,qa-cross-check,redact,metrics,alerts,diag}.ts`, profil
 *   `qa-global` dans `packages/ai`, `pnpm qa:diag`, fixtures `packages/agents/fixtures/qa/`) : `qaCheck`,
 *   `findApproval`, `requireApproval`, `qaRefusalCount`, `qaStats`, `checkQaAlerts`.
 * - Chantier B, BRANCHEMENTS (posts des équipes + verrou d'envoi du worker, shorts, rapports et alertes des Analystes,
 *   recommandations, règles publicitaires, réponses IA de Kevin, file de rattrapage `qa-sweep`).
 * - Chantier C, KEVIN, SITE ET DOCS (catalogue `qa_status` / `qa_history` / `qa_detail`, capacités, annuaire des
 *   agents, page Agents → Qualité, opérations du site pour Kevin (phase 34), guide, docs).
 */
import type { AgentsDeps } from "../types";

export const QA_MODEL = "claude-fable-5-1" as const;
export const QA_TEAM_KEY = "qa";

export type QaContentType = "POST" | "SHORT" | "REPORT" | "KEVIN_RESPONSE" | "RECOMMENDATION" | "ALERT" | "COMPLIANCE_RULE";
export type QaVerdict = "APPROVED" | "REJECTED" | "TIMEOUT" | "ERROR";
export type QaSeverity = "critical" | "warning";

export type QaReason = { code: string; message: string; severity: QaSeverity };
export type QaCorrection = { field: string; expected: string; got: string; suggestion: string };

/** Codes de refus attendus (le modèle peut en rendre d'autres ; ceux-ci sont reconnus par le code et les tests). */
export const QA_REASON_CODES = [
  "COPY",
  "SENSITIVE_DATA",
  "HALLUCINATION",
  "GAIN_PROMISE",
  "LEGAL_ADVICE",
  "CHANNEL_RULE",
  "COMPLIANCE",
  "CONTRADICTION",
  "INVENTED_NUMBER",
  "UNSOURCED",
  "DEAD_SOURCE",
  "OFF_TOPIC",
  "FALSE_ALERT",
  "SUBTITLE_ERROR",
  "METADATA",
  "AI_MENTION",
  "LANGUAGE",
  "OUT_OF_BOUNDS",
] as const;

/** Réglages (`Setting`) et valeurs par défaut. */
export const QA_SETTINGS = {
  enabled: { key: "qa.enabled", value: true },
  model: { key: "qa.model", value: QA_MODEL },
  timeoutMs: { key: "qa.timeout_ms", value: 30_000 },
  maxAttempts: { key: "qa.max_attempts", value: 3 },
  blockOnUnavailable: { key: "qa.block_on_unavailable", value: true },
  /** Plafond mensuel du QA en centimes (`AgentUsage` équipe qa) ; atteint = sorties bloquées et Kevin prévient. */
  monthlyBudgetCents: { key: "qa.monthly_budget_cents", value: 15_000 },
} as const;

export const QA_LIMITS = {
  /** Sortie du modèle : 2 000 jetons au plus (verdict court). */
  maxTokens: 2000,
  /** Effort de raisonnement par défaut (rapide et sûr) ; « medium » pour les rapports et lots. */
  effort: "low" as "low" | "medium" | "high",
  /** Contenu envoyé au modèle : 40 000 caractères au plus (au-delà : découpé en sous-vérifications). */
  maxContentChars: 40_000,
  /** Contenu gardé dans `QaCheck.content` : 8 000 caractères au plus, masqué. */
  storedContentChars: 8_000,
  /** Réponses de Kevin : pas de QA sous 50 caractères (accusés de réception). */
  kevinMinChars: 50,
  /** Alertes internes : refus > 30 % sur une heure ; latence moyenne > 20 s sur 10 ; modèle indisponible > 5 min. */
  rejectRateAlert: 0.3,
  latencyWarnMs: 20_000,
  latencyWindow: 10,
  unavailableAlertMs: 5 * 60_000,
} as const;

/** Ce qu'on vérifie (le contenu, déjà masqué par l'appelant ou par `qaCheck`). */
export type QaContent = Record<string, unknown>;
/** Contexte croisé chargé par `qa-cross-check.ts` (règles du canal, règles publicitaires, historique…). */
export type QaContext = Record<string, unknown>;

export type QaResult = {
  checkId: string;
  verdict: QaVerdict;
  reasons: QaReason[];
  corrections: QaCorrection[];
  durationMs: number;
  attempt: number;
  /** Vrai si le contenu peut sortir (APPROVED seulement). */
  approved: boolean;
  /** Après `maxAttempts` refus du même contenu : le client doit trancher (Kevin le lui demande). */
  needsHuman: boolean;
};

/** IA du QA injectée (faux en test, aucun réseau) : un appel = un verdict JSON brut + coût. */
export type QaLlm = {
  check(req: { system: string; user: string; effort: "low" | "medium" | "high"; maxTokens: number; signal?: AbortSignal }): Promise<{
    text: string;
    stopReason: string | null;
    model: string;
    costCents: number;
  }>;
};

export type QaDeps = AgentsDeps & { qaLlm?: QaLlm | null };

/** Signatures attendues du chantier A (le chantier B les importe par ces noms). */
export type QaApi = {
  qaCheck(deps: QaDeps, req: { contentType: QaContentType; contentId: string; teamKey: string; content: QaContent; context?: QaContext; effort?: "low" | "medium" | "high" }): Promise<QaResult>;
  /** Dernière approbation pour ce contenu exact (empreinte), ou null. */
  findApproval(deps: QaDeps, contentType: QaContentType, contentId: string, content: QaContent): Promise<{ checkId: string } | null>;
  /** Approbation existante, sinon vérification maintenant ; rend le résultat (le point de sortie n'envoie que si `approved`). */
  requireApproval(deps: QaDeps, req: { contentType: QaContentType; contentId: string; teamKey: string; content: QaContent; context?: QaContext }): Promise<QaResult>;
  qaRefusalCount(deps: QaDeps, contentType: QaContentType, contentId: string): Promise<number>;
};
