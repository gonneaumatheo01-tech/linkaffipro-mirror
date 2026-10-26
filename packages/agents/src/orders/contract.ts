/**
 * Phase 33 — contrat FIGÉ des ordres de Kevin (`docs/prompts/35-phase-33-kevin-ordres-equipes.md`). Types et noms
 * partagés par plusieurs chantiers ; ne pas les renommer.
 *
 * Chaîne unique : admin → Kevin (`boss/`) → Grand Chef (`orchestrator/` + `orders/run.ts`) → Chef d'équipe (capacité du
 * registre) → agents → Chef → Grand Chef → Kevin (rapport). Aucun agent ne reçoit d'ordre directement.
 *
 * Qui fournit quoi :
 * - Chantier A, CAPACITÉS ET EXÉCUTION (`orders/registry.ts`, `orders/capabilities/<équipe>.ts`, `sports/themes.json` +
 *   `sports/themes.ts`, `orders/run.ts`, `orders/tick.ts`, dérogations lues par `orchestrator/plan-day.ts`, tâche worker
 *   `orders-tick`) : `listCapabilities`, `capability`, `runOrder`, `stopOrder`, `tickOrders`, `activeOverridesFor`.
 * - Chantier B, KEVIN ET ORDRES (`orders/planner.ts`, `orders/validate.ts`, `orders/recap.ts`, `orders/reports.ts`,
 *   `orders/unmet.ts`, `boss/catalog-orders.ts`, outil `ordre_equipe` dans `boss/interpret.ts`) : `planOrder`,
 *   `validatePlan`, `orderRecap`, `submitOrder`, `orderDailyReports`, rapports début / jour / fin, commandes sur les
 *   ordres, bilan hebdomadaire des demandes impossibles.
 * - Chantier C, VOIR ET PARLER AUX AGENTS (`orders/view/*`, `orders/agents-dict.ts`, `boss/catalog-view.ts`) :
 *   `agentDirectory`, `findAgent`, `viewPlan`, `viewScheduled`, `viewDone`, `whyNothing`, `previewSportsPicks`,
 *   `viewMatches`.
 * - Chantier D, VOIX DE KEVIN (`boss/voice.ts`, `docs/KEVIN-VOIX.md`, réécriture des textes fixes de `boss/*`).
 * - Chantier E, SITE ET DOCS (page Agents → Ordres, encart de la fiche canal, guide, `docs/AGENTS-ARCHITECTURE.md`).
 */
import type { AgentsDeps, TeamKey } from "../types";

/** Équipes « ordonnables » (les phases 28 à 32 en ajoutent : montage (phase 28), analystes, qa, prospection). */
export type OrderTeamKey = TeamKey | "ads" | "inspiration" | "transverse" | "montage" | "analystes" | "qa" | "prospection";

export type OrderKind = "PROGRAM" | "ONE_SHOT" | "ADJUST" | "ASK" | "WHAT_IF";
export type OrderMode = "simulation" | "real";

/** Solution de repli proposée quand une partie est impossible (choix numérotés). */
export type Alternative = {
  /** Libellé en français courant (« thème corners », « 1 post par jour au lieu de 5 »). */
  label: string;
  /** Capacité et paramètres qui réaliseraient ce repli (rejouables sans IA si l'admin répond par le numéro). */
  capability?: { teamKey: OrderTeamKey; key: string; params: Record<string, unknown> };
};

/** Ce qui n'a pas pu être pris, avec la raison (en français) et 2 à 4 replis. */
export type ImpossiblePart = { part: string; reason: string; alternatives: Alternative[] };

/** Portée d'un ordre. */
export type OrderScope =
  | { channelIds: string[] }
  | { test: true }
  | { teamWide: true };

/** Période : début (AAAA-MM-JJ, Paris) et nombre de jours (1 à 30). */
export type OrderPeriod = { start: string; days: number };

/** Une étape du plan = une capacité du registre avec ses paramètres. */
export type OrderStepPlan = { capability: string; teamKey: OrderTeamKey; params: Record<string, unknown> };

/** Valeur résolue et sa provenance (« défaut du système », « catégorie active », « demande »…). */
export type ResolvedValue = { value: unknown; from: string };

/** Plan d'un ordre (sortie du planificateur, puis revalidé par le code). */
export type OrderPlan = {
  teamKey: OrderTeamKey;
  /** « Faire comme si » : le canal Test traité comme un canal de cette équipe pendant la période. */
  asIfTeamKey?: TeamKey | null;
  scope: OrderScope;
  kind: OrderKind;
  period?: OrderPeriod | null;
  perDay?: number | null;
  theme?: string | null;
  categoryId?: string | null;
  format?: string | null;
  mode: OrderMode;
  steps: OrderStepPlan[];
  resolved: Record<string, ResolvedValue>;
  /** Une question au plus quand une valeur manque vraiment. */
  questions: string[];
  impossible: ImpossiblePart[];
};

