/**
 * Phase 33, chantier C — « qu'est-ce qui est prévu ? » : plan d'un canal, d'une équipe ou de tout, pour un ou
 * plusieurs jours (équipe, nombre prévu, fenêtre, format ou catégorie, persona, dérogations d'ordre en cours, pause,
 * pour de faux / pour de vrai, niveau). Pour un jour pas encore préparé, le plan du Grand Chef est joué À BLANC :
 * même règle pure que `plan-day.ts` (`missingMissions`) appliquée aux mêmes lectures, RIEN n'est écrit.
 */
import { nowOf } from "../../admin/journal";
import { chainOf } from "../../chiefs/index";
import { missingMissions } from "../../orchestrator/plan-day";
import { addDaysToDay, parisDay, parisDayStart, parisParts } from "../../rules/time";
import { activeCategories, toCategory, type BetCategoryInfo } from "../../sports/data";
import { readPassageState } from "../../sports/passage-state";
import { parseSportsSettings } from "../../sports/settings";
import { isTeamKey, TEAM_LABELS, TEAM_OF_VERTICAL, type AgentsDeps, type TeamKey } from "../../types";
import { dayLabel, hhmmLabel, overridesOf, readTeamState, type OverrideView, type TeamState, type ViewResult } from "./common";

export type ViewPlanInput = {
  channelId?: string | null;
  teamKey?: TeamKey | null;
  all?: boolean;
  /** Premier jour (AAAA-MM-JJ, Paris) ; aujourd'hui par défaut. */
  day?: string | null;
  /** Nombre de jours (1 à 7). */
  days?: number | null;
};

export type PlanEntry = {
  channelId: string;
  channel: string;
  isTest: boolean;
  day: string;
  teamKey: TeamKey | null;
  source: "plan" | "ordre" | "categories" | "aucun";
  enabled: boolean;
  perDay: number;
  unit: "post" | "pari";
  windowStart: string | null;
  windowEnd: string | null;
  format: string | null;
  persona: string | null;
  themes: string[];
  categories: string[];
  /** Paris sportifs : heures de passage du jour et prochain passage (« 15 h »). */
  passages: number[];
  nextPassage: string | null;
  overrides: Array<{ ordre: number | null; jusquau: string; equipe: string }>;
  /** Missions déjà créées pour ce jour (canal visé). */
  created: number;
  /** Ce que le Grand Chef créerait encore (plan joué à blanc). */
  toCreate: number;
  /** Jour déjà préparé (au moins une mission créée) ; faux = prévision à blanc. */
  prepared: boolean;
  /** Pourquoi rien ne serait créé (pause, équipe sans agents…), sinon null. */
  blocked: string | null;
};

type ChannelRow = { id: string; title: string; vertical: string | null; isTest: boolean; isActive: boolean };
type PlanRow = {
  channelId: string;
  teamKey: string;
  enabled: boolean;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  mix: unknown;
  personaId: string | null;
  themes: unknown;
};

const FORMAT_WORDS: Record<string, [string, string]> = { video: ["vidéo", "vidéos"], photo: ["photo", "photos"], text: ["texte", "textes"] };

/** Mélange `{ video, photo, text }` → « 1 vidéo, 2 photos, 1 texte » (pur). */
export function mixLabel(mix: unknown): string | null {
  if (!mix || typeof mix !== "object") return null;
  const parts: string[] = [];
  for (const k of ["video", "photo", "text"]) {
    const n = Number((mix as Record<string, unknown>)[k] ?? 0);
    if (Number.isFinite(n) && n > 0) parts.push(`${n} ${n > 1 ? FORMAT_WORDS[k]![1] : FORMAT_WORDS[k]![0]}`);
  }
  return parts.length ? parts.join(", ") : null;
}

export function formatLabel(f: string | null | undefined): string | null {
  if (!f) return null;
  return FORMAT_WORDS[f]?.[1] ?? f;
}

/** Thèmes d'un plan (`["roulette"]` ou `[{ theme, weight }]`) → noms (pur). */
export function themeNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as { theme?: unknown }).theme ?? "") : ""))
    .filter(Boolean);
}

