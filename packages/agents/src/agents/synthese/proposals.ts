/**
 * Recommandations de l'agent Synthèse & réglages : écriture sans doublon (une proposition en attente sur le même
 * réglage est mise à jour), recommandations nées d'un test A/B gagnant, et propositions de la semaine tirées des
 * classements (mélange, fenêtre, consignes « ce qui marche ici » du canal, consignes de l'équipe). Les quotas ne sont
 * jamais proposés d'office (ils dépendent du client) ; les réglages de persona viennent de l'agent Conversations.
 */
import type { AgentsDeps } from "../../types";
import { nowOf } from "../../admin/journal";
import { allowedHoursFor, loadAlgoTeam, type AlgoSettings } from "../../algo/settings";
import { parisWeekStart } from "../../algo/week";
import { hhmmToMinutes } from "../../rules/time";
import { mixKeyOf } from "../posts/features";
import { bestCase, FORMAT_LABELS, type ScopeRanking } from "../posts/rank";
import type { ExperimentVerdict } from "../experimentation/verdict";
import { shiftMix, type Mix, type Variants } from "../experimentation/variants";
import { dailyRange, type WindowCell } from "../horaires/windows";
import { sameValue } from "./apply";

export type RecommendationInput = {
  teamKey: string;
  target: "CHANNEL_PLAN" | "TEAM_CONFIG" | "PERSONA";
  targetId: string;
  field: string;
  before: unknown;
  after: unknown;
  evidence: Record<string, unknown>;
  expectedGain: string | null;
  size: "SMALL" | "BIG";
  weekStart?: string;
};

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

/** Écrit la proposition ; même réglage déjà proposé → mise à jour ; même valeur déjà appliquée → rien. */
export async function proposeRecommendation(deps: AgentsDeps, r: RecommendationInput): Promise<{ id: string; created: boolean; skipped?: boolean }> {
  const weekStart = r.weekStart ?? parisWeekStart(nowOf(deps));
  const where = { target: r.target, targetId: r.targetId, field: r.field };
  const applied = await deps.prisma.recommendation.findFirst({ where: { ...where, status: "APPLIED" }, orderBy: { appliedAt: "desc" } });
  if (applied && sameValue(applied.after, r.after)) return { id: applied.id, created: false, skipped: true };
  const data = {
    teamKey: r.teamKey,
    before: r.before === null || r.before === undefined ? undefined : json(r.before),
    after: json(r.after),
    evidence: json(r.evidence),
    expectedGain: r.expectedGain,
    size: r.size,
    weekStart,
  };
  const pending = await deps.prisma.recommendation.findFirst({ where: { ...where, status: "PROPOSED" }, orderBy: { createdAt: "desc" } });
  if (pending) {
    await deps.prisma.recommendation.update({ where: { id: pending.id }, data });
    return { id: pending.id, created: false };
  }
  const row = await deps.prisma.recommendation.create({ data: { ...data, ...where, status: "PROPOSED" } });
  return { id: row.id, created: true };
}

