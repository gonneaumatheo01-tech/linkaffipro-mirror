/**
 * Phase 28, chantier E — ce que Kevin dit du montage, en LECTURE SEULE : « où en est le montage ? » (`montageStatus`),
 * « montre-moi les shorts » (`montageView`), et la fiche de chaque agent de l'équipe Montage (Réception, Découpe,
 * Monteur, Habillage, Contrôle qualité montage) : ce qu'il a fait ce jour-là et ce qu'il a à faire (`montageAgentCard`).
 * Seule source des chiffres : `MontageJob` et `ShortClip` en base.
 */
import { esc, nowOf } from "../admin/journal";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import { fromParis, addDaysToDay, parisDay } from "../rules/time";
import type { AgentsDeps } from "../types";
import { clockOf, durationLabel } from "./plan-message";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Où en est un travail, en mots (pas de statut technique en surface). */
export const JOB_STATUS_LABELS: Record<string, string> = {
  PENDING: "en attente de démarrage",
  ANALYZING: "j'analyse la vidéo",
  PLAN_SENT: "plan envoyé, j'attends ta réponse",
  CUTTING: "les shorts sont en fabrication",
  DRESSING: "j'ajoute les sous-titres et le texte",
  QC: "je vérifie les shorts",
  PREVIEW: "aperçus envoyés, j'attends tes réponses",
  APPROVED: "terminé",
  DONE: "terminé",
  FAILED: "raté",
  CANCELLED: "annulé",
};

export const CLIP_STATUS_LABELS: Record<string, string> = {
  PLANNED: "prévu",
  CUTTING: "en fabrication",
  DRESSING: "sous-titres en cours",
  QC: "en vérification",
  QC_FAILED: "contrôle raté, j'attends ta réponse",
  PREVIEW_SENT: "aperçu envoyé, à valider",
  APPROVED: "validé",
  REJECTED: "refusé",
  REDO: "en cours de retouche",
  CANCELLED: "annulé",
};

export const VIEW_VARIANTS = {
  noJob: [
    "Aucun montage pour le moment. Envoie-moi une vidéo avec tes consignes, par exemple « découpe ça en shorts de 15 secondes ».",
    "Pas de montage en cours. Envoie-moi une vidéo et dis-moi ce que tu veux, par exemple « fais des shorts pour TikTok ».",
  ],
  status: voiceTemplate<{ source: string; state: string; counts: string }>(
    [
      { source: "ta vidéo de 47 min", state: "aperçus envoyés, j'attends tes réponses", counts: "12 shorts : 5 validés, 1 refusé, 6 à valider" },
      { source: "ta vidéo", state: "j'analyse la vidéo", counts: "pas encore de short" },
    ],
    (p) => [`Montage de ${p.source} : ${p.state}.\n${p.counts}.`, `Pour ${p.source} : ${p.state}.\n${p.counts}.`],
  ),
  view: voiceTemplate<{ source: string; lines: string }>(
    [{ source: "ta vidéo de 47 min", lines: "1. 2:30-2:45 — Gros gain à la roulette : validé\n2. 5:10-5:25 — Série de mises : aperçu envoyé, à valider" }],
    (p) => [`Les shorts de ${p.source} :\n${p.lines}`, `Où en sont les shorts de ${p.source} :\n${p.lines}`],
    { allowList: true, allowLong: true },
  ),
} satisfies VoiceTable;

type JobRow = { id: string; status: string; chatId: string | null; sourceMeta: unknown; createdAt: Date; updatedAt: Date; planMsgId?: unknown; completedAt?: Date | null };
type ClipRow = {
  id: string;
  montageJobId: string;
  index: number;
  startMs: number;
  endMs: number;
  description: string | null;
  status: string;
  assetId: string | null;
  subtitles: boolean;
  subtitlesSrt: string | null;
  subtitlesPending: unknown;
  updatedAt: Date;
  createdAt: Date;
};

/** Travail le plus récent (de la conversation si connue), ou null. */
export async function latestJob(deps: Pick<AgentsDeps, "prisma">, chatId?: string | null): Promise<JobRow | null> {
  const rows = (await deps.prisma.montageJob.findMany({ where: chatId ? { chatId } : {}, orderBy: { createdAt: "desc" }, take: 1 })) as JobRow[];
  if (rows[0]) return rows[0];
  if (!chatId) return null;
  return ((await deps.prisma.montageJob.findMany({ orderBy: { createdAt: "desc" }, take: 1 })) as JobRow[])[0] ?? null;
}

