/**
 * Phase 28, chantier E — ce que Kevin appelle chez les autres chantiers du montage, derrière un seul port (faux en test) :
 * - chantier C : `parseMontageInstructions` (règles puis Haiku pour l'ambigu) ;
 * - chantier D : `createLongVideoAsset`, `createMontageJob`, `approvePlan`, `redoClip`, `cancelJob`,
 *   `resolveSubtitleDoubt` (chaîne et stockage).
 * Les tests passent `deps.montageKevin` (fonctions remplacées une à une) ; la production prend les vraies.
 * Les formes `PlanEdit` et `ClipChange` (celles de la chaîne) sont ce que Kevin comprend des réponses du client
 * (règles du code d'abord, Haiku si besoin), passées telles quelles.
 */
import type { BossDeps } from "../boss/contract";
import type { LlmProvider } from "../types";
import type { ActorRef } from "../admin/team";
import type { MontageInstructions } from "./contract";
import { parseMontageInstructions } from "./instructions";
import { createLongVideoAsset, sourceRefusal, type LongVideoInput, type LongVideoResult } from "./source";
import {
  approvePlan,
  cancelJob,
  createMontageJob,
  redoClip,
  resolveSubtitleDoubt,
  setClipDecision,
  type MontageClipChange,
  type MontagePlanEdit,
  type PlanEditResult,
} from "./pipeline";
import type { UncertainSegment } from "./contract";
import type { MontageEngine, MontagePipelineDeps } from "./runtime";
import { applyClientCorrection, subtitlesToSrt } from "./subtitles";

/**
 * Ajustement du plan de coupe (« enlève le 3 », « le 2, commence 2 secondes plus tôt », « garde que les 5 meilleurs ») :
 * `shift` décale le début et / ou la fin (ms, négatif = plus tôt), `duration` change la durée ; `index` null = tous.
 */
export type PlanEdit = MontagePlanEdit;

/** Modification d'un short déjà fait (« raccourcis de 2 secondes », « cam en bas à gauche », « sans sous-titres »). */
export type ClipChange = MontageClipChange & { note: string };

export type CreateJobInput = {
  sourceAssetId: string;
  instructions: MontageInstructions;
  chatId: string;
  instructionsMsgId: number | null;
  createdById: string | null;
  universe?: string;
};

type Fail = { ok: false; reason: string };

export type MontageKevinPort = {
  parseInstructions(deps: BossDeps, text: string): Promise<MontageInstructions>;
  createLongVideoAsset(deps: BossDeps, input: LongVideoInput): Promise<LongVideoResult>;
  /** Refus d'une source (trop lourde, trop longue) avant tout enregistrement, ou null. */
  sourceRefusal(input: { sizeBytes?: number | null; durationMs?: number | null }): string | null;
  /** Crée le travail (PENDING) et lance l'analyse ; rend son identifiant. */
  createMontageJob(deps: BossDeps, input: CreateJobInput): Promise<{ id: string }>;
  approvePlan(deps: BossDeps, jobId: string, edits: PlanEdit[], actor?: ActorRef): Promise<PlanEditResult>;
  redoClip(deps: BossDeps, clipId: string, change: ClipChange, actor?: ActorRef): Promise<{ ok: true } | Fail>;
  cancelJob(deps: BossDeps, jobId: string, actor?: ActorRef): Promise<{ ok: true } | Fail>;
  /** Réponse du client à un doute de sous-titre : le passage est corrigé ; tous tranchés → le short repart. */
  resolveSubtitleDoubt(
    deps: BossDeps,
    clipId: string,
    answer: { index: number; text: string },
    actor?: ActorRef,
  ): Promise<{ ok: true; done: boolean; remaining: UncertainSegment[] } | Fail>;
  /** ✅ / ❌ d'un short (statut du travail tenu à jour par la chaîne). */
  setClipDecision(deps: BossDeps, clipId: string, decision: "APPROVED" | "REJECTED", feedback?: string | null): Promise<{ ok: true } | Fail>;
};

/** Dépendances de Kevin pour le montage (au-dessus de celles du Boss). */
export type KevinMontageDeps = BossDeps & {
  /** Fonctions des autres chantiers remplacées (tests). */
  montageKevin?: Partial<MontageKevinPort>;
  /**
   * Envoi d'un short déjà gardé dans Telegram par le bot de Kevin (identifiant de fichier, pas de ré-envoi du fichier).
   * Fourni par `packages/telegram` (`createStoredVideoSender`) ; absent : aperçu en texte avec les mêmes boutons.
   */
  sendStoredVideo?: (req: {
    chatId: string;
    assetId: string;
    fileId?: string | null;
    caption: string;
    buttons?: Array<Array<{ text: string; callbackData: string }>>;
  }) => Promise<{ messageId: number } | null>;
};

/**
 * Hors du worker (webhook du site), la chaîne n'a pas son moteur : la correction d'un sous-titre n'a besoin que des
 * deux fonctions pures des sous-titres (chantier C), branchées ici. La mise en file `agents-montage` vient des
 * dépendances (`montage.enqueue`, posée par le bot et le worker).
 */
function withRuntime(deps: BossDeps): MontagePipelineDeps {
  const d = deps as MontagePipelineDeps;
  if (d.montage?.engine) return d;
  const pure = { applyClientCorrection: (segments, index, choice, uncertain) => applyClientCorrection(segments, index, choice, uncertain ?? null), subtitlesToSrt } as Pick<
    MontageEngine,
    "applyClientCorrection" | "subtitlesToSrt"
  >;
  return { ...d, montage: { ...(d.montage ?? {}), engine: pure as MontageEngine } };
}

/** L'interprète de Kevin vu comme un fournisseur d'IA texte (rédaction courte), ou null sans IA. */
function kevinLlmProvider(deps: BossDeps): LlmProvider | null {
  const llm = deps.llm;
  if (!llm) return null;
  return { complete: async (req) => llm.write({ system: req.system, user: req.user }) };
}

const REAL_PORT: MontageKevinPort = {
  // L'IA de Kevin (Haiku, plafond du Boss) lève les ambiguïtés des consignes : elle sert de fournisseur au chantier C.
  parseInstructions: (deps, text) => parseMontageInstructions({ ...deps, llm: kevinLlmProvider(deps) }, text),
  createLongVideoAsset: (deps, input) => createLongVideoAsset(deps, input),
  sourceRefusal: (input) => sourceRefusal(input),
  createMontageJob: (deps, input) => createMontageJob(deps, input),
  approvePlan: (deps, jobId, edits, actor) => approvePlan(deps, jobId, edits, actor),
  redoClip: (deps, clipId, change, actor) => redoClip(deps, clipId, change, actor),
  cancelJob: (deps, jobId, actor) => cancelJob(deps, jobId, actor),
  resolveSubtitleDoubt: (deps, clipId, answer, actor) => resolveSubtitleDoubt(withRuntime(deps), clipId, answer, actor),
  setClipDecision: (deps, clipId, decision, feedback) => setClipDecision(deps, clipId, decision, feedback),
};

/** Le port de Kevin : les fonctions remplacées par `deps.montageKevin`, sinon les vraies. */
export function montagePort(deps: KevinMontageDeps): MontageKevinPort {
  return { ...REAL_PORT, ...(deps.montageKevin ?? {}) };
}
