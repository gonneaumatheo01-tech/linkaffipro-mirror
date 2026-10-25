/**
 * Phase 29, chantier B — Agent Compliance (`docs/prompts/31-phase-29-analystes-marche.md`, section 3).
 *
 * Base de règles publicitaires par plateforme × marché × pays (« ALL » quand c'est global) :
 * - `buildInitialRules` : pages de politique publicitaire OFFICIELLES de Meta et TikTok (jeux d'argent, paris,
 *   rencontres), lues par l'accès web de l'équipe (`deps.web`, débit et robots.txt gérés par la veille ; adresse
 *   introuvable → recherche limitée aux domaines officiels), plus les entrées de veille `AD_BAN` / `PLATFORM_CHANGE` ;
 *   Opus 5.5 propose, le code valide (preuve sourcée obligatoire, adresse fournie, pays européen, risque connu) ;
 * - `checkEntryCompliance` : une entrée `AD_BAN` / `PLATFORM_CHANGE` / `REGULATION` → nouvelle règle, ou mise à jour d'une
 *   règle existante avec la nouvelle preuve ; une contradiction garde les preuves des deux côtés et le risque le plus
 *   prudent ;
 * - vérification croisée : deux sources différentes (domaines distincts) qui vont dans le même sens → vérifiée ; une
 *   seule, ou des sources qui se contredisent → « non vérifiée » ;
 * - `reverifyRules` : règles non revérifiées depuis 30 jours, sources relues, Opus confirme ou non.
 * Jamais d'avis juridique : une règle décrit ce que fait la plateforme (refus, compte limité, bannissement), jamais ce
 * que la loi permet (`sanitizeLegal`). Rien n'est fait chez Meta / TikTok. Les alertes HIGH / BAN sont RENDUES (texte
 * prêt, voix de Kevin) pour le chantier C, qui les envoie.
 */
import { agentEvent } from "../admin/journal";
import {
  cleanLine,
  distinctSources,
  hasLegalAdvice,
  honestWorkaround,
  isRiskLevel,
  knownUrlSet,
  isKnownUrl,
  maxRisk,
  normalizeUrl,
  riskRank,
  sanitizeLegal,
} from "./citations";
import {
  ANALYSTS_LIMITS,
  ANALYSTS_SETTINGS,
  EUROPE_COUNTRIES,
  type AnalystsWeb,
  type CompliancePlatform,
  type Market,
  type RiskLevel,
} from "./contract";
import { ANALYSTS_DATA_RULES, AnalystsAiError, callAnalystsTask, nowOfDeps, parseAnalystsJson, type AnalystsBrainDeps } from "./reasoning";
import { alertFor, type AnalystsAlert } from "./alert-texts";
import { MARKETS } from "./analysis-labels";

export const COMPLIANCE_PLATFORMS: readonly CompliancePlatform[] = ["META", "TIKTOK", "GOOGLE", "SNAP", "X", "TELEGRAM", "OTHER"];
/** Catégories d'entrées lues par la Compliance. */
export const COMPLIANCE_CATEGORIES = ["AD_BAN", "PLATFORM_CHANGE", "REGULATION"] as const;
/** Règles proposées au plus par appel ; règles revérifiées au plus par passage ; texte d'une page envoyé à l'IA. */
export const COMPLIANCE_LIMITS = { maxRulesPerCall: 40, maxReverifyPerRun: 10, pageMaxChars: 12_000, ruleMaxChars: 400, entriesForInitial: 60, rulesInPrompt: 60 } as const;

const isPlatform = (v: unknown): v is CompliancePlatform => typeof v === "string" && (COMPLIANCE_PLATFORMS as readonly string[]).includes(v);
const isMarket = (v: unknown): v is Market => typeof v === "string" && (MARKETS as readonly string[]).includes(v);
const isCountry = (v: unknown): v is string => v === "ALL" || (typeof v === "string" && v.toUpperCase() in EUROPE_COUNTRIES);

/**
 * Pages officielles (adresses connues à l'écriture ; relues à chaque construction). Une adresse qui ne répond plus est
 * remplacée par une recherche limitée aux domaines officiels de la plateforme (`searchQuery`).
 */
