/**
 * Phase 29, chantier B — Agent Stratège (`docs/prompts/31-phase-29-analystes-marche.md`, section 4).
 *
 * - `answerMarketQuestion` : question du client (« qu'est-ce qui marche en casino en France ? ») → entrées de veille des
 *   30 derniers jours filtrées (marché, pays, plateforme), règles actives, chiffres internes de l'agent Ads s'il y en a ;
 *   Opus 5.5 rédige (français, 20 lignes au plus) ; le code contrôle : toute adresse citée doit venir des entrées /
 *   règles fournies (sinon retirée, et la ligne avec si c'était sa seule source), une affirmation sans source est
 *   retirée, « non vérifié » ajouté quand la seule source n'est pas vérifiée, avis juridique réécrit, `LEGAL_DISCLAIMER`
 *   dès qu'on parle de règles. Aucune entrée → réponse honnête sans IA, et proposition de lancer une recherche.
 * - `weeklySynthesis` : par marché × pays (entrées de la semaine), tendances, règles et croisement interne →
 *   `Recommendation` (`teamKey = "analystes"`, `source = "market_analysis"`, cible `MARKET`) : type d'annonce, angle,
 *   format, pays, risque, preuves, priorité. Rien n'est appliqué nulle part (règle 6) : le client décide.
 */
import { agentEvent } from "../admin/journal";
import { parisWeekStart } from "../algo/week";
import { voiceCheck } from "../boss/voice";
import {
  cleanLine,
  distinctSources,
  escHtml,
  hasLegalAdvice,
  isKnownUrl,
  isRiskLevel,
  LEGAL_REWRITE_SENTENCE,
  maxRisk,
  normalizeUrl,
  riskRank,
  sanitizeLegal,
  shorten,
  stripUnknownUrls,
  urlsIn,
} from "./citations";
import { entryMentions, ruleSimilarity } from "./compliance";
import {
  ANALYSTS_LIMITS,
  ANALYSTS_SETTINGS,
  ANALYSTS_TEAM_KEY,
  EUROPE_COUNTRIES,
  LEGAL_DISCLAIMER,
  MARKET_ANALYSIS_SOURCE,
  type CompliancePlatform,
  type Market,
  type RiskLevel,
  type SourceRef,
} from "./contract";
import { countryLabel, MARKET_LABELS, MARKETS } from "./analysis-labels";
import { internalFor, loadInternalFigures } from "./internal";
import { ANALYSTS_DATA_RULES, callAnalystsTask, nowOfDeps, parseAnalystsJson, type AnalystsBrainDeps } from "./reasoning";

/** Types d'annonce, angles (section 4 du prompt). */
export const AD_TYPES = ["VIDEO", "IMAGE", "CAROUSEL", "UGC", "TEXT"] as const;
export const AD_ANGLES = ["BONUS", "GAINS", "LIFESTYLE", "TEMOIGNAGE", "COMPARAISON", "AUTRE"] as const;
export type AdType = (typeof AD_TYPES)[number];
export type AdAngle = (typeof AD_ANGLES)[number];
export const AD_TYPE_LABELS: Readonly<Record<AdType, string>> = { VIDEO: "vidéo", IMAGE: "image", CAROUSEL: "carrousel", UGC: "vidéo façon témoignage d'utilisateur", TEXT: "texte" };
export const AD_ANGLE_LABELS: Readonly<Record<AdAngle, string>> = { BONUS: "bonus", GAINS: "gains", LIFESTYLE: "style de vie", TEMOIGNAGE: "témoignage", COMPARAISON: "comparaison", AUTRE: "autre" };

/** Cible des recommandations de marché (jamais appliquée par le code : aucune fonction d'application ne la connaît). */
export const MARKET_RECOMMENDATION_TARGET = "MARKET";
export const MARKET_RECOMMENDATION_FIELD = "ad_strategy";
export const STRATEGY_LIMITS = { entriesInPrompt: 40, rulesInPrompt: 30, maxGroups: 12, entriesPerGroup: 12, maxRecommendationsPerGroup: 3, sameRecommendationSimilarity: 0.6 } as const;

