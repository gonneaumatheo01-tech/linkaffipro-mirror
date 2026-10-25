/**
 * Phase 29, chantier C — entrées du catalogue de Kevin pour l'équipe Analystes (section 7 du prompt) :
 * - `analyse_marche` (« qu'est-ce qui marche en casino en France ? », « compare la France et l'Allemagne en casino ») et
 *   `strategie_ads` (« quel type d'ad je devrais faire pour le dating en Espagne ? ») : question longue, traitée par le
 *   worker (Stratège, Opus) ; Kevin répond « Je regarde, je te réponds dans une minute » puis envoie la réponse sourcée
 *   (20 lignes au plus) et les recommandations ouvertes en choix numérotés ;
 * - `rapport_marche` (« briefing casino Allemagne ») : briefing du Rapporteur, en différé aussi ;
 * - `tendances`, `compliance`, `alertes_marche` : lectures instantanées de la base (aucune IA), sources visibles,
 *   phrase fixe `LEGAL_DISCLAIMER` dès qu'on parle de règles ;
 * - `sources_veille` : voir (tout membre présenté), ajouter (source notée INACTIVE puis OUI pour l'activer), retirer
 *   (OUI) : l'admin seul ; `activer_source` : OUI ;
 * - `appliquer_reco_marche` (« applique 2 ») : la proposition passe « gardée » ; rien n'est changé chez Meta / TikTok
 *   ni sur les canaux (l'équipe recommande, le client agit).
 * Et le chemin rapide (`analystsFastPath`, sans IA, admin seulement) : numéros en réponse au dernier choix numéroté.
 */
import { adminTelegramId, agentAudit, agentEvent, esc, nowOf, writeSetting } from "../admin/journal";
import { ANALYSTS_LIMITS, type CompliancePlatform, type Market } from "../analysts/contract";
import { composeAnalystsAnswer } from "../analysts/kevin-jobs";
import type { AnalystsKevinDeps } from "../analysts/kevin-port";
import { alertsReply, findSources, ruleLine, rulesFor, rulesReply, scopeText, sourcesReply, topRisk, trendsReply, type SourceRow } from "../analysts/kevin-read";
import {
  analystsChoiceOpen,
  analystsEnabled,
  choiceKeyOf,
  createAnalystsRequest,
  readAnalystsChoice,
  type AnalystsRequestKind,
} from "../analysts/kevin-state";
import { ANALYSTS_KEVIN_VARIANTS as AV, boundedAnswer, countriesOf, hostLabel, marketOf, platformOf, RISK_WORDS, urlIn } from "../analysts/kevin-texts";
import type { BossAction, BossDeps, BossReply, BossTeamInput } from "./contract";
import { defineAction } from "./catalog-kit";
import type { BossExecDeps } from "./catalog-read";
import { readInspirationChoice, parseProposalNumbers } from "./catalog-inspiration";
import { createBossPending } from "./confirm";
import { int, oneOf, str } from "./params";
import { pick } from "./voice";
import { BOSS_ADMIN_ONLY_KEYS, BOSS_READ_KEYS } from "./team/rights";

/** Conversation de la demande (privé de l'admin par défaut ; un membre sans conversation : null). */
async function chatKeyOf(deps: BossDeps): Promise<string | null> {
  const d = deps as BossExecDeps;
  if (d.chat) return d.chat.chatId.toString();
  if (d.speaker && d.speaker.kind === "member") return null;
  return (await adminTelegramId(deps))?.toString() ?? null;
}

const askedByOf = (deps: BossDeps): string => {
  const d = deps as BossExecDeps;
  return d.speaker && d.speaker.kind === "member" ? d.speaker.telegramUserId.toString() : "admin";
};

const MARKET_PARAM = ["casino", "paris_sportifs", "rencontres"] as const;
const MARKET_OF_PARAM: Record<string, Market> = { casino: "CASINO", paris_sportifs: "SPORTS", rencontres: "DATING" };