/** Prochain passage du Chef Paris (pur) : heure suivante du jour, sinon la première du lendemain. */
export function nextPassageOf(runHours: readonly number[], day: string, now: Date, done: readonly number[] = []): string | null {
  const hours = [...runHours].sort((a, b) => a - b);
  if (!hours.length) return null;
  const today = parisDay(now);
  if (day > today) return `${hours[0]} h`;
  if (day < today) return null;
  const h = parisParts(now).hour;
  const next = hours.find((x) => x > h || (x === h && !done.includes(x)));
  return next !== undefined ? `${next} h` : `demain ${hours[0]} h`;
}

async function loadContext(deps: AgentsDeps) {
  const [channels, plans, personas, sportsCats] = await Promise.all([
    deps.prisma.channel.findMany({ where: { isActive: true }, select: { id: true, title: true, vertical: true, isTest: true, isActive: true }, orderBy: { title: "asc" } }),
    deps.prisma.channelAgentPlan.findMany({}),
    deps.prisma.persona.findMany({ select: { id: true, name: true } }),
    activeCategories(deps.prisma),
  ]);
  return {
    channels: channels as ChannelRow[],
    plans: new Map((plans as PlanRow[]).map((p) => [p.channelId, p])),
    personas: new Map((personas as Array<{ id: string; name: string }>).map((p) => [p.id, p.name])),
    sportsCats,
  };
}

type Ctx = Awaited<ReturnType<typeof loadContext>>;

function baseTeamOf(c: ChannelRow, plan: PlanRow | undefined): TeamKey | null {
  if (plan && isTeamKey(plan.teamKey)) return plan.teamKey;
  const v = c.vertical as keyof typeof TEAM_OF_VERTICAL | null;
  return v && TEAM_OF_VERTICAL[v] ? TEAM_OF_VERTICAL[v] : null;
}

async function categoryById(deps: AgentsDeps, id: string | null): Promise<BetCategoryInfo | null> {
  if (!id) return null;
  const r = await deps.prisma.betCategory.findUnique({ where: { id } });
  return r ? toCategory(r as unknown as Record<string, unknown>) : null;
}