const pct = (x: number | null) => (x === null ? "?" : `${(x * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function planMix(v: unknown): Mix {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && x > 0 ? x : 0);
  const m = { video: n(r.video), photo: n(r.photo), text: n(r.text) };
  return m.video + m.photo + m.text > 0 ? m : { video: 0, photo: 0, text: 1 };
}

/** Fenêtre de même durée centrée sur `hour`, ramenée dans les heures autorisées (pur). */
export function windowAround(hour: number, length: number, allowed: { start: string; end: string }): { windowStart: string; windowEnd: string } {
  const lo = Math.ceil((hhmmToMinutes(allowed.start) ?? 0) / 60);
  const hi = Math.floor((hhmmToMinutes(allowed.end) ?? 1440) / 60);
  const len = Math.max(1, Math.min(length, hi - lo));
  let start = Math.round(hour - len / 2 + 0.5);
  start = Math.max(lo, Math.min(start, hi - len));
  return { windowStart: hh(start), windowEnd: hh(start + len) };
}

type PlanRow = { channelId: string; teamKey: string; mix: unknown; windowStart: string; windowEnd: string; postsPerDay: number; minSpacingMinutes: number; styleNotes: string | null };

/** Recommandation tirée d'un test clos avec gagnant (ou null si le test ne porte pas sur un réglage). */
export async function recommendationFromExperiment(
  deps: AgentsDeps,
  exp: { id: string; teamKey: string; channelId: string | null; personaId: string | null; kind: string; metric: string },
  variants: Variants,
  winner: "A" | "B",
  v: ExperimentVerdict,
): Promise<RecommendationInput | null> {
  const win = variants[winner];
  const lose = variants[winner === "A" ? "B" : "A"];
  const evidence = { agent: "experimentation", experimentId: exp.id, metric: exp.metric, p: v.p, A: v.A, B: v.B, winner };
  const gain = `${win.label} plutôt que ${lose.label} (${v[winner].value ?? "?"} contre ${v[winner === "A" ? "B" : "A"].value ?? "?"})`;
  if (exp.kind === "REGLAGE_PERSONA") {
    if (!exp.personaId || !win.field) return null;
    const p = (await deps.prisma.persona.findUnique({ where: { id: exp.personaId } })) as Record<string, unknown> | null;
    return { teamKey: exp.teamKey, target: "PERSONA", targetId: exp.personaId, field: win.field, before: p?.[win.field] ?? null, after: win.value, evidence, expectedGain: gain, size: "BIG" };
  }
  if (!exp.channelId) return null;
  const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: exp.channelId } })) as PlanRow | null;
  if (!plan) return null;
  const base = { teamKey: exp.teamKey, target: "CHANNEL_PLAN" as const, targetId: exp.channelId, evidence, expectedGain: gain, size: "SMALL" as const };
  if (exp.kind === "MELANGE" && win.mix) return { ...base, field: "mix", before: plan.mix, after: win.mix };
  if (exp.kind === "HORAIRE" && win.hour !== undefined) {
    const { settings } = await loadAlgoTeam(deps.prisma);
    const len = Math.round(((hhmmToMinutes(plan.windowEnd) ?? 1320) - (hhmmToMinutes(plan.windowStart) ?? 540)) / 60);
    return { ...base, field: "window", before: { windowStart: plan.windowStart, windowEnd: plan.windowEnd }, after: windowAround(win.hour, len, allowedHoursFor(settings, exp.channelId)) };
  }
  if (exp.kind === "STYLE_LEGENDE" && win.style) {
    const note = `Légendes : ${win.style}`;
    const kept = (plan.styleNotes ?? "").split("\n").filter((l) => l.trim() && !l.startsWith("Légendes :"));
    return { ...base, field: "styleNotes", before: plan.styleNotes, after: [...kept, note].join("\n").slice(0, 600) };
  }
  return null;
}

/** Phrase « ce qui marche ici » d'un canal (pure), ou null sans cas gagnant. */
export function styleNotesFrom(r: ScopeRanking): string | null {
  const parts: string[] = [];
  const f = bestCase(r.dimensions.format);
  if (f) parts.push(`les ${FORMAT_LABELS[f.key] ?? f.label}s marchent le mieux`);
  const l = bestCase(r.dimensions.length);
  if (l) parts.push(`textes ${l.label}`);
  const t = bestCase(r.dimensions.theme);
  if (t) parts.push(`thème « ${t.label} »`);
  const h = bestCase(r.dimensions.hour);
  if (h) parts.push(`vers ${h.label}`);
  return parts.length ? `Ce qui marche ici : ${parts.join(", ")}.` : null;
}

export const TEAM_GUIDELINES_MARK = "[Équipe Algorithme]";

/** Consignes d'équipe : le bloc de l'équipe Algorithme est remplacé, le texte humain gardé (pur). */
export function mergeGuidelines(current: string, line: string | null): string {
  const kept = current.split("\n").filter((l) => !l.startsWith(TEAM_GUIDELINES_MARK)).join("\n").trimEnd();
  return line ? [kept, `${TEAM_GUIDELINES_MARK} ${line}`].filter(Boolean).join("\n") : kept;
}

/** Point de mélange déplacé par semaine quand un type de post sort du lot (sous la borne). */
export const WEEKLY_MIX_STEP = 10;

/** Propositions d'un canal (pur) à partir de son classement et de ses fenêtres. */
export function channelProposals(
  plan: PlanRow,
  ranking: ScopeRanking | null,
  cells: readonly WindowCell[],
  settings: AlgoSettings,
): RecommendationInput[] {
  const out: RecommendationInput[] = [];
  const base = { teamKey: plan.teamKey, target: "CHANNEL_PLAN" as const, targetId: plan.channelId, size: "SMALL" as const };
  if (ranking) {
    const fmt = ranking.dimensions.format;
    const best = bestCase(fmt);
    const worst = [...fmt.cases].reverse().find((c) => fmt.weak.includes(c.key)) ?? null;
    if (best && worst && mixKeyOf(best.key) !== mixKeyOf(worst.key)) {
      const mix = planMix(plan.mix);
      const after = shiftMix(mix, mixKeyOf(best.key), Math.min(WEEKLY_MIX_STEP, settings.maxMixShiftPoints));
      if (!sameValue(after, mix))
        out.push({
          ...base,
          field: "mix",
          before: plan.mix,
          after,
          evidence: { agent: "posts", metric: fmt.metric, best: { key: best.key, posts: best.posts, ctr: best.ctr, views24h: best.views24hMedian }, worst: { key: worst.key, posts: worst.posts, ctr: worst.ctr, views24h: worst.views24hMedian } },
          expectedGain: `${FORMAT_LABELS[best.key] ?? best.key} : ${pct(best.ctr)} de clic offre contre ${pct(worst.ctr)} pour ${FORMAT_LABELS[worst.key] ?? worst.key}`,
        });
    }
    const notes = styleNotesFrom(ranking);
    if (notes && notes !== plan.styleNotes)
      out.push({ ...base, field: "styleNotes", before: plan.styleNotes, after: notes, evidence: { agent: "posts", posts: ranking.posts, views: ranking.views }, expectedGain: "La Rédaction s'appuie sur ce qui marche sur ce canal." });
  }
  const range = dailyRange(cells, { ratio: settings.windowRatio, minPostsPerCell: settings.minPostsPerCell });
  const enough = cells.reduce((s, c) => s + c.posts, 0) >= settings.minPosts;
  if (range && enough) {
    // Assez large pour le quota et l'espacement du plan.
    const need = Math.ceil((plan.postsPerDay * plan.minSpacingMinutes) / 60) + 1;
    const center = (range.start + range.end) / 2;
    const after = windowAround(Math.floor(center), Math.max(need, range.end - range.start), allowedHoursFor(settings, plan.channelId));
    if (after.windowStart !== plan.windowStart || after.windowEnd !== plan.windowEnd)
      out.push({
        ...base,
        field: "window",
        before: { windowStart: plan.windowStart, windowEnd: plan.windowEnd },
        after,
        evidence: { agent: "horaires", bestRange: range, posts: cells.reduce((s, c) => s + c.posts, 0) },
        expectedGain: `Publier entre ${after.windowStart} et ${after.windowEnd}, les heures où le canal est le plus vu et cliqué.`,
      });
  }
  return out;
}

/** Propositions de la semaine pour tous les canaux à plan et les équipes. */
export async function generateWeeklyRecommendations(
  deps: AgentsDeps,
  input: { channels: ScopeRanking[]; verticals: ScopeRanking[]; cells: Record<string, WindowCell[]>; settings: AlgoSettings },
): Promise<string[]> {
  const ids: string[] = [];
  const plans = (await deps.prisma.channelAgentPlan.findMany({ where: { teamKey: { in: ["dating", "casino", "sports"] } } })) as PlanRow[];
  const byChannel = new Map(input.channels.map((r) => [r.id, r]));
  for (const plan of plans)
    for (const r of channelProposals(plan, byChannel.get(plan.channelId) ?? null, input.cells[plan.channelId] ?? [], input.settings))
      ids.push((await proposeRecommendation(deps, r)).id);
  const VERT: Record<string, string> = { DATING: "dating", CASINO: "casino", SPORTS: "sports" };
  for (const v of input.verticals) {
    const teamKey = VERT[v.id];
    if (!teamKey) continue;
    const line = styleNotesFrom(v);
    const team = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey } });
    if (!team || !line) continue;
    const after = mergeGuidelines(team.styleGuidelines ?? "", line.replace(/^Ce qui marche ici/, "Ce qui marche dans l'univers"));
    if (after === team.styleGuidelines) continue;
    ids.push(
      (
        await proposeRecommendation(deps, {
          teamKey,
          target: "TEAM_CONFIG",
          targetId: teamKey,
          field: "styleGuidelines",
          before: team.styleGuidelines,
          after,
          evidence: { agent: "posts", vertical: v.id, posts: v.posts, views: v.views },
          expectedGain: "La Rédaction de toute l'équipe s'appuie sur ce qui marche.",
          size: "BIG",
        })
      ).id,
    );
  }
  return ids;
}
