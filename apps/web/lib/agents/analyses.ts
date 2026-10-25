/**
 * Agents → Analyses (phase 29, équipe Analystes) à l'écran : vues, filtres lus dans l'adresse, libellés, courbe des
 * entrées par semaine, preuves et sources, contenu d'un rapport, état d'une source, gestes permis. Fonctions pures,
 * testées (`analyses.test.ts`) ; lectures en base dans `analyses-queries.ts`.
 *
 * Règles reprises du contrat (`packages/agents/src/analysts/contract.ts`) : chaque tendance, règle ou recommandation
 * porte sa source (adresse + date) ; une information non recoupée est montrée « non vérifiée » ; jamais d'avis
 * juridique (mention fixe sur les règles publicitaires) ; l'équipe ne fait rien chez Meta / TikTok : « Accepter » note
 * seulement la décision du client.
 */
import { ANALYSTS_SETTINGS, EUROPE_COUNTRIES } from "@linkaffipro/agents";

export const ANALYSES_PATH = "/agents/analyses";

/** Mention fixe des règles publicitaires (règle 2 de la phase 29). */
export const NOT_LEGAL_ADVICE =
  "Ce qui est observé sur les plateformes, pas un avis juridique : pour les questions légales, vérifiez avec un avocat.";

// ---------------------------------------------------------------- vues

export const ANALYSES_VIEWS = ["tendances", "regles", "rapports", "sources", "recommandations"] as const;
export type AnalysesView = (typeof ANALYSES_VIEWS)[number];

export const ANALYSES_VIEW_LABELS: Record<AnalysesView, string> = {
  tendances: "Tendances",
  regles: "Règles publicitaires",
  rapports: "Rapports",
  sources: "Sources",
  recommandations: "Recommandations",
};

const first = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : undefined;
};

export function parseAnalysesView(v: unknown): AnalysesView {
  const s = first(v);
  return (ANALYSES_VIEWS as readonly string[]).includes(s ?? "") ? (s as AnalysesView) : "tendances";
}

export function viewHref(view: AnalysesView, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  if (view !== "tendances") q.set("vue", view);
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return `${ANALYSES_PATH}${s ? `?${s}` : ""}`;
}

export function reportHref(id: string): string {
  return `${ANALYSES_PATH}/rapports/${encodeURIComponent(id)}`;
}

export function safeAnalysesId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

// ---------------------------------------------------------------- valeurs connues

export const MARKETS = ["CASINO", "SPORTS", "DATING"] as const;
export type MarketKey = (typeof MARKETS)[number];
export const TREND_CATEGORIES = [
  "AD_STRATEGY",
  "AD_BAN",
  "AD_CREATIVE",
  "PLATFORM_CHANGE",
  "MARKET_TREND",
  "REGULATION",
  "OFFER",
  "TOOL",
  "DISCUSSION",
  "OTHER",
] as const;
export const SENTIMENTS = ["POSITIVE", "NEGATIVE", "NEUTRAL"] as const;
export const PLATFORMS = ["META", "TIKTOK", "GOOGLE", "SNAP", "X", "TELEGRAM", "OTHER"] as const;
export const RISKS = ["LOW", "MEDIUM", "HIGH", "BAN"] as const;

let regionNames: Intl.DisplayNames | null = null;

/** Pays couverts (codes ISO), dans l'ordre alphabétique de leur nom français. */
export const COUNTRY_CODES: readonly string[] = Object.keys(EUROPE_COUNTRIES).sort((a, b) =>
  countryName(a).localeCompare(countryName(b), "fr"),
);