/** Une entrée du plan pour un canal et un jour (lecture seule). */
async function planEntry(deps: AgentsDeps, ctx: Ctx, c: ChannelRow, day: string, teams: Map<TeamKey, TeamState>): Promise<PlanEntry> {
  const now = nowOf(deps);
  const plan = ctx.plans.get(c.id);
  const overrides: OverrideView[] = await overridesOf(deps, c.id, day);
  const ov = overrides[0] ?? null;
  const team = ov && isTeamKey(ov.teamKey) ? ov.teamKey : baseTeamOf(c, plan);
  const entry: PlanEntry = {
    channelId: c.id,
    channel: c.title,
    isTest: c.isTest,
    day,
    teamKey: team,
    source: ov ? "ordre" : plan ? "plan" : "aucun",
    enabled: ov ? true : plan?.enabled === true,
    perDay: 0,
    unit: team === "sports" ? "pari" : "post",
    windowStart: ov?.windowStart ?? plan?.windowStart ?? null,
    windowEnd: ov?.windowEnd ?? plan?.windowEnd ?? null,
    format: ov?.format ? formatLabel(ov.format) : mixLabel(ov?.mix ?? plan?.mix ?? null),
    persona: (ov?.personaId ?? plan?.personaId) ? (ctx.personas.get((ov?.personaId ?? plan?.personaId)!) ?? null) : null,
    themes: themeNames(ov?.themes ?? plan?.themes ?? []),
    categories: [],
    passages: [],
    nextPassage: null,
    overrides: overrides.map((o) => ({ ordre: o.orderNumber ?? null, jusquau: o.toDay, equipe: isTeamKey(o.teamKey) ? TEAM_LABELS[o.teamKey] : o.teamKey })),
    created: 0,
    toCreate: 0,
    prepared: false,
    blocked: null,
  };
  const state = team ? (teams.get(team) ?? (await readTeamState(deps, team))) : null;
  if (team && state) teams.set(team, state);
  if (state?.pausedAll) entry.blocked = "pause générale";
  else if (state?.paused) entry.blocked = "équipe en pause";
  else if (state && !state.enabled) entry.blocked = "équipe désactivée";

  if (team === "sports") {
    const s = parseSportsSettings(state?.settings.settings ?? {});
    entry.passages = s.runHours;
    const passageState = await readPassageState(deps);
    entry.nextPassage = nextPassageOf(s.runHours, day, now, passageState.day === parisDay(now) ? passageState.done : []);
    const cats = ov?.betCategoryId ? [await categoryById(deps, ov.betCategoryId)].filter((x): x is BetCategoryInfo => !!x) : ctx.sportsCats.filter((k) => k.channelIds.includes(c.id));
    entry.categories = cats.map((k) => k.name);
    entry.perDay = ov?.picksPerDay ?? cats.reduce((n, k) => n + k.picksPerDay, 0);
    entry.source = ov ? "ordre" : cats.length ? "categories" : "aucun";
    entry.enabled = cats.length > 0;
    entry.windowStart = null;
    entry.windowEnd = null;
    entry.format = null;
    const picks = cats.length
      ? ((await deps.prisma.bettingPick.findMany({
          where: { categoryId: { in: cats.map((k) => k.id) }, status: { in: ["PROPOSED", "PUBLISHED", "WON", "LOST", "VOID"] }, createdAt: { gte: parisDayStart(day), lt: parisDayStart(addDaysToDay(day, 1)) } },
          select: { id: true },
        })) as unknown[])
      : [];
    entry.created = picks.length;
    entry.prepared = picks.length > 0;
    entry.toCreate = entry.blocked || !entry.enabled ? 0 : Math.max(0, entry.perDay - picks.length);
    return entry;
  }

  entry.perDay = ov?.postsPerDay ?? plan?.postsPerDay ?? 0;
  if (team && !chainOf(team).active) entry.blocked = entry.blocked ?? "équipe sans agents de production";
  if (team === "algo") entry.blocked = entry.blocked ?? "l'équipe Algorithme ne publie rien";
  const existing = (await deps.prisma.agentMission.findMany({
    where: ov?.isTest || c.isTest ? { channelId: c.id, planDay: day, status: { not: "CANCELLED" } } : { channelId: c.id, planDay: day, isTest: false, createdBy: "GRAND_CHEF" },
    select: { channelId: true },
  })) as Array<{ channelId: string | null }>;
  entry.created = existing.length;
  entry.prepared = existing.length > 0;
  const activeTeams: TeamKey[] = team && !entry.blocked && entry.enabled ? [team] : [];
  const missing = team ? missingMissions([{ channelId: c.id, teamKey: team, postsPerDay: entry.perDay }], existing, activeTeams) : [];
  entry.toCreate = missing.reduce((n, m) => n + m.count, 0);
  return entry;
}

/** Canaux concernés par la demande (lecture seule). */
async function channelsFor(deps: AgentsDeps, ctx: Ctx, input: ViewPlanInput, day: string): Promise<ChannelRow[]> {
  if (input.channelId) return ctx.channels.filter((c) => c.id === input.channelId);
  const out: ChannelRow[] = [];
  for (const c of ctx.channels) {
    const plan = ctx.plans.get(c.id);
    const ov = (await overridesOf(deps, c.id, day))[0];
    const team = ov && isTeamKey(ov.teamKey) ? ov.teamKey : baseTeamOf(c, plan);
    const concerned = !!plan || !!ov || (team === "sports" && ctx.sportsCats.some((k) => k.channelIds.includes(c.id)));
    if (!concerned) continue;
    if (input.teamKey && team !== input.teamKey) continue;
    out.push(c);
  }
  return out;
}