export type PolicyPage = { platform: CompliancePlatform; markets: Market[]; url: string; title: string; searchQuery: string; domains: string[] };
export const OFFICIAL_POLICY_PAGES: readonly PolicyPage[] = [
  {
    platform: "META",
    markets: ["CASINO", "SPORTS"],
    url: "https://transparency.meta.com/policies/ad-standards/restricted-goods-services/online-gambling-games/",
    title: "Meta — règles publicitaires : jeux d'argent et jeux en ligne",
    searchQuery: "Meta advertising standards online gambling and games policy",
    domains: ["transparency.meta.com", "facebook.com"],
  },
  {
    platform: "META",
    markets: ["CASINO", "SPORTS"],
    url: "https://www.facebook.com/business/help/345214789920228",
    title: "Meta — autorisation écrite pour les pubs de jeux d'argent",
    searchQuery: "Meta online gambling advertising written permission application",
    domains: ["facebook.com", "transparency.meta.com"],
  },
  {
    platform: "META",
    markets: ["DATING"],
    url: "https://transparency.meta.com/policies/ad-standards/restricted-goods-services/dating/",
    title: "Meta — règles publicitaires : rencontres en ligne",
    searchQuery: "Meta advertising standards online dating services policy",
    domains: ["transparency.meta.com", "facebook.com"],
  },
  {
    platform: "TIKTOK",
    markets: ["CASINO", "SPORTS", "DATING"],
    url: "https://ads.tiktok.com/help/article/tiktok-advertising-policies-industry-entry",
    title: "TikTok — règles publicitaires par secteur (produits interdits et soumis à conditions)",
    searchQuery: "TikTok advertising policies industry entry prohibited restricted gambling dating",
    domains: ["ads.tiktok.com"],
  },
  {
    platform: "TIKTOK",
    markets: ["CASINO", "SPORTS"],
    url: "https://ads.tiktok.com/help/article/tiktok-ads-policy-gambling",
    title: "TikTok — règles publicitaires : jeux d'argent",
    searchQuery: "TikTok ads policy gambling betting allowed countries",
    domains: ["ads.tiktok.com"],
  },
  {
    platform: "TIKTOK",
    markets: ["DATING"],
    url: "https://ads.tiktok.com/help/article/tiktok-ads-policy-dating",
    title: "TikTok — règles publicitaires : rencontres",
    searchQuery: "TikTok ads policy dating services",
    domains: ["ads.tiktok.com"],
  },
];

/** Preuve d'une règle (`ComplianceRule.evidence`). `stance` : la preuve confirme la règle, ou la contredit. */
export type RuleEvidence = { url: string; date: string | null; description: string; stance?: "supports" | "contradicts"; entryId?: string | null };

/** Règle telle que proposée par l'IA, après validation par le code. */
export type ProposedRule = {
  platform: CompliancePlatform;
  market: Market;
  country: string;
  rule: string;
  riskLevel: RiskLevel;
  workaround: string | null;
  evidence: RuleEvidence[];
  updatesRuleId: string | null;
  contradicts: boolean;
  sourceEntryId: string | null;
};

type RuleRow = {
  id: string;
  platform: string;
  market: string;
  country: string;
  rule: string;
  riskLevel: string;
  evidence: unknown;
  verified: boolean;
  workaround: string | null;
  isActive: boolean;
  lastVerifiedAt: Date;
  sourceEntryId: string | null;
};

type EntryRow = {
  id: string;
  market: string;
  countries: unknown;
  title: string | null;
  summary: string;
  url: string;
  publishedAt: Date | null;
  createdAt: Date;
  category: string;
  tags: unknown;
  verified: boolean;
  relevanceScore: number;
};

export type SavedRule = { id: string; created: boolean; riskRaised: boolean; contradicted: boolean; rule: RuleRow };

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Preuves lues d'une règle (forme tolérante). */
export function evidenceOf(v: unknown): RuleEvidence[] {
  if (!Array.isArray(v)) return [];
  const out: RuleEvidence[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.url !== "string" || !o.url) continue;
    out.push({
      url: o.url,
      date: typeof o.date === "string" ? o.date : null,
      description: typeof o.description === "string" ? o.description : "",
      stance: o.stance === "contradicts" ? "contradicts" : "supports",
      entryId: typeof o.entryId === "string" ? o.entryId : null,
    });
  }
  return out;
}

/**
 * Vérification croisée (pur) : vérifiée si au moins deux sources DIFFÉRENTES (domaines distincts) confirment la règle
 * et qu'aucune ne la contredit.
 */
export function isRuleVerified(evidence: readonly RuleEvidence[]): boolean {
  if (evidence.some((e) => e.stance === "contradicts")) return false;
  return distinctSources(evidence.map((e) => e.url)) >= 2;
}