type Scope = { market: Market | null; countries: string[]; platform: CompliancePlatform | null };

/** Marché, pays et plateforme : paramètres de l'IA d'abord, sinon lus dans la phrase (pur). */
export function scopeFrom(p: { marche?: string; pays?: string; plateforme?: string }, text: string): Scope {
  return {
    market: (p.marche ? MARKET_OF_PARAM[p.marche] : null) ?? marketOf(text),
    countries: p.pays ? countriesOf(p.pays) : countriesOf(text),
    platform: platformOf(p.plateforme ?? null) ?? platformOf(text),
  };
}

const marketSpec = oneOf("Marché : casino, paris_sportifs ou rencontres (absent = tous)", MARKET_PARAM, true);
const countrySpec = str("Pays cités, tels que dits (« France », « France et Allemagne »)", { optional: true, maxLength: 120 });
const platformSpec = str("Plateforme pub citée (Meta, TikTok, Google, Snap, X)", { optional: true, maxLength: 40 });

/** Question longue : rangée, traitée par le worker (réponse dans une minute) ; sans file, réponse tout de suite. */
async function deferOrAnswer(deps: BossDeps, kind: AnalystsRequestKind, question: string, scope: Scope): Promise<BossReply> {
  const chatId = await chatKeyOf(deps);
  if (!(await analystsEnabled(deps))) return { reply: pick(AV.disabled, "analysts.disabled", chatId) };
  const req = await createAnalystsRequest(deps, { kind, question: question.slice(0, 600), market: scope.market, countries: scope.countries, platform: scope.platform, chatId, askedBy: askedByOf(deps) });
  // Sans conversation connue (membre), la réponse ne part pas en différé : elle irait chez l'admin.
  const enqueue = chatId ? (deps as AnalystsKevinDeps).analysts?.enqueue : undefined;
  if (enqueue) {
    try {
      await enqueue({ type: "analysts.strategy", kind: "on_demand", requestId: req.id }, { jobId: `analysts-ask-${req.id}` });
      return { reply: pick(kind === "briefing" ? AV.deferredBriefing : AV.deferred, `analysts.deferred.${kind}`, chatId) };
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message }, "[analystes] question non mise en file, réponse directe");
    }
  }
  return { reply: (await composeAnalystsAnswer(deps as AnalystsKevinDeps, req)).text };
}

type AskP = { question: string; marche?: string; pays?: string; plateforme?: string };

const askSpec = {
  question: str("La question du client, telle que posée", { maxLength: 500 }),
  marche: marketSpec,
  pays: countrySpec,
  plateforme: platformSpec,
};

export const analyseMarche = defineAction<AskP>({
  key: "analyse_marche",
  description:
    "Question libre sur un marché et des pays, d'après la veille des forums, réseaux et actualités (« qu'est-ce qui marche en casino en France ? », « compare la France et l'Allemagne en casino », « comment faire des pubs dating sans se faire bannir sur TikTok ? »)",
  theme: "ads",
  cls: "immediate",
  spec: askSpec,
  async execute(deps, p) {
    return deferOrAnswer(deps, "analysis", p.question, scopeFrom(p, p.question));
  },
});

export const strategieAds = defineAction<AskP>({
  key: "strategie_ads",
  description: "Quel type de pub faire, quel angle, quel format, pour quel marché et quel pays (« quel type d'ad je devrais faire pour le dating en Espagne ? »), avec mes propositions numérotées",
  theme: "ads",
  cls: "immediate",
  spec: askSpec,
  async execute(deps, p) {
    return deferOrAnswer(deps, "strategy", p.question, scopeFrom(p, p.question));
  },
});

type BriefP = { marche?: string; pays?: string };