/** Nom français d'un pays (« FR » → « France ») ; « ALL » → « Tous les pays ». */
export function countryName(code: string): string {
  if (code === "ALL") return "Tous les pays";
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    regionNames ??= new Intl.DisplayNames(["fr"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function countriesText(codes: readonly string[]): string {
  if (codes.length === 0) return "Europe";
  return codes.map(countryName).join(", ");
}

const pick = <T extends string>(list: readonly T[], v: unknown): T | null => {
  const s = first(v);
  return s && (list as readonly string[]).includes(s) ? (s as T) : null;
};

const countryOf = (v: unknown): string | null => {
  const s = first(v)?.toUpperCase();
  return s && Object.prototype.hasOwnProperty.call(EUROPE_COUNTRIES, s) ? s : null;
};

/** Chaîne JSON → liste de textes (pays, langues, étiquettes). */
export function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

// ---------------------------------------------------------------- tendances

export type TrendFilters = {
  market: MarketKey | null;
  country: string | null;
  category: (typeof TREND_CATEGORIES)[number] | null;
  sentiment: (typeof SENTIMENTS)[number] | null;
  minScore: number;
};

/** Score minimal par défaut : le seuil de la veille (en dessous, rien n'est gardé). */
export const DEFAULT_MIN_SCORE = ANALYSTS_SETTINGS.relevanceThreshold.value;

export function parseTrendFilters(sp: Record<string, unknown>): TrendFilters {
  const n = Number(first(sp.score));
  return {
    market: pick(MARKETS, sp.marche),
    country: countryOf(sp.pays),
    category: pick(TREND_CATEGORIES, sp.categorie),
    sentiment: pick(SENTIMENTS, sp.ton),
    minScore: Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_MIN_SCORE,
  };
}

export function trendFilterParams(f: TrendFilters): Record<string, string | null> {
  return {
    marche: f.market,
    pays: f.country,
    categorie: f.category,
    ton: f.sentiment,
    score: f.minScore !== DEFAULT_MIN_SCORE ? String(f.minScore) : null,
  };
}

/** Lundi 00:00 UTC de la semaine d'une date. */
export function weekStartUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

/** Semaines affichées par la courbe. */
export const TREND_WEEKS = 12;

/**
 * Nombre d'entrées par semaine (les `weeks` dernières, la semaine en cours comprise), du plus ancien au plus récent.
 * Libellé : « sem. du 13 oct. ».
 */
export function weeklyCounts(dates: readonly Date[], now: Date, weeks = TREND_WEEKS): { labels: string[]; values: number[]; starts: Date[] } {
  const last = weekStartUtc(now);
  const starts: Date[] = [];
  for (let i = weeks - 1; i >= 0; i--) starts.push(new Date(last.getTime() - i * 7 * 86_400_000));
  const values = starts.map(() => 0);
  const firstStart = starts[0]!.getTime();
  for (const d of dates) {
    const t = weekStartUtc(d).getTime();
    if (t < firstStart) continue;
    const idx = Math.round((t - firstStart) / (7 * 86_400_000));
    if (idx >= 0 && idx < values.length) values[idx]! += 1;
  }
  const fmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  return { labels: starts.map((s) => `sem. du ${fmt.format(s)}`), values, starts };
}

/** Score de pertinence lisible (« 8/10 »). */
export const scoreText = (n: number) => `${n}/10`;

// ---------------------------------------------------------------- règles publicitaires

export type RuleFilters = {
  platform: (typeof PLATFORMS)[number] | null;
  country: string | null;
  market: MarketKey | null;
  risk: (typeof RISKS)[number] | null;
};

export function parseRuleFilters(sp: Record<string, unknown>): RuleFilters {
  return {
    platform: pick(PLATFORMS, sp.plateforme),
    country: countryOf(sp.pays),
    market: pick(MARKETS, sp.marche),
    risk: pick(RISKS, sp.risque),
  };
}

export function ruleFilterParams(f: RuleFilters): Record<string, string | null> {
  return { plateforme: f.platform, pays: f.country, marche: f.market, risque: f.risk };
}

/** Ordre d'affichage : le plus risqué d'abord. */
export const RISK_ORDER: Record<string, number> = { BAN: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export type Evidence = { url: string; date: string | null; description: string | null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Adresse affichable : http(s) seulement (jamais `javascript:`). */
export function safeUrl(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Nom court d'une adresse (« blackhatworld.com »). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Preuves d'une règle ou d'une recommandation : `[{ url, date, description }]` (ou `title`, `snippet`). */
export function evidenceList(v: unknown): Evidence[] {
  const arr = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.sources) ? v.sources : isObj(v) && Array.isArray(v.evidence) ? v.evidence : [];
  const out: Evidence[] = [];
  for (const e of arr) {
    if (typeof e === "string") {
      const url = safeUrl(e);
      if (url) out.push({ url, date: null, description: null });
      continue;
    }
    if (!isObj(e)) continue;
    const url = safeUrl(e.url);
    if (!url) continue;
    out.push({ url, date: text(e.date), description: text(e.description) ?? text(e.title) ?? text(e.snippet) });
  }
  return out;
}

/** Date d'une preuve (« 2026-10-12 » → « 12/10/2026 ») ; texte tel quel s'il n'est pas une date. */
export function evidenceDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }).format(d);
}

// ---------------------------------------------------------------- sources

export type SourceState = "ACTIVE" | "INACTIVE" | "ERROR" | "PROPOSED";

/**
 * État d'une source : « À valider » (trouvée par la veille, jamais activée), « En erreur » (dernière lecture en échec,
 * active ou arrêtée après 5 échecs), « Active », « Inactive ».
 */
export function sourceState(s: { isActive: boolean; errorCount: number; lastError: string | null; origin: string; lastScrapedAt: Date | null }): SourceState {
  if (s.errorCount > 0 && s.lastError) return "ERROR";
  if (s.isActive) return "ACTIVE";
  if (s.origin === "discovered" && !s.lastScrapedAt) return "PROPOSED";
  return "INACTIVE";
}

export const SOURCE_ORIGIN_LABELS: Record<string, string> = {
  seed: "Liste de départ",
  discovered: "Trouvée par la veille",
  client: "Ajoutée par vous",
};

export const canManageSources = (role: string) => role === "ADMIN";

// ---------------------------------------------------------------- rapports

/** Une ligne du texte d'un rapport, découpée en morceaux de texte et en liens (adresses http(s) rendues cliquables). */
export type ReportPiece = { text: string; url: string | null };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };

/** Texte d'un rapport tel que l'équipe l'a écrit (le briefing est échappé pour Telegram : on le remet en clair). */
export function reportText(content: unknown): string | null {
  const t = isObj(content) ? text(content.text) : typeof content === "string" ? text(content) : null;
  if (!t) return null;
  return t.replace(/<[^>]+>/g, "").replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

/** Lignes d'un texte, chaque adresse devenue un lien (« (https://…) » → lien). */
export function reportLines(t: string): ReportPiece[][] {
  return t.split("\n").map((line) => {
    const out: ReportPiece[] = [];
    let last = 0;
    for (const m of line.matchAll(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?»]/g)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ text: line.slice(last, at), url: null });
      const url = safeUrl(m[0]);
      out.push(url ? { text: hostOf(url), url } : { text: m[0], url: null });
      last = at + m[0].length;
    }
    if (last < line.length || out.length === 0) out.push({ text: line.slice(last), url: null });
    return out;
  });
}

