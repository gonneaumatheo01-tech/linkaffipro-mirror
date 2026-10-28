/**
 * Phase 32, chantier B — application, annulation et suivi du calibrage (règle 4).
 *
 * - `listCalibrationChoices` : propositions ouvertes (`source = "prospection_calibration"`) approuvées par le QA
 *   Global, numérotées dans l'ordre (les autres restent « en vérification ») ; même liste pour Kevin et le site.
 * - `applyCalibration(deps, [1, 3], by)` : par le client seulement (jamais seul) ; QA revérifié, réglage inchangé
 *   depuis la proposition, bornes revérifiées sur la base du mois (coefficient ± 50 %, poids et parts ± 20 %) ;
 *   valeur écrite, proposition APPLIED, `AuditLog`, puis UNE `Experiment` de suivi (30 jours) qui garde les mesures
 *   avant / après : niveaux attribués aux signés (poids), écart estimé / réel des signés (coefficients), parts.
 * - `undoCalibration` : remet l'avant du dernier lot appliqué (30 jours au plus), sauf un réglage changé depuis ;
 *   l'`Experiment` est annulée.
 * - `closeCalibrationExperiments` : clôt les suivis arrivés à 30 jours avec les mesures du moment.
 * Ces propositions ne passent jamais par la mécanique de l'équipe Algorithme (application automatique exclue).
 */
import { agentAudit, agentEvent, nowOf } from "../../admin/journal";
import { pick } from "../../boss/voice";
import { recommendationNotApproved, splitApproved } from "../../qa-gates/recommendations";
import type { QaDeps } from "../../qa/contract";
import { PROSPECTION_SETTINGS, PROSPECTION_TEAM_KEY, type ProspectTier } from "../contract";
import { CALIBRATION_BOUNDS, CALIBRATION_SOURCE } from "../contract-advanced";
import type { ProspectionKevinDeps } from "../kevin-port";
import { scoreProspect } from "../score/score";
import { DAY_MS, loadScoreSettings, objectOf, weightsOf } from "../score/settings";
import { activeOffers, contactsOf, scoreInputOf, type ProspectRow } from "../score/store";
import { loadValueSettings } from "../value/index";
import { segmentKeyAt } from "../value/segment";
import { SEGMENT_LEVELS } from "../value/segment";
import {
  CALIBRATION_TARGETS,
  DISCOVERY_SHARES_KEY,
  currentCoefficient,
  currentShares,
  currentWeights,
  loadSamples,
  monthBaseOf,
  sharesOf,
  withinCoefficientBounds,
  withinShareBounds,
  withinWeightBounds,
  type CalibrationRecRow,
  type CalibrationSample,
  type CoefficientField,
} from "./calibrate";
import { CALIBRATION_VARIANTS } from "./texts";

type Deps = ProspectionKevinDeps & QaDeps;

/** Qui applique : le client (Kevin, avec son compte du site s'il est connu) ; jamais le système. */
export type CalibrationActor = "client" | "system" | { userId: string | null };
/** Repère du dernier lot appliqué (annulation en un clic). */
export const CALIBRATION_LAST_APPLY_KEY = "prospection.calibration.last_apply";
export const CALIBRATION_UNDO_DAYS = 30;
export const CALIBRATION_EXPERIMENT_METRIC = "prospection_calibration";

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));
const userIdOf = (by: CalibrationActor) => (typeof by === "object" ? by.userId : null);