/** Preuves fusionnées : une par adresse (la plus récente gagne la description ; une contradiction le reste). */
export function mergeEvidence(old: readonly RuleEvidence[], add: readonly RuleEvidence[]): RuleEvidence[] {
  const map = new Map<string, RuleEvidence>();
  for (const e of [...old, ...add]) {
    const k = normalizeUrl(e.url);
    const prev = map.get(k);
    if (!prev) map.set(k, { ...e });
    else map.set(k, { ...prev, ...e, stance: prev.stance === "contradicts" || e.stance === "contradicts" ? "contradicts" : "supports" });
  }
  return [...map.values()];
}

/** Proximité de deux textes de règle (mots de 4 lettres et plus, Jaccard). */
export function ruleSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4),
    );
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

export const SAME_RULE_SIMILARITY = 0.55;

/** Niveau à partir duquel une règle déclenche une alerte immédiate (`analysts.alert_risk_level`, HIGH par défaut). */
export async function alertRiskThreshold(deps: AnalystsBrainDeps): Promise<RiskLevel> {
  try {
    const row = await deps.prisma.setting.findUnique({ where: { key: ANALYSTS_SETTINGS.alertRiskLevel.key } });
    if (isRiskLevel(row?.value)) return row.value;
  } catch {
    /* réglage illisible */
  }
  return ANALYSTS_SETTINGS.alertRiskLevel.value;
}

/**
 * Validation d'une règle proposée par l'IA (pur) : plateforme, marché, pays européen ou « ALL », risque connu, texte
 * sans avis juridique, au moins une preuve dont l'adresse a été fournie. Null si la règle est refusée.
 */
export function validateProposedRule(
  raw: unknown,
  ctx: { platform?: CompliancePlatform | null; market?: Market | null; known: ReadonlySet<string>; sourceEntryId?: string | null; forcedEvidence?: RuleEvidence | null },
): { rule: ProposedRule | null; reason: string | null } {
  if (!raw || typeof raw !== "object") return { rule: null, reason: "forme" };
  const o = raw as Record<string, unknown>;
  const platform = ctx.platform ?? (typeof o.platform === "string" ? o.platform.toUpperCase() : null);
  if (!isPlatform(platform)) return { rule: null, reason: "plateforme" };
  const market = ctx.market ?? (typeof o.market === "string" ? o.market.toUpperCase() : null);
  if (!isMarket(market)) return { rule: null, reason: "marché" };
  const country = typeof o.country === "string" ? o.country.trim().toUpperCase() : "ALL";
  if (!isCountry(country)) return { rule: null, reason: "pays" };
  const risk = typeof o.riskLevel === "string" ? o.riskLevel.toUpperCase() : "";
  if (!isRiskLevel(risk)) return { rule: null, reason: "risque" };
  let text = cleanLine(o.rule, COMPLIANCE_LIMITS.ruleMaxChars);
  if (hasLegalAdvice(text)) text = sanitizeLegal(text, { replacement: null }).text.trim();
  if (text.length < 12) return { rule: null, reason: "texte" };
  const evidence: RuleEvidence[] = [];
  if (ctx.forcedEvidence) evidence.push(ctx.forcedEvidence);
  for (const e of Array.isArray(o.evidence) ? o.evidence : []) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    if (typeof x.url !== "string" || !isKnownUrl(x.url, ctx.known)) continue;
    const date = typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(x.date) ? x.date.slice(0, 10) : null;
    let description = cleanLine(x.description, 300);
    if (hasLegalAdvice(description)) description = sanitizeLegal(description, { replacement: null }).text.trim();
    evidence.push({ url: x.url.trim(), date, description, stance: o.contradicts === true ? "contradicts" : "supports" });
  }
  if (!evidence.length) return { rule: null, reason: "preuve" };
  return {
    rule: {
      platform,
      market,
      country,
      rule: text,
      riskLevel: risk,
      workaround: honestWorkaround(o.workaround),
      evidence: mergeEvidence([], evidence),
      updatesRuleId: typeof o.updatesRuleId === "string" ? o.updatesRuleId : typeof o.ruleId === "string" ? o.ruleId : null,
      contradicts: o.contradicts === true,
      sourceEntryId: ctx.sourceEntryId ?? null,
    },
    reason: null,
  };
}

/**
 * Enregistre une règle : mise à jour de la règle visée (ou d'une règle très proche sur la même plateforme, le même
 * marché et le même pays) avec la nouvelle preuve, sinon création. Contradiction : preuves gardées des deux côtés,
 * texte d'origine gardé, risque le plus prudent. Vérification croisée recalculée à chaque fois.
 */
