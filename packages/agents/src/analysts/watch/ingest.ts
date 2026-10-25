/**
 * Phase 29, chantier A : rangement des contenus lus (`TrendEntry`) et passage complet d'une source (`scrapeSource`).
 *
 * - Déduplication : `urlHash` = SHA-256 de l'adresse normalisée (hôte en minuscules, sans « www. », sans fragment ni
 *   paramètres de suivi, paramètres triés, `twitter.com` → `x.com`, `t.me/s/<nom>/<n>` → `t.me/<nom>/<n>`).
 * - Seuil de pertinence (`analysts.relevance_threshold`) : en dessous, rien n'est gardé (et pas de résumé payé).
 * - Au plus `analysts.max_entries_per_scrape` contenus nouveaux traités par passage.
 * - Texte brut gardé 7 jours (`rawTextPurgeAt`), pseudonyme seulement, jamais de profil.
 * - Entrées à alerter rendues à l'appelant (chantier C → Kevin) : AD_BAN / PLATFORM_CHANGE au risque du réglage
 *   `analysts.alert_risk_level` (HIGH : HIGH et BAN) ou plus, et score ≥ 9 (« tendance »).
 * - Erreur d'une source : `errorCount++`, `lastError` en français, nouvel essai plus tard (1 h, 2 h, 4 h… 24 h au plus) ;
 *   5 échecs de suite → source désactivée et événement rendu pour que Kevin prévienne.
 */
import { createHash } from "node:crypto";
import {
  ANALYSTS_LIMITS,
  ANALYSTS_SETTINGS,
  type CompliancePlatform,
  type EntryClassification,
  type Market,
  type RawItem,
  type RiskLevel,
  type TrendCategory,
  type TrendSourceType,
} from "../contract";
import { AnalystsAiError, nowOf, readSetting, type WatchDeps } from "./ai";
import { classifyEntry, COMPLIANCE_PLATFORMS, RISK_LEVELS, summarizeEntry } from "./classify";
import { createAnalystsWeb, PoliteFetchError, type PoliteWeb } from "./polite";
import { fetchForum, fetchReddit, fetchTelegramPublic, pseudonymOf, RAW_TEXT_MAX_CHARS, scrubPersonalData, searchNews, searchTelegram, searchX, WatchReadError, type WatchScrapeConfig } from "./readers";
import { languageOfCountry } from "./terms";

// ---------------------------------------------------------------- adresses

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|ttclid|msclkid|igshid|mc_[a-z]+|ref|ref_src|ref_url|si|s|share_id|context|raw_json|sort)$/i;

/** Adresse normalisée d'un contenu (clé de déduplication). */
export function normalizeEntryUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.trim().toLowerCase();
  }
  u.hash = "";
  let host = u.hostname.toLowerCase().replace(/^(www|old|new|m|mobile)\./, "");
  if (host === "twitter.com") host = "x.com";
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (host === "t.me") path = path.replace(/^\/s\//, "/");
  if (path.length > 1) path = path.replace(/\/$/, "");
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : "";
  return `https://${host}${path}${query}`;
}

export function urlHashOf(url: string): string {
  return createHash("sha256").update(normalizeEntryUrl(url)).digest("hex");
}

// ---------------------------------------------------------------- étiquettes plateforme / risque

/** Étiquettes ajoutées au classement pour garder plateforme et risque (le modèle `TrendEntry` n'a pas ces colonnes). */
export function platformRiskTags(c: Pick<EntryClassification, "platform" | "risk">): string[] {
  return [...(c.platform ? [`platform:${c.platform}`] : []), ...(c.risk ? [`risk:${c.risk}`] : [])];
}

/** Plateforme et risque relus depuis les étiquettes d'une entrée (pour la compliance et le site). */
export function platformRiskOfTags(tags: unknown): { platform: CompliancePlatform | null; risk: RiskLevel | null } {
  const list = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
  const p = list.find((t) => t.startsWith("platform:"))?.slice(9) ?? null;
  const r = list.find((t) => t.startsWith("risk:"))?.slice(5) ?? null;
  return {
    platform: p && (COMPLIANCE_PLATFORMS as readonly string[]).includes(p) ? (p as CompliancePlatform) : null,
    risk: r && (RISK_LEVELS as readonly string[]).includes(r) ? (r as RiskLevel) : null,
  };
}

const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, BAN: 3 };

/** Entrée à alerter tout de suite ? (fonction pure) */
export function alertKindOf(
  c: Pick<EntryClassification, "category" | "risk" | "relevanceScore">,
  alertRisk: RiskLevel = ANALYSTS_SETTINGS.alertRiskLevel.value,
): "compliance" | "viral" | null {
  if ((c.category === "AD_BAN" || c.category === "PLATFORM_CHANGE") && c.risk && RISK_ORDER[c.risk] >= RISK_ORDER[alertRisk]) return "compliance";
  if (c.relevanceScore >= ANALYSTS_LIMITS.viralScore) return "viral";
  return null;
}

