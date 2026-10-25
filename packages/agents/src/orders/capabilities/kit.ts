/**
 * Outils communs des capacités (phase 33, chantier A) : déclaration d'une capacité depuis une seule spécification
 * (schéma JSON strict + validation par le code, mêmes règles que les actions de Kevin, plus les listes), période,
 * canaux visés, bornes (quota, fenêtre, mélange), replis, faits des missions d'un ordre. LECTURE SEULE : aucune de ces
 * fonctions n'écrit en base (les capacités écrivent seulement dans `run`).
 */
import { jsonSchemaOf, parseWith, type ParamField } from "../../boss/params";
import { channelRefs, matchNames, type ChannelRef } from "../../boss/resolve";
import { nowOf } from "../../admin/journal";
import { findTestChannel } from "../../agents/data";
import { parseAlgoSettings, allowedHoursFor, type AlgoSettings } from "../../algo/settings";
import { addDaysToDay, hhmmToMinutes, parisDay, parisParts } from "../../rules/time";
import { TEAM_LABELS, type AgentsDeps, type TeamKey } from "../../types";
import type {
  Alternative,
  Capability,
  CapabilityCheck,
  CapabilityPlanContext,
  OrderFacts,
  OrderMode,
  OrderRow,
  OrderStep,
  OrderTeamKey,
  StepResult,
} from "../contract";

// ------------------------------------------------------------------------------------------------ paramètres

export type ListField = { kind: "list"; description: string; optional?: boolean; maxItems?: number };
export type CapField = ParamField | ListField;
export type CapSpec = Record<string, CapField>;

export const list = (description: string, opts: { optional?: boolean; maxItems?: number } = {}): ListField => ({ kind: "list", description, ...opts });

/** Schéma JSON strict (listes de textes comprises). */
export function capSchema(spec: CapSpec): Record<string, unknown> {
  const plain: Record<string, ParamField> = {};
  const lists: Record<string, ListField> = {};
  for (const [k, f] of Object.entries(spec)) {
    if (f.kind === "list") lists[k] = f;
    else plain[k] = f;
  }
  const schema = jsonSchemaOf(plain) as { properties: Record<string, unknown>; required: string[] };
  for (const [k, f] of Object.entries(lists)) {
    schema.properties[k] = { type: "array", items: { type: "string", maxLength: 200 }, maxItems: f.maxItems ?? 10, description: f.description };
    if (!f.optional) schema.required.push(k);
  }
  return schema as Record<string, unknown>;
}

/** Validation par le code : aucune clé inconnue, types et bornes, listes de textes (un texte seul = liste d'un). */
export function capParse<P>(spec: CapSpec, input: unknown): { ok: true; params: P } | { ok: false; error: string } {
  const raw = input ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "paramètres : objet attendu" };
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!(k in spec)) return { ok: false, error: `paramètre inconnu : ${k}` };
  const plainSpec: Record<string, ParamField> = {};
  const plainIn: Record<string, unknown> = {};
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(spec)) {
    if (f.kind !== "list") {
      plainSpec[k] = f;
      if (k in obj) plainIn[k] = obj[k];
      continue;
    }
    const v = obj[k];
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) {
      if (f.optional) continue;
      return { ok: false, error: `paramètre manquant : ${k}` };
    }
    const arr = Array.isArray(v) ? v : [v];
    if (arr.length > (f.maxItems ?? 10)) return { ok: false, error: `${k} : ${f.maxItems ?? 10} éléments au plus` };
    const items: string[] = [];
    for (const x of arr) {
      if (typeof x !== "string" || !x.trim()) return { ok: false, error: `${k} : liste de textes attendue` };
      if (x.trim().length > 200) return { ok: false, error: `${k} : texte trop long` };
      if (!items.includes(x.trim())) items.push(x.trim());
    }
    out[k] = items;
  }
  const r = parseWith<Record<string, unknown>>(plainSpec, plainIn);
  if (!r.ok) return r;
  return { ok: true, params: { ...r.params, ...out } as P };
}

