/**
 * Agents → Qualité (phase 30, contrôle qualité global) à l'écran : vues, filtres lus dans l'adresse, libellés en
 * français courant, chiffres (part acceptée par heure / jour, par équipe, par type, temps moyen, blocages faute de
 * modèle), tendances (motifs les plus fréquents, équipes les plus refusées, évolution) et contenu vérifié MASQUÉ.
 * Fonctions pures, testées (`qualite.test.ts`) ; lectures en base dans `qualite-queries.ts`.
 *
 * Règles reprises du contrat (`packages/agents/src/qa/contract.ts`) : le contrôle accepte ou bloque, il ne modifie
 * jamais rien ; un délai dépassé ou un modèle indisponible = contenu bloqué, jamais accepté. La page ne fait que lire :
 * aucun geste « accepter à la place du contrôle ». Le contenu gardé est déjà masqué par le moteur ; il l'est une
 * seconde fois ici (`maskQaText`) avant l'affichage. Les libellés des motifs et le masquage reprennent ceux de Kevin
 * (`packages/agents/src/qa/kevin-view.ts`).
 */
import type { QaContentType, QaVerdict } from "@linkaffipro/db";
import { fromParisLocal, parisDayKey, parisHour } from "@/lib/posts/time";

export const QUALITE_PATH = "/agents/qualite";
export const QA_MODEL_LABEL = "Fable 5.1";
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- vues et filtres

export const QUALITE_VIEWS = ["tableau", "historique", "tendances"] as const;
export type QualiteView = (typeof QUALITE_VIEWS)[number];

export const QUALITE_VIEW_LABELS: Record<QualiteView, string> = {
  tableau: "Tableau de bord",
  historique: "Historique",
  tendances: "Tendances",
};

export const QA_VERDICTS = ["APPROVED", "REJECTED", "TIMEOUT", "ERROR"] as const satisfies readonly QaVerdict[];
export const QA_CONTENT_TYPES = [
  "POST",
  "SHORT",
  "REPORT",
  "KEVIN_RESPONSE",
  "RECOMMENDATION",
  "ALERT",
  "COMPLIANCE_RULE",
] as const satisfies readonly QaContentType[];

/** Équipes d'origine connues (clé du moteur → nom affiché). */
export const QA_TEAM_LABELS: Record<string, string> = {
  dating: "Rencontres",
  casino: "Casino",
  sports: "Paris sportifs",
  algo: "Algorithme",
  ads: "Agent Ads",
  montage: "Montage",
  analystes: "Analystes",
  inspiration: "Inspiration",
  boss: "Kevin",
};

export function qaTeamLabel(key: string): string {
  return QA_TEAM_LABELS[key] ?? key;
}

const first = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : undefined;
};

