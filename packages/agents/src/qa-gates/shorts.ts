/**
 * Phase 30, chantier B — QA Global des shorts (équipe Montage) : après le QC Montage (ffprobe + lisibilité), juste
 * avant l'aperçu au client (`onPreviewReady`). Jamais d'aperçu, ni de publication, sans approbation.
 * - approuvé → l'aperçu part ;
 * - refusé → QC_FAILED avec le motif, puis retour à l'Habillage (REDO : sous-titres refaits si le motif les vise) ;
 * - 3e refus → QC_FAILED, Kevin demande au client de trancher (« Publier quand même » / « Non ») ;
 * - indisponible → rien n'est montré, l'aperçu est relu 5 minutes plus tard (jamais approuvé par défaut).
 * Contenu vérifié : durée, format, résolution, sous-titres SRT, texte incrusté, version du short (fichier rangé).
 */
import { agentEvent, nowOf } from "../admin/journal";
import type { QaContent, QaDeps } from "../qa/contract";
import type { AgentsDeps } from "../types";
import { contentHash, findApproval } from "../qa/index";
import { askQaDecision, clientOverride, correctionLines, qaGate, registerQaDecisionHandler, shortMotif } from "./gate";

export const SHORT_QA_RETRY_MS = 5 * 60_000;

type ClipLike = {
  id: string;
  montageJobId: string;
  index: number;
  status: string;
  durationMs: number;
  format: string;
  subtitles: boolean;
  subtitlesSrt: string | null;
  overlayText: string | null;
  description?: string | null;
  assetId: string | null;
  redoCount?: number | null;
  qc?: unknown;
};

export type ShortQaInput = {
  clip: ClipLike;
  asset: { width?: number | null; height?: number | null; size?: number | null } | null;
  theme?: string | null;
};

/** Contenu vérifié d'un short (le fichier rangé fait partie de l'empreinte : un short refait est revérifié). */
export function shortQaContent(i: ShortQaInput): QaContent {
  const w = i.asset?.width ?? 0;
  const h = i.asset?.height ?? 0;
  return {
    durationMs: i.clip.durationMs,
    format: i.clip.format,
    resolution: w && h ? `${w}x${h}` : null,
    width: w || null,
    height: h || null,
    sizeBytes: i.asset?.size ?? null,
    subtitlesSrt: i.clip.subtitles ? (i.clip.subtitlesSrt ?? null) : null,
    overlayText: i.clip.overlayText ?? null,
    description: i.clip.description ?? null,
    assetId: i.clip.assetId,
    version: i.clip.redoCount ?? 0,
  };
}

export type ShortGateActions = {
  /** Retour à l'Habillage (REDO) avec une note ; `resetSubtitles` : les sous-titres sont refaits. */
  redo(note: string, resetSubtitles: boolean): Promise<void>;
  /** Nouvelle lecture de l'aperçu plus tard (QA indisponible). */
  retryLater(delayMs: number): Promise<void>;
  /** Short en QC_FAILED avec ces motifs (sans prévenir le client : la suite le fait). */
  markFailed(problems: string[], qa: Record<string, unknown>): Promise<void>;
};

export type ShortGateResult = { go: true } | { go: false; outcome: string };

