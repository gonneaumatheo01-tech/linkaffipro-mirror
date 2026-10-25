/**
 * Page Agents → Ordres (`/agents/orders`, phase 33) : les ordres donnés par l'admin à une équipe, par Kevin
 * (contrat `packages/agents/src/orders/contract.ts`). Règles pures (testées dans orders.test.ts) : filtres, lecture
 * tolérante du plan validé, des impossibles et de la progression (JSON en base, jamais affiché brut), plan en mots,
 * réglage temporaire d'un canal (`ChannelPlanOverride`), chronologie, droits, regroupement des demandes impossibles.
 * À l'écran, une `ChannelPlanOverride` s'appelle « réglage temporaire » (le mot « dérogation » reste dans le code).
 */
import type { Prisma } from "@linkaffipro/db";
import { ORDER_LIMITS, type OrderTeamKey } from "@linkaffipro/agents";
import { fmtDayKey } from "@/lib/periods";
import { statusLabel } from "@/lib/status-badges";
import { teamName } from "./teams";

export const ORDERS_PATH = "/agents/orders";

export function orderHref(id: string): string {
  return `${ORDERS_PATH}/${encodeURIComponent(id)}`;
}

export function orderTitle(number: number): string {
  return `Ordre n°${number}`;
}

/** Arrêter et prolonger : administrateurs seulement (MANAGER : lecture seule). */
export function canManageOrders(role: string): boolean {
  return role === "ADMIN";
}

/** Exemple montré quand il n'y a pas encore d'ordre (la phrase du client du 24 octobre). */
export const ORDER_EXAMPLE =
  "Demandez à Kevin : « Sur le canal de test faisons comme si c'était un canal Paris sportifs, programme les paris pour 3 jours, avec comme thème les hors-jeux »";

// ── Équipes et statuts ─────────────────────────────────────────────────────────────────────────────────────────────

export const ORDER_TEAMS = ["dating", "casino", "sports", "algo", "ads", "inspiration", "transverse"] as const satisfies readonly OrderTeamKey[];
export type OrderTeam = (typeof ORDER_TEAMS)[number];

export const ORDER_STATUSES = ["DRAFT", "WAITING_CONFIRM", "RUNNING", "DONE", "CANCELLED", "BLOCKED", "FAILED"] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

const EXTRA_TEAM_NAMES: Record<string, string> = {
  ads: "Agent Ads",
  inspiration: "Inspiration",
  transverse: "Toutes les équipes",
  // Équipes des phases 28 à 32 (affichées dès qu'un ordre ou une demande les vise).
  montage: "Montage",
  analystes: "Analystes",
  qa: "Contrôle global",
  prospection: "Prospection",
};

export function orderTeamName(team: string | null | undefined): string {
  if (!team) return "Équipe à définir";
  return EXTRA_TEAM_NAMES[team] ?? teamName(team);
}

export type OrderFilters = { team: OrderTeam | ""; status: OrderStatusValue | "" };

const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export function parseOrderFilters(sp: Record<string, unknown>): OrderFilters {
  const team = one(sp.team);
  const status = one(sp.status);
  return {
    team: (ORDER_TEAMS as readonly string[]).includes(team as string) ? (team as OrderTeam) : "",
    status: (ORDER_STATUSES as readonly string[]).includes(status as string) ? (status as OrderStatusValue) : "",
  };
}