function pick<T extends string>(list: readonly T[], v: unknown): T | null {
  const s = first(v);
  return s && (list as readonly string[]).includes(s) ? (s as T) : null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type QualiteFilters = {
  verdict: QaVerdict | null;
  type: QaContentType | null;
  team: string | null;
  /** Jours AAAA-MM-JJ (heure de Paris), bornes comprises. */
  from: string | null;
  to: string | null;
  page: number;
};

export function parseQualiteView(v: unknown): QualiteView {
  return pick(QUALITE_VIEWS, v) ?? "tableau";
}

/** Pas du graphique du tableau de bord : par jour (défaut) ou par heure, toujours sur 7 jours. */
export type QualiteStep = "jour" | "heure";
export function parseQualiteStep(v: unknown): QualiteStep {
  return first(v) === "heure" ? "heure" : "jour";
}

export function parseQualiteFilters(sp: Record<string, unknown>): QualiteFilters {
  const team = first(sp.equipe);
  const from = first(sp.du);
  const to = first(sp.au);
  const page = Number(first(sp.page));
  return {
    verdict: pick(QA_VERDICTS, sp.resultat),
    type: pick(QA_CONTENT_TYPES, sp.type),
    team: team && /^[a-z_-]{1,30}$/.test(team) ? team : null,
    from: from && DAY_RE.test(from) ? from : null,
    to: to && DAY_RE.test(to) ? to : null,
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

export function hasQualiteFilters(f: QualiteFilters): boolean {
  return !!(f.verdict || f.type || f.team || f.from || f.to);
}

export function qualiteHref(view: QualiteView, params: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  if (view !== "tableau") q.set("vue", view);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return `${QUALITE_PATH}${s ? `?${s}` : ""}`;
}

/** Paramètres d'adresse des filtres de l'historique (page à part). */
export function filterParams(f: QualiteFilters): Record<string, string | null> {
  return { resultat: f.verdict, type: f.type, equipe: f.team, du: f.from, au: f.to };
}

export function checkHref(id: string, f?: QualiteFilters): string {
  return qualiteHref("historique", { ...(f ? filterParams(f) : {}), ...(f && f.page > 1 ? { page: f.page } : {}), voir: id });
}

export function safeCheckId(v: unknown): string | null {
  const s = first(v);
  return s && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------- motifs et masquage

/** Motifs en français courant (mêmes mots que Kevin). */
export const QA_REASON_LABELS: Record<string, string> = {
  COPY: "Texte copié sur une source",
  SENSITIVE_DATA: "Donnée sensible (clé, identifiant, coordonnées)",
  HALLUCINATION: "Information inventée",
  GAIN_PROMISE: "Promesse de gain",
  LEGAL_ADVICE: "Conseil juridique",
  CHANNEL_RULE: "Règle du canal pas respectée",
  COMPLIANCE: "Règle publicitaire pas respectée",
  CONTRADICTION: "Contradiction avec un autre contenu",
  INVENTED_NUMBER: "Chiffre inventé",
  UNSOURCED: "Affirmation sans source",
  DEAD_SOURCE: "Source qui ne répond plus",
  OFF_TOPIC: "Hors sujet",
  FALSE_ALERT: "Fausse alerte",
  SUBTITLE_ERROR: "Erreur dans les sous-titres",
  METADATA: "Durée, format ou image incohérents",
  AI_MENTION: "Parle de l'IA",
  LANGUAGE: "Français à corriger",
  OUT_OF_BOUNDS: "Réglage hors des limites",
  QA_TIMEOUT: "Contrôle trop long",
  QA_MODEL_UNAVAILABLE: "Contrôle indisponible",
  QA_BUDGET: "Plafond du contrôle atteint",
};

export function reasonLabel(code: string | null | undefined): string {
  return (code && QA_REASON_LABELS[code.toUpperCase()]) || "Autre motif";
}

/**
 * Masque ce qu'un texte pourrait encore contenir (pur) : jetons de bot, clés, mots de passe écrits, courriels,
 * téléphones, identifiants internes longs, paramètres d'adresse ; retire les codes en majuscules ; coupe à `max`.
 */
export function maskQaText(raw: unknown, max = 180): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/\s+/g, " ").trim();
  s = s
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1")
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "[jeton masqué]")
    .replace(/\b(?:sk|pk|rk|key|tok|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{10,}\b/gi, "[clé masquée]")
    .replace(/\b(mot de passe|password|passwd|pwd|secret|token|jeton|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1 : [masqué]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[courriel masqué]")
    .replace(/(?:\+|00)\d[\d .-]{7,}\d/g, "[téléphone masqué]")
    .replace(/\b0[1-9](?:[ .-]?\d{2}){4}\b/g, "[téléphone masqué]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, (m) => (/\d/.test(m) && /[a-z]/i.test(m) ? "[identifiant masqué]" : m))
    .replace(/\b[A-Z]{2,}_[A-Z_]{2,}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export type ReasonView = { code: string; label: string; message: string; critical: boolean };
export type CorrectionView = { field: string; expected: string; got: string; suggestion: string };

export function reasonsOf(raw: unknown): ReasonView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const code = typeof r.code === "string" ? r.code : "";
      return { code, label: reasonLabel(code), message: maskQaText(r.message, 400), critical: r.severity !== "warning" };
    });
}

export function correctionsOf(raw: unknown): CorrectionView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      field: maskQaText(r.field, 60),
      expected: maskQaText(r.expected, 300),
      got: maskQaText(r.got, 300),
      suggestion: maskQaText(r.suggestion, 400),
    }))
    .filter((c) => c.field || c.suggestion || c.expected);
}

/** Noms affichés des champs du contenu vérifié (les autres gardent leur nom). */
export const QA_CONTENT_FIELD_LABELS: Record<string, string> = {
  text: "Texte",
  caption: "Légende",
  media: "Média",
  mediaType: "Média",
  channel: "Canal",
  vertical: "Univers",
  country: "Pays",
  durationMs: "Durée (millisecondes)",
  format: "Format",
  subtitlesSrt: "Sous-titres",
  subtitles: "Sous-titres",
  overlayText: "Texte à l'écran",
  resolution: "Image",
  title: "Titre",
  summary: "Résumé",
  content: "Contenu",
  recommendations: "Recommandations",
  question: "Question",
  response: "Réponse",
  dataConsulted: "Données consultées",
  changes: "Changements",
  evidence: "Preuves",
  source: "Source",
  message: "Message",
  riskLevel: "Risque",
  buttons: "Boutons",
  rule: "Règle",
  platform: "Plateforme",
  token: "Jeton",
};