/** Verrou avant l'aperçu. Ne lève jamais. */
export async function gateShortPreview(deps: QaDeps, input: ShortQaInput, actions: ShortGateActions): Promise<ShortGateResult> {
  const content = shortQaContent(input);
  const gate = await qaGate(deps, {
    contentType: "SHORT",
    contentId: input.clip.id,
    teamKey: "montage",
    content,
    context: { qcReport: input.clip.qc ?? null, theme: input.theme ?? null },
  });
  if (gate.kind === "approved") return { go: true };
  if (gate.kind === "unavailable") {
    await actions.retryLater(SHORT_QA_RETRY_MS).catch((err: unknown) => deps.logger?.warn({ err: (err as Error).message, clipId: input.clip.id }, "[qa] aperçu non reprogrammé"));
    return { go: false, outcome: "contrôle qualité global indisponible : aperçu retenu, nouvel essai dans 5 minutes" };
  }
  const motifs = correctionLines(gate.result);
  const problems = [`contrôle qualité global : ${shortMotif(gate.result)}`];
  await actions.markFailed(problems, { checkId: gate.result.checkId, attempt: gate.result.attempt, corrections: motifs });
  if (gate.needsHuman) {
    await askQaDecision(deps, {
      contentType: "SHORT",
      contentId: input.clip.id,
      teamKey: "montage",
      hash: gate.hash,
      label: `le short ${input.clip.index}`,
      result: gate.result,
      extra: { montageJobId: input.clip.montageJobId },
    });
    return { go: false, outcome: "refusé 3 fois par le contrôle qualité global : le client tranche" };
  }
  const subtitleIssue = gate.result.reasons.some((r) => r.code === "SUBTITLE_ERROR") || gate.result.corrections.some((c) => /sous-titre|srt|subtitle/i.test(c.field));
  try {
    await actions.redo(motifs.join(" ; ").slice(0, 480) || problems[0]!, subtitleIssue);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, clipId: input.clip.id }, "[qa] short non renvoyé à l'Habillage");
  }
  await agentEvent(deps, "qa.short.redo", { clipId: input.clip.id, jobId: input.clip.montageJobId, subtitles: subtitleIssue });
  return { go: false, outcome: "refusé par le contrôle qualité global : retour à l'Habillage" };
}

/** Le short exact a-t-il l'approbation du QA (ou l'accord du client) ? Lecture seule, sans appel au modèle. */
export async function shortPreviewApproved(deps: QaDeps, clip: ClipLike, asset: ShortQaInput["asset"]): Promise<boolean> {
  try {
    const content = shortQaContent({ clip, asset });
    if (await clientOverride(deps, "SHORT", clip.id, contentHash(content))) return true;
    return (await findApproval(deps, "SHORT", clip.id, content)) !== null;
  } catch {
    return false;
  }
}

/** Short à vérifier avant de le montrer : remis au contrôle, l'aperçu part par la chaîne s'il est approuvé. */
export async function requestShortCheck(deps: AgentsDeps, clip: Pick<ClipLike, "id" | "montageJobId" | "redoCount">): Promise<void> {
  await deps.prisma.shortClip.updateMany({ where: { id: clip.id, status: "QC_FAILED" }, data: { status: "QC" } });
  // Montage clos entre-temps (tous ses shorts tranchés, celui-ci compris) : rouvert pour l'aperçu de ce short.
  await deps.prisma.montageJob.updateMany({ where: { id: clip.montageJobId, status: "DONE" }, data: { status: "PREVIEW", completedAt: null } });
  const enqueue = (deps as AgentsDeps & { montage?: { enqueue?: MontageEnqueueLike } }).montage?.enqueue;
  await enqueue?.({ type: "montage.preview", montageJobId: clip.montageJobId, shortClipId: clip.id }, { jobId: `montage-${clip.id}-preview-v${clip.redoCount ?? 0}-qa${nowOf(deps).getTime()}` });
}

type MontageEnqueueLike = (job: { type: "montage.preview"; montageJobId: string; shortClipId: string }, opts?: { jobId?: string; delayMs?: number }) => Promise<void>;

registerQaDecisionHandler("SHORT", {
  async onApprove(deps, d) {
    const clip = (await deps.prisma.shortClip.findUnique({ where: { id: d.contentId } })) as { id: string; montageJobId: string; status: string; assetId: string | null; redoCount: number | null } | null;
    if (!clip || clip.status !== "QC_FAILED" || !clip.assetId) return;
    // L'accord vaut pour ce short exact : l'aperçu repart (la vérification trouvera l'accord pour son empreinte).
    await requestShortCheck(deps, clip);
  },
  async onDrop(deps, d) {
    await deps.prisma.shortClip.updateMany({ where: { id: d.contentId, status: { in: ["QC_FAILED", "QC"] } }, data: { status: "REJECTED", clientFeedback: "abandonné par le client après 3 refus du contrôle qualité global" } });
  },
});