type EntryRow = {
  id: string;
  market: string;
  countries: unknown;
  title: string | null;
  summary: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  category: string;
  tags: unknown;
  sentiment: string;
  relevanceScore: number;
  verified: boolean;
};
type RuleRow = { id: string; platform: string; market: string; country: string; rule: string; riskLevel: string; evidence: unknown; verified: boolean; workaround: string | null; createdAt: Date; updatedAt: Date };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function ruleUrls(r: Pick<RuleRow, "evidence">): string[] {
  return Array.isArray(r.evidence) ? (r.evidence as Array<{ url?: unknown }>).map((e) => (typeof e?.url === "string" ? e.url : "")).filter(Boolean) : [];
}

/** Seuil de pertinence affiché (`analysts.relevance_threshold`). */
async function relevanceThreshold(deps: AnalystsBrainDeps): Promise<number> {
  try {
    const row = await deps.prisma.setting.findUnique({ where: { key: ANALYSTS_SETTINGS.relevanceThreshold.key } });
    const n = Number(row?.value);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n;
  } catch {
    /* réglage illisible */
  }
  return ANALYSTS_SETTINGS.relevanceThreshold.value;
}

/** Pays demandés, normalisés (codes européens connus seulement). */
export function normalizeCountries(list: readonly string[] | null | undefined): string[] {
  return [...new Set((list ?? []).map((c) => c.trim().toUpperCase()).filter((c) => c in EUROPE_COUNTRIES))];
}

/** Une entrée concerne-t-elle ces pays (entrée sans pays = toute l'Europe) ? */
const entryInCountries = (e: Pick<EntryRow, "countries">, countries: readonly string[]) => {
  if (!countries.length) return true;
  const c = strings(e.countries).map((x) => x.toUpperCase());
  return !c.length || c.includes("ALL") || c.some((x) => countries.includes(x));
};

/** Entrées récentes filtrées (marché, pays, seuil de pertinence), les plus pertinentes d'abord. */
export async function loadRecentEntries(
  deps: AnalystsBrainDeps,
  q: { market?: Market | null; countries?: readonly string[]; since: Date; platform?: CompliancePlatform | null; limit?: number },
): Promise<EntryRow[]> {
  const min = await relevanceThreshold(deps);
  const rows = (await deps.prisma.trendEntry.findMany({
    where: {
      ...(q.market ? { market: q.market } : {}),
      relevanceScore: { gte: min },
      OR: [{ publishedAt: { gte: q.since } }, { publishedAt: null, createdAt: { gte: q.since } }],
    },
    orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
    take: 300,
  })) as EntryRow[];
  const list = rows.filter((e) => entryInCountries(e, q.countries ?? []));
  if (q.platform) list.sort((a, b) => Number(entryMentions(b, q.platform!)) - Number(entryMentions(a, q.platform!)));
  return list.slice(0, q.limit ?? STRATEGY_LIMITS.entriesInPrompt);
}

