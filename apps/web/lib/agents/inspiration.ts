/**
 * Page Agents → Inspiration (`/agents/inspiration`, phase 27) : canaux exemples que Kevin lit pour s'inspirer de leur
 * méthode (jamais de leur contenu). Fonctions pures, testées dans `inspiration.test.ts` : nom et état lisibles d'une
 * référence, mesures brutes des posts lus (quand aucune analyse n'est disponible), lecture tolérante de l'analyse et
 * du profil de style gardés en base, libellés des propositions venues d'une inspiration, historique, droits.
 *
 * Droits (décision du chantier site) : tout le monde lit ; « Annuler » une proposition appliquée et « Retirer » une
 * référence sont réservés aux administrateurs (le client parle d'abord à Kevin, la page sert de contrôle).
 */
import type { ChannelComparison, InspirationGap, Measure } from "@linkaffipro/agents";
import { fieldLabel, valueText, type RecommendationView } from "./algo/recommendations";
import { verdictText, type ExperimentView } from "./algo/experiments";
import { TEAM_NAMES } from "./teams";

export const INSPIRATION_PATH = "/agents/inspiration";

/** Phrase d'exemple montrée dans les états vides (le client parle à Kevin, pas à la page). */
export const INSPIRATION_EXAMPLE = "Écrivez à Kevin : « inspire-toi de t.me/… pour le canal … »";

export function canManageInspiration(role: string): boolean {
  return role === "ADMIN";
}

export function referenceHref(id: string): string {
  return `${INSPIRATION_PATH}/${encodeURIComponent(id)}`;
}

// ── Référence : nom, état, voie ────────────────────────────────────────────────────────────────────────────────

export type ReferenceNameInput = { username: string | null; title: string | null; telegramChatId?: bigint | null };

/** « @nom » si le canal est public, sinon son titre, sinon « Canal sans nom ». */
export function referenceName(r: ReferenceNameInput): string {
  const u = r.username?.trim().replace(/^@/, "");
  if (u) return `@${u}`;
  const t = r.title?.trim();
  if (t) return t;
  return "Canal sans nom";
}

/** Le titre en plus du nom quand les deux existent (« @roulette_pro · Roulette Pro »). */
export function referenceSubtitle(r: ReferenceNameInput): string | null {
  const u = r.username?.trim();
  const t = r.title?.trim();
  return u && t ? t : null;
}

export function referenceTelegramLink(username: string | null): string | null {
  const u = username?.trim().replace(/^@/, "");
  return u && /^[A-Za-z0-9_]{3,64}$/.test(u) ? `https://t.me/${u}` : null;
}

/** Raisons d'une lecture impossible (codes du contrat `ReferenceReadResult`) en mots. */
const UNAVAILABLE_REASONS: Record<string, string> = {
  private: "canal privé : il faut un compte réel déjà membre, ou des posts transférés à Kevin",
  restricted: "canal restreint par Telegram",
  not_found: "canal introuvable",
  no_account: "aucun compte réel n'est membre de ce canal",
  rate_limited: "Telegram demande d'attendre : nouvel essai plus tard",
  error: "la lecture a échoué",
};

export function unavailableReasonText(reason: string | null): string {
  const r = reason?.trim();
  if (!r) return "raison inconnue";
  return UNAVAILABLE_REASONS[r] ?? (r.length > 160 ? `${r.slice(0, 159)}…` : r);
}

export type ReferenceStateView = { label: string; tone: "info" | "success" | "danger"; detail: string | null };

export function referenceState(status: string, reason: string | null): ReferenceStateView {
  if (status === "READY") return { label: "Prête", tone: "success", detail: null };
  if (status === "UNAVAILABLE") return { label: "Illisible", tone: "danger", detail: unavailableReasonText(reason) };
  return { label: "En lecture", tone: "info", detail: null };
}

export const VIA_LABELS: Record<string, string> = {
  WEB: "Aperçu public",
  ACCOUNT: "Compte réel",
  FORWARDED: "Posts transférés",
};

export function viaLabel(via: string): string {
  return VIA_LABELS[via] ?? via;
}

