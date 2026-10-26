/**
 * Phase 30 — vérifications croisées du QA Global (prompt section 2 « Vérifications croisées inter-équipes ») : avant la
 * vérification, le contexte utile des autres équipes est chargé selon le type de contenu, et le CODE fait les contrôles
 * qui ne dépendent pas du modèle. Lecture seule (aucune écriture en base).
 *
 * - Constats du code (`findings`, sévérité `critical`) : appliqués directement, quel que soit l'avis du modèle (copie de
 *   8 mots d'une source de référence, mention d'IA, lien hors plateforme, mot interdit de l'équipe, média non fourni sur
 *   un canal casino, source introuvable ou adresse cassée). Ils sont aussi transmis au modèle.
 * - Indices du code (`hints`) : transmis au modèle qui tranche (chiffres absents des données consultées, adresses
 *   inconnues de la veille).
 * Le contrôle de copie réutilise `inspiration/copy-check.ts` (empreintes des posts de référence, texte effacé compris) ;
 * le motif ne cite JAMAIS les mots repris (`COPY_PROBLEM`).
 */
import { copiedSequence, COPY_PROBLEM, shingleHashes } from "../inspiration/copy-check";
import { casinoMediaRefusal } from "../casino/control";
import { parseAlgoSettings, DEFAULT_ALGO_SETTINGS } from "../algo/settings";
import { DEFAULT_ALLOWED_LINK_HOSTS, foreignLinks, forbiddenWordsIn, mentionsAi } from "../rules/content";
import { allowedNumbers, inventedNumbers } from "../rules/report-numbers";
import type { AgentsDeps } from "../types";
import type { QaContent, QaContentType, QaContext, QaReason } from "./contract";

export type QaCrossCheckInput = {
  contentType: QaContentType;
  contentId: string;
  teamKey: string;
  content: QaContent;
  context?: QaContext;
};

export type QaCrossCheckResult = {
  /** Contexte transmis au modèle (le contexte fourni par l'appelant l'emporte sur le contexte chargé). */
  context: QaContext;
  /** Constats bloquants du code. */
  findings: QaReason[];
  /** Indices à vérifier par le modèle. */
  hints: string[];
  /** Chargements impossibles (le QA bloque si le contrôle de copie n'a pas pu se faire). */
  errors: string[];
  /** Vrai si le contrôle de copie a bien tourné. */
  copyChecked: boolean;
};

type Market = "CASINO" | "SPORTS" | "DATING";

/** Règles fixes de chaque univers (rappelées au modèle ; les plus nettes sont aussi vérifiées par le code). */
export const QA_UNIVERSE_RULES: Record<"common" | Market, readonly string[]> = {
  common: [
    "Aucune mention d'IA, de bot ou d'assistant.",
    "Aucune promesse de gain, d'argent facile ou de résultat garanti.",
    "Aucun lien hors de nos liens suivis (go.goolink.eu).",
    "Aucune donnée personnelle ni identifiant interne.",
  ],
  CASINO: ["Jamais de média non fourni par le client (aucun média produit par l'IA).", "Jeu responsable : pas d'incitation à jouer plus pour se refaire."],
  SPORTS: ["Jamais de « pari sûr » ni de cote présentée comme un gain certain.", "Les cotes citées viennent des bookmakers lus, à l'heure de la lecture."],
  DATING: ["La persona reste cohérente avec sa fiche ; aucun rendez-vous ni rencontre promis."],
};

const TEAM_MARKET: Record<string, Market> = { casino: "CASINO", sports: "SPORTS", dating: "DATING" };
const MAX_REFERENCE_POSTS = 5000;
const CLIP = 600;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const clip = (s: string | null | undefined, n = CLIP) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);
const isMarket = (v: unknown): v is Market => v === "CASINO" || v === "SPORTS" || v === "DATING";

/** Toutes les chaînes d'une valeur (contrôle de copie), sauf les champs techniques. */
export function textLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const x of value) textLeaves(x, out);
  else if (value && typeof value === "object")
    for (const [k, x] of Object.entries(value as Record<string, unknown>)) {
      if (/^(?:id|ids|.+Id|.+Ids|url|urls|href|hash)$/.test(k)) continue;
      textLeaves(x, out);
    }
  return out;
}