/** Sources citées par un rapport (`content.sources` : `[{ url, date }]`), sans doublon. */
export function reportSources(content: unknown): Evidence[] {
  const seen = new Set<string>();
  return evidenceList(isObj(content) ? content.sources : null).filter((e) => (seen.has(e.url) ? false : (seen.add(e.url), true)));
}

// ---------------------------------------------------------------- recommandations

export type MarketRecView = {
  id: string;
  title: string;
  description: string | null;
  market: MarketKey | null;
  countries: string[];
  risk: (typeof RISKS)[number] | null;
  priority: string | null;
  /** Type de pub, angle, format, plateforme visée, en mots (« vidéo », « angle bonus », « 15 s vertical », « TikTok »). */
  details: string[];
  /** Plateforme visée (code), pour la pastille. */
  platform: (typeof PLATFORMS)[number] | null;
  evidence: Evidence[];
  /** Faux quand une seule source la porte (montrée « non vérifiée »). */
  verified: boolean;
  status: string;
  comment: string | null;
  createdAt: Date;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
};

/**
 * Recommandation `market_analysis` à l'écran. Forme écrite par le Stratège (`saveMarketRecommendation`) : `after` =
 * `{ title, description, market, countries, adType, angle, format, platform, risk, priority }`, `evidence` =
 * `{ sources: [{ url, date }], verified, … }`, `targetId` = « CASINO:FR,DE ».
 */
export function marketRecView(
  r: {
    id: string;
    field: string;
    targetId: string;
    after: unknown;
    evidence: unknown;
    status: string;
    comment: string | null;
    createdAt: Date;
    appliedAt?: Date | null;
    doneAt?: Date | null;
    rejectedAt: Date | null;
  },
  labels: { adType?: Readonly<Record<string, string>>; angle?: Readonly<Record<string, string>> } = {},
): MarketRecView {
  const a = isObj(r.after) ? r.after : {};
  const ev = isObj(r.evidence) ? r.evidence : {};
  const afterText = typeof r.after === "string" ? r.after : null;
  const market = pick(MARKETS, a.market) ?? pick(MARKETS, r.targetId.split(":")[0]);
  const evidence = evidenceList(r.evidence).length ? evidenceList(r.evidence) : evidenceList(a.evidence ?? a.sources);
  const platform = pick(PLATFORMS, a.platform);
  const adType = text(a.adType);
  const angle = text(a.angle);
  const details = [
    adType ? (labels.adType?.[adType] ?? adType.toLowerCase()) : null,
    angle ? `angle ${labels.angle?.[angle] ?? angle.toLowerCase()}` : null,
    text(a.format),
  ].filter((x): x is string => Boolean(x));
  const priority = typeof a.priority === "number" ? String(a.priority) : text(a.priority);
  return {
    id: r.id,
    title: text(a.title) ?? afterText ?? "Recommandation",
    description: text(a.description) ?? text(a.text),
    market,
    countries: stringList(a.countries).filter((c) => /^[A-Z]{2}$/.test(c) || c === "ALL"),
    risk: pick(RISKS, a.risk),
    priority,
    details,
    platform,
    evidence,
    verified: ev.verified === true || (ev.verified === undefined && evidence.length > 1),
    status: r.status,
    comment: r.comment,
    createdAt: r.createdAt,
    acceptedAt: r.appliedAt ?? r.doneAt ?? null,
    rejectedAt: r.rejectedAt,
  };
}

export const canDecideRecommendation = (status: string) => status === "PROPOSED";

export const REC_COMMENT_MAX = 1000;

export function cleanRecComment(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, REC_COMMENT_MAX) : null;
}

export const REC_DECISIONS = {
  APPLIED: { button: "Accepter", done: "Recommandation acceptée : à vous de la mettre en place, rien n'est changé chez Meta ni TikTok." },
  REJECTED: { button: "Refuser", done: "Recommandation refusée." },
} as const;