/** Règles actives du marché, des pays (ou « ALL ») et de la plateforme, les plus risquées d'abord. */
export async function loadActiveRules(
  deps: AnalystsBrainDeps,
  q: { market?: Market | null; countries?: readonly string[]; platform?: CompliancePlatform | null; limit?: number },
): Promise<RuleRow[]> {
  const rows = (await deps.prisma.complianceRule.findMany({
    where: { isActive: true, ...(q.market ? { market: q.market } : {}), ...(q.platform ? { platform: q.platform } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 300,
  })) as RuleRow[];
  const countries = q.countries ?? [];
  return rows
    .filter((r) => !countries.length || r.country === "ALL" || countries.includes(r.country))
    .sort((a, b) => riskRank(b.riskLevel as RiskLevel) - riskRank(a.riskLevel as RiskLevel))
    .slice(0, q.limit ?? STRATEGY_LIMITS.rulesInPrompt);
}

/** Sources connues (adresse → vérifiée ?, date, titre) d'un lot d'entrées et de règles. */
export function sourceIndex(entries: readonly EntryRow[], rules: readonly RuleRow[]): Map<string, { url: string; verified: boolean; date: string | null; title: string | null }> {
  const map = new Map<string, { url: string; verified: boolean; date: string | null; title: string | null }>();
  const add = (url: string, verified: boolean, date: string | null, title: string | null) => {
    const k = normalizeUrl(url);
    const prev = map.get(k);
    map.set(k, { url: prev?.url ?? url, verified: (prev?.verified ?? false) || verified, date: prev?.date ?? date, title: prev?.title ?? title });
  };
  for (const e of entries) add(e.url, e.verified, dayOf(e.publishedAt ?? e.createdAt), e.title);
  for (const r of rules) {
    const ev = Array.isArray(r.evidence) ? (r.evidence as Array<{ url?: unknown; date?: unknown; description?: unknown }>) : [];
    for (const e of ev) if (typeof e?.url === "string") add(e.url, r.verified, typeof e.date === "string" ? e.date : null, null);
  }
  return map;
}

// ------------------------------------------------------------------------------------------------ réponse

export type MarketQuestion = { question: string; market?: Market | null; countries?: string[] | null; platform?: CompliancePlatform | null };

export type MarketAnswer = {
  /** HTML Telegram (texte échappé), prêt pour Kevin. */
  text: string;
  noData: boolean;
  /** Aucune entrée : Kevin propose de lancer une recherche (chantier C : bouton ou question). */
  suggestSearch: boolean;
  mentionsRules: boolean;
  sources: SourceRef[];
  usedEntryIds: string[];
  usedRuleIds: string[];
  removedUrls: string[];
  removedLegal: string[];
  costCents: number;
  market: Market | null;
  countries: string[];
};

/** Phrase qui dit ce qui manque (seule forme gardée sans adresse dans une réponse du Stratège). */
const NO_DATA_LINE =
  /\b(je n'ai|je n’ai|j'ai rien|je ne (sais|vois|trouve)|rien de|rien sur|aucune? |pas (de|d'|d’|encore|assez)|ne permet pas|ne dit pas|ne parle pas|pas trouvé|impossible de dire)\b/iu;

const RULES_WORDS = /\b(ban|bann|r[èe]gle|risqu|interdi|autoris|compliance|politique|refus|bloqu|sans se faire)/iu;

function scopeLabel(market: Market | null, countries: readonly string[]): string {
  const m = market ? `le ${MARKET_LABELS[market]}` : "ce sujet";
  const c = countries.length ? ` en ${countries.map(countryLabel).join(", ")}` : "";
  return `${m}${c}`;
}

/** Réponse honnête quand rien n'a été lu (texte fixe, voix de Kevin). */
export function noDataAnswer(market: Market | null, countries: readonly string[]): string {
  return `Je n'ai encore rien lu de solide sur ${scopeLabel(market, countries)} ces 30 derniers jours. Tu veux que je lance une recherche ?`;
}

export const STRATEGIST_ANSWER_SYSTEM = [
  "Tu es le stratège d'une équipe d'affiliation (casino, paris sportifs, rencontres) en Europe. Tu réponds à une question du client à partir de la veille fournie (forums, actualités, réseaux), des règles des plateformes publicitaires et des chiffres internes de ses pubs.",
  "Écris en français, en tutoyant, phrases courtes, sans introduction ni formule de fin. 20 lignes au plus.",
  "Chaque affirmation tient sur une ligne qui commence par « - » et se termine par l'adresse de sa source entre parenthèses, recopiée à l'identique depuis DONNÉES. Une source marquée verified=false : écris « non vérifié » sur la ligne.",
  "Si les chiffres internes sont fournis, croise-les avec la veille en recopiant les nombres tels quels ; sinon n'en parle pas. N'invente aucun chiffre.",
  "Si DONNÉES ne permet pas de répondre à une partie de la question, dis-le en une phrase plutôt que d'inventer.",
  ANALYSTS_DATA_RULES,
].join("\n");

/**
 * Nettoie et contrôle une réponse de l'IA (pur) : adresses inconnues retirées, affirmations sans source retirées,
 * « non vérifié » ajouté, avis juridique réécrit, formules retirées, 20 lignes au plus (avertissement compris).
 */
export function finalizeAnswer(
  raw: string,
  ctx: { sources: Map<string, { url: string; verified: boolean; date: string | null; title: string | null }>; mentionsRules: boolean; maxLines?: number },
): { lines: string[]; removedUrls: string[]; removedLegal: string[]; cited: string[] } {
  const known = new Set(ctx.sources.keys());
  const cleaned = raw
    .replace(/\r/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  const stripped = stripUnknownUrls(cleaned, known);
  const legal = sanitizeLegal(stripped.text);
  const lines: string[] = [];
  const cited = new Set<string>();
  for (let line of legal.text.split("\n")) {
    line = line.replace(/\s+$/g, "");
    if (!line.trim()) continue;
    const urls = urlsIn(line).filter((u) => isKnownUrl(u, known));
    const isClaim = /^\s*([-•*–]|\d+[.)])\s/u.test(line);
    if (isClaim && !urls.length) continue; // affirmation sans source : retirée
    // Hors liste, une phrase sans adresse ne reste que si elle dit ce qui manque (« je n'ai rien sur… ») ou si c'est la
    // phrase fixe qui remplace un avis juridique : une affirmation écrite sans tiret n'échappe pas au contrôle.
    if (!isClaim && !urls.length && !line.includes(LEGAL_DISCLAIMER) && !line.includes(LEGAL_REWRITE_SENTENCE) && !NO_DATA_LINE.test(line)) continue;
    if (!isClaim && !urls.length && voiceCheck(line, { allowList: true, allowLong: true }).problems.some((p) => p.code === "formule")) continue;
    if (line.includes(LEGAL_DISCLAIMER)) continue; // remis une seule fois, à la fin
    if (urls.length) {
      const allUnverified = urls.every((u) => ctx.sources.get(normalizeUrl(u))?.verified === false);
      if (allUnverified && !/non v[ée]rifi/iu.test(line)) line = `${line} (non vérifié)`;
      for (const u of urls) cited.add(normalizeUrl(u));
    }
    lines.push(line.replace(/^\s*[•*–]\s/u, "- "));
  }
  const max = (ctx.maxLines ?? ANALYSTS_LIMITS.answerMaxLines) - (ctx.mentionsRules ? 1 : 0);
  const kept = lines.slice(0, Math.max(1, max));
  return { lines: kept, removedUrls: stripped.removed, removedLegal: legal.removed, cited: [...cited] };
}

/** Répond à une question de marché (Opus 5.5 ; contrôle des sources par le code). */
export async function answerMarketQuestion(deps: AnalystsBrainDeps, q: MarketQuestion, now: Date = nowOfDeps(deps)): Promise<MarketAnswer> {
  const market = q.market && (MARKETS as readonly string[]).includes(q.market) ? q.market : null;
  const countries = normalizeCountries(q.countries);
  const platform = q.platform ?? null;
  const since = new Date(now.getTime() - ANALYSTS_LIMITS.answerWindowMs);
  const [entries, rules] = await Promise.all([loadRecentEntries(deps, { market, countries, since, platform }), loadActiveRules(deps, { market, countries, platform })]);
  const mentionsRules = rules.length > 0 || platform !== null || RULES_WORDS.test(q.question);
  const base = { market, countries, usedEntryIds: [] as string[], usedRuleIds: [] as string[], removedUrls: [] as string[], removedLegal: [] as string[], mentionsRules };
  if (!entries.length && !rules.length) {
    return { ...base, text: escHtml(noDataAnswer(market, countries)), noData: true, suggestSearch: true, sources: [], costCents: 0 };
  }
  const internal = internalFor(await loadInternalFigures(deps, now), market);
  const sources = sourceIndex(entries, rules);
  const user = JSON.stringify({
    QUESTION: cleanLine(q.question, 600),
    filtre: { marche: market, pays: countries, plateforme: platform },
    DONNÉES: {
      veille: entries.map((e) => ({
        url: e.url,
        date: dayOf(e.publishedAt ?? e.createdAt),
        verified: e.verified,
        category: e.category,
        sentiment: e.sentiment,
        countries: strings(e.countries),
        title: cleanLine(e.title, 200) || null,
        summary: cleanLine(e.summary, ANALYSTS_LIMITS.summaryMaxChars),
      })),
      regles: rules.map((r) => ({ platform: r.platform, country: r.country, rule: r.rule, riskLevel: r.riskLevel, verified: r.verified, urls: ruleUrls(r) })),
      chiffresInternes7Jours: internal.length ? internal : null,
    },
  });
  const res = await callAnalystsTask(deps, "strategy", { system: STRATEGIST_ANSWER_SYSTEM, user });
  const fin = finalizeAnswer(res.text, { sources, mentionsRules });
  const claimLines = fin.lines.filter((l) => urlsIn(l).length);
  let body: string[];
  if (!claimLines.length) body = [`Je n'ai rien de sourcé à te dire sur ${scopeLabel(market, countries)} pour l'instant. Tu veux que je lance une recherche ?`];
  else body = fin.lines;
  if (mentionsRules) body = [...body, LEGAL_DISCLAIMER];
  const citedSet = new Set(fin.cited);
  const usedEntryIds = entries.filter((e) => citedSet.has(normalizeUrl(e.url))).map((e) => e.id);
  const usedRuleIds = rules.filter((r) => ruleUrls(r).some((u) => citedSet.has(normalizeUrl(u)))).map((r) => r.id);
  const refs: SourceRef[] = fin.cited.map((k) => {
    const s = sources.get(k)!;
    return { url: s.url, date: s.date, title: s.title };
  });
  await agentEvent(deps, "analysts.strategy.answer", { market, countries, entries: entries.length, rules: rules.length, cited: refs.length, removedUrls: fin.removedUrls.length });
  return {
    ...base,
    text: escHtml(body.join("\n")),
    noData: !claimLines.length,
    suggestSearch: !claimLines.length,
    sources: refs,
    usedEntryIds,
    usedRuleIds,
    removedUrls: fin.removedUrls,
    removedLegal: fin.removedLegal,
    costCents: res.costCents,
  };
}

// --------------------------------------------------------------------------------------- synthèse hebdo

export type SynthesisTrend = { text: string; sources: SourceRef[]; verified: boolean };
export type SynthesisRecommendation = {
  id: string;
  number: number;
  title: string;
  description: string;
  market: Market;
  countries: string[];
  adType: AdType;
  angle: AdAngle;
  format: string;
  platform: CompliancePlatform | null;
  risk: Exclude<RiskLevel, "BAN">;
  priority: 1 | 2 | 3;
  sources: SourceRef[];
  verified: boolean;
  created: boolean;
};
export type SynthesisGroup = {
  market: Market;
  country: string;
  entries: number;
  trends: SynthesisTrend[];
  ruleIds: string[];
  /** Règle la plus risquée du groupe (HIGH / BAN) : alerte du rapport. */
  topRule: { id: string; text: string; riskLevel: RiskLevel; platform: string; url: string | null; verified: boolean } | null;
  internal: string | null;
  recommendations: SynthesisRecommendation[];
};
export type WeeklySynthesis = {
  weekStart: string;
  since: string;
  groups: SynthesisGroup[];
  recommendations: SynthesisRecommendation[];
  entries: number;
  costCents: number;
  writtenBy: "ai" | "none";
};

export const STRATEGIST_WEEKLY_SYSTEM = [
  "Tu es le stratège d'une équipe d'affiliation (casino, paris sportifs, rencontres) en Europe. Synthèse de la semaine, par marché et par pays.",
  "Pour chaque groupe fourni : 1 à 3 tendances (phrase courte en français + adresses de leurs sources), une phrase de croisement avec les chiffres internes s'ils existent (nombres recopiés tels quels, sinon null), et 0 à 3 recommandations d'annonces.",
  `Une recommandation : titre court, description (2 phrases), adType parmi ${AD_TYPES.join(", ")}, angle parmi ${AD_ANGLES.join(", ")}, format (durée, ratio, avec ou sans texte, avec ou sans voix), plateforme (META, TIKTOK ou null), pays (codes), risque (LOW, MEDIUM ou HIGH ; ne recommande jamais une pratique qu'une règle classe BAN), priorité 1 (haute) à 3, et les adresses de ses preuves.`,
  "Tiens compte des règles fournies : une recommandation qui touche une règle à risque prend au moins ce risque.",
  ANALYSTS_DATA_RULES,
  'Réponds uniquement par un JSON : {"groups":[{"market":"CASINO","country":"FR","trends":[{"text":"…","urls":["…"]}],"internal":null,"recommendations":[{"title":"…","description":"…","adType":"VIDEO","angle":"BONUS","format":"…","platform":"TIKTOK","countries":["FR"],"risk":"MEDIUM","priority":1,"urls":["…"]}]}]}',
].join("\n");

const groupKey = (m: string, c: string) => `${m}:${c}`;

function refsOf(urls: readonly string[], sources: ReturnType<typeof sourceIndex>): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const u of urls) {
    const k = normalizeUrl(u);
    const s = sources.get(k);
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push({ url: s.url, date: s.date, title: s.title });
  }
  return out;
}

/** Groupes marché × pays des entrées (pays absent = « ALL »), les plus fournis d'abord. */
export function groupEntries(entries: readonly EntryRow[]): Array<{ market: Market; country: string; entries: EntryRow[] }> {
  const map = new Map<string, { market: Market; country: string; entries: EntryRow[] }>();
  for (const e of entries) {
    if (!(MARKETS as readonly string[]).includes(e.market)) continue;
    const cs = strings(e.countries).map((c) => c.toUpperCase()).filter((c) => c === "ALL" || c in EUROPE_COUNTRIES);
    for (const c of cs.length ? cs : ["ALL"]) {
      const k = groupKey(e.market, c);
      const g = map.get(k) ?? { market: e.market as Market, country: c, entries: [] };
      g.entries.push(e);
      map.set(k, g);
    }
  }
  // Le client travaille d'abord en France : les groupes France (un par marché) passent toujours, puis les plus fournis.
  const fr = (g: { country: string }) => (g.country === "FR" ? 1 : 0);
  return [...map.values()]
    .sort((a, b) => fr(b) - fr(a) || b.entries.length - a.entries.length)
    .slice(0, STRATEGY_LIMITS.maxGroups)
    .map((g) => ({ ...g, entries: [...g.entries].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, STRATEGY_LIMITS.entriesPerGroup) }));
}

function topRuleOf(rules: readonly RuleRow[]): SynthesisGroup["topRule"] {
  const r = [...rules].filter((x) => riskRank(x.riskLevel as RiskLevel) >= riskRank("HIGH")).sort((a, b) => riskRank(b.riskLevel as RiskLevel) - riskRank(a.riskLevel as RiskLevel) || b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (!r) return null;
  return { id: r.id, text: r.rule, riskLevel: r.riskLevel as RiskLevel, platform: r.platform, url: ruleUrls(r)[0] ?? null, verified: r.verified };
}

/** Tendances écrites par le code (repli sans IA) : résumés des entrées les plus pertinentes. */
export function codeTrends(entries: readonly EntryRow[], max = 2): SynthesisTrend[] {
  return entries.slice(0, max).map((e) => ({ text: shorten(cleanLine(e.summary, ANALYSTS_LIMITS.summaryMaxChars), 200), sources: [{ url: e.url, date: dayOf(e.publishedAt ?? e.createdAt), title: e.title }], verified: e.verified }));
}

/**
 * Synthèse de la semaine (Opus 5.5, un seul appel pour tous les groupes) et recommandations `market_analysis`.
 * Aucune entrée → aucun appel, groupes vides. Rien n'est appliqué.
 */
export async function weeklySynthesis(deps: AnalystsBrainDeps, now: Date = nowOfDeps(deps)): Promise<WeeklySynthesis> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const weekStart = parisWeekStart(now);
  const entries = await loadRecentEntries(deps, { since, limit: 300 });
  const grouped = groupEntries(entries);
  const out: WeeklySynthesis = { weekStart, since: since.toISOString(), groups: [], recommendations: [], entries: entries.length, costCents: 0, writtenBy: "none" };
  if (!grouped.length) return out;
  const allRules = await loadActiveRules(deps, { limit: 300 });
  const rulesOf = (m: Market, c: string) => allRules.filter((r) => r.market === m && (r.country === "ALL" || c === "ALL" || r.country === c));
  const figures = await loadInternalFigures(deps, now);
  const sources = sourceIndex(entries, allRules);
  const user = JSON.stringify({
    semaine: weekStart,
    DONNÉES: {
      groupes: grouped.map((g) => ({
        market: g.market,
        country: g.country,
        veille: g.entries.map((e) => ({ url: e.url, date: dayOf(e.publishedAt ?? e.createdAt), verified: e.verified, category: e.category, sentiment: e.sentiment, summary: cleanLine(e.summary, ANALYSTS_LIMITS.summaryMaxChars) })),
        regles: rulesOf(g.market, g.country).slice(0, 10).map((r) => ({ platform: r.platform, country: r.country, rule: r.rule, riskLevel: r.riskLevel, verified: r.verified, urls: ruleUrls(r) })),
        chiffresInternes7Jours: internalFor(figures, g.market),
      })),
    },
  });
  const res = await callAnalystsTask(deps, "strategy", { system: STRATEGIST_WEEKLY_SYSTEM, user });
  out.costCents = res.costCents;
  out.writtenBy = "ai";
  const data = parseAnalystsJson(res.text, "la synthèse de la semaine");
  const aiGroups = new Map<string, Record<string, unknown>>();
  for (const g of Array.isArray(data.groups) ? data.groups : []) {
    const o = (g ?? {}) as Record<string, unknown>;
    if (typeof o.market === "string" && typeof o.country === "string") aiGroups.set(groupKey(o.market.toUpperCase(), o.country.toUpperCase()), o);
  }
  const known = new Set(sources.keys());
  let number = 0;
  for (const g of grouped) {
    const ai = aiGroups.get(groupKey(g.market, g.country)) ?? {};
    const rules = rulesOf(g.market, g.country);
    const trends: SynthesisTrend[] = [];
    for (const t of (Array.isArray(ai.trends) ? ai.trends : []).slice(0, 3)) {
      const o = (t ?? {}) as Record<string, unknown>;
      const urls = strings(o.urls).filter((u) => isKnownUrl(u, known));
      let text = cleanLine(o.text, 300);
      if (hasLegalAdvice(text)) text = sanitizeLegal(text, { replacement: null }).text;
      if (!urls.length || text.length < 8) continue;
      const refs = refsOf(urls, sources);
      trends.push({ text, sources: refs, verified: refs.some((r) => sources.get(normalizeUrl(r.url))?.verified) || distinctSources(refs.map((r) => r.url)) >= 2 });
    }
    let internal = cleanLine(ai.internal, 300) || null;
    if (internal && !internalFor(figures, g.market).length) internal = null; // aucun chiffre interne : rien à croiser
    const group: SynthesisGroup = {
      market: g.market,
      country: g.country,
      entries: g.entries.length,
      trends: trends.length ? trends : codeTrends(g.entries),
      ruleIds: rules.map((r) => r.id),
      topRule: topRuleOf(rules),
      internal,
      recommendations: [],
    };
    for (const r of (Array.isArray(ai.recommendations) ? ai.recommendations : []).slice(0, STRATEGY_LIMITS.maxRecommendationsPerGroup)) {
      const v = validateRecommendation(r, { market: g.market, country: g.country, known, rules });
      if (!v) continue;
      const refs = refsOf(v.urls, sources);
      const verified = distinctSources(refs.map((x) => x.url)) >= 2;
      const saved = await saveMarketRecommendation(deps, { ...v, sources: refs, verified, number: ++number }, now);
      group.recommendations.push(saved);
      out.recommendations.push(saved);
    }
    out.groups.push(group);
  }
  await agentEvent(deps, "analysts.strategy.weekly", { groups: out.groups.length, recommendations: out.recommendations.length, entries: entries.length });
  return out;
}

type ValidRecommendation = Omit<SynthesisRecommendation, "id" | "number" | "sources" | "verified" | "created"> & { urls: string[] };

/** Validation d'une recommandation de l'IA (pur) : preuves fournies, valeurs connues, risque le plus prudent, jamais BAN. */
export function validateRecommendation(
  raw: unknown,
  ctx: { market: Market; country: string; known: ReadonlySet<string>; rules: ReadonlyArray<Pick<RuleRow, "platform" | "riskLevel" | "country">> },
): ValidRecommendation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const urls = strings(o.urls).filter((u) => isKnownUrl(u, ctx.known));
  if (!urls.length) return null;
  const title = sanitizeLegal(cleanLine(o.title, 120), { replacement: null }).text;
  const description = sanitizeLegal(cleanLine(o.description, 500), { replacement: null }).text;
  if (title.length < 4) return null;
  const adType = (AD_TYPES as readonly string[]).includes(String(o.adType).toUpperCase()) ? (String(o.adType).toUpperCase() as AdType) : "IMAGE";
  const angleRaw = String(o.angle ?? "").toUpperCase().normalize("NFD").replace(/\p{M}+/gu, "");
  const angle = (AD_ANGLES as readonly string[]).includes(angleRaw) ? (angleRaw as AdAngle) : "AUTRE";
  const platformRaw = typeof o.platform === "string" ? o.platform.toUpperCase() : null;
  const platform = platformRaw && (["META", "TIKTOK", "GOOGLE", "SNAP", "X", "TELEGRAM", "OTHER"] as const).includes(platformRaw as CompliancePlatform) ? (platformRaw as CompliancePlatform) : null;
  const countries = normalizeCountries(strings(o.countries));
  const finalCountries = countries.length ? countries : ctx.country === "ALL" ? [] : [ctx.country];
  const aiRisk: RiskLevel = isRiskLevel(String(o.risk).toUpperCase()) ? (String(o.risk).toUpperCase() as RiskLevel) : "MEDIUM";
  // Risque le plus prudent : celui de la plateforme visée dans les pays visés (ou au moins MEDIUM sans plateforme connue).
  const touching = ctx.rules.filter((r) => (!platform || r.platform === platform) && (r.country === "ALL" || !finalCountries.length || finalCountries.includes(r.country)));
  const ruleRisk = platform ? touching.reduce<RiskLevel>((a, r) => maxRisk(a, r.riskLevel as RiskLevel), "LOW") : "LOW";
  const risk = maxRisk(aiRisk, ruleRisk);
  if (risk === "BAN") return null;
  const p = Number(o.priority);
  const priority = (p === 1 || p === 2 || p === 3 ? p : 2) as 1 | 2 | 3;
  return { title, description, market: ctx.market, countries: finalCountries, adType, angle, format: cleanLine(o.format, 200), platform, risk, priority, urls };
}