export type CapabilityDef<P> = Omit<Capability<P>, "params" | "parse"> & {
  spec: CapSpec;
  /** Contrôle supplémentaire après les types (pur). */
  refine?: (p: P) => string | null;
};

/** Déclare une capacité : `params` (schéma envoyé au planificateur) et `parse` viennent de la même spécification. */
export function defineCapability<P>(def: CapabilityDef<P>): Capability<P> {
  const { spec, refine, ...rest } = def;
  return {
    ...rest,
    params: capSchema(spec),
    parse(input) {
      const r = capParse<P>(spec, input);
      if (!r.ok) return r;
      const extra = refine?.(r.params);
      return extra ? { ok: false, error: extra } : r;
    },
  };
}

// Champs communs (mêmes noms partout : le planificateur les apprend une fois).
export const F = {
  canaux: list("Canaux visés, tels que dits (titre ou prénom de la persona) ; absent avec test = canal Test", { optional: true }),
  test: { kind: "bool", description: "true = sur le canal Test", optional: true } as ParamField,
  jours: { kind: "int", description: "Durée en jours (30 au plus ; au-delà, ramenée à 30)", min: 1, max: 365, optional: true } as ParamField,
  debut: { kind: "string", description: "Premier jour AAAA-MM-JJ (heure de Paris) ; absent = aujourd'hui avant 20 h, sinon demain", optional: true, maxLength: 10 } as ParamField,
  mode: { kind: "enum", description: "simulation (par défaut) ou vrai", values: ["simulation", "vrai"], optional: true } as ParamField,
  fenetreDebut: { kind: "string", description: "Début de la fenêtre horaire HH:MM (heure de Paris)", optional: true, maxLength: 5 } as ParamField,
  fenetreFin: { kind: "string", description: "Fin de la fenêtre horaire HH:MM (heure de Paris)", optional: true, maxLength: 5 } as ParamField,
};

// ------------------------------------------------------------------------------------------------ résultats

export const ok = (): CapabilityCheck => ({ ok: true });

/** Refus avec la raison et 4 replis au plus (doublons retirés). */
export function refuse(reason: string, alternatives: Alternative[]): CapabilityCheck {
  const seen = new Set<string>();
  const alts = alternatives.filter((a) => {
    const k = a.label;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ok: false, reason, alternatives: alts.slice(0, 4) };
}

export function alt(label: string, teamKey: OrderTeamKey, key: string, params: Record<string, unknown>): Alternative {
  return { label, capability: { teamKey, key, params: JSON.parse(JSON.stringify(params)) as Record<string, unknown> } };
}

export const done = (message: string, extra: Partial<StepResult> = {}): StepResult => ({ ok: true, message, ...extra });
export const failed = (message: string, retryable = false): StepResult => ({ ok: false, message, retryable });

// ------------------------------------------------------------------------------------------------ période

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Premier jour par défaut : aujourd'hui avant 20 h (Paris), sinon demain (pur). */
export function defaultStartDay(now: Date): string {
  return parisParts(now).hour < 20 ? parisDay(now) : addDaysToDay(parisDay(now), 1);
}

/** « 25 octobre » (pur). */
export function frDay(day: string): string {
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d === 1 ? "1er" : d} ${MONTHS[m - 1] ?? ""}`.trim();
}

/** « du 25 au 27 octobre » / « le 25 octobre » (pur). */
export function frRange(fromDay: string, toDay: string): string {
  if (fromDay === toDay) return `le ${frDay(fromDay)}`;
  const sameMonth = fromDay.slice(0, 7) === toDay.slice(0, 7);
  return `du ${sameMonth ? frDay(fromDay).split(" ")[0] : frDay(fromDay)} au ${frDay(toDay)}`;
}

export const MAX_ORDER_DAYS = 30;

export type ResolvedPeriod = { start: string; days: number; toDay: string; clamped: string[] };

/** Période résolue et bornée : début jamais dans le passé, 1 à 30 jours (pur). */
export function resolvePeriod(p: { debut?: string; jours?: number }, ctx: Pick<CapabilityPlanContext, "now" | "period">, defaultDays = 1): ResolvedPeriod {
  const clamped: string[] = [];
  const today = parisDay(ctx.now);
  let start = p.debut && DAY_RE.test(p.debut) ? p.debut : ctx.period?.start && DAY_RE.test(ctx.period.start) ? ctx.period.start : defaultStartDay(ctx.now);
  if (start < today) {
    clamped.push(`début ${frDay(start)} déjà passé → ${frDay(today)}`);
    start = today;
  }
  let days = Math.round(p.jours ?? ctx.period?.days ?? defaultDays);
  if (!Number.isFinite(days) || days < 1) days = 1;
  if (days > MAX_ORDER_DAYS) {
    clamped.push(`${days} jours → ${MAX_ORDER_DAYS}, la durée maximale d'un ordre`);
    days = MAX_ORDER_DAYS;
  }
  return { start, days, toDay: addDaysToDay(start, days - 1), clamped };
}