/** Travail en cours (pas fini, pas annulé, pas raté) le plus récent, ou null. */
export async function activeJob(deps: Pick<AgentsDeps, "prisma">, chatId?: string | null): Promise<JobRow | null> {
  const rows = (await deps.prisma.montageJob.findMany({
    where: { status: { notIn: ["DONE", "APPROVED", "FAILED", "CANCELLED"] }, ...(chatId ? { chatId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 1,
  })) as JobRow[];
  return rows[0] ?? null;
}

function sourceLabel(job: JobRow): string {
  const meta = job.sourceMeta as { durationMs?: unknown } | null;
  const d = meta && typeof meta.durationMs === "number" ? durationLabel(meta.durationMs / 1000) : null;
  return d ? `ta vidéo de ${d}` : "ta vidéo";
}

/** Comptes des shorts d'un travail (pur). */
export function clipCounts(clips: readonly Pick<ClipRow, "status">[]) {
  const live = clips.filter((c) => c.status !== "CANCELLED");
  const n = (s: string[]) => live.filter((c) => s.includes(c.status)).length;
  return {
    total: live.length,
    approved: n(["APPROVED"]),
    rejected: n(["REJECTED"]),
    toValidate: n(["PREVIEW_SENT", "QC_FAILED"]),
    inProgress: n(["PLANNED", "CUTTING", "DRESSING", "QC", "REDO"]),
  };
}

function countsText(c: ReturnType<typeof clipCounts>): string {
  if (!c.total) return "pas encore de short";
  const bits: string[] = [];
  if (c.approved) bits.push(plural(c.approved, "validé", "validés"));
  if (c.rejected) bits.push(plural(c.rejected, "refusé", "refusés"));
  if (c.toValidate) bits.push(`${c.toValidate} à valider`);
  if (c.inProgress) bits.push(`${c.inProgress} en fabrication`);
  return `${plural(c.total, "short")}${bits.length ? ` : ${bits.join(", ")}` : ""}`;
}

export type MontageViewResult = { facts: Record<string, unknown>; text: string; jobId: string | null };

/** « Où en est le montage ? » : le travail le plus récent, son état et ses shorts. */
export async function montageStatus(deps: AgentsDeps, chatId?: string | null): Promise<MontageViewResult> {
  const job = (await activeJob(deps, chatId)) ?? (await latestJob(deps, chatId));
  if (!job) return { facts: { montage: null }, text: pick(VIEW_VARIANTS.noJob, "montage.view.none", chatId ?? null), jobId: null };
  const clips = (await deps.prisma.shortClip.findMany({ where: { montageJobId: job.id } })) as ClipRow[];
  const counts = clipCounts(clips);
  const state = JOB_STATUS_LABELS[job.status] ?? "en cours";
  return {
    facts: { montage: { etat: state, ...counts } },
    text: pick(VIEW_VARIANTS.status({ source: sourceLabel(job), state, counts: countsText(counts) }), "montage.view.status", chatId ?? null),
    jobId: job.id,
  };
}

/** « Montre-moi les shorts » : chaque short du travail le plus récent, avec son état. */
export async function montageView(deps: AgentsDeps, chatId?: string | null): Promise<MontageViewResult> {
  const job = (await activeJob(deps, chatId)) ?? (await latestJob(deps, chatId));
  if (!job) return { facts: { montage: null }, text: pick(VIEW_VARIANTS.noJob, "montage.view.none", chatId ?? null), jobId: null };
  const clips = ((await deps.prisma.shortClip.findMany({ where: { montageJobId: job.id }, orderBy: { index: "asc" } })) as ClipRow[]).filter((c) => c.status !== "CANCELLED");
  if (!clips.length) return montageStatus(deps, chatId);
  const lines = clips
    .slice(0, 25)
    .map((c) => `${c.index}. ${clockOf(c.startMs)}-${clockOf(c.endMs)} — ${esc((c.description ?? "Moment retenu").slice(0, 80))} : ${CLIP_STATUS_LABELS[c.status] ?? "en cours"}`)
    .join("\n");
  return {
    facts: { montage: { etat: JOB_STATUS_LABELS[job.status] ?? "en cours", shorts: clips.map((c) => ({ numero: c.index, etat: CLIP_STATUS_LABELS[c.status] ?? c.status })) } },
    text: pick(VIEW_VARIANTS.view({ source: sourceLabel(job), lines }), "montage.view.list", chatId ?? null),
    jobId: job.id,
  };
}

// ------------------------------------------------------------------------------------------------ fiches des agents

/** Clés des agents de l'équipe Montage dans l'annuaire (`orders/agents-dict.ts`). */
export const MONTAGE_AGENT_KEYS = ["chef-montage", "montage-reception", "montage-decoupe", "montage-monteur", "montage-habillage", "montage-controle"] as const;
export type MontageAgentKey = (typeof MONTAGE_AGENT_KEYS)[number];

export function isMontageAgentKey(k: string): k is MontageAgentKey {
  return (MONTAGE_AGENT_KEYS as readonly string[]).includes(k);
}

const inRange = (d: Date, from: Date, to: Date) => d.getTime() >= from.getTime() && d.getTime() < to.getTime();

/**
 * Ce qu'un agent du montage a fait ce jour-là et ce qu'il a à faire (lecture seule). `day` : AAAA-MM-JJ (Paris),
 * aujourd'hui par défaut.
 */
export async function montageAgentCard(deps: AgentsDeps, key: MontageAgentKey, day?: string | null): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const now = nowOf(deps);
  const d = day ?? parisDay(now);
  const from = fromParis(d, 0);
  const to = fromParis(addDaysToDay(d, 1), 0);
  const jobs = (await deps.prisma.montageJob.findMany({ orderBy: { createdAt: "desc" }, take: 50 })) as JobRow[];
  const clips = jobs.length ? ((await deps.prisma.shortClip.findMany({ where: { montageJobId: { in: jobs.map((j) => j.id) } } })) as ClipRow[]) : [];
  const today = d === parisDay(now) ? "Aujourd'hui" : `Le ${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const touched = (c: ClipRow) => inRange(c.updatedAt, from, to);
  const facts: Record<string, unknown> = { jour: d };
  const lines: string[] = [];
  switch (key) {
    case "montage-reception": {
      const got = jobs.filter((j) => inRange(j.createdAt, from, to)).length;
      const waiting = jobs.filter((j) => j.status === "PENDING").length;
      facts.fait = { videos: got };
      facts.aFaire = { enAttente: waiting };
      lines.push(`${today} : ${got ? `${plural(got, "vidéo reçue", "vidéos reçues")} et lancée${got > 1 ? "s" : ""}` : "aucune vidéo reçue"}.`);
      lines.push(waiting ? `${plural(waiting, "vidéo attend", "vidéos attendent")} de démarrer.` : "Rien en attente.");
      break;
    }
    case "montage-decoupe": {
      const plans = jobs.filter((j) => inRange(j.updatedAt, from, to) && !["PENDING", "ANALYZING"].includes(j.status)).length;
      const analyzing = jobs.filter((j) => j.status === "PENDING" || j.status === "ANALYZING").length;
      const waitingAnswer = jobs.filter((j) => j.status === "PLAN_SENT").length;
      facts.fait = { plans };
      facts.aFaire = { analyses: analyzing, plansSansReponse: waitingAnswer };
      lines.push(`${today} : ${plans ? `${plural(plans, "plan de coupe proposé", "plans de coupe proposés")}` : "aucun plan de coupe proposé"}.`);
      lines.push(analyzing ? `${plural(analyzing, "vidéo", "vidéos")} à analyser.` : waitingAnswer ? `${plural(waitingAnswer, "plan attend", "plans attendent")} ta réponse.` : "Rien à analyser.");
      break;
    }
    case "montage-monteur": {
      const made = clips.filter((c) => touched(c) && c.assetId && !["PLANNED", "CUTTING", "REDO"].includes(c.status)).length;
      const todo = clips.filter((c) => ["PLANNED", "CUTTING", "REDO"].includes(c.status)).length;
      facts.fait = { shorts: made };
      facts.aFaire = { shorts: todo };
      lines.push(`${today} : ${made ? `${plural(made, "short monté", "shorts montés")}` : "aucun short monté"}.`);
      lines.push(todo ? `${plural(todo, "short", "shorts")} à monter ou à retoucher.` : "Rien à monter.");
      break;
    }
    case "montage-habillage": {
      const dressed = clips.filter((c) => touched(c) && c.subtitles && !!c.subtitlesSrt).length;
      const doubts = clips.filter((c) => c.subtitlesPending && (Array.isArray(c.subtitlesPending) ? c.subtitlesPending.length > 0 : true) && c.status === "DRESSING").length;
      const todo = clips.filter((c) => c.status === "DRESSING").length;
      facts.fait = { sousTitres: dressed };
      facts.aFaire = { shorts: todo, doutes: doubts };
      lines.push(`${today} : ${dressed ? `sous-titres posés sur ${plural(dressed, "short")}` : "aucun sous-titre posé"}.`);
      lines.push(doubts ? `${plural(doubts, "passage attend", "passages attendent")} ta réponse.` : todo ? `${plural(todo, "short", "shorts")} à habiller.` : "Rien à habiller.");
      break;
    }
    case "montage-controle": {
      const checked = clips.filter((c) => touched(c) && ["PREVIEW_SENT", "APPROVED", "REJECTED", "QC_FAILED"].includes(c.status)).length;
      const failed = clips.filter((c) => touched(c) && c.status === "QC_FAILED").length;
      const todo = clips.filter((c) => c.status === "QC").length;
      facts.fait = { verifies: checked, rates: failed };
      facts.aFaire = { shorts: todo };
      lines.push(`${today} : ${checked ? `${plural(checked, "short vérifié", "shorts vérifiés")}${failed ? `, ${failed} pas passé${failed > 1 ? "s" : ""}` : ""}` : "aucun short vérifié"}.`);
      lines.push(todo ? `${plural(todo, "short", "shorts")} à vérifier.` : "Rien à vérifier.");
      break;
    }
    default: {
      const active = jobs.filter((j) => !["DONE", "APPROVED", "FAILED", "CANCELLED"].includes(j.status));
      const counts = clipCounts(clips.filter((c) => active.some((j) => j.id === c.montageJobId)));
      facts.enCours = { montages: active.length, ...counts };
      lines.push(active.length ? `${plural(active.length, "montage en cours", "montages en cours")}, ${countsText(counts)}.` : "Aucun montage en cours.");
    }
  }
  return { facts, lines };
}