export async function saveProposedRule(deps: AnalystsBrainDeps, p: ProposedRule, now: Date): Promise<SavedRule> {
  const candidates = (await deps.prisma.complianceRule.findMany({
    where: { platform: p.platform, market: p.market, country: p.country, isActive: true },
  })) as RuleRow[];
  const target =
    (p.updatesRuleId ? candidates.find((r) => r.id === p.updatesRuleId) : undefined) ??
    candidates
      .map((r) => ({ r, s: ruleSimilarity(r.rule, p.rule) }))
      .filter((x) => x.s >= SAME_RULE_SIMILARITY)
      .sort((a, b) => b.s - a.s)[0]?.r;
  if (target) {
    const oldRisk = (isRiskLevel(target.riskLevel) ? target.riskLevel : "MEDIUM") as RiskLevel;
    const evidence = mergeEvidence(evidenceOf(target.evidence), p.evidence.map((e) => ({ ...e, stance: p.contradicts ? "contradicts" : e.stance })));
    const riskLevel = maxRisk(oldRisk, p.riskLevel);
    const row = (await deps.prisma.complianceRule.update({
      where: { id: target.id },
      data: {
        evidence: json(evidence),
        riskLevel,
        verified: isRuleVerified(evidence),
        workaround: target.workaround ?? p.workaround,
        lastVerifiedAt: now,
        sourceEntryId: target.sourceEntryId ?? p.sourceEntryId,
      },
    })) as RuleRow;
    await agentEvent(deps, "analysts.compliance.rule_updated", { ruleId: row.id, platform: p.platform, market: p.market, country: p.country, riskLevel, contradicts: p.contradicts });
    return { id: row.id, created: false, riskRaised: riskRank(riskLevel) > riskRank(oldRisk), contradicted: p.contradicts, rule: row };
  }
  const row = (await deps.prisma.complianceRule.create({
    data: {
      platform: p.platform,
      market: p.market,
      country: p.country,
      rule: p.rule,
      riskLevel: p.riskLevel,
      evidence: json(p.evidence),
      verified: isRuleVerified(p.evidence),
      workaround: p.workaround,
      isActive: true,
      lastVerifiedAt: now,
      sourceEntryId: p.sourceEntryId,
    },
  })) as RuleRow;
  await agentEvent(deps, "analysts.compliance.rule_created", { ruleId: row.id, platform: p.platform, market: p.market, country: p.country, riskLevel: p.riskLevel });
  return { id: row.id, created: true, riskRaised: false, contradicted: false, rule: row };
}

/** Alerte à envoyer pour une règle enregistrée (nouvelle, ou risque relevé) au-dessus du seuil. */
function alertsOf(saved: readonly SavedRule[], threshold: RiskLevel): AnalystsAlert[] {
  const out: AnalystsAlert[] = [];
  for (const s of saved) {
    const risk = s.rule.riskLevel as RiskLevel;
    if (riskRank(risk) < riskRank(threshold)) continue;
    if (!s.created && !s.riskRaised) continue;
    out.push(alertFor({ ...s.rule, riskLevel: risk, platform: s.rule.platform as CompliancePlatform, market: s.rule.market as Market, evidence: evidenceOf(s.rule.evidence) }));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ pages web

/** Texte lisible d'une page HTML (scripts, styles et balises retirés ; entités courantes décodées). */
export function pageText(html: string, max: number = COMPLIANCE_LIMITS.pageMaxChars): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, max);
}

export type ReadPage = { url: string; requestedUrl: string; ok: boolean; status: number | null; text: string; via: "fetch" | "search" | "none"; error?: string };

/** Lecture d'une page (accès web de l'équipe) ; jamais de levée. */
export async function readPage(web: AnalystsWeb, url: string): Promise<ReadPage> {
  try {
    const res = await web.fetchText(url, { accept: "text/html" });
    if (res.status >= 200 && res.status < 400 && res.body.trim()) {
      const text = pageText(res.body);
      if (text.length >= 80) return { url: res.finalUrl || url, requestedUrl: url, ok: true, status: res.status, text, via: "fetch" };
    }
    return { url, requestedUrl: url, ok: false, status: res.status, text: "", via: "fetch", error: `réponse ${res.status}` };
  } catch (err) {
    return { url, requestedUrl: url, ok: false, status: null, text: "", via: "fetch", error: (err as Error).message.slice(0, 160) };
  }
}