// ------------------------------------------------------------------------------------------------ bornes

/** Réglages de l'équipe Algorithme (bornes) SANS écriture (`loadAlgoTeam` crée l'équipe si elle manque). */
export async function readAlgoBounds(deps: Pick<AgentsDeps, "prisma">): Promise<AlgoSettings> {
  const row = (await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: "algo" } })) as { settings?: unknown } | null;
  const s = row?.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>).algo : undefined;
  return parseAlgoSettings(s);
}

/** Quantité par jour ramenée dans la borne (pur). */
export function clampPerDay(n: number, max: number, what: string, where: string): { value: number; note: string | null } {
  const v = Math.max(1, Math.round(n));
  if (v <= max) return { value: v, note: null };
  return { value: max, note: `${v} ${what} par jour → ${max}, le maximum ${where}` };
}

export function isHhmm(v: string | undefined | null): v is string {
  return typeof v === "string" && hhmmToMinutes(v) !== null;
}

/** Fenêtre ramenée dans les heures autorisées du canal (pur). */
export function clampWindow(
  start: string,
  end: string,
  allowed: { start: string; end: string },
): { start: string; end: string; note: string | null } {
  const s = hhmmToMinutes(start) ?? 0;
  const e = hhmmToMinutes(end) ?? 1440;
  const a = hhmmToMinutes(allowed.start) ?? 0;
  const b = hhmmToMinutes(allowed.end) ?? 1440;
  const cs = Math.max(s, a);
  const ce = Math.min(e, b);
  if (cs === s && ce === e) return { start, end, note: null };
  if (ce <= cs) return { start: allowed.start, end: allowed.end, note: `fenêtre ${start}-${end} hors des heures autorisées → ${allowed.start}-${allowed.end}` };
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { start: hh(cs), end: hh(ce), note: `fenêtre ${start}-${end} → ${hh(cs)}-${hh(ce)}, les heures autorisées du canal` };
}

export function windowAllowedFor(settings: AlgoSettings, channelId: string): { start: string; end: string } {
  return allowedHoursFor(settings, channelId);
}

export type Mix = { video: number; photo: number; text: number };

const shares = (m: Mix) => {
  const t = Math.max(1e-9, m.video + m.photo + m.text);
  return { video: (m.video / t) * 100, photo: (m.photo / t) * 100, text: (m.text / t) * 100 };
};

/** Mélange demandé, rapproché du mélange actuel de `maxPoints` points au plus par part (en %) (pur). */
export function clampMix(wanted: Mix, base: Mix, maxPoints: number): { mix: Mix; note: string | null } {
  const w = shares(wanted);
  const b = shares(base);
  const diff = Math.max(Math.abs(w.video - b.video), Math.abs(w.photo - b.photo), Math.abs(w.text - b.text));
  if (diff <= maxPoints + 0.5) return { mix: wanted, note: null };
  const k = maxPoints / diff;
  const m = { video: Math.round(b.video + (w.video - b.video) * k), photo: Math.round(b.photo + (w.photo - b.photo) * k), text: 0 };
  m.text = Math.max(0, 100 - m.video - m.photo);
  return { mix: m, note: `mélange ramené à vidéo ${m.video} / photo ${m.photo} / texte ${m.text} (${maxPoints} points au plus par semaine)` };
}

