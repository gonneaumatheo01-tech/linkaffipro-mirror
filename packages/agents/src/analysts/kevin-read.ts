/**
 * Phase 29, chantier C — lectures instantanées de Kevin pour l'équipe Analystes (aucune IA, aucun réseau) : tendances
 * récentes, règles des plateformes pub, alertes du moment, sources surveillées, recommandations ouvertes. Chaque ligne
 * porte sa source (adresse + date) ; une règle d'une seule source est dite « non vérifiée » ; dès qu'on parle de
 * règles, la phrase fixe `LEGAL_DISCLAIMER` est ajoutée par `boundedAnswer`.
 */
import { esc, nowOf } from "../admin/journal";
import { pick } from "../boss/voice";
import type { AgentsDeps } from "../types";
import { ANALYSTS_LIMITS, ANALYSTS_TEAM_KEY, MARKET_ANALYSIS_SOURCE, type CompliancePlatform, type Market, type RiskLevel, type SourceRef } from "./contract";
import { analystsScheduleSettings } from "./kevin-state";
import { countryLabel, MARKET_LABELS, PLATFORM_LABELS } from "./analysis-labels";
import { RISK_ORDER } from "./citations";
import { ANALYSTS_KEVIN_VARIANTS as V, boundedAnswer, RISK_WORDS, riskAtLeast, shortDate } from "./kevin-texts";

export type TrendRow = {
  id: string;
  sourceId: string;
  market: string;
  countries: unknown;
  title: string | null;
  summary: string;
  url: string;
  publishedAt: Date | null;
  category: string;
  relevanceScore: number;
  verified: boolean;
  createdAt: Date;
  tags?: unknown;
};

export type RuleRow = {
  id: string;
  platform: string;
  market: string;
  country: string;
  rule: string;
  riskLevel: string;
  evidence: unknown;
  verified: boolean;
  isActive: boolean;
  workaround: string | null;
  lastVerifiedAt: Date;
  sourceEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceRow = {
  id: string;
  name: string;
  url: string;
  sourceType: string;
  market: string;
  countries: unknown;
  isActive: boolean;
  origin?: string | null;
  errorCount: number;
  lastScrapedAt: Date | null;
  nextScrapeAt: Date | null;
  lastError?: string | null;
};

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Preuves d'une règle (adresse, date), dans l'ordre. */
export function ruleSources(r: Pick<RuleRow, "evidence">): SourceRef[] {
  const ev = Array.isArray(r.evidence) ? (r.evidence as Array<{ url?: unknown; date?: unknown }>) : [];
  return ev.filter((e) => typeof e?.url === "string").map((e) => ({ url: e.url as string, date: typeof e.date === "string" ? e.date : null }));
}

export const entrySource = (e: Pick<TrendRow, "url" | "publishedAt" | "createdAt">): SourceRef => ({ url: e.url, date: (e.publishedAt ?? e.createdAt)?.toISOString?.() ?? null });

/** « casino, France » / « Meta, casino, France ». */
export function scopeText(f: { market?: Market | null; countries?: readonly string[]; platform?: CompliancePlatform | null }): string {
  const parts = [f.platform ? PLATFORM_LABELS[f.platform] : null, f.market ? MARKET_LABELS[f.market] : null, f.countries?.length ? f.countries.map(countryLabel).join(", ") : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "tous les marchés";
}

/** Une ligne de tendance : résumé (180 caractères), source et date, « non vérifiée » si besoin. */
function trendLine(e: TrendRow, chatId: string | null): string {
  const summary = e.summary.replace(/\s+/g, " ").trim();
  const short = summary.length > 180 ? `${summary.slice(0, 179)}…` : summary;
  const when = shortDate(e.publishedAt ?? e.createdAt);
  const unverified = e.verified ? "" : ` (${pick(V.unverified, "analysts.unverified", chatId)})`;
  return `- ${esc(short)} (${esc(e.url)}${when ? `, ${when}` : ""})${unverified}`;
}

/** Une ligne de règle : plateforme, pays, règle, risque, preuve. */
export function ruleLine(r: RuleRow, chatId: string | null): string {
  const src = ruleSources(r)[0];
  const when = src ? shortDate(src.date) : null;
  const unverified = r.verified ? "" : ` (${pick(V.unverified, "analysts.unverified", chatId)})`;
  const text = r.rule.replace(/\s+/g, " ").trim();
  return `- ${esc(PLATFORM_LABELS[r.platform as CompliancePlatform] ?? r.platform)}, ${esc(countryLabel(r.country))} : ${esc(text.length > 200 ? `${text.slice(0, 199)}…` : text)} Risque : ${RISK_WORDS[r.riskLevel as RiskLevel] ?? r.riskLevel.toLowerCase()}.${src ? ` (${esc(src.url)}${when ? `, ${when}` : ""})` : ""}${unverified}`;
}

function countriesMatch(rowCountries: unknown, wanted: readonly string[]): boolean {
  if (!wanted.length) return true;
  const list = strings(rowCountries).map((c) => c.toUpperCase());
  return !list.length || list.includes("ALL") || wanted.some((w) => list.includes(w));
}

/** Entrée qui parle des règles des plateformes ou de la réglementation : la phrase fixe l'accompagne (règle 2). */
const talksRules = (e: Pick<TrendRow, "category">) => e.category === "AD_BAN" || e.category === "PLATFORM_CHANGE" || e.category === "REGULATION";

export type TrendsFilter = { market?: Market | null; countries?: string[]; days?: number };

/** Tendances récentes (7 jours par défaut), au-dessus du seuil de pertinence, les plus fortes d'abord. */
export async function recentTrends(deps: AgentsDeps, f: TrendsFilter, take = 8): Promise<TrendRow[]> {
  const now = nowOf(deps);
  const days = Math.min(30, Math.max(1, f.days ?? 7));
  const { relevance } = await analystsScheduleSettings(deps);
  const rows = (await deps.prisma.trendEntry.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - days * 86400_000) }, relevanceScore: { gte: relevance }, ...(f.market ? { market: f.market } : {}) },
    orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
    take: 200,
  })) as TrendRow[];
  return rows.filter((e) => countriesMatch(e.countries, f.countries ?? [])).slice(0, take);
}