export const rapportMarche = defineAction<BriefP>({
  key: "rapport_marche",
  description: "Briefing du marché sur un univers et un pays (« briefing casino Allemagne », « fais-moi le point paris sportifs en Italie »)",
  theme: "ads",
  cls: "immediate",
  spec: { marche: marketSpec, pays: countrySpec },
  async execute(deps, p) {
    const text = (deps as BossExecDeps).inputText ?? "";
    const scope = scopeFrom(p, text);
    return deferOrAnswer(deps, "briefing", text || `briefing ${p.marche ?? ""} ${p.pays ?? ""}`.trim(), scope);
  },
});

type TrendsP = { marche?: string; pays?: string; jours?: number };

export const tendances = defineAction<TrendsP>({
  key: "tendances",
  description: "Les dernières tendances du marché relevées par la veille (« quelles tendances cette semaine ? », « quoi de neuf en paris sportifs en Allemagne ? »)",
  theme: "ads",
  cls: "immediate",
  spec: { marche: marketSpec, pays: countrySpec, jours: int("Nombre de jours (7 par défaut)", 1, 30, true) },
  async execute(deps, p) {
    const chatId = await chatKeyOf(deps);
    if (!(await analystsEnabled(deps))) return { reply: pick(AV.disabled, "analysts.disabled", chatId) };
    const s = scopeFrom(p, (deps as BossExecDeps).inputText ?? "");
    return { reply: await trendsReply(deps, { market: s.market, countries: s.countries, ...(p.jours ? { days: p.jours } : {}) }, chatId) };
  },
});

type RulesP = { plateforme?: string; marche?: string; pays?: string; pratique?: string };

export const complianceAction = defineAction<RulesP>({
  key: "compliance",
  description:
    "Règles des plateformes pub pour un marché et un pays, et le risque d'une pratique (« quelles sont les règles Meta pour le casino en France ? », « c'est risqué de faire des ads casino avec du bonus sur TikTok en France ? »)",
  theme: "ads",
  cls: "immediate",
  spec: { plateforme: platformSpec, marche: marketSpec, pays: countrySpec, pratique: str("Pratique dont on demande le risque (« bonus », « gains »)", { optional: true, maxLength: 120 }) },
  async execute(deps, p) {
    const chatId = await chatKeyOf(deps);
    const s = scopeFrom(p, (deps as BossExecDeps).inputText ?? "");
    if (!p.pratique) return { reply: await rulesReply(deps, s, chatId) };
    // La pratique citée : ses règles d'abord (mots de la pratique trouvés dans la règle).
    const words = p.pratique
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4);
    const all = await rulesFor(deps, s);
    const hit = all.filter((r) => {
      const t = r.rule
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLowerCase();
      return words.some((w) => t.includes(w.slice(0, Math.max(4, w.length - 1))));
    });
    if (!hit.length) return { reply: await rulesReply(deps, s, chatId) };
    const risk = topRisk(hit)!;
    const head = pick(AV.rulesHead({ what: `${scopeText(s)} (${p.pratique})`, risk: RISK_WORDS[risk] }), "analysts.rulesHead", chatId);
    return { reply: boundedAnswer([esc(head), ...hit.slice(0, 8).map((r) => ruleLine(r, chatId))].join("\n"), { rules: true }) };
  },
});

export const alertesMarche = defineAction<{ marche?: string }>({
  key: "alertes_marche",
  description: "Les alertes du moment sur le marché : règles pub à risque, bannissements, tendances qui explosent (« y a des alertes en ce moment ? »)",
  theme: "ads",
  cls: "immediate",
  spec: { marche: marketSpec },
  async execute(deps, p) {
    const chatId = await chatKeyOf(deps);
    return { reply: await alertsReply(deps, { market: p.marche ? MARKET_OF_PARAM[p.marche]! : null }, chatId) };
  },
});

// ------------------------------------------------------------------------------------------------ sources

type SourcesP = { action: "voir" | "ajouter" | "retirer"; adresse?: string; nom?: string; marche?: string };