export function universeName(universe: string): string {
  return (TEAM_NAMES as Record<string, string>)[universe] ?? universe;
}

/** Prochaine relecture en mots : relecture chaque semaine des références vivantes. */
export function nextReadText(status: string, nextReadAt: Date | null, fmt: (d: Date) => string): string {
  if (status === "READING") return "en cours";
  if (!nextReadAt) return "pas prévue";
  return fmt(nextReadAt);
}

// ── Lecture tolérante des colonnes JSON ────────────────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Liste de chaînes (canaux cibles, règles, exemples, points signalés). */
export function stringList(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((x) => x.trim())
    .slice(0, max);
}

/** Coupe une citation du canal de référence à 10 mots au plus (règle 1 : jamais plus). */
export function shortQuote(s: string, maxWords = 10): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : words.join(" ");
}

function parseMeasure(v: unknown): Measure | null {
  if (!isObj(v)) return null;
  const key = typeof v.key === "string" ? v.key : null;
  const label = typeof v.label === "string" ? v.label : null;
  if (!key || !label) return null;
  const value = typeof v.value === "number" || typeof v.value === "string" ? v.value : null;
  return {
    key,
    label,
    value,
    ...(typeof v.unit === "string" ? { unit: v.unit } : {}),
    sampleSize: num(v.sampleSize) ?? 0,
  };
}

function parseMeasures(v: unknown): Measure[] {
  return Array.isArray(v) ? v.map(parseMeasure).filter((m): m is Measure => m !== null) : [];
}

function parseGap(v: unknown): InspirationGap | null {
  if (!isObj(v) || typeof v.key !== "string" || typeof v.label !== "string") return null;
  const val = (x: unknown) => (typeof x === "number" || typeof x === "string" ? x : null);
  return {
    key: v.key,
    label: v.label,
    theirs: val(v.theirs),
    ours: val(v.ours),
    ...(typeof v.unit === "string" ? { unit: v.unit } : {}),
    matters: v.matters === true,
  };
}

export function parseComparisons(v: unknown): ChannelComparison[] {
  if (!Array.isArray(v)) return [];
  const out: ChannelComparison[] = [];
  for (const c of v) {
    if (!isObj(c) || typeof c.channelId !== "string") continue;
    out.push({
      channelId: c.channelId,
      channelTitle: typeof c.channelTitle === "string" ? c.channelTitle : "Canal",
      gaps: Array.isArray(c.gaps) ? c.gaps.map(parseGap).filter((g): g is InspirationGap => g !== null) : [],
      ourSampleSize: num(c.ourSampleSize) ?? 0,
    });
  }
  return out;
}

/** Analyse lisible : les quatre familles de mesures, heures de pointe, citations courtes, points signalés. */
export type AnalysisView = {
  sampleSize: number;
  rhythm: Measure[];
  form: Measure[];
  content: Measure[];
  results: Measure[];
  peakSlots: string[];
  quotes: string[];
  flagged: string[];
};

/** Analyse gardée dans `StyleProfile.stats` (écrite par l'analyse) ; null si elle n'a pas la bonne forme. */
export function parseStoredAnalysis(stats: unknown): { analysis: AnalysisView; comparisons: ChannelComparison[] } | null {
  if (!isObj(stats)) return null;
  const src = isObj(stats.analysis) ? stats.analysis : stats;
  const analysis: AnalysisView = {
    sampleSize: num(src.sampleSize) ?? 0,
    rhythm: parseMeasures(src.rhythm),
    form: parseMeasures(src.form),
    content: parseMeasures(src.content),
    results: parseMeasures(src.results),
    peakSlots: stringList(src.peakSlots, 6),
    quotes: stringList(src.quotes, 6).map((q) => shortQuote(q)),
    flagged: stringList(src.flagged, 20),
  };
  const total = analysis.rhythm.length + analysis.form.length + analysis.content.length + analysis.results.length;
  if (total === 0) return null;
  return { analysis, comparisons: parseComparisons(stats.comparisons ?? src.comparisons) };
}