// ---------------------------------------------------------------- rangement

/** Ce que la veille lit d'une source (colonnes de `TrendSource`). */
export type WatchSource = {
  id: string;
  name: string;
  url: string;
  sourceType: TrendSourceType;
  market: Market;
  countries: unknown;
  languages: unknown;
  scrapeConfig: unknown;
  isActive: boolean;
  errorCount: number;
};

export type WatchAlert = {
  kind: "compliance" | "viral";
  entryId: string;
  sourceId: string;
  sourceName: string;
  market: Market;
  category: TrendCategory;
  platform: CompliancePlatform | null;
  risk: RiskLevel | null;
  relevanceScore: number;
  countries: string[];
  title: string | null;
  summary: string;
  url: string;
  publishedAt: string | null;
};

export type IngestResult = {
  read: number;
  created: number;
  duplicates: number;
  belowThreshold: number;
  failed: number;
  /** Contenus non traités au-delà de `max_entries_per_scrape`. */
  overLimit: number;
  /** Arrêt du lot : plafond mensuel atteint ou IA absente. */
  stoppedReason: "budget" | "no_ai" | null;
  entryIds: string[];
  alerts: WatchAlert[];
  /** Premier message d'erreur de l'IA rencontré (français). */
  firstError: string | null;
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function configOf(source: Pick<WatchSource, "scrapeConfig">): WatchScrapeConfig {
  const c = source.scrapeConfig;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as WatchScrapeConfig) : {};
}

const isUniqueError = (err: unknown) => /unique constraint|P2002/i.test(String((err as { code?: string; message?: string })?.code ?? "") + String((err as Error)?.message ?? ""));

/** Range les contenus d'une source : déduplication, classement, seuil, résumé, `TrendEntry`. */
export async function ingestEntries(deps: WatchDeps, source: WatchSource, items: RawItem[]): Promise<IngestResult> {
  const now = nowOf(deps);
  const [threshold, maxEntries, alertRisk] = await Promise.all([
    readSetting(deps, ANALYSTS_SETTINGS.relevanceThreshold.key, ANALYSTS_SETTINGS.relevanceThreshold.value),
    readSetting(deps, ANALYSTS_SETTINGS.maxEntriesPerScrape.key, ANALYSTS_SETTINGS.maxEntriesPerScrape.value),
    readSetting<string>(deps, ANALYSTS_SETTINGS.alertRiskLevel.key, ANALYSTS_SETTINGS.alertRiskLevel.value),
  ]);
  const risk = ((RISK_LEVELS as readonly string[]).includes(alertRisk) ? alertRisk : "HIGH") as RiskLevel;
  const out: IngestResult = { read: items.length, created: 0, duplicates: 0, belowThreshold: 0, failed: 0, overLimit: 0, stoppedReason: null, entryIds: [], alerts: [], firstError: null };
  const sourceCountries = strings(source.countries);
  const sourceLanguage = strings(source.languages)[0] ?? null;
  const seen = new Set<string>();
  let processed = 0;
  for (const item of items) {
    const hash = urlHashOf(item.url);
    if (seen.has(hash)) {
      out.duplicates++;
      continue;
    }
    seen.add(hash);
    if (await deps.prisma.trendEntry.findUnique({ where: { urlHash: hash } })) {
      out.duplicates++;
      continue;
    }
    if (out.stoppedReason || processed >= Math.max(1, Math.round(maxEntries))) {
      out.overLimit++;
      continue;
    }
    processed++;
    const clean: RawItem = { ...item, text: scrubPersonalData(item.text).slice(0, RAW_TEXT_MAX_CHARS), author: pseudonymOf(item.author), language: item.language ?? sourceLanguage };
    try {
      const c = await classifyEntry(deps, clean, source.market);
      if (c.relevanceScore < threshold) {
        out.belowThreshold++;
        continue;
      }
      const s = await summarizeEntry(deps, clean);
      const countries = c.countries.length ? c.countries : sourceCountries;
      const publishedAt = clean.publishedAt ? new Date(clean.publishedAt) : null;
      const row = await deps.prisma.trendEntry.create({
        data: {
          sourceId: source.id,
          market: source.market,
          countries,
          language: (s.language ?? clean.language ?? "en").slice(0, 8),
          title: clean.title ? clean.title.slice(0, 300) : null,
          summary: s.summary,
          summaryOriginal: s.summaryOriginal,
          url: item.url,
          urlHash: hash,
          author: clean.author,
          publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
          category: c.category,
          tags: [...c.tags, ...platformRiskTags(c)],
          sentiment: c.sentiment,
          relevanceScore: c.relevanceScore,
          verified: false,
          rawText: clean.text,
          rawTextPurgeAt: new Date(now.getTime() + ANALYSTS_LIMITS.rawTextTtlMs),
        },
      });
      out.created++;
      out.entryIds.push(row.id);
      const kind = alertKindOf(c, risk);
      if (kind)
        out.alerts.push({
          kind,
          entryId: row.id,
          sourceId: source.id,
          sourceName: source.name,
          market: source.market,
          category: c.category,
          platform: c.platform,
          risk: c.risk,
          relevanceScore: c.relevanceScore,
          countries,
          title: clean.title,
          summary: s.summary,
          url: item.url,
          publishedAt: clean.publishedAt,
        });
    } catch (err) {
      if (isUniqueError(err)) {
        out.duplicates++;
        continue;
      }
      if (err instanceof AnalystsAiError && (err.code === "budget" || err.code === "no_ai")) {
        out.stoppedReason = err.code;
        out.firstError ??= err.message;
        out.failed++;
        continue;
      }
      out.failed++;
      out.firstError ??= (err as Error).message.slice(0, 300);
      deps.logger?.warn({ err: (err as Error).message.slice(0, 200), sourceId: source.id }, "[analystes] contenu non rangé");
    }
  }
  return out;
}