/** Plan (lecture seule) : une entrée par canal et par jour, puis les lignes de Kevin. */
export async function viewPlan(deps: AgentsDeps, input: ViewPlanInput = {}): Promise<ViewResult & { entries: PlanEntry[] }> {
  const now = nowOf(deps);
  const first = input.day ?? parisDay(now);
  const n = Math.max(1, Math.min(7, Math.round(input.days ?? 1)));
  const ctx = await loadContext(deps);
  const teams = new Map<TeamKey, TeamState>();
  const entries: PlanEntry[] = [];
  for (let i = 0; i < n; i++) {
    const day = addDaysToDay(first, i);
    for (const c of await channelsFor(deps, ctx, input, day)) entries.push(await planEntry(deps, ctx, c, day, teams));
  }
  const facts = {
    jours: [...new Set(entries.map((e) => e.day))],
    canaux: entries.map((e) => ({ ...e, equipe: e.teamKey ? TEAM_LABELS[e.teamKey] : null })),
    equipes: [...teams.values()].map((t) => ({ equipe: t.label, pourDeFaux: t.simulation, pause: t.paused || t.pausedAll, niveau: t.level })),
  };
  return { facts, lines: planLines(entries, [...teams.values()], now, input), entries };
}

/** Lignes de Kevin (pures, à partir des entrées). */
export function planLines(entries: readonly PlanEntry[], teams: readonly TeamState[], now: Date, input: ViewPlanInput = {}): string[] {
  if (!entries.length) {
    if (input.channelId) return ["Rien de prévu sur ce canal : aucun plan réglé."];
    if (input.teamKey) return [`Rien de prévu pour l'équipe ${TEAM_LABELS[input.teamKey]} : aucun canal réglé.`];
    return ["Rien de prévu : aucun canal n'a de plan réglé."];
  }
  const lines: string[] = [];
  const multiDay = new Set(entries.map((e) => e.day)).size > 1;
  for (const e of entries) {
    const when = dayLabel(e.day, now);
    const head = multiDay || entries.length === 1 ? `${e.channel} ${when}` : e.channel;
    if (!e.teamKey || e.source === "aucun") {
      lines.push(`${head} : rien de prévu, aucun plan réglé.`);
      continue;
    }
    if (!e.enabled) {
      lines.push(`${head} : ${e.unit === "pari" ? "aucune catégorie de paris active pour ce canal" : "agents arrêtés sur ce canal"}.`);
      continue;
    }
    const what =
      e.unit === "pari"
        ? `${e.perDay} ${e.perDay > 1 ? "paris" : "pari"}${e.categories.length ? ` (${e.categories.join(", ")})` : ""}${e.passages.length ? `, choisis aux passages de ${e.passages.map((h) => `${h} h`).join(", ")}` : ""}${e.nextPassage ? ` ; prochain passage ${e.nextPassage.startsWith("demain") ? e.nextPassage : `à ${e.nextPassage}`}` : ""}`
        : `${e.perDay} ${e.perDay > 1 ? "posts" : "post"}${e.format ? ` (${e.format})` : ""}${e.windowStart && e.windowEnd ? ` entre ${hhmmLabel(e.windowStart)} et ${hhmmLabel(e.windowEnd)}` : ""}${e.persona ? `, avec ${e.persona}` : ""}${e.themes.length ? `, thèmes ${e.themes.slice(0, 3).join(", ")}` : ""}`;
    lines.push(`${head} : ${what}.`);
    for (const o of e.overrides.slice(0, 1))
      lines.push(`C'est l'ordre${o.ordre ? ` n°${o.ordre}` : ""} qui le demande jusqu'au ${o.jusquau.slice(8, 10)}/${o.jusquau.slice(5, 7)} (équipe ${o.equipe}).`);
    if (e.blocked) lines.push(`Rien ne partira : ${e.blocked}.`);
    else if (!e.prepared && e.toCreate > 0) lines.push(`Pas encore préparé : le Grand Chef en lancera ${e.toCreate} à son passage.`);
    else if (e.prepared) lines.push(`Déjà ${e.created} en route, ${e.toCreate > 0 ? `${e.toCreate} encore à lancer` : "rien d'autre à lancer"}.`);
  }
  for (const t of teams) lines.push(`Équipe ${t.label} : ${t.pausedAll ? "pause générale" : t.paused ? "en pause" : t.simulation ? "pour de faux (tout part sur le canal Test)" : "pour de vrai"}, niveau ${t.level}.`);
  return lines;
}