export async function trendsReply(deps: AgentsDeps, f: TrendsFilter, chatId: string | null): Promise<string> {
  const rows = await recentTrends(deps, f, 8);
  const what = scopeText(f);
  if (!rows.length) return pick(V.noData({ what }), "analysts.noData", chatId);
  return boundedAnswer([pick(V.trendsHead({ what, days: Math.min(30, Math.max(1, f.days ?? 7)) }), "analysts.trendsHead", chatId), ...rows.map((e) => trendLine(e, chatId))].join("\n"), {
    rules: rows.some(talksRules),
  });
}

export type RulesFilter = { market?: Market | null; countries?: string[]; platform?: CompliancePlatform | null };

/** Règles actives d'une plateforme × marché × pays (« ALL » compris), les plus risquées d'abord. */
export async function rulesFor(deps: AgentsDeps, f: RulesFilter): Promise<RuleRow[]> {
  const rows = (await deps.prisma.complianceRule.findMany({
    where: { isActive: true, ...(f.market ? { market: f.market } : {}), ...(f.platform ? { platform: f.platform } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 300,
  })) as RuleRow[];
  const wanted = (f.countries ?? []).map((c) => c.toUpperCase());
  return rows
    .filter((r) => !wanted.length || r.country === "ALL" || wanted.includes(r.country.toUpperCase()))
    .sort((a, b) => RISK_ORDER.indexOf(b.riskLevel as RiskLevel) - RISK_ORDER.indexOf(a.riskLevel as RiskLevel) || Number(b.verified) - Number(a.verified));
}

/** Risque le plus haut d'une liste de règles (null si vide). */
export function topRisk(rules: readonly Pick<RuleRow, "riskLevel">[]): RiskLevel | null {
  let best: RiskLevel | null = null;
  for (const r of rules) if (RISK_ORDER.includes(r.riskLevel as RiskLevel) && (!best || RISK_ORDER.indexOf(r.riskLevel as RiskLevel) > RISK_ORDER.indexOf(best))) best = r.riskLevel as RiskLevel;
  return best;
}

export async function rulesReply(deps: AgentsDeps, f: RulesFilter, chatId: string | null): Promise<string> {
  const rules = await rulesFor(deps, f);
  const what = scopeText(f);
  if (!rules.length) return boundedAnswer(pick(V.noRules({ what }), "analysts.noRules", chatId), { rules: true });
  const risk = topRisk(rules)!;
  return boundedAnswer([pick(V.rulesHead({ what, risk: RISK_WORDS[risk] }), "analysts.rulesHead", chatId), ...rules.slice(0, 8).map((r) => ruleLine(r, chatId))].join("\n"), { rules: true });
}

/** Alertes du moment : règles à risque (seuil des réglages) revues ces 7 jours et tendances virales (score ≥ 9). */
export async function currentAlerts(deps: AgentsDeps, f: { market?: Market | null } = {}): Promise<{ rules: RuleRow[]; viral: TrendRow[] }> {
  const now = nowOf(deps);
  const since = new Date(now.getTime() - 7 * 86400_000);
  const { alertRisk } = await analystsScheduleSettings(deps);
  const rules = ((await deps.prisma.complianceRule.findMany({
    where: { isActive: true, updatedAt: { gte: since }, ...(f.market ? { market: f.market } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })) as RuleRow[]).filter((r) => riskAtLeast(r.riskLevel, alertRisk));
  const viral = (await deps.prisma.trendEntry.findMany({
    where: { createdAt: { gte: since }, relevanceScore: { gte: ANALYSTS_LIMITS.viralScore }, ...(f.market ? { market: f.market } : {}) },
    orderBy: { relevanceScore: "desc" },
    take: 5,
  })) as TrendRow[];
  return { rules, viral };
}

export async function alertsReply(deps: AgentsDeps, f: { market?: Market | null }, chatId: string | null): Promise<string> {
  const { rules, viral } = await currentAlerts(deps, f);
  if (!rules.length && !viral.length) return pick(V.noAlerts, "analysts.noAlerts", chatId);
  const lines = [pick(V.alertsHead, "analysts.alertsHead", chatId), ...rules.slice(0, 6).map((r) => `⚠️ ${ruleLine(r, chatId).replace(/^- /, "")}`), ...viral.slice(0, 3).map((e) => `🔥 ${trendLine(e, chatId).replace(/^- /, "")}`)];
  return boundedAnswer(lines.join("\n"), { rules: rules.length > 0 || viral.slice(0, 3).some(talksRules) });
}

/** Sources de la veille : actives d'abord, puis en attente ou coupées. */
export async function listSources(deps: AgentsDeps): Promise<SourceRow[]> {
  return (await deps.prisma.trendSource.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], take: 300 })) as SourceRow[];
}

export async function sourcesReply(deps: AgentsDeps, chatId: string | null, f: { market?: Market | null } = {}): Promise<string> {
  const all = (await listSources(deps)).filter((s) => !f.market || s.market === f.market);
  if (!all.length) return pick(V.noSources, "analysts.noSources", chatId);
  const active = all.filter((s) => s.isActive);
  const off = all.filter((s) => !s.isActive);
  const line = (s: SourceRow) => {
    const state = s.isActive ? "" : s.errorCount >= ANALYSTS_LIMITS.maxConsecutiveErrors ? " (en panne)" : " (en attente)";
    const when = shortDate(s.lastScrapedAt);
    return `- ${esc(s.name)} · ${esc(MARKET_LABELS[s.market as Market] ?? s.market.toLowerCase())}${when ? ` · lue le ${when}` : ""}${state} (${esc(s.url)})`;
  };
  const shown = [...active.slice(0, 12), ...off.slice(0, 4)];
  const more = all.length - shown.length;
  const body = [pick(V.sourcesList({ active: active.length, inactive: off.length }), "analysts.sourcesList", chatId), ...shown.map(line), ...(more > 0 ? [`… et ${more} de plus sur le site (Agents → Analyses).`] : [])];
  return boundedAnswer(body.join("\n"));
}

/** Retrouve une source par son nom ou son adresse (accents et casse ignorés). */
export async function findSources(deps: AgentsDeps, raw: string): Promise<SourceRow[]> {
  const n = raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/+$/, "")
    .trim();
  if (!n) return [];
  const all = await listSources(deps);
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/+$/, "");
  const exact = all.filter((s) => norm(s.url) === n || norm(s.name) === n);
  if (exact.length) return exact;
  return all.filter((s) => norm(s.url).includes(n) || norm(s.name).includes(n));
}