/** Analyse reçue directement de la fonction d'analyse (même forme, citations recoupées). */
export function analysisView(a: {
  sampleSize: number;
  rhythm: Measure[];
  form: Measure[];
  content: Measure[];
  results: Measure[];
  peakSlots: string[];
  quotes: string[];
  flagged: string[];
}): AnalysisView {
  return { ...a, peakSlots: a.peakSlots.slice(0, 6), quotes: a.quotes.slice(0, 6).map((q) => shortQuote(q)) };
}

/** Valeur d'une mesure en mots (« 4,2 posts par jour », « — »). */
export function measureValueText(value: number | string | null, unit?: string): string {
  if (value === null || value === "") return "—";
  const v = typeof value === "number" ? value.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : value;
  return unit ? `${v} ${unit}` : v;
}

/** Effectif derrière un chiffre : « sur 48 posts ». */
export function sampleText(n: number): string {
  return n > 0 ? `sur ${n.toLocaleString("fr-FR")} post${n > 1 ? "s" : ""}` : "";
}

// ── Profil de style ────────────────────────────────────────────────────────────────────────────────────────────

export type StyleProfileView = {
  id: string;
  version: number;
  createdAt: Date;
  rules: string[];
  description: string | null;
  examples: string[];
  flagged: string[];
};

export function styleProfileView(row: {
  id: string;
  version: number;
  createdAt: Date;
  rules: unknown;
  description: string | null;
  examples: unknown;
  flagged: unknown;
}): StyleProfileView {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    rules: stringList(row.rules, 10),
    description: row.description?.trim() || null,
    examples: stringList(row.examples, 5),
    flagged: stringList(row.flagged, 20),
  };
}

// ── Mesures brutes des posts lus (sans analyse) ────────────────────────────────────────────────────────────────

export type RawPost = {
  postedAt: Date;
  length: number;
  mediaKind: string;
  views: number | null;
  hasLink: boolean;
  hasButton: boolean;
  hasVipCall: boolean;
  hasOdds: boolean;
};

export type RawMeasures = {
  count: number;
  /** Posts par jour sur la période lue (null sous 2 posts). */
  postsPerDay: number | null;
  /** Heures de Paris les plus fréquentes, de la plus fréquente à la moins fréquente (3 au plus). */
  topHours: Array<{ hour: number; posts: number }>;
  medianLength: number | null;
  /** Mélange des médias, en parts (0 à 1), du plus fréquent au moins fréquent. */
  mediaMix: Array<{ kind: string; share: number }>;
  medianViews: number | null;
  viewsSample: number;
  linkShare: number | null;
  buttonShare: number | null;
  vipShare: number | null;
  oddsShare: number | null;
  firstAt: Date | null;
  lastAt: Date | null;
};

const PARIS_HOUR = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });

export function parisHour(d: Date): number {
  const h = Number(PARIS_HOUR.format(d).replace(/\D/g, ""));
  return Number.isFinite(h) ? h % 24 : 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const DAY_MS = 86_400_000;

export function rawMeasures(posts: RawPost[]): RawMeasures {
  const count = posts.length;
  const times = posts.map((p) => p.postedAt.getTime()).sort((a, b) => a - b);
  const firstAt = count ? new Date(times[0]!) : null;
  const lastAt = count ? new Date(times[count - 1]!) : null;
  const spanDays = count >= 2 ? Math.max(1, (times[count - 1]! - times[0]!) / DAY_MS) : 0;
  const hours = new Map<number, number>();
  for (const p of posts) {
    const h = parisHour(p.postedAt);
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }
  const media = new Map<string, number>();
  for (const p of posts) media.set(p.mediaKind || "other", (media.get(p.mediaKind || "other") ?? 0) + 1);
  const views = posts.map((p) => p.views).filter((v): v is number => typeof v === "number" && v >= 0);
  const share = (f: (p: RawPost) => boolean) => (count ? posts.filter(f).length / count : null);
  return {
    count,
    postsPerDay: count >= 2 ? Math.round((count / spanDays) * 10) / 10 : null,
    topHours: [...hours.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 3)
      .map(([hour, n]) => ({ hour, posts: n })),
    medianLength: median(posts.map((p) => p.length)),
    mediaMix: [...media.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, n]) => ({ kind, share: n / count })),
    medianViews: median(views),
    viewsSample: views.length,
    linkShare: share((p) => p.hasLink),
    buttonShare: share((p) => p.hasButton),
    vipShare: share((p) => p.hasVipCall),
    oddsShare: share((p) => p.hasOdds),
    firstAt,
    lastAt,
  };
}