/** Champs du contenu vérifié, déjà masqué par le moteur, masqué à nouveau et coupé (jamais tel quel). */
export function maskedContentFields(raw: unknown, maxFields = 12): Array<{ key: string; value: string }> {
  if (raw === null || raw === undefined) return [];
  const obj = typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : { contenu: raw };
  const out: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(obj)) {
    if (out.length >= maxFields) break;
    if (/token|secret|password|passwd|apikey|api_key|cle|clé/i.test(k)) {
      out.push({ key: QA_CONTENT_FIELD_LABELS[k] ?? maskQaText(k, 40), value: "[masqué]" });
      continue;
    }
    const text = typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v);
    const value = maskQaText(text.replace(/<[^>]+>/g, " "), 600);
    if (value) out.push({ key: QA_CONTENT_FIELD_LABELS[k] ?? maskQaText(k, 40), value });
  }
  return out;
}

// ---------------------------------------------------------------- chiffres

export type QaCheckLite = {
  id: string;
  contentType: QaContentType;
  teamKey: string;
  verdict: QaVerdict;
  reasons: unknown;
  durationMs: number;
  createdAt: Date;
};

export type QaCounts = { total: number; approved: number; rejected: number; timeout: number; error: number; rate: number | null };

export function countsOf(rows: readonly Pick<QaCheckLite, "verdict">[]): QaCounts {
  const c = { total: rows.length, approved: 0, rejected: 0, timeout: 0, error: 0 };
  for (const r of rows) {
    if (r.verdict === "APPROVED") c.approved++;
    else if (r.verdict === "REJECTED") c.rejected++;
    else if (r.verdict === "TIMEOUT") c.timeout++;
    else c.error++;
  }
  return { ...c, rate: c.total ? c.approved / c.total : null };
}

/** Temps moyen d'une vérification menée à terme (acceptée ou refusée), en ms ; null sans vérification. */
export function averageLatencyMs(rows: readonly Pick<QaCheckLite, "verdict" | "durationMs">[]): number | null {
  const done = rows.filter((r) => r.verdict === "APPROVED" || r.verdict === "REJECTED");
  return done.length ? Math.round(done.reduce((s, r) => s + r.durationMs, 0) / done.length) : null;
}

export function fmtSeconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}

const dayLabelFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

/** 7 derniers jours de Paris (plus ancien d'abord), clé AAAA-MM-JJ et libellé « 23 oct. ». */
export function lastDays(now: Date, n = 7): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (let i = n - 1; i >= 0; i--) {
    const at = new Date(now.getTime() - i * DAY_MS);
    const key = parisDayKey(at);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: dayLabelFmt.format(at) });
  }
  return out;
}

export type RateSeries = { labels: string[]; rates: number[]; totals: number[] };

/** Part acceptée jour par jour sur 7 jours (NaN un jour sans vérification : rien n'est dessiné, « — » au tableau). */
export function dailyRates(rows: readonly Pick<QaCheckLite, "verdict" | "createdAt">[], now: Date): RateSeries {
  const days = lastDays(now);
  const by = new Map(days.map((d) => [d.key, { total: 0, ok: 0 }]));
  for (const r of rows) {
    const b = by.get(parisDayKey(r.createdAt));
    if (!b) continue;
    b.total++;
    if (r.verdict === "APPROVED") b.ok++;
  }
  const vals = days.map((d) => by.get(d.key)!);
  return { labels: days.map((d) => d.label), rates: vals.map((v) => (v.total ? v.ok / v.total : Number.NaN)), totals: vals.map((v) => v.total) };
}

/** Part acceptée heure par heure sur 7 jours (168 points, libellé « 23 oct. 14 h »). */
export function hourlyRates(rows: readonly Pick<QaCheckLite, "verdict" | "createdAt">[], now: Date): RateSeries {
  const end = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const start = end - 167 * HOUR_MS;
  const totals = new Array<number>(168).fill(0);
  const oks = new Array<number>(168).fill(0);
  for (const r of rows) {
    const i = Math.floor((r.createdAt.getTime() - start) / HOUR_MS);
    if (i < 0 || i >= 168) continue;
    totals[i]!++;
    if (r.verdict === "APPROVED") oks[i]!++;
  }
  const labels = totals.map((_, i) => {
    const at = new Date(start + i * HOUR_MS);
    return `${dayLabelFmt.format(at)} ${parisHour(at)} h`;
  });
  return { labels, rates: totals.map((t, i) => (t ? oks[i]! / t : Number.NaN)), totals };
}

export type GroupRow = QaCounts & { key: string; label: string; latencyMs: number | null };