export type MarketRecommendationRow = { id: string; after: unknown; evidence: unknown; expectedGain: string | null; targetId: string; status: string; createdAt: Date };

/** Recommandations du marché encore ouvertes (les plus récentes d'abord), filtrées par marché et pays. */
export async function openMarketRecommendations(deps: AgentsDeps, f: { market?: Market | null; countries?: string[] } = {}, take = 5): Promise<MarketRecommendationRow[]> {
  const rows = (await deps.prisma.recommendation.findMany({
    where: { teamKey: ANALYSTS_TEAM_KEY, source: MARKET_ANALYSIS_SOURCE, status: "PROPOSED" },
    orderBy: { createdAt: "desc" },
    take: 100,
  })) as MarketRecommendationRow[];
  return rows
    .filter((r) => {
      const a = (r.after ?? {}) as { market?: unknown; countries?: unknown };
      if (f.market && a.market && a.market !== f.market) return false;
      return countriesMatch(a.countries, f.countries ?? []);
    })
    .slice(0, take);
}

/** Libellé court d'une recommandation (titre, sinon gain attendu). */
export function recommendationTitle(r: Pick<MarketRecommendationRow, "after" | "expectedGain">): string {
  const a = (r.after ?? {}) as { title?: unknown };
  const t = typeof a.title === "string" && a.title.trim() ? a.title.trim() : (r.expectedGain ?? "recommandation");
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
}

/** Ligne numérotée d'une recommandation, avec son risque et sa première source. */
export function recommendationChoiceLine(n: number, r: MarketRecommendationRow): string {
  const a = (r.after ?? {}) as { risk?: unknown; countries?: unknown };
  const ev = (r.evidence ?? {}) as { sources?: unknown };
  const src = Array.isArray(ev.sources) ? (ev.sources as Array<{ url?: unknown }>).find((s) => typeof s?.url === "string") : undefined;
  const risk = typeof a.risk === "string" && a.risk in RISK_WORDS ? `, risque ${RISK_WORDS[a.risk as RiskLevel]}` : "";
  const where = strings(a.countries).length ? `, ${strings(a.countries).map(countryLabel).join(", ")}` : "";
  return `${n}. ${esc(recommendationTitle(r))}${esc(where)}${risk}${src ? ` (${esc(src.url as string)})` : ""}`;
}