// ---------------------------------------------------------------- passage d'une source

export type SourceDisabledEvent = { type: "source_disabled"; sourceId: string; name: string; url: string; lastError: string; errorCount: number };

export type ScrapeResult =
  | ({ ok: true; sourceId: string; nextScrapeAt: Date } & IngestResult)
  | { ok: false; sourceId: string; skipped: "not_found" | "inactive" | "disabled_team" }
  | { ok: false; sourceId: string; skipped?: undefined; error: string; errorCount: number; disabled: boolean; nextScrapeAt: Date | null; event: SourceDisabledEvent | null };

/** Débit par défaut selon le type : forums 15 s, Telegram 3 s, autres sites 10 s. */
export function defaultSourceRateMs(type: TrendSourceType): number {
  return type === "FORUM" ? ANALYSTS_LIMITS.forumRateMs : type === "TELEGRAM" ? ANALYSTS_LIMITS.telegramRateMs : ANALYSTS_LIMITS.webRateMs;
}

function webFor(deps: WatchDeps, source: WatchSource) {
  const base = deps.web ?? createAnalystsWeb(deps);
  // Le réglage d'une source peut ralentir la lecture, jamais l'accélérer sous le débit de son type (forums 15 s…).
  const asked = Number(configOf(source).rateLimitMs);
  const rate = Math.max(Number.isFinite(asked) ? asked : 0, defaultSourceRateMs(source.sourceType));
  const polite = base as Partial<PoliteWeb>;
  return typeof polite.withRate === "function" ? polite.withRate(rate) : base;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Lit une source selon son type et son réglage (aucune IA ici). */
export async function readSource(deps: WatchDeps, source: WatchSource, maxItems: number): Promise<RawItem[]> {
  const web = webFor(deps, source);
  const cfg = configOf(source);
  const countries = strings(source.countries);
  const country = countries[0] ?? null;
  const language = strings(source.languages)[0] ?? (country ? languageOfCountry(country) : "en");
  const host = hostOf(source.url);
  const search = cfg.mode === "search";
  switch (source.sourceType) {
    case "REDDIT":
      return fetchReddit(web, source.url, { limit: cfg.limit ?? 25, language, ...(country ? { country } : {}) });
    case "TELEGRAM":
      return search
        ? searchTelegram(web, { market: source.market, country, language, keywords: cfg.query ?? null, maxUses: 1 })
        : fetchTelegramPublic(web, source.url, { now: nowOf(deps), maxPosts: Math.min(maxItems, 50), language });
    case "TWITTER":
      return searchX(web, { market: source.market, country, language, keywords: cfg.query ?? null, maxUses: 1 });
    case "NEWS":
      return search || !cfg.selectors
        ? searchNews(web, {
            market: source.market,
            country,
            language,
            allowedDomains: cfg.allowedDomains ?? [host],
            query: cfg.query ?? null,
            fetchArticles: cfg.fetchArticles ?? 3,
            maxUses: 1,
          })
        : fetchForum(web, source.url, cfg, { maxItems, language, maxPages: cfg.maxPages ?? 1 });
    case "FORUM":
    case "OTHER":
    default:
      if (search) {
        const hits = await searchNews(web, {
          market: source.market,
          country,
          language,
          allowedDomains: cfg.allowedDomains ?? [host],
          query: cfg.query ?? null,
          fetchArticles: 0,
          maxUses: 1,
        });
        return hits;
      }
      return fetchForum(web, source.url, cfg, { maxItems, language, ...(source.sourceType === "OTHER" ? { maxPages: 1 } : {}) });
  }
}

/** Message d'erreur en français (300 caractères), sans détail technique inutile. */
export function errorMessageOf(err: unknown): string {
  if (err instanceof WatchReadError || err instanceof PoliteFetchError || err instanceof AnalystsAiError) return err.message.slice(0, 300);
  return `Lecture impossible : ${String((err as Error)?.message ?? err).slice(0, 200)}`;
}

/** Délai avant le prochain essai après `errorCount` échecs : 1 h, 2 h, 4 h, 8 h… 24 h au plus. */
export function retryDelayMs(errorCount: number): number {
  return Math.min(2 ** Math.max(0, errorCount - 1), 24) * 3600_000;
}

/** Un passage complet d'une source : lecture, rangement, état de la source mis à jour. */
export async function scrapeSource(deps: WatchDeps, sourceId: string, now: Date = nowOf(deps)): Promise<ScrapeResult> {
  // L'heure du passage fait foi (dates de l'entrée, purge à 7 jours, prochain passage).
  const d: WatchDeps = { ...deps, now: () => now };
  const enabled = await readSetting(d, ANALYSTS_SETTINGS.enabled.key, ANALYSTS_SETTINGS.enabled.value);
  if (!enabled) return { ok: false, sourceId, skipped: "disabled_team" };
  const source = (await d.prisma.trendSource.findUnique({ where: { id: sourceId } })) as WatchSource | null;
  if (!source) return { ok: false, sourceId, skipped: "not_found" };
  if (!source.isActive) return { ok: false, sourceId, skipped: "inactive" };
  const cfg = configOf(source);
  const maxEntries = await readSetting(d, ANALYSTS_SETTINGS.maxEntriesPerScrape.key, ANALYSTS_SETTINGS.maxEntriesPerScrape.value);
  try {
    const items = await readSource(d, source, maxEntries);
    const res = await ingestEntries(d, source, items);
    // Rien de rangé parce que l'IA a échoué sur tout : la source a bien été lue, ce n'est PAS un échec de la source
    // (une panne de l'IA ne coupe jamais des sources saines) ; nouvel essai dans une heure, compteur inchangé.
    if (res.created === 0 && res.failed > 0 && res.failed + res.duplicates + res.belowThreshold + res.overLimit >= res.read && !res.stoppedReason) {
      const message = errorMessageOf(new AnalystsAiError("ai_failed", res.firstError ?? "L'IA n'a pu ranger aucun contenu."));
      const retryAt = new Date(now.getTime() + retryDelayMs(1));
      await d.prisma.trendSource.update({ where: { id: source.id }, data: { lastError: message, nextScrapeAt: retryAt } });
      d.logger?.warn({ sourceId }, "[analystes] source lue mais IA en échec sur tout le lot");
      return { ok: false, sourceId, error: message, errorCount: source.errorCount ?? 0, disabled: false, nextScrapeAt: retryAt, event: null };
    }
    const hours = cfg.intervalHours ?? (await readSetting(d, ANALYSTS_SETTINGS.scrapeIntervalHours.key, ANALYSTS_SETTINGS.scrapeIntervalHours.value));
    const nextScrapeAt = new Date(now.getTime() + Math.max(1, hours) * 3600_000);
    await d.prisma.trendSource.update({ where: { id: source.id }, data: { lastScrapedAt: now, nextScrapeAt, errorCount: 0, lastError: null } });
    return { ok: true, sourceId, nextScrapeAt, ...res };
  } catch (err) {
    const message = errorMessageOf(err);
    const errorCount = (source.errorCount ?? 0) + 1;
    const disabled = errorCount >= ANALYSTS_LIMITS.maxConsecutiveErrors;
    const nextScrapeAt = disabled ? null : new Date(now.getTime() + retryDelayMs(errorCount));
    await d.prisma.trendSource.update({
      where: { id: source.id },
      data: { errorCount, lastError: message, nextScrapeAt, ...(disabled ? { isActive: false } : {}) },
    });
    d.logger?.warn({ sourceId, errorCount, disabled }, "[analystes] lecture de source en échec");
    return {
      ok: false,
      sourceId,
      error: message,
      errorCount,
      disabled,
      nextScrapeAt,
      event: disabled ? { type: "source_disabled", sourceId, name: source.name, url: source.url, lastError: message, errorCount } : null,
    };
  }
}

/** Texte brut effacé après 7 jours (résumé, adresse et classement restent). */
export async function purgeRawTexts(deps: WatchDeps, now: Date = nowOf(deps)): Promise<{ purged: number }> {
  const res = await deps.prisma.trendEntry.updateMany({ where: { rawTextPurgeAt: { lte: now }, rawText: { not: null } }, data: { rawText: null } });
  return { purged: res.count };
}