/** Page officielle : adresse connue, sinon recherche limitée aux domaines officiels puis lecture du premier résultat. */
async function readPolicyPage(web: AnalystsWeb, page: PolicyPage): Promise<ReadPage> {
  const direct = await readPage(web, page.url);
  if (direct.ok) return direct;
  try {
    const results = await web.search({ query: page.searchQuery, allowedDomains: page.domains, maxUses: 2 });
    for (const r of results.slice(0, 2)) {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      if (!page.domains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
      const again = await readPage(web, r.url);
      if (again.ok) return { ...again, via: "search" };
      if (r.snippet && r.snippet.length >= 80) return { url: r.url, requestedUrl: page.url, ok: true, status: null, text: r.snippet.slice(0, COMPLIANCE_LIMITS.pageMaxChars), via: "search" };
    }
  } catch (err) {
    return { ...direct, error: `${direct.error ?? "illisible"} ; recherche impossible (${(err as Error).message.slice(0, 80)})` };
  }
  return direct;
}

// ---------------------------------------------------------------------------------------------- prompts

const RULE_JSON_SHAPE =
  '{"rules":[{"market":"CASINO|SPORTS|DATING","country":"ALL ou code pays européen (FR, DE…)","rule":"ce que fait la plateforme, en français, une phrase","riskLevel":"LOW|MEDIUM|HIGH|BAN","workaround":null,"evidence":[{"url":"adresse fournie","date":"AAAA-MM-JJ ou null","description":"ce que dit la source"}],"updatesRuleId":null,"contradicts":false}]}';

export const COMPLIANCE_SYSTEM = [
  "Tu es l'analyste « compliance publicitaire » d'une équipe d'affiliation (casino, paris sportifs, rencontres) en Europe.",
  "Tu tiens une base de règles : ce que chaque plateforme publicitaire (Meta, TikTok…) refuse, limite ou bannit, par marché et par pays européen. « ALL » quand la règle vaut partout.",
  "Risque : LOW (rarement un souci), MEDIUM (pub souvent refusée), HIGH (pubs refusées et compte surveillé ou limité), BAN (compte publicitaire bloqué ou banni). En cas de doute, le plus prudent.",
  "Une règle par idée, courte, en français. « updatesRuleId » : l'identifiant d'une règle EXISTANTE fournie quand il s'agit de la même règle (nouvelle preuve) ; « contradicts » : true si la source dit le contraire de cette règle existante.",
  ANALYSTS_DATA_RULES,
  `Réponds uniquement par un JSON de cette forme : ${RULE_JSON_SHAPE}`,
].join("\n");

function rulesForPrompt(rules: readonly RuleRow[]) {
  return rules.slice(0, COMPLIANCE_LIMITS.rulesInPrompt).map((r) => ({ id: r.id, platform: r.platform, market: r.market, country: r.country, rule: r.rule, riskLevel: r.riskLevel }));
}

function entryForPrompt(e: EntryRow) {
  return {
    url: e.url,
    date: dayOf(e.publishedAt ?? e.createdAt),
    market: e.market,
    countries: strings(e.countries),
    category: e.category,
    title: cleanLine(e.title, 200) || null,
    summary: cleanLine(e.summary, ANALYSTS_LIMITS.summaryMaxChars),
    tags: strings(e.tags).slice(0, 10),
  };
}

// --------------------------------------------------------------------------------------- base initiale

export type InitialRulesResult = {
  created: string[];
  updated: string[];
  rejected: number;
  pages: Array<{ platform: CompliancePlatform; url: string; ok: boolean; via: ReadPage["via"]; error?: string }>;
  entries: number;
  alerts: AnalystsAlert[];
  costCents: number;
  errors: string[];
};

/**
 * Construit (ou complète) la base de règles pour Meta et TikTok : pages officielles + entrées `AD_BAN` /
 * `PLATFORM_CHANGE`, un appel Opus par plateforme. Relançable : une règle déjà connue reçoit la nouvelle preuve.
 */
export async function buildInitialRules(deps: AnalystsBrainDeps, now: Date = nowOfDeps(deps)): Promise<InitialRulesResult> {
  const out: InitialRulesResult = { created: [], updated: [], rejected: 0, pages: [], entries: 0, alerts: [], costCents: 0, errors: [] };
  const entries = (await deps.prisma.trendEntry.findMany({
    where: { category: { in: ["AD_BAN", "PLATFORM_CHANGE"] } },
    orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
    take: COMPLIANCE_LIMITS.entriesForInitial,
  })) as EntryRow[];
  out.entries = entries.length;
  const threshold = await alertRiskThreshold(deps);
  const saved: SavedRule[] = [];
  for (const platform of ["META", "TIKTOK"] as const) {
    const pages: ReadPage[] = [];
    if (deps.web) {
      for (const page of OFFICIAL_POLICY_PAGES.filter((p) => p.platform === platform)) {
        const read = await readPolicyPage(deps.web, page);
        out.pages.push({ platform, url: read.url, ok: read.ok, via: read.via, ...(read.error ? { error: read.error } : {}) });
        if (read.ok) pages.push(read);
      }
    }
    const platformEntries = entries.filter((e) => entryMentions(e, platform));
    if (!pages.length && !platformEntries.length) {
      out.errors.push(`${platform} : aucune page officielle lisible ni retour de forum, aucune règle créée.`);
      continue;
    }
    const known = knownUrlSet([...pages.map((p) => p.url), ...pages.map((p) => p.requestedUrl), ...platformEntries.map((e) => e.url)]);
    const existing = (await deps.prisma.complianceRule.findMany({ where: { platform, isActive: true } })) as RuleRow[];
    const user = JSON.stringify({
      consigne: `Plateforme : ${platform}. Marchés : CASINO, SPORTS, DATING. Pays : Europe (${Object.keys(EUROPE_COUNTRIES).join(", ")}).`,
      DONNÉES: {
        pagesOfficielles: pages.map((p) => ({ url: p.url, texte: p.text })),
        retoursDeForums: platformEntries.map(entryForPrompt),
        reglesExistantes: rulesForPrompt(existing),
      },
    });
    let data: Record<string, unknown>;
    try {
      const res = await callAnalystsTask(deps, "compliance", { system: COMPLIANCE_SYSTEM, user });
      out.costCents += res.costCents;
      data = parseAnalystsJson(res.text, "les règles des plateformes");
    } catch (err) {
      if (err instanceof AnalystsAiError && (err.code === "budget" || err.code === "no_ai")) throw err;
      out.errors.push(`${platform} : ${(err as Error).message}`);
      continue;
    }
    const list = Array.isArray(data.rules) ? data.rules.slice(0, COMPLIANCE_LIMITS.maxRulesPerCall) : [];
    for (const raw of list) {
      const entry = platformEntries.find((e) => (raw as { evidence?: Array<{ url?: string }> })?.evidence?.some((x) => typeof x?.url === "string" && normalizeUrl(x.url) === normalizeUrl(e.url)));
      const v = validateProposedRule(raw, { platform, known, sourceEntryId: entry?.id ?? null });
      if (!v.rule) {
        out.rejected++;
        continue;
      }
      const s = await saveProposedRule(deps, v.rule, now);
      saved.push(s);
      (s.created ? out.created : out.updated).push(s.id);
    }
  }
  out.alerts = alertsOf(saved, threshold);
  await agentEvent(deps, "analysts.compliance.initial", { created: out.created.length, updated: out.updated.length, rejected: out.rejected, pages: out.pages.filter((p) => p.ok).length });
  return out;
}

/** Une entrée parle-t-elle de cette plateforme (tags, titre, résumé) ? */
export function entryMentions(e: Pick<EntryRow, "tags" | "title" | "summary">, platform: CompliancePlatform): boolean {
  const words: Record<CompliancePlatform, RegExp> = {
    META: /\b(meta|facebook|instagram|fb)\b/i,
    TIKTOK: /\btik\s?tok\b/i,
    GOOGLE: /\b(google|youtube)\b/i,
    SNAP: /\bsnap(chat)?\b/i,
    X: /\b(twitter|x\.com|x ads)\b/i,
    TELEGRAM: /\btelegram\b/i,
    OTHER: /$^/,
  };
  const hay = `${strings(e.tags).join(" ")} ${e.title ?? ""} ${e.summary}`;
  return words[platform].test(hay);
}

// ------------------------------------------------------------------------------------ entrée par entrée

export type EntryComplianceResult =
  | { entryId: string; skipped: "not_found" | "category" }
  | { entryId: string; created: string[]; updated: string[]; contradicted: string[]; rejected: number; alerts: AnalystsAlert[]; costCents: number };

const ENTRY_JSON_SHAPE =
  '{"items":[{"action":"new|update|none","ruleId":"identifiant d\'une règle existante ou null","contradicts":false,"platform":"META|TIKTOK|GOOGLE|SNAP|X|TELEGRAM|OTHER","country":"ALL ou code pays","rule":"ce que fait la plateforme, une phrase","riskLevel":"LOW|MEDIUM|HIGH|BAN","workaround":null,"evidenceDescription":"ce que dit l\'entrée, une phrase"}]}';

export const ENTRY_COMPLIANCE_SYSTEM = [
  "Tu es l'analyste « compliance publicitaire » d'une équipe d'affiliation (casino, paris sportifs, rencontres) en Europe.",
  "On te donne UNE entrée de veille (résumé d'un post de forum, d'un article ou d'un message) et les règles déjà connues pour ce marché.",
  "Dis si l'entrée révèle une règle inconnue (action « new »), apporte une preuve à une règle existante (« update », avec son ruleId, et contradicts=true si elle dit le contraire), ou rien d'utile (« none »). Trois éléments au plus.",
  "Risque : LOW, MEDIUM, HIGH (pubs refusées, compte limité), BAN (compte banni). Quand une source contredit une règle, garde le risque le plus prudent.",
  "Une entrée sur la réglementation d'un pays ne devient une règle que si elle dit ce que fait la PLATEFORME (refus, autorisation exigée, ciblage limité) ; sinon « none ».",
  ANALYSTS_DATA_RULES,
  `Réponds uniquement par un JSON de cette forme : ${ENTRY_JSON_SHAPE}`,
].join("\n");

/** Analyse une entrée `AD_BAN` / `PLATFORM_CHANGE` / `REGULATION` (une seule source : la règle naît non vérifiée). */
export async function checkEntryCompliance(deps: AnalystsBrainDeps, entryId: string): Promise<EntryComplianceResult> {
  const now = nowOfDeps(deps);
  const entry = (await deps.prisma.trendEntry.findUnique({ where: { id: entryId } })) as EntryRow | null;
  if (!entry) return { entryId, skipped: "not_found" };
  if (!(COMPLIANCE_CATEGORIES as readonly string[]).includes(entry.category)) return { entryId, skipped: "category" };
  const market = entry.market as Market;
  const existing = (await deps.prisma.complianceRule.findMany({ where: { market, isActive: true }, orderBy: { updatedAt: "desc" }, take: COMPLIANCE_LIMITS.rulesInPrompt })) as RuleRow[];
  const user = JSON.stringify({ DONNÉES: { entree: entryForPrompt(entry), reglesExistantes: rulesForPrompt(existing) } });
  const res = await callAnalystsTask(deps, "compliance", { system: ENTRY_COMPLIANCE_SYSTEM, user });
  const data = parseAnalystsJson(res.text, "une entrée de veille");
  const known = knownUrlSet([entry.url]);
  const evidence: RuleEvidence = { url: entry.url, date: dayOf(entry.publishedAt ?? entry.createdAt), description: "", entryId: entry.id };
  const out = { entryId, created: [] as string[], updated: [] as string[], contradicted: [] as string[], rejected: 0, alerts: [] as AnalystsAlert[], costCents: res.costCents };
  const saved: SavedRule[] = [];
  for (const raw of (Array.isArray(data.items) ? data.items : []).slice(0, 3)) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (o.action !== "new" && o.action !== "update") continue;
    const target = o.action === "update" && typeof o.ruleId === "string" ? existing.find((r) => r.id === o.ruleId) : undefined;
    const description = cleanLine(o.evidenceDescription, 300) || cleanLine(entry.summary, 300);
    const merged = target
      ? { ...o, platform: o.platform ?? target.platform, country: o.country ?? target.country, rule: o.rule ?? target.rule, riskLevel: o.riskLevel ?? target.riskLevel, updatesRuleId: target.id }
      : { ...o, updatesRuleId: null };
    const v = validateProposedRule(merged, {
      market,
      known,
      sourceEntryId: entry.id,
      forcedEvidence: { ...evidence, description: sanitizeLegal(description, { replacement: null }).text, stance: o.contradicts === true ? "contradicts" : "supports" },
    });
    if (!v.rule) {
      out.rejected++;
      continue;
    }
    // Une mise à jour garde la plateforme, le marché et le pays de la règle visée.
    if (target) Object.assign(v.rule, { platform: target.platform as CompliancePlatform, country: target.country });
    const s = await saveProposedRule(deps, v.rule, now);
    saved.push(s);
    (s.created ? out.created : out.updated).push(s.id);
    if (s.contradicted) out.contradicted.push(s.id);
  }
  out.alerts = alertsOf(saved, await alertRiskThreshold(deps));
  return out;
}