/** Source visée par un nom ou une adresse : une seule, sinon la réponse à donner. */
async function oneSource(deps: BossDeps, raw: string): Promise<{ ok: true; source: SourceRow } | { ok: false; reply: string }> {
  const chatId = await chatKeyOf(deps);
  const found = await findSources(deps, raw);
  if (!found.length) return { ok: false, reply: pick(AV.sourceUnknown({ name: esc(raw.slice(0, 80)) }), "analysts.source.unknown", chatId) };
  if (found.length > 1) return { ok: false, reply: pick(AV.sourceMany({ list: esc(found.slice(0, 4).map((s) => s.name).join(", ")) }), "analysts.source.many", chatId) };
  return { ok: true, source: found[0]! };
}

export const sourcesVeille = defineAction<SourcesP>({
  key: "sources_veille",
  description:
    "Les sources que surveille la veille du marché : voir la liste (« quelles sources tu surveilles ? », « montre-moi les sources »), ajouter un forum ou un site (« ajoute ce forum https://… », « ajoute BlackHatWorld »), en retirer un (« retire Reddit r/gambling »)",
  theme: "ads",
  cls: "immediate",
  spec: {
    action: oneOf("voir, ajouter ou retirer", ["voir", "ajouter", "retirer"]),
    adresse: str("Adresse de la source à ajouter ou retirer", { optional: true, maxLength: 300 }),
    nom: str("Nom de la source (« BlackHatWorld », « Reddit r/gambling »)", { optional: true, maxLength: 120 }),
    marche: marketSpec,
  },
  async classify(deps, p) {
    if (p.action === "voir") return "immediate";
    if (p.action === "retirer") return "confirm";
    // Ajouter : la source naît inactive, puis un OUI l'active. Un membre présenté : la demande part chez l'admin.
    const d = deps as BossExecDeps;
    return d.speaker && d.speaker.kind === "member" ? "confirm" : "immediate";
  },
  async check(deps, p) {
    if (p.action !== "retirer") return null;
    const r = await oneSource(deps, p.adresse ?? p.nom ?? "");
    return r.ok ? null : { reply: r.reply };
  },
  async summarize(deps, p) {
    const chatId = await chatKeyOf(deps);
    if (p.action === "retirer") {
      const r = await oneSource(deps, p.adresse ?? p.nom ?? "");
      return pick(AV.confirmRemove({ name: r.ok ? r.source.name : (p.nom ?? p.adresse ?? "cette source") }), "analysts.confirmRemove", chatId);
    }
    return pick(AV.confirmActivate({ name: p.nom ?? (p.adresse ? hostLabel(urlIn(p.adresse) ?? p.adresse) : "cette source") }), "analysts.confirmActivate", chatId);
  },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    const marketParam = p.marche ? MARKET_OF_PARAM[p.marche]! : null;
    if (p.action === "voir") return { reply: await sourcesReply(deps, chatId, { market: marketParam }) };
    if (p.action === "retirer") {
      const r = await oneSource(deps, p.adresse ?? p.nom ?? "");
      if (!r.ok) return { reply: r.reply };
      await deps.prisma.trendSource.update({ where: { id: r.source.id }, data: { isActive: false, nextScrapeAt: null } });
      await agentAudit(deps, { userId: actor.userId, action: "analysts.source.removed", entityType: "TrendSource", entityId: r.source.id, metadata: { via: "TELEGRAM" } });
      return { reply: pick(AV.sourceRemoved({ name: esc(r.source.name) }), "analysts.source.removed", chatId) };
    }
    // Ajouter : source notée INACTIVE, puis confirmation OUI pour l'activer.
    const text = (deps as BossExecDeps).inputText ?? "";
    const url = urlIn(p.adresse ?? null) ?? urlIn(p.nom ?? null) ?? urlIn(text);
    if (!url) {
      // « ajoute BlackHatWorld » : une source déjà connue sous ce nom s'active par OUI, sinon il faut l'adresse.
      const known = p.nom ? await findSources(deps, p.nom) : [];
      if (known.length === 1) return activationPending(deps, known[0]!);
      return { reply: pick(AV.sourceAsk, "analysts.source.ask", chatId) };
    }
    const existing = (await deps.prisma.trendSource.findFirst({ where: { url } })) as SourceRow | null;
    if (existing?.isActive) return { reply: pick(AV.sourceAlready({ name: esc(existing.name) }), "analysts.source.already", chatId) };
    const market = marketParam ?? marketOf(text) ?? marketOf(url) ?? "CASINO";
    const countries = countriesOf(text);
    const source = (existing ??
      (await deps.prisma.trendSource.create({
        data: {
          name: (p.nom ?? hostLabel(url)).slice(0, 120),
          url,
          sourceType: /reddit\.com/.test(url) ? "REDDIT" : /t\.me\//.test(url) ? "TELEGRAM" : /(x|twitter)\.com/.test(url) ? "TWITTER" : "FORUM",
          market,
          countries,
          languages: [],
          scrapeConfig: { rateLimitMs: ANALYSTS_LIMITS.forumRateMs, maxPages: 5 },
          isActive: false,
          origin: "client",
        },
      }))) as SourceRow;
    await agentAudit(deps, { userId: actor.userId, action: "analysts.source.added", entityType: "TrendSource", entityId: source.id, metadata: { via: "TELEGRAM", active: false } });
    return activationPending(deps, source, true);
  },
});

