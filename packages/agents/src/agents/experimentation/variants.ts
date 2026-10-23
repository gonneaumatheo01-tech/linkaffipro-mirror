/**
 * Variantes des tests A/B (purs) : forme de `Experiment.variants`, tirage de la variante d'une mission, et ce que
 * Planification, Rédaction et Médiathèque doivent appliquer. Une mission participe à un seul test (choisi par une
 * empreinte de son identifiant parmi les tests actifs du canal) : deux tests ne se mélangent jamais dans un même post.
 */
import { hashBucket } from "@linkaffipro/core";

export type ExperimentKindName = "STYLE_LEGENDE" | "HORAIRE" | "MELANGE" | "REGLAGE_PERSONA";
/** Types appliqués aux posts des missions (le réglage de persona concerne les conversations). */
export const POST_EXPERIMENT_KINDS: readonly ExperimentKindName[] = ["STYLE_LEGENDE", "HORAIRE", "MELANGE"];

export type Mix = { video: number; photo: number; text: number };

export type VariantConfig = {
  label: string;
  /** STYLE_LEGENDE : consigne de style ajoutée à la Rédaction. */
  style?: string;
  /** HORAIRE : heure de Paris visée (0-23). */
  hour?: number;
  /** MELANGE : mélange de la variante. */
  mix?: Mix;
  /** REGLAGE_PERSONA : champ et valeur. */
  field?: string;
  value?: unknown;
};

export type Variants = { A: VariantConfig; B: VariantConfig };

/** Test tiré pour une mission (`AgentMission.payload.experiment`). */
export type MissionExperiment = { id: string; kind: ExperimentKindName; variant: "A" | "B"; config: VariantConfig };

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseMix(v: unknown): Mix | undefined {
  const r = record(v);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  const m = { video: n(r.video), photo: n(r.photo), text: n(r.text) };
  return m.video + m.photo + m.text > 0 ? m : undefined;
}

function parseConfig(v: unknown): VariantConfig | null {
  const r = record(v);
  if (typeof r.label !== "string" || !r.label) return null;
  const out: VariantConfig = { label: r.label };
  if (typeof r.style === "string" && r.style.trim()) out.style = r.style.trim().slice(0, 300);
  if (typeof r.hour === "number" && Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23) out.hour = r.hour;
  const mix = parseMix(r.mix);
  if (mix) out.mix = mix;
  if (typeof r.field === "string") out.field = r.field;
  if ("value" in r) out.value = r.value;
  return out;
}

export function parseVariants(v: unknown): Variants | null {
  const r = record(v);
  const A = parseConfig(r.A);
  const B = parseConfig(r.B);
  return A && B ? { A, B } : null;
}

export type RunningExperiment = { id: string; kind: string; variants: unknown };

/** Test et variante d'une mission parmi les tests actifs de son canal (déterministe). */
export function assignExperiment(missionId: string, running: readonly RunningExperiment[]): MissionExperiment | null {
  const list = running
    .filter((e) => (POST_EXPERIMENT_KINDS as readonly string[]).includes(e.kind) && parseVariants(e.variants))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!list.length) return null;
  const exp = list[hashBucket("experiment", missionId) % list.length]!;
  const variants = parseVariants(exp.variants)!;
  const variant = hashBucket(exp.id, missionId) < 50 ? "A" : "B";
  return { id: exp.id, kind: exp.kind as ExperimentKindName, variant, config: variants[variant] };
}

/** Lecture tolérante de `payload.experiment`. */
export function missionExperimentOf(payload: Record<string, unknown> | null | undefined): MissionExperiment | null {
  const e = record(payload?.experiment);
  if (typeof e.id !== "string" || (e.variant !== "A" && e.variant !== "B") || typeof e.kind !== "string") return null;
  const config = parseConfig(e.config);
  return config ? { id: e.id, kind: e.kind as ExperimentKindName, variant: e.variant, config } : null;
}

/** Identifiant de groupe A/B des posts d'un test (`Post.abGroupId`). */
export function experimentGroupId(experimentId: string): string {
  return `exp_${experimentId}`;
}

/** Mélange déplacé de `points` points (pourcentage) vers `toward`, pris aux autres formats à parts égales (pur). */
export function shiftMix(mix: Mix, toward: keyof Mix, points: number): Mix {
  const total = mix.video + mix.photo + mix.text || 1;
  const pct = { video: (mix.video / total) * 100, photo: (mix.photo / total) * 100, text: (mix.text / total) * 100 };
  const others = (Object.keys(pct) as (keyof Mix)[]).filter((k) => k !== toward);
  const room = others.reduce((s, k) => s + pct[k], 0);
  const move = Math.min(points, room);
  if (move <= 0) return mix;
  for (const k of others) pct[k] -= room > 0 ? (move * pct[k]) / room : 0;
  pct[toward] += move;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { video: r(pct.video), photo: r(pct.photo), text: r(pct.text) };
}