export const MEDIA_LABELS: Record<string, string> = {
  text: "texte seul",
  photo: "photo",
  video: "vidéo",
  poll: "sondage",
  document: "document",
  other: "autre",
};

export function pctText(share: number | null): string {
  if (share === null) return "—";
  return `${Math.round(share * 100).toLocaleString("fr-FR")} %`;
}

export function mediaMixText(mix: RawMeasures["mediaMix"]): string {
  if (mix.length === 0) return "—";
  return mix.map((m) => `${MEDIA_LABELS[m.kind] ?? m.kind} ${pctText(m.share)}`).join(", ");
}

export function topHoursText(top: RawMeasures["topHours"]): string {
  if (top.length === 0) return "—";
  return top.map((t) => `${t.hour} h (${t.posts} post${t.posts > 1 ? "s" : ""})`).join(", ");
}

/** Lignes « mesure → valeur » des posts lus, dans l'ordre de la page. */
export function rawMeasureRows(m: RawMeasures): Array<{ label: string; value: string }> {
  const n = (v: number | null, unit: string) => (v === null ? "—" : `${v.toLocaleString("fr-FR")} ${unit}`);
  return [
    { label: "Posts lus", value: m.count.toLocaleString("fr-FR") },
    { label: "Posts par jour", value: m.postsPerDay === null ? "—" : m.postsPerDay.toLocaleString("fr-FR") },
    { label: "Heures les plus fréquentes (Paris)", value: topHoursText(m.topHours) },
    { label: "Longueur du milieu", value: n(m.medianLength, "caractères") },
    { label: "Mélange des médias", value: mediaMixText(m.mediaMix) },
    {
      label: "Vues du milieu",
      value: m.medianViews === null ? "non visibles" : `${n(m.medianViews, "vues")} (${m.viewsSample} posts)`,
    },
    { label: "Posts avec un lien", value: pctText(m.linkShare) },
    { label: "Posts avec un bouton", value: pctText(m.buttonShare) },
    { label: "Posts qui poussent le VIP", value: pctText(m.vipShare) },
    { label: "Posts avec une cote", value: pctText(m.oddsShare) },
  ];
}

// ── Propositions venues d'une inspiration ──────────────────────────────────────────────────────────────────────

/** Réglages propres à l'inspiration, en plus de ceux de l'équipe Algorithme. */
const INSPIRATION_FIELDS: Record<string, string> = {
  styleProfileId: "Profil de style pour la Rédaction",
  // Noms écrits par Kevin (chantier C) : fenêtre `{ windowStart, windowEnd }` ; longueur et offre dans `styleNotes`.
  window: "Fenêtre horaire des posts",
  targetLength: "Longueur visée des posts",
  postLength: "Longueur visée des posts",
  offerFrequency: "Fréquence des appels à l'offre",
  offerEvery: "Fréquence des appels à l'offre",
  vipCallShare: "Part des posts qui poussent le VIP",
  betResultSeries: "Série pari puis résultat",
};

export function inspirationFieldLabel(field: string): string {
  return INSPIRATION_FIELDS[field] ?? fieldLabel(field);
}

/** Valeur en mots ; un profil de style se dit « profil v2 » (jamais son identifiant). */
export function inspirationValueText(
  field: string,
  v: unknown,
  profileVersions: ReadonlyMap<string, number> = new Map(),
): string {
  if (field === "styleProfileId") {
    if (v === null || v === undefined || v === "") return "aucun";
    if (typeof v === "string") {
      const ver = profileVersions.get(v);
      return ver ? `profil de style v${ver}` : "un autre profil de style";
    }
  }
  if (field === "window" && v && typeof v === "object") {
    const w = v as { windowStart?: unknown; windowEnd?: unknown };
    if (typeof w.windowStart === "string" && typeof w.windowEnd === "string") return `${w.windowStart}-${w.windowEnd}`;
  }
  return valueText(field, v);
}