/** Ce qu'une étape créera (sans rien écrire) : dérogations, missions, réglages. */
export type OrderStep = {
  /** Clé stable (idempotence par `(orderId, stepKey)`). */
  stepKey: string;
  capability: string;
  teamKey: OrderTeamKey;
  /** Description en français courant pour le récapitulatif (« 2 paris par jour sur le canal Test, du 25 au 27 »). */
  summary: string;
  /** Dérogation(s) de plan à poser (forme de `ChannelPlanOverride` sans id / orderId). */
  overrides?: Array<{
    channelId: string;
    teamKey: TeamKey;
    fromDay: string;
    toDay: string;
    postsPerDay?: number | null;
    picksPerDay?: number | null;
    betCategoryId?: string | null;
    themes?: string[] | null;
    mix?: Record<string, number> | null;
    format?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    personaId?: string | null;
    isTest?: boolean;
  }>;
  /** Ce qui a été ramené dans une borne (« 50 posts par jour → 12, le maximum du canal »). */
  clamped?: string[];
  /** Dépense chez un fournisseur (vidéo, photo, cotes) estimée en centimes, si connue. */
  costCents?: number;
  /**
   * Ce que l'étape TOUCHE (relecture du 25 octobre) : seule base de la classe de confirmation (`classifyOrder`), jamais
   * la portée donnée par l'IA. `channelIds` = canaux écrits (canal Test compris), `teamWide` = toute une équipe (mots
   * interdits, réglage de l'Algorithme, mode, reprise), `testOnly` = rien hors du canal Test, `days` = durée réelle de
   * ce qui est lancé (test A/B), `setting` = réglage durable (réservé à l'admin). `{ channelIds: [] }` = lecture seule.
   * Absent (et sans dérogation) = inconnu → confirmation.
   */
  touches?: { channelIds: string[]; teamWide?: boolean; testOnly?: boolean; days?: number; setting?: boolean };
  params: Record<string, unknown>;
};

export type StepResult = { ok: boolean; message: string; missionIds?: string[]; postIds?: string[]; retryable?: boolean };

/** Chiffres pour les messages de Kevin (aucun chiffre ailleurs : règle « aucun chiffre inventé »). */
export type OrderFacts = Record<string, unknown>;

export type CapabilityCheck =
  | { ok: true }
  | { ok: false; reason: string; alternatives: Alternative[] };

/** Contexte passé à `plan` (horloge, ordre en cours de préparation). */
export type CapabilityPlanContext = { now: Date; orderId?: string | null; mode: OrderMode; period?: OrderPeriod | null };

/** Ordre tel que lu en base (forme minimale utile aux capacités). */
export type OrderRow = {
  id: string;
  number: number;
  teamKey: string;
  kind: OrderKind;
  status: string;
  interpretation: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
  chatId: string | null;
  createdById: string | null;
  progress: unknown;
};

/** Une capacité = ce qu'une équipe sait faire, déclaré en code (règle 2 : seule vérité). */
export type Capability<P = Record<string, unknown>> = {
  teamKey: OrderTeamKey;
  key: string;
  /** Une ligne en français (montrée à l'IA et dans l'aide). */
  description: string;
  /** Agents concernés (annuaire `agents-dict.ts`) : « redaction », « cotes », « capture »… */
  agents: string[];
  /** Schéma JSON strict des paramètres (envoyé au planificateur). */
  params: Record<string, unknown>;
  parse(input: unknown): { ok: true; params: P } | { ok: false; error: string };
  limits: { maxDays?: number; maxPerDay?: number; channels?: "any" | "team" | "test"; modes: OrderMode[] };
  /** Vérifie le réel (thème ↔ marché, persona existe, stock de médias, fenêtre…). */
  check(deps: AgentsDeps, p: P): Promise<CapabilityCheck>;
  /** Ce qui sera créé, SANS RIEN ÉCRIRE. */
  plan(deps: AgentsDeps, p: P, ctx: CapabilityPlanContext): Promise<OrderStep[]>;
  /** Écrit (reprenable : idempotent par `(orderId, stepKey)`). */
  run(deps: AgentsDeps, order: OrderRow, step: OrderStep): Promise<StepResult>;
  /** Chiffres pour les rapports de Kevin. */
  report(deps: AgentsDeps, order: OrderRow): Promise<OrderFacts>;
};

/** Bornes générales des ordres (règle 6). */
export const ORDER_LIMITS = {
  maxDays: 30,
  /** Au-delà, confirmation OUI obligatoire. */
  confirmOverDays: 7,
  /** « Annule » arrête un ordre immédiat avant sa première mission pendant 60 s. */
  immediateCancelMs: 60_000,
  /** Plan réutilisé pour une demande identique (texte normalisé). */
  planCacheMs: 24 * 3600_000,
  /** Kevin prévient au-delà de 2 échecs sur un ordre. */
  failuresBeforeWarning: 2,
} as const;

/** Budget de Kevin relevé (règle 8) : 30 € par mois par défaut, alerte à 80 %. */
export const BOSS_ORDERS_DEFAULT_MONTHLY_CENTS = 3000;