/** Adresses citées dans le contenu (chaînes qui commencent par http, et adresses dans le texte). */
export function urlsIn(value: unknown): string[] {
  const out = new Set<string>();
  for (const s of allStrings(value)) for (const m of s.matchAll(/\bhttps?:\/\/[^\s"'<>)\]]+/gi)) out.add(m[0].replace(/[.,;:!?]+$/, ""));
  return [...out];
}

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const x of value) allStrings(x, out);
  else if (value && typeof value === "object") for (const x of Object.values(value as Record<string, unknown>)) allStrings(x, out);
  return out;
}

/** Nos adresses de production (site, liens suivis). */
const OWN_HOSTS = ["app.linkaffipro.com", "go.goolink.eu"];

/**
 * Notre propre adresse (lien « Détail complet sur le site » ajouté par le code, lien suivi) : jamais une source à
 * vérifier, ni « cassée » (site local en développement), ni « absente de la veille ». Même origine que `APP_BASE_URL`
 * ou `TRACKING_BASE_URL`, ou nos domaines de production en https.
 */
export function ownUrl(url: string, env: Record<string, string | undefined> = process.env): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "https:" && OWN_HOSTS.includes(u.hostname.toLowerCase())) return true;
  for (const base of [env.APP_BASE_URL, env.TRACKING_BASE_URL]) {
    if (!base) continue;
    try {
      if (new URL(base).origin === u.origin) return true;
    } catch {
      // adresse de base illisible : ignorée
    }
  }
  return false;
}

/** Adresse manifestement cassée (illisible, autre protocole, hôte local ou de démonstration). */
export function brokenUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || /\.(?:invalid|example|test|localhost|local)$/.test(host) || /^example\.(?:com|org|net)$/.test(host)) return true;
  if (/^(?:127\.|10\.|192\.168\.|0\.)/.test(host)) return true;
  return false;
}

/** Texte principal d'un post (HTML Telegram). */
function postText(content: QaContent): string {
  return str(content.text) ?? str(content.html) ?? str(content.caption) ?? "";
}

/** Identifiants de sources citées (`sourceEntryIds`, `sources[].entryId`, `sourceEntryId`). */
function sourceEntryIdsOf(content: QaContent, context: QaContext): string[] {
  const ids = new Set<string>([...strings(content.sourceEntryIds), ...strings(context.sourceEntryIds)]);
  for (const k of ["sourceEntryId", "trendEntryId"]) {
    const v = str(content[k]);
    if (v) ids.add(v);
  }
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const r = v as Record<string, unknown>;
      const id = str(r.entryId) ?? str(r.trendEntryId) ?? str(r.sourceEntryId);
      if (id) ids.add(id);
      for (const x of Object.values(r)) if (x && typeof x === "object") visit(x);
    }
  };
  visit(content.sources);
  visit(content.content);
  return [...ids];
}

async function safe<T>(errors: string[], what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    errors.push(`${what} : ${(err as Error).message.slice(0, 120)}`);
    return fallback;
  }
}

type ChannelRow = { id: string; title: string; vertical: string | null; isTest: boolean; language: string; settings: unknown };

async function loadChannel(deps: AgentsDeps, channelId: string | null): Promise<ChannelRow | null> {
  if (!channelId) return null;
  const row = await deps.prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, title: true, vertical: true, isTest: true, language: true, settings: true },
  });
  return (row as ChannelRow | null) ?? null;
}