export function ordersWhere(f: OrderFilters): Prisma.TeamOrderWhereInput {
  return {
    ...(f.team ? { teamKey: f.team } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
}

/** Un ordre encore vivant peut être arrêté (missions non commencées annulées, réglage temporaire clos). */
export function canStop(status: string): boolean {
  return status === "RUNNING" || status === "WAITING_CONFIRM" || status === "BLOCKED" || status === "DRAFT";
}

/** Seul un ordre en cours se prolonge. */
export function canExtend(status: string): boolean {
  return status === "RUNNING";
}

export const EXTEND_CHOICES = [1, 2, 3, 7] as const;

/** Nombre de jours de prolongation lu dans le formulaire (1 à 30), `null` sinon. */
export function parseExtendDays(v: unknown): number | null {
  const n = typeof v === "string" && /^\d{1,2}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= ORDER_LIMITS.maxDays ? n : null;
}

export function safeOrderId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

/** Résultat d'une fonction du moteur (`{ ok, message }` ou rien) en message pour l'écran. */
export function orderEngineResult(r: unknown, fallback: string): { ok: boolean; message: string } {
  if (isObj(r)) {
    const ok = typeof r.ok === "boolean" ? r.ok : true;
    const message = typeof r.message === "string" && r.message.trim() ? r.message.trim() : fallback;
    return { ok, message };
  }
  return { ok: true, message: fallback };
}

// ── Lecture tolérante du JSON en base ─────────────────────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : []);

export type ScopeView = { kind: "channels"; channelIds: string[] } | { kind: "test" } | { kind: "team" } | null;
export type StepPlanView = { capability: string; teamKey: string; params: Record<string, unknown> };
export type ResolvedView = { key: string; value: unknown; from: string | null };

export type PlanView = {
  teamKey: string | null;
  asIfTeamKey: string | null;
  scope: ScopeView;
  kind: string | null;
  period: { start: string; days: number } | null;
  perDay: number | null;
  theme: string | null;
  categoryId: string | null;
  format: string | null;
  mode: "simulation" | "real" | null;
  steps: StepPlanView[];
  resolved: ResolvedView[];
  questions: string[];
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseScope(v: unknown): ScopeView {
  if (!isObj(v)) return null;
  if (v.test === true) return { kind: "test" };
  if (v.teamWide === true) return { kind: "team" };
  const ids = strs(v.channelIds);
  return ids.length ? { kind: "channels", channelIds: ids } : null;
}

/** Plan validé (`TeamOrder.interpretation`), lu sans jamais planter sur un champ absent ou mal formé. */
export function parsePlan(v: unknown): PlanView {
  const o = isObj(v) ? v : {};
  const p = isObj(o.period) ? o.period : null;
  const start = p ? str(p.start) : null;
  const days = p ? num(p.days) : null;
  const mode = o.mode === "real" || o.mode === "simulation" ? o.mode : null;
  const steps = Array.isArray(o.steps)
    ? o.steps.filter(isObj).map((s) => ({
        capability: str(s.capability) ?? "",
        teamKey: str(s.teamKey) ?? str(o.teamKey) ?? "",
        params: isObj(s.params) ? s.params : {},
      }))
    : [];
  const resolved = isObj(o.resolved)
    ? Object.entries(o.resolved).map(([key, r]) =>
        isObj(r) && "value" in r ? { key, value: r.value, from: str(r.from) } : { key, value: r, from: null },
      )
    : [];
  return {
    teamKey: str(o.teamKey),
    asIfTeamKey: str(o.asIfTeamKey),
    scope: parseScope(o.scope),
    kind: str(o.kind),
    period: start && DAY_RE.test(start) && days && days > 0 ? { start, days: Math.round(days) } : null,
    perDay: num(o.perDay),
    theme: str(o.theme),
    categoryId: str(o.categoryId),
    format: str(o.format),
    mode,
    steps: steps.filter((s) => s.capability),
    resolved,
    questions: strs(o.questions),
  };
}

export type ImpossibleView = { part: string; reason: string; alternatives: string[] };

export function parseImpossible(v: unknown): ImpossibleView[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).flatMap((x) => {
    const part = str(x.part);
    const reason = str(x.reason);
    if (!part && !reason) return [];
    const alternatives = Array.isArray(x.alternatives)
      ? x.alternatives.map((a) => (isObj(a) ? str(a.label) : str(a))).filter((s): s is string => s !== null)
      : [];
    return [{ part: part ?? "Une partie de la demande", reason: reason ?? "", alternatives }];
  });
}

export type DayProgress = { day: string; done: number; failed: number; postIds: string[] };
export type ProgressView = { planned: number; done: number; failed: number; lastReportAt: Date | null; perDay: DayProgress[] };

export function parseProgress(v: unknown): ProgressView {
  const o = isObj(v) ? v : {};
  const at = str(o.lastReportAt);
  const d = at ? new Date(at) : null;
  return {
    planned: num(o.missionsPlanned) ?? 0,
    done: num(o.missionsDone) ?? 0,
    failed: num(o.missionsFailed) ?? 0,
    lastReportAt: d && !Number.isNaN(d.getTime()) ? d : null,
    perDay: Array.isArray(o.perDay)
      ? o.perDay
          .filter(isObj)
          .map((p) => ({ day: str(p.day) ?? "", done: num(p.done) ?? 0, failed: num(p.failed) ?? 0, postIds: strs(p.postIds) }))
          .filter((p) => DAY_RE.test(p.day))
          .sort((a, b) => a.day.localeCompare(b.day))
      : [],
  };
}

// ── Missions, progression, coût ───────────────────────────────────────────────────────────────────────────────────

export type MissionCounts = { total: number; done: number; failed: number; waiting: number; cancelled: number };

export function missionCounts(statuses: readonly string[]): MissionCounts {
  const c: MissionCounts = { total: statuses.length, done: 0, failed: 0, waiting: 0, cancelled: 0 };
  for (const s of statuses) {
    if (s === "DONE") c.done++;
    else if (s === "FAILED" || s === "BLOCKED_BUDGET") c.failed++;
    else if (s === "WAITING_VALIDATION" || s === "WAITING_HUMAN") c.waiting++;
    else if (s === "CANCELLED") c.cancelled++;
  }
  return c;
}

/** Progression affichée : le plus grand des deux (chiffres tenus par le Grand Chef, missions réellement en base). */
export function progressFigures(p: ProgressView, c: MissionCounts): { planned: number; done: number; failed: number; waiting: number } {
  return {
    planned: Math.max(p.planned, c.total - c.cancelled),
    done: Math.max(p.done, c.done),
    failed: Math.max(p.failed, c.failed),
    waiting: c.waiting,
  };
}

export function progressText(f: { planned: number; done: number; failed: number; waiting: number }, status: string): string {
  if (f.planned === 0 && f.done === 0) {
    if (status === "WAITING_CONFIRM") return "Attend votre OUI";
    if (status === "DRAFT") return "En préparation";
    if (status === "RUNNING") return "Première production à venir";
    return "Aucune mission";
  }
  const parts = [`${f.done} sur ${Math.max(f.planned, f.done)} faite${f.done > 1 ? "s" : ""}`];
  if (f.waiting) parts.push(`${f.waiting} à valider`);
  if (f.failed) parts.push(`${f.failed} en échec`);
  return parts.join(" · ");
}

/** Pourcentage de la barre de progression (0 à 100). */
export function progressPercent(f: { planned: number; done: number }): number {
  const total = Math.max(f.planned, f.done);
  return total > 0 ? Math.min(100, Math.round((f.done / total) * 100)) : 0;
}

/** Coût d'un ordre : celui tenu sur l'ordre, sinon la somme de ses missions. */
export function orderCostCents(orderCents: number, missionCents: readonly number[]): number {
  return orderCents > 0 ? orderCents : missionCents.reduce((s, c) => s + c, 0);
}

// ── Période ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function addDayKey(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type PeriodView = { from: string | null; to: string | null; days: number | null };

/** Période de l'ordre : celle du plan (jours de Paris), sinon les dates de début et de fin posées sur l'ordre. */
export function orderPeriod(plan: Pick<PlanView, "period">, startsAt: Date | null, endsAt: Date | null, toParisDay: (d: Date) => string): PeriodView {
  if (plan.period) return { from: plan.period.start, to: addDayKey(plan.period.start, plan.period.days - 1), days: plan.period.days };
  const from = startsAt ? toParisDay(startsAt) : null;
  const to = endsAt ? toParisDay(endsAt) : null;
  const days = from && to && to >= from ? Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1 : null;
  return { from, to, days };
}

export function periodText(p: PeriodView): string {
  if (!p.from && !p.to) return "Tout de suite";
  if (p.from && (!p.to || p.to === p.from)) return `Le ${fmtDayKey(p.from)}`;
  if (!p.from) return `Jusqu'au ${fmtDayKey(p.to!)}`;
  const sameYear = p.from.slice(0, 4) === p.to!.slice(0, 4);
  return `Du ${fmtDayKey(p.from, !sameYear)} au ${fmtDayKey(p.to!)}${p.days ? ` (${p.days} jour${p.days > 1 ? "s" : ""})` : ""}`;
}

// ── Plan en mots ──────────────────────────────────────────────────────────────────────────────────────────────────

export type NameLookup = {
  channels?: ReadonlyMap<string, string>;
  categories?: ReadonlyMap<string, string>;
  personas?: ReadonlyMap<string, string>;
  /** Description de chaque capacité du registre, par `équipe:clé`. */
  capabilities?: ReadonlyMap<string, string>;
};

export function modeText(mode: string | null | undefined): string {
  if (mode === "real") return "En vrai (sur les vrais canaux)";
  if (mode === "simulation") return "Pour de faux (sur le canal Test)";
  return "Non précisé";
}

const FORMAT_LABELS: Record<string, string> = {
  video: "vidéo",
  photo: "photo",
  image: "photo",
  text: "texte",
  texte: "texte",
  screenshot: "capture d'écran",
};

export function formatText(format: string): string {
  return FORMAT_LABELS[format.toLowerCase()] ?? format;
}

export function scopeText(scope: ScopeView, names: NameLookup = {}): string {
  if (!scope) return "Non précisé";
  if (scope.kind === "test") return "Canal Test";
  if (scope.kind === "team") return "Tous les canaux de l'équipe";
  return scope.channelIds.map((id) => names.channels?.get(id) ?? "canal retiré").join(", ");
}

/** Libellés des paramètres et des valeurs résolues (clés du planificateur et des capacités). */
const PARAM_LABELS: Record<string, string> = {
  start: "Début",
  days: "Nombre de jours",
  period: "Période",
  perDay: "Par jour",
  picksPerDay: "Paris par jour",
  postsPerDay: "Posts par jour",
  theme: "Thème",
  themes: "Thèmes",
  channelId: "Canal",
  channelIds: "Canaux",
  channel: "Canal",
  scope: "Où",
  test: "Canal Test",
  categoryId: "Catégorie de paris",
  betCategoryId: "Catégorie de paris",
  category: "Catégorie de paris",
  format: "Format",
  mix: "Mélange",
  personaId: "Persona",
  persona: "Persona",
  windowStart: "Début de la fenêtre",
  windowEnd: "Fin de la fenêtre",
  window: "Fenêtre",
  mode: "Mode",
  bookmaker: "Bookmaker",
  minOdds: "Cote minimum",
  maxOdds: "Cote maximum",
  odds: "Fourchette de cotes",
  oddsMin: "Cote minimum",
  oddsMax: "Cote maximum",
  leagues: "Ligues",
  teamKey: "Équipe",
  asIfTeamKey: "Faire comme si",
  offer: "Bouton d'offre",
  offerButton: "Bouton d'offre",
  active: "Active",
  question: "Question",
  text: "Texte",
  durationDays: "Durée (jours)",
  setting: "Réglage",
  value: "Valeur",
  referenceId: "Canal d'inspiration",
};

export function paramLabel(key: string): string {
  if (PARAM_LABELS[key]) return PARAM_LABELS[key];
  const spaced = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const ID_KEYS: Record<string, keyof NameLookup> = {
  channelId: "channels",
  channelIds: "channels",
  categoryId: "categories",
  betCategoryId: "categories",
  personaId: "personas",
};

/** Une valeur en mots (jamais de JSON) : listes jointes, oui / non, objets « clé : valeur », identifiants nommés. */
export function valueText(value: unknown, key = "", names: NameLookup = {}): string {
  const lookup = ID_KEYS[key] ? names[ID_KEYS[key]] : undefined;
  const named = (v: unknown) => {
    if (typeof v === "string") return lookup && "get" in lookup ? ((lookup as ReadonlyMap<string, string>).get(v) ?? v) : v;
    return valueText(v, "", names);
  };
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toLocaleString("fr-FR");
  if (typeof value === "string") {
    if (key === "mode") return modeText(value);
    if (key === "teamKey" || key === "asIfTeamKey") return orderTeamName(value);
    if (key === "format") return formatText(value);
    if (DAY_RE.test(value)) return fmtDayKey(value);
    return named(value);
  }
  if (Array.isArray(value)) return value.length ? value.map(named).join(", ") : "—";
  if (isObj(value)) {
    if (key === "scope") return scopeText(parseScope(value), names);
    if (key === "period" && str(value.start) && num(value.days)) {
      const s = str(value.start)!;
      const d = num(value.days)!;
      return periodText({ from: s, to: addDayKey(s, d - 1), days: d });
    }
    const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined);
    if (key === "mix") return mixText(value);
    return entries.length ? entries.map(([k, v]) => `${paramLabel(k).toLowerCase()} ${valueText(v, k, names)}`).join(", ") : "—";
  }
  return "—";
}

/** Mélange `{ video: 1, photo: 2, text: 1 }` → « 1 vidéo, 2 photos, 1 texte ». */
export function mixText(mix: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(mix)) {
    const n = num(v);
    if (n === null || n <= 0) continue;
    const label = formatText(k);
    out.push(`${n} ${n > 1 && !label.includes(" ") && !label.endsWith("s") ? `${label}s` : label}`);
  }
  return out.length ? out.join(", ") : "—";
}

export function paramsInWords(params: Record<string, unknown>, names: NameLookup = {}): string[] {
  return Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${paramLabel(k)} : ${valueText(v, k, names)}`);
}

/** Nom d'une capacité : sa description dans le registre, sinon sa clé en mots (« programmer paris »). */
export function capabilityText(teamKey: string, key: string, names: NameLookup = {}): string {
  const d = names.capabilities?.get(`${teamKey}:${key}`) ?? names.capabilities?.get(key);
  if (d) return d.charAt(0).toUpperCase() + d.slice(1);
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export type PlanLine = { label: string; value: string };

/** Lignes principales du plan validé (équipe, où, période, quantité, thème, catégorie, format, mode). */
export function planLines(plan: PlanView, names: NameLookup = {}): PlanLine[] {
  const lines: PlanLine[] = [];
  if (plan.teamKey) lines.push({ label: "Équipe", value: orderTeamName(plan.teamKey) });
  if (plan.asIfTeamKey)
    lines.push({ label: "Faire comme si", value: `Le canal Test est traité comme un canal ${orderTeamName(plan.asIfTeamKey)} pendant la période` });
  lines.push({ label: "Où", value: scopeText(plan.scope, names) });
  if (plan.kind) lines.push({ label: "Genre d'ordre", value: statusLabel("teamOrderKind", plan.kind) });
  if (plan.period) lines.push({ label: "Période", value: periodText({ from: plan.period.start, to: addDayKey(plan.period.start, plan.period.days - 1), days: plan.period.days }) });
  if (plan.perDay !== null) lines.push({ label: "Par jour", value: String(plan.perDay) });
  if (plan.theme) lines.push({ label: "Thème", value: plan.theme });
  if (plan.categoryId) lines.push({ label: "Catégorie de paris", value: names.categories?.get(plan.categoryId) ?? "catégorie retirée" });
  if (plan.format) lines.push({ label: "Format", value: formatText(plan.format) });
  lines.push({ label: "Mode", value: modeText(plan.mode) });
  return lines;
}

/** Valeurs que Kevin a déduites, avec leur provenance (« défaut du système », « catégorie active », « demande »). */
export function resolvedLines(plan: PlanView, names: NameLookup = {}): PlanLine[] {
  return plan.resolved.map((r) => ({
    label: paramLabel(r.key),
    value: `${valueText(r.value, r.key, names)}${r.from ? ` (${r.from})` : ""}`,
  }));
}

// ── Réglage temporaire d'un canal (`ChannelPlanOverride`) ─────────────────────────────────────────────────────────

export type OverrideRow = {
  id: string;
  channelId: string;
  teamKey: string;
  fromDay: string;
  toDay: string;
  postsPerDay: number | null;
  picksPerDay: number | null;
  betCategoryId: string | null;
  themes: unknown;
  mix: unknown;
  format: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  personaId: string | null;
  isTest: boolean;
  closedAt: Date | null;
};

export function overrideActiveOn(o: Pick<OverrideRow, "fromDay" | "toDay" | "closedAt">, day: string): boolean {
  return !o.closedAt && o.fromDay <= day && day <= o.toDay;
}

export function overrideState(o: Pick<OverrideRow, "fromDay" | "toDay" | "closedAt">, today: string): { label: string; tone: "info" | "muted" | "neutral" } {
  if (o.closedAt) return { label: "Arrêté avant la fin", tone: "muted" };
  if (today < o.fromDay) return { label: `À venir (dès le ${fmtDayKey(o.fromDay)})`, tone: "neutral" };
  if (today > o.toDay) return { label: "Terminé", tone: "muted" };
  return { label: "En cours", tone: "info" };
}

const hourText = (h: string) => (/^\d{1,2}:00$/.test(h) ? `${Number(h.slice(0, -3))} h` : /^\d{1,2}:\d{2}$/.test(h) ? h.replace(":", " h ") : h);

/** Ce qui change sur le canal pendant la période, en mots. */
export function overrideChanges(o: OverrideRow, names: NameLookup = {}, channelTeam?: string | null): string[] {
  const out: string[] = [];
  if (o.isTest && (!channelTeam || channelTeam !== o.teamKey)) out.push(`Travaillé comme un canal ${orderTeamName(o.teamKey)}`);
  else out.push(`Équipe : ${orderTeamName(o.teamKey)}`);
  if (o.picksPerDay !== null) out.push(`${o.picksPerDay} pari${o.picksPerDay > 1 ? "s" : ""} par jour`);
  if (o.postsPerDay !== null) out.push(`${o.postsPerDay} post${o.postsPerDay > 1 ? "s" : ""} par jour`);
  if (o.betCategoryId) out.push(`Catégorie de paris : ${names.categories?.get(o.betCategoryId) ?? "catégorie retirée"}`);
  const themes = strs(o.themes);
  if (themes.length) out.push(`Thème${themes.length > 1 ? "s" : ""} : ${themes.join(", ")}`);
  if (isObj(o.mix)) {
    const m = mixText(o.mix);
    if (m !== "—") out.push(`Mélange : ${m}`);
  }
  if (o.format) out.push(`Format : ${formatText(o.format)}`);
  if (o.windowStart || o.windowEnd)
    out.push(`Fenêtre : ${o.windowStart ? hourText(o.windowStart) : "début de journée"} – ${o.windowEnd ? hourText(o.windowEnd) : "fin de journée"}`);
  if (o.personaId) out.push(`Persona : ${names.personas?.get(o.personaId) ?? "persona retirée"}`);
  if (o.isTest) out.push("Pour de faux : tout part sur le canal Test");
  return out;
}

/** Phrase de l'encart de la fiche canal. */
export function channelOverrideTitle(toDay: string, orderNumber: number): string {
  return `Réglage temporaire en cours jusqu'au ${fmtDayKey(toDay)} (ordre n°${orderNumber})`;
}

// ── Chronologie ───────────────────────────────────────────────────────────────────────────────────────────────────

export type TimelineEntry = { at: Date; label: string; detail?: string };

export type TimelineEvent = { type: string; occurredAt: Date; payload: unknown };
export type TimelineAudit = { action: string; createdAt: Date; metadata: unknown; userName?: string | null };

/** Libellé d'un événement d'ordre selon les mots de son type (`order.confirmed`, `agents.order_report`…). */
const EVENT_KEYWORDS: Array<[RegExp, string]> = [
  [/confirm/, "Confirmé par OUI"],
  [/cancel_immediate|annul/, "Annulé"],
  [/stop|arret/, "Arrêté"],
  [/extend|prolong/, "Prolongé"],
  [/modif|update|adjust|change/, "Modifié"],
  [/report|rapport|bilan/, "Rapport de Kevin"],
  [/start|launch|lance|running/, "Lancé"],
  [/done|finish|termin|fini/, "Fini"],
  [/fail|echec/, "En échec"],
  [/block/, "Bloqué"],
  [/creat|recu|received/, "Demandé à Kevin"],
];

/** Événements du Grand Chef (`packages/agents/src/orders/events.ts` : `agents.order.<type>`), libellés exacts. */
const EVENT_LABELS: Record<string, string> = {
  "agents.order.started": "Lancé",
  "agents.order.day_done": "Rapport du jour",
  "agents.order.finished": "Fini",
  "agents.order.failures": "Échecs signalés",
  "agents.order.blocked": "Bloqué",
};

export function eventLabel(type: string): string {
  if (EVENT_LABELS[type]) return EVENT_LABELS[type];
  const t = type.toLowerCase();
  for (const [re, label] of EVENT_KEYWORDS) if (re.test(t)) return label;
  return "Étape de l'ordre";
}

const detailOf = (payload: unknown): string | undefined => {
  if (!isObj(payload)) return undefined;
  for (const k of ["summary", "message", "text", "reason"]) {
    const s = str(payload[k]);
    if (s) return s.length > 300 ? `${s.slice(0, 297)}…` : s;
  }
  const parts: string[] = [];
  const day = str(payload.day);
  if (day && DAY_RE.test(day)) parts.push(`Jour du ${fmtDayKey(day)}`);
  const failures = num(payload.failures);
  if (failures) parts.push(`${failures} mission${failures > 1 ? "s" : ""} en échec`);
  const days = num(payload.days);
  if (days && !day) parts.push(`${days} jour${days > 1 ? "s" : ""} de plus`);
  return parts.length ? parts.join(" · ") : undefined;
};

const AUDIT_LABELS: Record<string, string> = {
  "agents.order_stopped": "Arrêté depuis le site",
  "agents.order_extended": "Prolongé depuis le site",
};

const FINAL_LABELS: Record<string, string> = {
  DONE: "Fini",
  CANCELLED: "Arrêté",
  FAILED: "En échec",
  BLOCKED: "Bloqué",
};

/**
 * Chronologie : créé, confirmé, lancé, rapports, modifié, prolongé, arrêté / fini. Les événements du journal priment ;
 * à défaut, les dates de l'ordre (création, début de période, dernier rapport, dernière mise à jour du statut final).
 */
export function orderTimeline(
  order: { createdAt: Date; updatedAt: Date; startsAt: Date | null; status: string; progress: ProgressView },
  events: readonly TimelineEvent[],
  audits: readonly TimelineAudit[],
  now: Date,
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const evs = events.map((e) => ({ at: e.occurredAt, label: eventLabel(e.type), detail: detailOf(e.payload) }));
  const has = (label: string) => evs.some((e) => e.label === label);
  if (!has("Demandé à Kevin")) out.push({ at: order.createdAt, label: "Demandé à Kevin" });
  out.push(...evs);
  for (const a of audits) {
    const days = isObj(a.metadata) ? num(a.metadata.days) : null;
    out.push({
      at: a.createdAt,
      label: AUDIT_LABELS[a.action] ?? "Action depuis le site",
      detail: [a.userName ? `par ${a.userName}` : null, days ? `${days} jour${days > 1 ? "s" : ""} de plus` : null].filter(Boolean).join(" · ") || undefined,
    });
  }
  if (!has("Lancé") && order.startsAt && order.startsAt <= now && order.status !== "WAITING_CONFIRM" && order.status !== "DRAFT")
    out.push({ at: order.startsAt, label: "Début de la période" });
  if (!has("Rapport de Kevin") && !has("Rapport du jour") && order.progress.lastReportAt) out.push({ at: order.progress.lastReportAt, label: "Dernier rapport de Kevin" });
  const final = FINAL_LABELS[order.status];
  if (final && !evs.some((e) => e.label === final) && !(order.status === "CANCELLED" && audits.some((a) => a.action === "agents.order_stopped")))
    out.push({ at: order.updatedAt, label: final });
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ── Demandes impossibles regroupées (page Kevin → « Pas encore possible ») ──────────────────────────────────────

export type UnmetRow = { id: string; text: string; count: number; lastAt: Date; teamKey?: string | null; suggestedCapability?: string | null };
export type UnmetGroup = { key: string; teamKey: string | null; team: string; capability: string; count: number; examples: string[]; lastAt: Date };

/** Regroupe les demandes par équipe et capacité suggérée (du plus demandé au moins demandé). */
export function groupUnmet(rows: readonly UnmetRow[], maxExamples = 3): UnmetGroup[] {
  const groups = new Map<string, UnmetGroup>();
  for (const r of rows) {
    const team = r.teamKey ?? null;
    const capability = str(r.suggestedCapability) ?? "À classer";
    const key = `${team ?? ""}|${capability.toLowerCase()}`;
    const g = groups.get(key) ?? { key, teamKey: team, team: team ? orderTeamName(team) : "Aucune équipe", capability, count: 0, examples: [], lastAt: r.lastAt };
    g.count += r.count;
    if (g.examples.length < maxExamples) g.examples.push(r.text);
    if (r.lastAt > g.lastAt) g.lastAt = r.lastAt;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime());
}