// --------------------------------------------------------------------------------------- revérification

export type ReverifyResult = {
  checked: string[];
  confirmed: string[];
  deactivated: string[];
  unreachable: string[];
  changedRisk: string[];
  alerts: AnalystsAlert[];
  costCents: number;
  skipped?: "no_web";
  errors: string[];
};

export const REVERIFY_SYSTEM = [
  "Tu revérifies UNE règle publicitaire d'une base de compliance (casino, paris sportifs, rencontres en Europe) à partir des sources relues aujourd'hui.",
  "Dis si les sources confirment encore la règle (stillValid true), la contredisent (false) ou n'en parlent plus (null), et le niveau de risque qu'elles montrent (LOW, MEDIUM, HIGH, BAN).",
  ANALYSTS_DATA_RULES,
  'Réponds uniquement par un JSON : {"stillValid":true,"riskLevel":"HIGH","note":"une phrase"}',
].join("\n");

/**
 * Règles non revérifiées depuis 30 jours (10 au plus par passage, les plus anciennes d'abord) : sources relues, Opus
 * dit si elles confirment encore la règle. Sources toutes injoignables → règle « non vérifiée » (gardée). Sources qui
 * la contredisent → règle désactivée (preuve gardée).
 */
export async function reverifyRules(deps: AnalystsBrainDeps, now: Date = nowOfDeps(deps)): Promise<ReverifyResult> {
  const out: ReverifyResult = { checked: [], confirmed: [], deactivated: [], unreachable: [], changedRisk: [], alerts: [], costCents: 0, errors: [] };
  if (!deps.web) return { ...out, skipped: "no_web" };
  const before = new Date(now.getTime() - ANALYSTS_LIMITS.ruleReverifyMs);
  const due = (await deps.prisma.complianceRule.findMany({
    where: { isActive: true, lastVerifiedAt: { lt: before } },
    orderBy: { lastVerifiedAt: "asc" },
    take: COMPLIANCE_LIMITS.maxReverifyPerRun,
  })) as RuleRow[];
  const threshold = await alertRiskThreshold(deps);
  for (const rule of due) {
    out.checked.push(rule.id);
    const evidence = evidenceOf(rule.evidence);
    const pages: ReadPage[] = [];
    for (const e of evidence.slice(0, 3)) {
      const p = await readPage(deps.web, e.url);
      if (p.ok) pages.push(p);
    }
    if (!pages.length) {
      await deps.prisma.complianceRule.update({ where: { id: rule.id }, data: { verified: false, lastVerifiedAt: now } });
      out.unreachable.push(rule.id);
      await agentEvent(deps, "analysts.compliance.reverify_unreachable", { ruleId: rule.id });
      continue;
    }
    let data: Record<string, unknown>;
    try {
      const res = await callAnalystsTask(deps, "compliance", {
        system: REVERIFY_SYSTEM,
        user: JSON.stringify({
          regle: { platform: rule.platform, market: rule.market, country: rule.country, rule: rule.rule, riskLevel: rule.riskLevel },
          DONNÉES: { sources: pages.map((p) => ({ url: p.url, texte: p.text })) },
        }),
      });
      out.costCents += res.costCents;
      data = parseAnalystsJson(res.text, "la revérification d'une règle");
    } catch (err) {
      if (err instanceof AnalystsAiError && (err.code === "budget" || err.code === "no_ai")) throw err;
      out.errors.push(`${rule.id} : ${(err as Error).message}`);
      continue;
    }
    const day = now.toISOString().slice(0, 10);
    const note = sanitizeLegal(cleanLine(data.note, 300), { replacement: null }).text;
    if (data.stillValid === false) {
      const merged = mergeEvidence(evidence, pages.map((p) => ({ url: p.url, date: day, description: note || "Source relue : ne confirme plus la règle.", stance: "contradicts" as const })));
      await deps.prisma.complianceRule.update({ where: { id: rule.id }, data: { isActive: false, verified: false, evidence: json(merged), lastVerifiedAt: now } });
      out.deactivated.push(rule.id);
      await agentEvent(deps, "analysts.compliance.rule_deactivated", { ruleId: rule.id });
      continue;
    }
    const oldRisk = (isRiskLevel(rule.riskLevel) ? rule.riskLevel : "MEDIUM") as RiskLevel;
    const risk = isRiskLevel(data.riskLevel) ? data.riskLevel : oldRisk;
    const merged = data.stillValid === true ? mergeEvidence(evidence, pages.map((p) => ({ url: p.url, date: day, description: note || "Source relue : confirme la règle.", stance: "supports" as const }))) : evidence;
    const updated = (await deps.prisma.complianceRule.update({
      where: { id: rule.id },
      data: { riskLevel: risk, evidence: json(merged), verified: isRuleVerified(merged), lastVerifiedAt: now },
    })) as RuleRow;
    if (data.stillValid === true) out.confirmed.push(rule.id);
    if (risk !== oldRisk) out.changedRisk.push(rule.id);
    if (riskRank(risk) > riskRank(oldRisk) && riskRank(risk) >= riskRank(threshold))
      out.alerts.push(alertFor({ ...updated, riskLevel: risk, platform: updated.platform as CompliancePlatform, market: updated.market as Market, evidence: evidenceOf(updated.evidence) }));
  }
  if (out.checked.length)
    await agentEvent(deps, "analysts.compliance.reverify", { checked: out.checked.length, confirmed: out.confirmed.length, deactivated: out.deactivated.length, unreachable: out.unreachable.length });
  return out;
}