/** Une proposition appliquée s'annule pendant 30 jours. */
export const UNDO_WINDOW_DAYS = 30;

export function canUndo(rec: Pick<RecommendationView, "status" | "appliedAt">, now: Date): boolean {
  if (rec.status !== "APPLIED") return false;
  if (!rec.appliedAt) return true;
  return now.getTime() - rec.appliedAt.getTime() <= UNDO_WINDOW_DAYS * DAY_MS;
}

export type RecCounts = { proposed: number; applied: number; total: number };

export function recCounts(statuses: Array<{ status: string; n: number }>): RecCounts {
  let proposed = 0;
  let applied = 0;
  let total = 0;
  for (const s of statuses) {
    total += s.n;
    if (s.status === "PROPOSED") proposed += s.n;
    if (s.status === "APPLIED") applied += s.n;
  }
  return { proposed, applied, total };
}

export function recCountsText(c: RecCounts): string {
  if (c.total === 0) return "aucune";
  const parts: string[] = [];
  if (c.proposed) parts.push(`${c.proposed} à décider`);
  if (c.applied) parts.push(`${c.applied} appliquée${c.applied > 1 ? "s" : ""}`);
  const other = c.total - c.proposed - c.applied;
  if (other) parts.push(`${other} terminée${other > 1 ? "s" : ""}`);
  return parts.join(", ");
}

// ── Historique ─────────────────────────────────────────────────────────────────────────────────────────────────

export type HistoryEntry = { at: Date; kind: "added" | "read" | "applied" | "undone" | "rejected" | "test" | "verdict"; text: string };

export function inspirationHistory(input: {
  createdAt: Date;
  lastReadAt: Date | null;
  postCount: number;
  recs: Array<Pick<RecommendationView, "field" | "targetLabel" | "appliedAt" | "appliedBy" | "undoneAt" | "rejectedAt">>;
  experiments: Array<Pick<ExperimentView, "createdAt" | "startedAt" | "closedAt" | "status" | "winner" | "hypothesis" | "targetLabel">>;
}): HistoryEntry[] {
  const out: HistoryEntry[] = [{ at: input.createdAt, kind: "added", text: "Référence ajoutée" }];
  if (input.lastReadAt)
    out.push({
      at: input.lastReadAt,
      kind: "read",
      text: `Dernière lecture : ${input.postCount.toLocaleString("fr-FR")} post${input.postCount > 1 ? "s" : ""} lus au total`,
    });
  for (const r of input.recs) {
    const what = `${inspirationFieldLabel(r.field)} (${r.targetLabel})`;
    if (r.appliedAt) out.push({ at: r.appliedAt, kind: "applied", text: `Appliqué : ${what}` });
    if (r.undoneAt) out.push({ at: r.undoneAt, kind: "undone", text: `Annulé : ${what}` });
    if (r.rejectedAt) out.push({ at: r.rejectedAt, kind: "rejected", text: `Refusé : ${what}` });
  }
  for (const e of input.experiments) {
    const where = e.targetLabel ? ` sur ${e.targetLabel}` : "";
    out.push({ at: e.startedAt ?? e.createdAt, kind: "test", text: `Test A/B lancé${where} : ${e.hypothesis}` });
    const verdict = verdictText(e);
    if (verdict && e.closedAt) out.push({ at: e.closedAt, kind: "verdict", text: `Bilan du test${where} : ${verdict}` });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ── Résultat d'une action du moteur ────────────────────────────────────────────────────────────────────────────

/** Résultat renvoyé par les fonctions de Kevin, quelle que soit sa forme exacte. */
export function engineResult(r: unknown, fallback: string): { ok: boolean; message: string } {
  if (isObj(r)) {
    const ok = typeof r.ok === "boolean" ? r.ok : true;
    const message = typeof r.message === "string" && r.message.trim() ? r.message.trim() : fallback;
    return { ok, message };
  }
  return { ok: true, message: fallback };
}

/** Identifiant venant d'un formulaire (clé de la base). */
export function safeId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}