function countriesOf(content: QaContent, channel: ChannelRow | null): string[] {
  const s = rec(channel?.settings);
  const list = [
    ...strings(content.countries),
    ...(str(content.country) ? [str(content.country)!] : []),
    ...strings(s.countries),
    ...(str(s.country) ? [str(s.country)!] : []),
  ];
  return [...new Set(list.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
}

function marketOf(content: QaContent, channel: ChannelRow | null, teamKey: string): Market | null {
  for (const v of [content.vertical, content.market, content.universe, channel?.vertical])
    if (typeof v === "string" && isMarket(v.toUpperCase())) return v.toUpperCase() as Market;
  return TEAM_MARKET[teamKey] ?? null;
}

/** Règles publicitaires actives (marché × pays du canal, plus les règles « ALL »). */
export async function activeComplianceRules(
  deps: AgentsDeps,
  q: { market: Market | null; countries: string[]; platforms?: string[]; excludeId?: string },
): Promise<Array<Record<string, unknown>>> {
  const where: Record<string, unknown> = { isActive: true };
  if (q.market) where.market = q.market;
  if (q.countries.length) where.country = { in: [...q.countries, "ALL"] };
  if (q.platforms?.length) where.platform = { in: q.platforms };
  if (q.excludeId) where.id = { not: q.excludeId };
  const rows = (await deps.prisma.complianceRule.findMany({
    where: where as never,
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, platform: true, market: true, country: true, rule: true, riskLevel: true, verified: true, workaround: true },
  })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    platform: r.platform,
    market: r.market,
    country: r.country,
    rule: clip(str(r.rule), 400),
    riskLevel: r.riskLevel,
    verified: r.verified === true,
    ...(str(r.workaround) ? { workaround: clip(str(r.workaround), 200) } : {}),
  }));
}

async function teamForbiddenWords(deps: AgentsDeps, teamKey: string): Promise<{ words: string[]; maxTextLength: number | null; styleGuidelines: string | null }> {
  const row = (await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey } })) as { forbiddenWords?: unknown; maxTextLength?: unknown; styleGuidelines?: unknown } | null;
  return {
    words: strings(row?.forbiddenWords),
    maxTextLength: typeof row?.maxTextLength === "number" ? row.maxTextLength : null,
    styleGuidelines: clip(str(row?.styleGuidelines), 400),
  };
}

/** Empreintes de toutes les sources de référence (posts des canaux d'inspiration) + textes fournis par l'appelant. */
async function referenceShingles(deps: AgentsDeps, context: QaContext): Promise<Set<string>> {
  const rows = (await deps.prisma.referencePost.findMany({
    orderBy: { postedAt: "desc" },
    take: MAX_REFERENCE_POSTS,
    select: { shingles: true },
  })) as Array<{ shingles: unknown }>;
  const set = new Set<string>();
  for (const r of rows) for (const h of strings(r.shingles)) set.add(h);
  for (const t of strings(context.referenceTexts)) for (const h of shingleHashes(t)) set.add(h);
  return set;
}

const critical = (code: string, message: string): QaReason => ({ code, message, severity: "critical" });