/** Message « notée, pas encore suivie » + OUI / NON (confirmation `activer_source`). */
async function activationPending(deps: BossDeps, source: SourceRow, justAdded = false): Promise<BossReply> {
  const chatId = await chatKeyOf(deps);
  const summary = pick(
    justAdded ? AV.sourceAdded({ name: source.name, url: source.url }) : AV.confirmActivate({ name: source.name }),
    justAdded ? "analysts.source.added" : "analysts.confirmActivate",
    chatId,
  );
  const d = deps as BossExecDeps;
  return createBossPending(deps, { actionKey: "activer_source", params: { source: `id:${source.id}` }, summary, chatId: d.chat?.chatId ?? null });
}

/** Active une source (OUI de l'admin) : lue au prochain passage de la veille (dans l'heure). */
export async function activateSource(deps: BossDeps, sourceId: string, actor: { userId: string | null }): Promise<{ ok: boolean; name: string }> {
  const s = (await deps.prisma.trendSource.findUnique({ where: { id: sourceId } })) as SourceRow | null;
  if (!s) return { ok: false, name: "" };
  await deps.prisma.trendSource.update({ where: { id: s.id }, data: { isActive: true, errorCount: 0, lastError: null, nextScrapeAt: nowOf(deps) } });
  await deps.prisma.setting.deleteMany({ where: { key: `analysts.sourceWarned.${s.id}` } });
  await agentAudit(deps, { userId: actor.userId, action: "analysts.source.activated", entityType: "TrendSource", entityId: s.id, metadata: { via: "TELEGRAM" } });
  await agentEvent(deps, "analysts.source.activated", { sourceId: s.id });
  return { ok: true, name: s.name };
}

export const activerSource = defineAction<{ source: string }>({
  key: "activer_source",
  description: "Mettre dans la veille une source déjà notée ou proposée (« active AffLift », « oui, suis ce forum »)",
  theme: "ads",
  cls: "confirm",
  spec: { source: str("Nom ou adresse de la source", { maxLength: 300 }) },
  async check(deps, p) {
    if (p.source.startsWith("id:")) return null;
    const r = await oneSource(deps, p.source);
    return r.ok ? null : { reply: r.reply };
  },
  async summarize(deps, p) {
    const chatId = await chatKeyOf(deps);
    const s = p.source.startsWith("id:") ? ((await deps.prisma.trendSource.findUnique({ where: { id: p.source.slice(3) } })) as SourceRow | null) : null;
    const r = s ? null : await oneSource(deps, p.source);
    const name = s?.name ?? (r && r.ok ? r.source.name : p.source);
    return pick(AV.confirmActivate({ name }), "analysts.confirmActivate", chatId);
  },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    let id: string | null = p.source.startsWith("id:") ? p.source.slice(3) : null;
    if (!id) {
      const r = await oneSource(deps, p.source);
      if (!r.ok) return { reply: r.reply };
      id = r.source.id;
    }
    const r = await activateSource(deps, id, actor);
    if (!r.ok) return { reply: pick(AV.sourceUnknown({ name: esc(p.source.replace(/^id:/, "").slice(0, 60)) }), "analysts.source.unknown", chatId) };
    return { reply: pick(AV.sourceActivated({ name: esc(r.name) }), "analysts.source.activated", chatId) };
  },
});