function groupBy(rows: readonly QaCheckLite[], keyOf: (r: QaCheckLite) => string, labelOf: (k: string) => string): GroupRow[] {
  const by = new Map<string, QaCheckLite[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = by.get(k);
    if (list) list.push(r);
    else by.set(k, [r]);
  }
  return [...by.entries()]
    .map(([key, list]) => ({ key, label: labelOf(key), ...countsOf(list), latencyMs: averageLatencyMs(list) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export function byTeam(rows: readonly QaCheckLite[]): GroupRow[] {
  return groupBy(rows, (r) => r.teamKey, qaTeamLabel);
}

/** `typeLabel` : libellé du type (dictionnaire des statuts). */
export function byType(rows: readonly QaCheckLite[], typeLabel: (t: string) => string): GroupRow[] {
  return groupBy(rows, (r) => r.contentType, typeLabel);
}

/** Motifs des refus les plus fréquents (un refus compte une fois par motif « bloquant »). */
export function topReasons(rows: readonly Pick<QaCheckLite, "verdict" | "reasons">[], n = 5): Array<{ code: string; label: string; count: number }> {
  const by = new Map<string, { code: string; count: number }>();
  for (const r of rows) {
    if (r.verdict !== "REJECTED") continue;
    const seen = new Set<string>();
    for (const x of reasonsOf(r.reasons)) {
      if (!x.critical || seen.has(x.label)) continue;
      seen.add(x.label);
      const cur = by.get(x.label);
      if (cur) cur.count++;
      else by.set(x.label, { code: x.code, count: 1 });
    }
  }
  return [...by.entries()]
    .map(([label, v]) => ({ label, code: v.code, count: v.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n);
}

/** Équipes les plus refusées (nombre de refus, puis part refusée). */
export function mostRejectedTeams(rows: readonly QaCheckLite[], n = 5): GroupRow[] {
  return byTeam(rows)
    .filter((g) => g.rejected > 0)
    .sort((a, b) => b.rejected - a.rejected || b.rejected / b.total - a.rejected / a.total)
    .slice(0, n);
}

/** Refus jour par jour sur `days` jours (évolution) et part refusée. */
export function dailyRefusals(rows: readonly Pick<QaCheckLite, "verdict" | "createdAt">[], now: Date, days = 28): { labels: string[]; refusals: number[]; totals: number[] } {
  const list = lastDays(now, days);
  const by = new Map(list.map((d) => [d.key, { total: 0, rejected: 0 }]));
  for (const r of rows) {
    const b = by.get(parisDayKey(r.createdAt));
    if (!b) continue;
    b.total++;
    if (r.verdict === "REJECTED") b.rejected++;
  }
  return { labels: list.map((d) => d.label), refusals: list.map((d) => by.get(d.key)!.rejected), totals: list.map((d) => by.get(d.key)!.total) };
}

/** Comparaison des 7 derniers jours avec les 7 d'avant : refus, part refusée. */
export function weekOverWeek(rows: readonly Pick<QaCheckLite, "verdict" | "createdAt">[], now: Date): { current: QaCounts; previous: QaCounts } {
  const t = now.getTime();
  const cur = rows.filter((r) => t - r.createdAt.getTime() < 7 * DAY_MS);
  const prev = rows.filter((r) => t - r.createdAt.getTime() >= 7 * DAY_MS && t - r.createdAt.getTime() < 14 * DAY_MS);
  return { current: countsOf(cur), previous: countsOf(prev) };
}

/** Le contrôle est-il en pause (dernière vérification = modèle indisponible, depuis moins d'une heure) ? */
export function qaPaused(latest: Pick<QaCheckLite, "verdict" | "createdAt"> | null, now: Date): boolean {
  return !!latest && latest.verdict === "ERROR" && now.getTime() - latest.createdAt.getTime() <= HOUR_MS;
}

/** Nom du modèle affiché (jamais l'identifiant technique brut). */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return "—";
  if (/fable[-_ ]?5[-_.]1/i.test(model)) return QA_MODEL_LABEL;
  return maskQaText(model, 40);
}

/** Bornes UTC d'une période de jours de Paris (filtres « du » / « au », bornes comprises) ; vide = pas de borne. */
export function dayBounds(from: string | null, to: string | null): { gte?: Date; lt?: Date } {
  const out: { gte?: Date; lt?: Date } = {};
  const start = from ? fromParisLocal(`${from}T00:00`) : null;
  if (start) out.gte = start;
  if (to) {
    const next = new Date(new Date(`${to}T12:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
    const end = fromParisLocal(`${next}T00:00`);
    if (end) out.lt = end;
  }
  return out;
}