/** Charge le contexte croisé et fait les contrôles du code. */
export async function loadQaContext(deps: AgentsDeps, input: QaCrossCheckInput): Promise<QaCrossCheckResult> {
  const { contentType, contentId, teamKey, content } = input;
  const given = input.context ?? {};
  const errors: string[] = [];
  const findings: QaReason[] = [];
  const hints: string[] = [];
  const loaded: Record<string, unknown> = {};

  // 1. Copie (tous les types) : sur toutes les chaînes du contenu, contre toutes les sources de référence.
  let copyChecked = false;
  try {
    const refs = await referenceShingles(deps, given);
    copyChecked = true;
    if (refs.size) {
      const hit = textLeaves(content).some((t) => copiedSequence(t, refs) !== null);
      if (hit) findings.push(critical("COPY", `${COPY_PROBLEM} (contrôle du code).`));
    }
  } catch (err) {
    errors.push(`contrôle de copie : ${(err as Error).message.slice(0, 120)}`);
  }

  // 2. Canal visé (posts, shorts, recommandations d'un canal).
  const postId = contentType === "POST" ? contentId : null;
  let post: { channelId: string; mediaAssetIds: unknown; text: string } | null = null;
  if (postId && !str(content.channelId))
    post = await safe(errors, "post", async () => (await deps.prisma.post.findUnique({ where: { id: postId }, select: { channelId: true, mediaAssetIds: true, text: true } })) as typeof post, null);
  const channelId =
    str(content.channelId) ??
    str(content.targetChannelId) ??
    str(given.channelId) ??
    post?.channelId ??
    (contentType === "RECOMMENDATION" && str(content.target) === "CHANNEL_PLAN" ? str(content.targetId) : null);
  const channel = await safe(errors, "canal", () => loadChannel(deps, channelId), null);
  const market = marketOf(content, channel, teamKey);
  const countries = countriesOf(content, channel);
  if (channel) loaded.channel = { title: channel.title, universe: channel.vertical, language: channel.language, isTest: channel.isTest, countries };

  const needsChannelRules = contentType === "POST" || (contentType === "SHORT" && channel !== null);
  if (needsChannelRules) {
    const team = await safe(errors, "réglages de l'équipe", () => teamForbiddenWords(deps, teamKey), { words: [], maxTextLength: null, styleGuidelines: null });
    loaded.channelRules = {
      forbiddenWords: team.words,
      universeRules: [...QA_UNIVERSE_RULES.common, ...(market ? QA_UNIVERSE_RULES[market] : [])],
      allowedLinkHosts: DEFAULT_ALLOWED_LINK_HOSTS,
      ...(team.maxTextLength ? { maxTextLength: team.maxTextLength } : {}),
      ...(team.styleGuidelines ? { styleGuidelines: team.styleGuidelines } : {}),
    };
    if (contentType === "POST") {
      const text = postText(content) || post?.text || "";
      if (text) {
        const ai = mentionsAi(text);
        if (ai) findings.push(critical("AI_MENTION", `Le texte parle d'IA, de bot ou d'assistant (« ${ai} ») (contrôle du code).`));
        const links = foreignLinks(text);
        if (links.length) findings.push(critical("CHANNEL_RULE", `Lien hors de nos liens suivis : ${links.slice(0, 3).join(", ")} (contrôle du code).`));
        const words = forbiddenWordsIn(text, team.words);
        if (words.length) findings.push(critical("CHANNEL_RULE", `Mot interdit par l'équipe : ${words.slice(0, 5).join(", ")} (contrôle du code).`));
      }
      // Casino : jamais de média non fourni.
      if (market === "CASINO") {
        const ids = [...strings(content.mediaAssetIds), ...(str(content.mediaAssetId) ? [str(content.mediaAssetId)!] : []), ...strings(post?.mediaAssetIds)];
        if (ids.length) {
          const assets = await safe(
            errors,
            "médias",
            async () => (await deps.prisma.mediaAsset.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, origin: true } })) as Array<{ id: string; origin: string | null }>,
            [],
          );
          const refusals = [...new Set(ids)].map((id) => casinoMediaRefusal(assets.find((a) => a.id === id) ?? { origin: null })).filter((x): x is string => x !== null);
          if (refusals.length) findings.push(critical("CHANNEL_RULE", `Casino : ${refusals[0]} (contrôle du code).`));
        }
        const origin = str(content.mediaOrigin);
        if (origin && origin !== "HUMAN") findings.push(critical("CHANNEL_RULE", `Casino : ${casinoMediaRefusal({ origin })} (contrôle du code).`));
      }
      // 10 derniers posts du canal, profil de style, recommandations appliquées au canal.
      if (channelId) {
        loaded.recentPosts = await safe(
          errors,
          "posts récents",
          async () =>
            ((await deps.prisma.post.findMany({
              where: { channelId, status: "SENT", ...(postId ? { id: { not: postId } } : {}) },
              orderBy: { sentAt: "desc" },
              take: 10,
              select: { text: true, sentAt: true },
            })) as Array<{ text: string; sentAt: Date | null }>).map((p) => ({ sentAt: p.sentAt?.toISOString() ?? null, text: clip(p.text, 500) })),
          [],
        );
        const plan = await safe(
          errors,
          "plan du canal",
          async () => (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId }, select: { styleProfileId: true, styleNotes: true } })) as { styleProfileId: string | null; styleNotes: string | null } | null,
          null,
        );
        if (plan?.styleNotes) loaded.styleNotes = clip(plan.styleNotes, 600);
        if (plan?.styleProfileId) {
          const sp = await safe(
            errors,
            "profil de style",
            async () => (await deps.prisma.styleProfile.findUnique({ where: { id: plan.styleProfileId! }, select: { rules: true, description: true, flagged: true } })) as { rules: unknown; description: string | null; flagged: unknown } | null,
            null,
          );
          if (sp) loaded.styleProfile = { rules: sp.rules, description: clip(sp.description, 800), flagged: sp.flagged };
        }
        loaded.appliedRecommendations = await safe(errors, "recommandations du canal", () => recommendationsFor(deps, { targetId: channelId, statuses: ["APPLIED"] }), []);
      }
    }
  }

  // 3. Règles publicitaires actives (posts, shorts, recommandations, alertes, règles).
  if (["POST", "SHORT", "RECOMMENDATION", "ALERT", "COMPLIANCE_RULE"].includes(contentType)) {
    const platforms = contentType === "SHORT" ? ["META", "TIKTOK"] : undefined;
    const ruleMarket = contentType === "SHORT" ? (market ?? "CASINO") : market;
    loaded.complianceRules = await safe(
      errors,
      "règles publicitaires",
      () => activeComplianceRules(deps, { market: ruleMarket, countries, ...(platforms ? { platforms } : {}), ...(contentType === "COMPLIANCE_RULE" ? { excludeId: contentId } : {}) }),
      [],
    );
  }

  // 4. Sources des rapports, alertes et règles : existence vérifiée par le code.
  if (contentType === "REPORT" || contentType === "ALERT" || contentType === "COMPLIANCE_RULE") {
    const ids = sourceEntryIdsOf(content, given);
    // Nos propres liens (site, liens suivis) ne sont pas des sources : ni cassés, ni « absents de la veille ».
    const urls = urlsIn(content).filter((u) => !ownUrl(u));
    const broken = urls.filter(brokenUrl);
    if (broken.length) findings.push(critical("DEAD_SOURCE", `Adresse cassée : ${broken.slice(0, 3).join(", ")} (contrôle du code).`));
    const byId = ids.length
      ? await safe(errors, "sources", async () => (await deps.prisma.trendEntry.findMany({ where: { id: { in: ids } }, select: entrySelect })) as EntryRow[], [])
      : [];
    const missing = ids.filter((id) => !byId.some((e) => e.id === id));
    if (missing.length) findings.push(critical("DEAD_SOURCE", `${missing.length} source(s) citée(s) introuvable(s) dans la veille (contrôle du code).`));
    const good = urls.filter((u) => !brokenUrl(u));
    const byUrl = good.length
      ? await safe(errors, "sources par adresse", async () => (await deps.prisma.trendEntry.findMany({ where: { url: { in: good } }, select: entrySelect })) as EntryRow[], [])
      : [];
    const entries = [...byId, ...byUrl.filter((e) => !byId.some((x) => x.id === e.id))];
    const unknown = good.filter((u) => !entries.some((e) => e.url === u));
    if (unknown.length) hints.push(`${unknown.length} adresse(s) citée(s) absente(s) de la veille : vérifie qu'elles soutiennent l'affirmation.`);
    loaded.sourceEntries = entries.map((e) => ({
      title: clip(e.title, 200),
      summary: clip(e.summary, 500),
      url: e.url,
      publishedAt: e.publishedAt?.toISOString() ?? null,
      verified: e.verified,
      category: e.category,
    }));
  }

  // 5. Réponse de Kevin : question d'origine et données consultées.
  if (contentType === "KEVIN_RESPONSE") {
    let question = str(content.question) ?? str(given.question);
    if (!question) {
      const turn = await safe(
        errors,
        "question d'origine",
        async () => (await deps.prisma.bossTurn.findUnique({ where: { id: contentId }, select: { role: true, text: true, createdAt: true, chatId: true } })) as { role: string; text: string; createdAt: Date; chatId: bigint | null } | null,
        null,
      );
      if (turn?.role === "ADMIN") question = turn.text;
      else if (turn) {
        const prev = await safe(
          errors,
          "question d'origine",
          async () =>
            (await deps.prisma.bossTurn.findFirst({
              where: { role: "ADMIN", createdAt: { lte: turn.createdAt }, ...(turn.chatId !== null ? { chatId: turn.chatId } : {}) },
              orderBy: { createdAt: "desc" },
              select: { text: true },
            })) as { text: string } | null,
          null,
        );
        question = prev?.text ?? null;
      }
    }
    loaded.question = clip(question, 2000);
    const data = content.dataConsulted ?? given.dataConsulted;
    loaded.dataConsulted = data ?? null;
    const response = str(content.response) ?? str(content.text) ?? "";
    if (data !== undefined && data !== null && response) {
      const problems = inventedNumbers(response, allowedNumbers(data));
      if (problems.length) hints.push(`Chiffres de la réponse absents des données consultées : ${problems.slice(0, 5).join(" ; ")}.`);
    }
  }

  // 6. Recommandation : recommandations actives, bornes de l'équipe Algorithme.
  if (contentType === "RECOMMENDATION") {
    const target = str(content.targetId);
    loaded.activeRecommendations = await safe(
      errors,
      "recommandations actives",
      () => recommendationsFor(deps, { targetId: target, teamKey, statuses: ["PROPOSED", "APPLIED"], excludeId: contentId }),
      [],
    );
    loaded.algoBounds = await safe(
      errors,
      "bornes de l'Algorithme",
      async () => {
        const row = (await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: "algo" }, select: { settings: true } })) as { settings: unknown } | null;
        const s = row ? parseAlgoSettings(rec(row.settings).algo) : { ...DEFAULT_ALGO_SETTINGS };
        return { maxMixShiftPoints: s.maxMixShiftPoints, maxPostsPerDay: s.maxPostsPerDay, allowedHours: s.allowedHours.default, minPosts: s.minPosts };
      },
      null,
    );
  }

  // 7. Règle publicitaire / alerte : règle visée.
  if (contentType === "ALERT" && str(content.ruleId)) {
    const id = str(content.ruleId)!;
    const rule = await safe(errors, "règle de l'alerte", async () => (await deps.prisma.complianceRule.findUnique({ where: { id }, select: { rule: true, riskLevel: true, platform: true, country: true, isActive: true } })) as Record<string, unknown> | null, null);
    if (!rule) findings.push(critical("DEAD_SOURCE", "La règle publicitaire citée par l'alerte est introuvable (contrôle du code)."));
    else loaded.rule = { ...rule, rule: clip(str(rule.rule), 400) };
  }

  return { context: { ...loaded, ...given }, findings, hints, errors, copyChecked };
}

type EntryRow = { id: string; title: string | null; summary: string; url: string; publishedAt: Date | null; verified: boolean; category: string };
const entrySelect = { id: true, title: true, summary: true, url: true, publishedAt: true, verified: true, category: true } as const;

async function recommendationsFor(
  deps: AgentsDeps,
  q: { targetId?: string | null; teamKey?: string; statuses: string[]; excludeId?: string },
): Promise<Array<Record<string, unknown>>> {
  const or: Array<Record<string, unknown>> = [];
  if (q.targetId) or.push({ targetId: q.targetId });
  if (q.teamKey) or.push({ teamKey: q.teamKey });
  if (!or.length) return [];
  const rows = (await deps.prisma.recommendation.findMany({
    where: { status: { in: q.statuses as never }, OR: or as never, ...(q.excludeId ? { id: { not: q.excludeId } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { teamKey: true, target: true, field: true, before: true, after: true, status: true, source: true, action: true, createdAt: true },
  })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    teamKey: r.teamKey,
    target: r.target,
    field: r.field,
    before: r.before ?? null,
    after: r.after,
    status: r.status,
    source: r.source,
    ...(r.action ? { action: r.action } : {}),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : null,
  }));
}