// ------------------------------------------------------------------------------------------------ canaux

export type ScopeChannel = { id: string; title: string; isTest: boolean; vertical: string | null; team: TeamKey | null };

export type ScopeResult = { ok: true; channels: ScopeChannel[]; test: boolean } | { ok: false; reason: string; alternatives: Alternative[] };

const TEST_WORDS = new Set(["test", "canal test", "le canal test", "canal de test", "le canal de test", "tests"]);

function toScope(c: ChannelRef): ScopeChannel {
  return { id: c.id, title: c.name, isTest: c.isTest, vertical: c.vertical, team: c.team };
}

/**
 * Canaux visés par un ordre d'une équipe (lecture seule) : canal Test (`test` ou « canal test »), sinon titres
 * retrouvés ; un vrai canal d'un autre univers est refusé (il garde son univers) avec des replis : le canal Test
 * « comme si », ou un canal de l'équipe.
 */
export async function resolveScope(
  deps: AgentsDeps,
  p: { canaux?: string[]; test?: boolean },
  team: TeamKey,
  replay: { teamKey: OrderTeamKey; key: string; params: Record<string, unknown> },
): Promise<ScopeResult> {
  const names = (p.canaux ?? []).filter((n) => !TEST_WORDS.has(n.trim().toLowerCase()));
  const wantsTest = p.test === true || (p.canaux ?? []).some((n) => TEST_WORDS.has(n.trim().toLowerCase()));
  const refs = await channelRefs(deps);
  const teamRefs = refs.filter((c) => c.team === team && !c.isTest);
  const teamAlts = teamRefs.slice(0, 3).map((c) => alt(`sur ${c.name}`, replay.teamKey, replay.key, { ...replay.params, canaux: [c.name], test: undefined }));
  const testAlt = alt("sur le canal Test, pour de faux", replay.teamKey, replay.key, { ...replay.params, canaux: undefined, test: true });
  const out: ScopeChannel[] = [];
  if (wantsTest) {
    const test = await findTestChannel(deps.prisma);
    if (!test) return { ok: false, reason: "Il n'y a pas de canal Test : coche « canal de test » sur un canal (page Canaux).", alternatives: teamAlts };
    out.push({ id: test.id, title: test.title, isTest: true, vertical: test.vertical, team: null });
  }
  if (!wantsTest && !names.length)
    return { ok: false, reason: `Sur quel canal ? (${TEAM_LABELS[team]})`, alternatives: [testAlt, ...teamAlts] };
  for (const raw of names) {
    const found = matchNames(raw, refs.map((c) => ({ ...c, extra: c.personaName ? [c.personaName] : [] })));
    if (!found.length) return { ok: false, reason: `Je ne trouve pas le canal « ${raw.slice(0, 60)} ».`, alternatives: [...teamAlts, testAlt] };
    if (found.length > 1 && !found.some((f) => f.name.toLowerCase() === raw.toLowerCase()))
      return {
        ok: false,
        reason: `Plusieurs canaux correspondent à « ${raw.slice(0, 60)} ».`,
        alternatives: found.slice(0, 4).map((c) => alt(c.name, replay.teamKey, replay.key, { ...replay.params, canaux: [c.name] })),
      };
    const c = found.find((f) => f.name.toLowerCase() === raw.toLowerCase()) ?? found[0]!;
    if (c.isTest) {
      if (!out.some((x) => x.id === c.id)) out.push(toScope(c));
      continue;
    }
    if (c.team !== team)
      return {
        ok: false,
        reason: `${c.name} est un canal ${c.team ? TEAM_LABELS[c.team] : "sans univers"} : un vrai canal garde son univers, l'équipe ${TEAM_LABELS[team]} n'y publie pas.`,
        alternatives: [testAlt, ...teamAlts],
      };
    if (!out.some((x) => x.id === c.id)) out.push(toScope(c));
  }
  return { ok: true, channels: out, test: out.length > 0 && out.every((c) => c.isTest) };
}

export function modeOf(p: { mode?: string }, ctx?: { mode?: OrderMode }): OrderMode {
  if (p.mode === "vrai" || p.mode === "real") return "real";
  if (p.mode === "simulation") return "simulation";
  return ctx?.mode ?? "simulation";
}