/** Égalité de deux valeurs de réglage (nombres à 0,001 près, objets clé par clé). */
export function sameSetting(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.001;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.join(",") !== kb.join(",")) return false;
    return ka.every((k) => sameSetting((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

// ————— Liste numérotée —————

export type CalibrationChoice = { n: number; id: string; kind: string; target: string; targetId: string; field: string; before: unknown; after: unknown; text: string; createdAt: Date };

async function openRecs(deps: Pick<Deps, "prisma">): Promise<CalibrationRecRow[]> {
  return (await deps.prisma.recommendation.findMany({ where: { source: CALIBRATION_SOURCE, status: "PROPOSED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) as CalibrationRecRow[];
}

/** Propositions de calibrage ouvertes et approuvées, numérotées (1, 2, 3…) ; `inReview` : encore en vérification. */
export async function listCalibrationChoices(deps: Deps): Promise<{ choices: CalibrationChoice[]; inReview: number }> {
  const recs = await openRecs(deps);
  const { approved, pending } = await splitApproved(deps, recs as never[]);
  const ok = new Set((approved as CalibrationRecRow[]).map((r) => r.id));
  const choices = recs
    .filter((r) => ok.has(r.id))
    .map((r, i) => ({
      n: i + 1,
      id: r.id,
      kind: String(objectOf(r.evidence).kind ?? ""),
      target: r.target,
      targetId: r.targetId,
      field: r.field,
      before: r.before,
      after: r.after,
      text: r.expectedGain ?? String(objectOf(r.evidence).code ?? ""),
      createdAt: r.createdAt,
    }));
  return { choices, inReview: pending.length };
}

/** Message de Kevin : propositions numérotées et façon de répondre ; null s'il n'y a rien à choisir. */
export async function calibrationChoicesMessage(deps: Deps, chatKey?: string | null): Promise<string | null> {
  const { choices, inReview } = await listCalibrationChoices(deps);
  if (!choices.length) return null;
  const lines = [pick(CALIBRATION_VARIANTS.title({ n: choices.length }), "prospection.calibration.title", chatKey)];
  for (const c of choices) lines.push(`${c.n}. ${c.text}`);
  if (inReview) lines.push(pick(CALIBRATION_VARIANTS.inReview({ n: inReview }), "prospection.calibration.inReview", chatKey));
  lines.push(pick(CALIBRATION_VARIANTS.how, "prospection.calibration.how", chatKey));
  return lines.join("\n");
}

// ————— Lecture et écriture des réglages —————

async function readCurrent(deps: Deps, rec: CalibrationRecRow): Promise<unknown> {
  if (rec.target === CALIBRATION_TARGETS.coefficient) return currentCoefficient(deps, rec.targetId, rec.field as CoefficientField);
  if (rec.target === CALIBRATION_TARGETS.weights) return currentWeights(deps);
  if (rec.target === CALIBRATION_TARGETS.shares) return currentShares(deps);
  return undefined;
}

/** Bornes revérifiées sur la base du mois ; null si la valeur peut être écrite, sinon la raison. */
async function boundsRefusal(deps: Deps, rec: CalibrationRecRow, current: unknown, now: Date): Promise<string | null> {
  const base = await monthBaseOf(deps, rec.target, rec.targetId, rec.field, current, now);
  if (rec.target === CALIBRATION_TARGETS.coefficient) {
    const after = typeof rec.after === "number" ? rec.after : NaN;
    if (!Number.isFinite(after) || !withinCoefficientBounds(Number(base), after)) return `la limite de ${Math.round(CALIBRATION_BOUNDS.coefficientMaxChange * 100)} % par mois serait dépassée`;
    return null;
  }
  if (rec.target === CALIBRATION_TARGETS.weights) return withinWeightBounds(weightsOf(base), weightsOf(rec.after)) ? null : `la limite de ${Math.round(CALIBRATION_BOUNDS.weightMaxChange * 100)} % par mois serait dépassée`;
  if (rec.target === CALIBRATION_TARGETS.shares) return withinShareBounds(sharesOf(base), sharesOf(rec.after)) ? null : `la limite de ${Math.round(CALIBRATION_BOUNDS.weightMaxChange * 100)} % par mois serait dépassée`;
  return "réglage inconnu";
}

async function writeSettingValue(deps: Deps, key: string, value: unknown): Promise<void> {
  const v = json(value);
  await deps.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

async function writeValue(deps: Deps, rec: CalibrationRecRow, value: unknown, mode: "apply" | "undo", now: Date): Promise<void> {
  if (rec.target === CALIBRATION_TARGETS.coefficient) {
    const field = rec.field as CoefficientField;
    const ev = objectOf(rec.evidence);
    if (mode === "apply") {
      const data = { [field]: Number(value), source: "calibrated", sample: typeof ev.affiliates === "number" ? ev.affiliates : 0, periodEnd: now, periodStart: new Date(now.getTime() - 30 * DAY_MS), recommendationId: rec.id };
      await deps.prisma.prospectCalibration.upsert({ where: { segment: rec.targetId }, create: { segment: rec.targetId, ...data }, update: data });
    } else {
      const others = await deps.prisma.recommendation.count({ where: { source: CALIBRATION_SOURCE, target: rec.target, targetId: rec.targetId, status: "APPLIED", NOT: { id: rec.id } } });
      await deps.prisma.prospectCalibration.update({ where: { segment: rec.targetId }, data: { [field]: Number(value), ...(others ? {} : { source: "default", recommendationId: null }) } });
    }
    return;
  }
  if (rec.target === CALIBRATION_TARGETS.weights) return writeSettingValue(deps, PROSPECTION_SETTINGS.weights.key, weightsOf(value));
  if (rec.target === CALIBRATION_TARGETS.shares) return writeSettingValue(deps, DISCOVERY_SHARES_KEY, sharesOf(value));
}

// ————— Mesures du suivi —————

type TierCounts = Partial<Record<ProspectTier, number>>;

/** Niveaux qu'auraient les signés / actifs avec ces poids (score du code, sans IA). */
async function signedTiers(deps: Deps, weights: ReturnType<typeof weightsOf>): Promise<TierCounts> {
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: ["SIGNED", "ACTIVE"] } } })) as unknown as ProspectRow[];
  const offers = await activeOffers(deps);
  const s = await loadScoreSettings(deps);
  const out: TierCounts = {};
  for (const p of rows) {
    const r = scoreProspect(scoreInputOf(p, offers, await contactsOf(deps, p.id)), { ...s, weights });
    out[r.tier] = (out[r.tier] ?? 0) + 1;
  }
  return out;
}

/** Écart médian entre estimé et réel (|ln(estimé ÷ réel)|) des signés d'un segment, pour un coefficient donné. */
function estimateError(samples: readonly CalibrationSample[], segment: string, field: CoefficientField, factor: number, settings: Awaited<ReturnType<typeof loadValueSettings>>): number | null {
  const errs: number[] = [];
  for (const s of samples) {
    if (s.days < CALIBRATION_BOUNDS.minDays) continue;
    if (!SEGMENT_LEVELS.some((l) => segmentKeyAt(s.segment, l) === segment)) continue;
    let est: number | null = null;
    let real: number | null = null;
    if (field === "ctrFactor" && s.promoReach && s.realClicks !== null) {
      est = s.promoReach * settings.ctr * factor;
      real = (s.realClicks / s.days) * 30;
    } else if (field === "ftdFactor" && s.realClicks && s.realFtd !== null) {
      est = settings.regRate * settings.ftdRate * factor;
      real = s.realFtd / s.realClicks;
    }
    if (est && real && est > 0 && real > 0) errs.push(Math.abs(Math.log(est / real)));
  }
  if (!errs.length) return null;
  errs.sort((a, b) => a - b);
  const m = Math.floor(errs.length / 2);
  return Math.round((errs.length % 2 ? errs[m]! : (errs[m - 1]! + errs[m]!) / 2) * 1000) / 1000;
}

type Measures = Record<string, unknown>;

async function measuresFor(deps: Deps, recs: readonly CalibrationRecRow[], which: "before" | "after" | "now"): Promise<Measures> {
  const out: Measures = {};
  const settings = await loadValueSettings(deps);
  const samples = recs.some((r) => r.target === CALIBRATION_TARGETS.coefficient) ? await loadSamples(deps, nowOf(deps)) : [];
  for (const r of recs) {
    if (r.target === CALIBRATION_TARGETS.weights) {
      const w = which === "now" ? await currentWeights(deps) : weightsOf(which === "before" ? r.before : r.after);
      out[`niveaux_des_signes`] = await signedTiers(deps, w);
    } else if (r.target === CALIBRATION_TARGETS.coefficient) {
      const factor = which === "now" ? await currentCoefficient(deps, r.targetId, r.field as CoefficientField) : Number(which === "before" ? r.before : r.after);
      out[`ecart_${r.field}_${r.targetId}`] = estimateError(samples, r.targetId, r.field as CoefficientField, factor, settings);
    } else if (r.target === CALIBRATION_TARGETS.shares) {
      out.parts = which === "now" ? await currentShares(deps) : sharesOf(which === "before" ? r.before : r.after);
    }
  }
  return out;
}

// ————— Application —————

export type ApplyCalibrationResult = { ok: boolean; applied: number[]; refused: Array<{ n: number; reason: string }>; experimentId: string | null; message: string };

/** « applique 1 et 3 » : applique les choix numérotés, dans les bornes, puis ouvre le suivi. */
export async function applyCalibration(deps: Deps, choices: number[], by: CalibrationActor): Promise<ApplyCalibrationResult> {
  const say = (entry: readonly string[], key: string) => pick(entry, `prospection.calibration.${key}`);
  if (by === "system") return { ok: false, applied: [], refused: [], experimentId: null, message: say(CALIBRATION_VARIANTS.notByRobot, "notByRobot") };
  const { choices: list } = await listCalibrationChoices(deps);
  if (!list.length) return { ok: false, applied: [], refused: [], experimentId: null, message: say(CALIBRATION_VARIANTS.noChoices, "noChoices") };
  const wanted = [...new Set(choices.filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
  if (!wanted.length || wanted.some((n) => n < 1 || n > list.length)) return { ok: false, applied: [], refused: [], experimentId: null, message: say(CALIBRATION_VARIANTS.badChoice({ max: list.length }), "badChoice") };

  const now = nowOf(deps);
  const applied: number[] = [];
  const refused: Array<{ n: number; reason: string }> = [];
  const done: CalibrationRecRow[] = [];
  for (const n of wanted) {
    const choice = list[n - 1]!;
    const rec = (await deps.prisma.recommendation.findUnique({ where: { id: choice.id } })) as CalibrationRecRow | null;
    if (!rec || rec.status !== "PROPOSED") {
      refused.push({ n, reason: "cette proposition n'est plus ouverte" });
      continue;
    }
    const notApproved = await recommendationNotApproved(deps, rec as never);
    if (notApproved) {
      refused.push({ n, reason: notApproved.replace(/[.\s]+$/u, "").toLowerCase() });
      continue;
    }
    const current = await readCurrent(deps, rec);
    if (current === undefined) {
      refused.push({ n, reason: "réglage inconnu" });
      continue;
    }
    if (!sameSetting(current, rec.before)) {
      refused.push({ n, reason: "le réglage a changé depuis la proposition" });
      continue;
    }
    const bound = await boundsRefusal(deps, rec, current, now);
    if (bound) {
      refused.push({ n, reason: bound });
      continue;
    }
    await writeValue(deps, rec, rec.after, "apply", now);
    await deps.prisma.recommendation.update({ where: { id: rec.id }, data: { status: "APPLIED", appliedAt: now, appliedBy: "HUMAN", appliedById: userIdOf(by) } });
    await agentAudit(deps, { userId: userIdOf(by), action: "prospection.calibration.applied", entityType: "Recommendation", entityId: rec.id, metadata: { target: rec.target, targetId: rec.targetId, field: rec.field, before: rec.before, after: rec.after } });
    applied.push(n);
    done.push(rec);
  }

  let experimentId: string | null = null;
  if (done.length) {
    const before = await measuresFor(deps, done, "before");
    const after = await measuresFor(deps, done, "after");
    const exp = (await deps.prisma.experiment.create({
      data: {
        teamKey: PROSPECTION_TEAM_KEY,
        channelId: null,
        personaId: null,
        kind: "REGLAGE_PERSONA",
        hypothesis: "Calibrage de la prospection : estimations et niveaux plus proches des vrais résultats des affiliés signés.",
        variants: json({ A: { label: "avant", values: Object.fromEntries(done.map((r) => [`${r.target}:${r.targetId}:${r.field}`, r.before])) }, B: { label: "après", values: Object.fromEntries(done.map((r) => [`${r.target}:${r.targetId}:${r.field}`, r.after])) } }),
        metric: CALIBRATION_EXPERIMENT_METRIC,
        minSamples: CALIBRATION_BOUNDS.minAffiliates,
        status: "RUNNING",
        startedAt: now,
        endsAt: new Date(now.getTime() + CALIBRATION_BOUNDS.experimentDays * DAY_MS),
        recommendationId: done[0]!.id,
        result: json({ prospection: { recommendationIds: done.map((r) => r.id), appliedAt: now.toISOString(), before, after } }),
      },
    })) as { id: string };
    experimentId = exp.id;
    await writeSettingValue(deps, CALIBRATION_LAST_APPLY_KEY, { recommendationIds: done.map((r) => r.id), experimentId, at: now.toISOString() });
    await agentEvent(deps, "prospection.calibration.applied", { recommendations: done.length, experimentId });
  }

  const nums = applied.length > 1 ? `${applied.slice(0, -1).join(", ")} et ${applied.at(-1)}` : String(applied[0] ?? "");
  const lines: string[] = [];
  lines.push(applied.length ? say(CALIBRATION_VARIANTS.applied({ nums }), "applied") : say(CALIBRATION_VARIANTS.applyNothing, "applyNothing"));
  for (const r of refused.slice(0, 4)) lines.push(say(CALIBRATION_VARIANTS.applyRefused(r), "applyRefused"));
  return { ok: applied.length > 0, applied, refused, experimentId, message: lines.join("\n") };
}

// ————— Annulation —————

export type UndoCalibrationResult = { ok: boolean; undone: number; skipped: number; message: string };

/** « annule le calibrage » : remet l'avant du dernier lot appliqué (30 jours au plus). */
export async function undoCalibration(deps: Deps, by: CalibrationActor): Promise<UndoCalibrationResult> {
  const say = (entry: readonly string[], key: string) => pick(entry, `prospection.calibration.${key}`);
  const now = nowOf(deps);
  const last = objectOf((await deps.prisma.setting.findUnique({ where: { key: CALIBRATION_LAST_APPLY_KEY } }))?.value);
  const ids = Array.isArray(last.recommendationIds) ? (last.recommendationIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const recs = ids.length ? ((await deps.prisma.recommendation.findMany({ where: { id: { in: ids }, status: "APPLIED" } })) as CalibrationRecRow[]) : [];
  const fresh = recs.filter((r) => r.appliedAt && now.getTime() - r.appliedAt.getTime() <= CALIBRATION_UNDO_DAYS * DAY_MS);
  if (!fresh.length) return { ok: false, undone: 0, skipped: 0, message: say(CALIBRATION_VARIANTS.undoNothing, "undoNothing") };

  let undone = 0;
  let skipped = 0;
  for (const rec of [...fresh].sort((a, b) => ids.indexOf(b.id) - ids.indexOf(a.id))) {
    const current = await readCurrent(deps, rec);
    if (!sameSetting(current, rec.after)) {
      skipped++;
      continue;
    }
    await writeValue(deps, rec, rec.before, "undo", now);
    await deps.prisma.recommendation.update({ where: { id: rec.id }, data: { status: "UNDONE", undoneAt: now, undoneById: userIdOf(by) } });
    await agentAudit(deps, { userId: userIdOf(by), action: "prospection.calibration.undone", entityType: "Recommendation", entityId: rec.id, metadata: { target: rec.target, targetId: rec.targetId, field: rec.field, restored: rec.before } });
    undone++;
  }
  if (typeof last.experimentId === "string")
    await deps.prisma.experiment.updateMany({ where: { id: last.experimentId, status: "RUNNING" }, data: { status: "CANCELLED", closedAt: now } });
  if (!skipped) await deps.prisma.setting.deleteMany({ where: { key: CALIBRATION_LAST_APPLY_KEY } });
  await agentEvent(deps, "prospection.calibration.undone", { undone, skipped });
  const lines = [undone ? say(CALIBRATION_VARIANTS.undone({ n: undone }), "undone") : say(CALIBRATION_VARIANTS.undoNothing, "undoNothing")];
  if (skipped) lines.push(say(CALIBRATION_VARIANTS.undoSkipped({ n: skipped }), "undoSkipped"));
  return { ok: undone > 0, undone, skipped, message: lines.join("\n") };
}

// ————— Suivi —————

/** Clôt les suivis de calibrage arrivés à 30 jours (mesures du moment rangées dans `result.prospection.closed`). */
export async function closeCalibrationExperiments(deps: Deps, now: Date): Promise<number> {
  const due = (await deps.prisma.experiment.findMany({ where: { teamKey: PROSPECTION_TEAM_KEY, metric: CALIBRATION_EXPERIMENT_METRIC, status: "RUNNING", endsAt: { lte: now } } })) as Array<{ id: string; result: unknown }>;
  let n = 0;
  for (const exp of due) {
    const prev = objectOf(exp.result);
    const pr = objectOf(prev.prospection);
    const ids = Array.isArray(pr.recommendationIds) ? (pr.recommendationIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const recs = ids.length ? ((await deps.prisma.recommendation.findMany({ where: { id: { in: ids } } })) as CalibrationRecRow[]) : [];
    const closed = await measuresFor(deps, recs.filter((r) => r.status === "APPLIED"), "now");
    await deps.prisma.experiment.update({ where: { id: exp.id }, data: { status: "CLOSED", closedAt: now, result: json({ ...prev, prospection: { ...pr, closed, closedAt: now.toISOString() } }) } });
    n++;
  }
  return n;
}

/** Historique du calibrage (site) : propositions appliquées ou annulées, la plus récente d'abord. */
export async function calibrationHistory(deps: Pick<Deps, "prisma">, take = 30): Promise<CalibrationRecRow[]> {
  return (await deps.prisma.recommendation.findMany({ where: { source: CALIBRATION_SOURCE, status: { in: ["APPLIED", "UNDONE"] } }, orderBy: { appliedAt: "desc" }, take })) as CalibrationRecRow[];
}

/** Coefficients en place par segment (site : « calibrage par segment avec échantillon »). */
export async function calibrationSegments(deps: Pick<Deps, "prisma">): Promise<Array<{ segment: string; ctrFactor: number; ftdFactor: number; sample: number; source: string; updatedAt: Date }>> {
  return (await deps.prisma.prospectCalibration.findMany({ orderBy: { updatedAt: "desc" } })) as never;
}