// ------------------------------------------------------------------------------------------------ recommandations

type ApplyP = { numeros: string };

/** « applique la 2 », « garde 1 et 3 », « je prends tout » → « 2 », « 1 et 3 », « tout » (pur). */
export function cleanNumbers(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/^\s*(?:applique[rsz]?|appliquez|garde[rsz]?|gardez|ok pour|go pour|je prends|je garde)\s+/, "")
    .replace(/^(?:la|le|les|propositions?|numeros?|n°|no)\s+/, "")
    .replace(/^(?:propositions?|numeros?|n°)\s+/, "")
    .trim();
}

const numbersOf = (raw: string, max: number) => parseProposalNumbers(cleanNumbers(raw), max);

export const appliquerRecoMarche = defineAction<ApplyP>({
  key: "appliquer_reco_marche",
  description:
    "Garder mes propositions de l'analyse du marché par leurs numéros (« applique 2 », « garde la 1 et la 3 ») ; je ne change rien chez Meta, TikTok ni sur les canaux, c'est le client qui agit",
  theme: "ads",
  cls: "confirm",
  spec: { numeros: str("Numéros tels que dits : « 2 », « 1 et 3 », « tout »", { maxLength: 60 }) },
  async classify(deps) {
    // Réponse au choix numéroté posé par Kevin à l'admin, dans cette conversation : le choix vaut accord.
    const d = deps as BossExecDeps;
    if (d.speaker && d.speaker.kind === "member") return "confirm";
    return analystsChoiceOpen(await readAnalystsChoice(d, await chatKeyOf(d)), nowOf(d)) ? "immediate" : "confirm";
  },
  async check(deps, p) {
    const chatId = await chatKeyOf(deps);
    const c = await readAnalystsChoice(deps, chatId);
    if (!c?.items.length) return { reply: pick(AV.noProposals, "analysts.noProposals", chatId) };
    if (!numbersOf(p.numeros, c.items.length)) return { reply: pick(AV.badNumbers({ max: c.items.length }), "analysts.badNumbers", chatId) };
    return null;
  },
  async summarize(deps, p) {
    const c = await readAnalystsChoice(deps, await chatKeyOf(deps));
    const nums = c ? numbersOf(p.numeros, c.items.length) : null;
    return pick(AV.confirmAccept({ nums: nums?.join(", ") ?? p.numeros }), "analysts.confirmAccept", await chatKeyOf(deps));
  },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    const c = await readAnalystsChoice(deps, chatId);
    if (!c?.items.length) return { reply: pick(AV.noProposals, "analysts.noProposals", chatId) };
    const nums = numbersOf(p.numeros, c.items.length);
    if (!nums) return { reply: pick(AV.badNumbers({ max: c.items.length }), "analysts.badNumbers", chatId) };
    const chosen = nums.map((n) => c.items.find((i) => i.n === n)).filter((i): i is NonNullable<typeof i> => !!i);
    const now = nowOf(deps);
    // Seul le statut de la proposition change (gardée par le client) : aucune action chez Meta, TikTok, ni sur les canaux.
    for (const item of chosen) {
      await deps.prisma.recommendation.updateMany({
        where: { id: item.recommendationId, status: "PROPOSED" },
        data: { status: "APPLIED", appliedAt: now, appliedBy: "HUMAN", appliedById: actor.userId, comment: "Gardée par le client (Kevin) ; à faire par lui chez la plateforme." },
      });
      await agentAudit(deps, { userId: actor.userId, action: "analysts.recommendation.accepted", entityType: "Recommendation", entityId: item.recommendationId, metadata: { via: "TELEGRAM", number: item.n } });
    }
    await writeSetting(deps, choiceKeyOf(c.chatId), { ...c, answeredAt: now.toISOString() });
    const list = chosen.map((i) => `${i.n} (${esc(i.label)})`).join(", ");
    return { reply: pick(AV.accepted({ list }), "analysts.accepted", chatId) };
  },
});