export function channelsLabel(channels: readonly ScopeChannel[]): string {
  if (!channels.length) return "aucun canal";
  return channels.map((c) => (c.isTest ? "le canal Test" : c.title)).join(", ");
}

// ------------------------------------------------------------------------------------------------ faits d'un ordre

export type OrderMissionFacts = {
  missions: number;
  done: number;
  failed: number;
  cancelled: number;
  blockedBudget: number;
  waitingValidation: number;
  inProgress: number;
  postIds: string[];
  perDay: Array<{ day: string; done: number; failed: number; inProgress: number; postIds: string[] }>;
  errors: string[];
};

type MissionLite = { id: string; status: string; planDay: string | null; postId: string | null; lastError: string | null; createdAt: Date };

/** Missions d'un ordre (comptes par statut et par jour, posts publiés) : seule source des chiffres des rapports. */
export async function orderMissionFacts(deps: Pick<AgentsDeps, "prisma">, orderId: string): Promise<OrderMissionFacts> {
  const rows = (await deps.prisma.agentMission.findMany({
    where: { orderId },
    select: { id: true, status: true, planDay: true, postId: true, lastError: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })) as MissionLite[];
  const posts = rows.length
    ? ((await deps.prisma.post.findMany({ where: { agentMissionId: { in: rows.map((r) => r.id) } }, select: { id: true, agentMissionId: true } })) as Array<{ id: string; agentMissionId: string | null }>)
    : [];
  const postsOf = (id: string, own: string | null) => [...new Set([...(own ? [own] : []), ...posts.filter((p) => p.agentMissionId === id).map((p) => p.id)])];
  const days = new Map<string, OrderMissionFacts["perDay"][number]>();
  const out: OrderMissionFacts = { missions: rows.length, done: 0, failed: 0, cancelled: 0, blockedBudget: 0, waitingValidation: 0, inProgress: 0, postIds: [], perDay: [], errors: [] };
  for (const r of rows) {
    const day = r.planDay ?? parisDay(r.createdAt);
    const d = days.get(day) ?? { day, done: 0, failed: 0, inProgress: 0, postIds: [] };
    if (r.status === "DONE") {
      out.done++;
      d.done++;
      const ids = postsOf(r.id, r.postId);
      out.postIds.push(...ids);
      d.postIds.push(...ids);
    } else if (r.status === "FAILED") {
      out.failed++;
      d.failed++;
      if (r.lastError) out.errors.push(r.lastError.slice(0, 160));
    } else if (r.status === "CANCELLED") out.cancelled++;
    else if (r.status === "BLOCKED_BUDGET") {
      out.blockedBudget++;
      if (r.lastError) out.errors.push(r.lastError.slice(0, 160));
    } else {
      out.inProgress++;
      d.inProgress++;
      if (r.status === "WAITING_VALIDATION") out.waitingValidation++;
    }
    days.set(day, d);
  }
  out.perDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  out.errors = [...new Set(out.errors)].slice(0, 5);
  return out;
}

/** Rapport standard d'une capacité qui fait des missions : faits des missions + étiquette. */
export async function missionsReport(deps: AgentsDeps, order: OrderRow, extra: OrderFacts = {}): Promise<OrderFacts> {
  const f = await orderMissionFacts(deps, order.id);
  return { ordre: order.number, ...f, ...extra };
}

/** Capacité de lecture : rien à poser, `run` rend les lignes des faits. */
export function askStep(capability: string, teamKey: OrderTeamKey, summary: string, params: Record<string, unknown>): OrderStep {
  return { stepKey: `${capability}`, capability, teamKey, summary, params };
}

export function nowFor(deps: AgentsDeps): Date {
  return nowOf(deps);
}

/** Acteur journalisé d'un ordre (l'admin qui l'a donné). */
export function orderActor(order: Pick<OrderRow, "createdById">): { userId: string | null; via: "TELEGRAM" } {
  return { userId: order.createdById ?? null, via: "TELEGRAM" };
}