/**
 * Enregistre une recommandation de marché (`Recommendation` `analystes` / `market_analysis`, cible `MARKET`, taille BIG :
 * jamais appliquée seule). Une recommandation ouverte au même titre (ou presque) sur le même marché et les mêmes pays
 * est mise à jour, pas doublée.
 */
export async function saveMarketRecommendation(
  deps: AnalystsBrainDeps,
  r: ValidRecommendation & { sources: SourceRef[]; verified: boolean; number: number },
  now: Date,
): Promise<SynthesisRecommendation> {
  const targetId = `${r.market}:${r.countries.length ? r.countries.join(",") : "ALL"}`;
  const after = { title: r.title, description: r.description, market: r.market, countries: r.countries, adType: r.adType, angle: r.angle, format: r.format, platform: r.platform, risk: r.risk, priority: r.priority };
  const evidence = { agent: "stratege", number: r.number, sources: r.sources, verified: r.verified, risk: r.risk, priority: r.priority };
  const open = (await deps.prisma.recommendation.findMany({
    where: { teamKey: ANALYSTS_TEAM_KEY, source: MARKET_ANALYSIS_SOURCE, status: "PROPOSED", target: MARKET_RECOMMENDATION_TARGET, targetId },
  })) as Array<{ id: string; after: unknown }>;
  const same = open.find((x) => ruleSimilarity(String((x.after as { title?: unknown } | null)?.title ?? ""), r.title) >= STRATEGY_LIMITS.sameRecommendationSimilarity);
  const weekStart = parisWeekStart(now);
  const base = { id: "", number: r.number, title: r.title, description: r.description, market: r.market, countries: r.countries, adType: r.adType, angle: r.angle, format: r.format, platform: r.platform, risk: r.risk as Exclude<RiskLevel, "BAN">, priority: r.priority, sources: r.sources, verified: r.verified };
  if (same) {
    await deps.prisma.recommendation.update({ where: { id: same.id }, data: { after: json(after), evidence: json(evidence), expectedGain: r.title, weekStart } });
    return { ...base, id: same.id, created: false };
  }
  const row = await deps.prisma.recommendation.create({
    data: {
      teamKey: ANALYSTS_TEAM_KEY,
      target: MARKET_RECOMMENDATION_TARGET,
      targetId,
      field: MARKET_RECOMMENDATION_FIELD,
      after: json(after),
      evidence: json(evidence),
      expectedGain: r.title,
      size: "BIG",
      status: "PROPOSED",
      weekStart,
      source: MARKET_ANALYSIS_SOURCE,
    },
  });
  return { ...base, id: row.id, created: true };
}

/** Description d'une recommandation pour Kevin (texte simple, une ligne). */
export function recommendationLine(r: Pick<SynthesisRecommendation, "number" | "title" | "adType" | "angle" | "countries" | "risk">): string {
  const where = r.countries.length ? r.countries.map(countryLabel).join(", ") : "toute l'Europe";
  const risk = { LOW: "faible", MEDIUM: "moyen", HIGH: "élevé" }[r.risk];
  return `${r.number}. ${r.title} : ${AD_TYPE_LABELS[r.adType]}, angle ${AD_ANGLE_LABELS[r.angle]}, ${where}, risque ${risk}.`;
}