export const ANALYSTS_ACTIONS: BossAction[] = [
  analyseMarche,
  tendances,
  complianceAction,
  strategieAds,
  sourcesVeille,
  activerSource,
  rapportMarche,
  alertesMarche,
  appliquerRecoMarche,
] as unknown as BossAction[];

/** Lectures (et questions) qu'un membre présenté fait lui-même ; ajouter ou retirer une source part chez l'admin. */
export const ANALYSTS_READ_ACTION_KEYS = ["analyse_marche", "tendances", "compliance", "strategie_ads", "sources_veille", "rapport_marche", "alertes_marche"] as const;
/** Réservées à l'admin : activer une source, garder une proposition. */
export const ANALYSTS_ADMIN_ACTION_KEYS = ["activer_source", "appliquer_reco_marche"] as const;

for (const k of ANALYSTS_READ_ACTION_KEYS) BOSS_READ_KEYS.add(k);
for (const k of ANALYSTS_ADMIN_ACTION_KEYS) BOSS_ADMIN_ONLY_KEYS.add(k);

// ------------------------------------------------------------------------------------------------ chemin rapide

const NUMBERS_ONLY = /^\s*(?:(?:applique[rsz]?|garde[rsz]?|ok pour|go pour|je prends|je garde)\s+(?:la\s+|le\s+|les\s+)?)?(?:\d{1,2}(?:\s*(?:,|;|et|&|\+|\s)\s*\d{1,2})*|tout|tous|toutes)\s*[.!]?\s*$/i;

/**
 * Chemin rapide (sans IA) de l'analyse du marché, pour l'admin seulement : numéros (« 2 », « applique 1 et 3 ») en
 * réponse au dernier choix numéroté de l'équipe Analystes posé dans cette conversation, plus récent que toute autre
 * question ouverte et que le choix d'inspiration, jamais en « Répondre » à un autre message. Null : la suite décide.
 */
export async function analystsFastPath(
  deps: BossDeps,
  input: BossTeamInput,
  ctx: { otherQuestionAt: number; run: (action: BossAction, params: Record<string, unknown>) => Promise<BossReply> },
): Promise<{ reply: BossReply; actionKey: string } | null> {
  const text = (input.text ?? "").trim();
  if (!text || input.forwarded || input.replyToMessageId != null) return null;
  if (input.speaker && input.speaker.kind === "member") return null;
  if (!NUMBERS_ONLY.test(text)) return null;
  const chatKey = input.chat ? input.chat.chatId.toString() : ((await adminTelegramId(deps))?.toString() ?? null);
  const c = await readAnalystsChoice(deps, chatKey);
  const now = nowOf(deps);
  if (!analystsChoiceOpen(c, now)) return null;
  const at = new Date(c.createdAt).getTime();
  if (at <= ctx.otherQuestionAt) return null;
  const insp = await readInspirationChoice(deps, chatKey);
  if (insp && !insp.answeredAt && new Date(insp.createdAt).getTime() > at) return null;
  return { reply: await ctx.run(appliquerRecoMarche as unknown as BossAction, { numeros: text }), actionKey: "appliquer_reco_marche" };
}

