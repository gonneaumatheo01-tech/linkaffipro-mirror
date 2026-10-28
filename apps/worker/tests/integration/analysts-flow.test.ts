/**
 * Phase 29 — équipe Analystes de bout en bout, sur base réelle (`linkaffipro_test`), sans réseau :
 * - Kevin (bot `role ADMIN`) reçoit les updates simulées par SES vrais handlers grammY (`createBot` + `handleUpdate` :
 *   chemin rapide du dialogue admin, OUI, « applique 1 »), faux Telegram ; les phrases libres passent par la vraie tâche
 *   `boss-text` du worker (`processBossText`, interprète réel, fausse IA de Kevin `createFakeBossLlm`) ;
 * - la VRAIE file `agents-analystes` (`processAgentsAnalystes` → `runAnalystsJob`) tourne en processus, avec une file
 *   simulée idempotente par identifiant de tâche (comme `addIdempotent`) ;
 * - web : le vrai accès poli (`createAnalystsWeb` : robots.txt, débit par hôte) sur un faux `fetch` qui sert les
 *   fixtures de `packages/agents/fixtures/analysts/` (forum, Reddit, `t.me/s/`, article, page de règles) ; recherche par
 *   les faux outils serveur de l'API (`fakeServerTools`) ; horloge injectée (l'attente du débit avance l'horloge) ;
 * - IA de l'équipe : fausse IA scriptée (classement, résumé, règles, stratège, synthèse, rapport) qui répond selon le
 *   prompt système et les DONNÉES reçues.
 *
 * Scénario : premier lancement (sources de départ + règles initiales, une seule fois) → lecture des sources dues sur
 * fixtures → « ajoute <url> » (INACTIVE → OUI → active) → forum + t.me lus → entrée AD_BAN BAN → règle → alerte immédiate
 * (une fois, source + « pas un avis juridique ») → « qu'est-ce qui marche en casino en France ? » (réponse différée,
 * sourcée, sans adresse inventée) → « quelles sources tu surveilles ? » → « c'est risqué … bonus sur TikTok en France ? »
 * → rapport du lundi 8 h (une fois, rien le mardi) → « applique 1 » (APPLIED, rien dehors) → source en panne 5 fois
 * (coupée, Kevin prévient une fois) → purge du texte brut à 7 jours → post d'injection = simple donnée →
 * `analysts.enabled = false` → rien.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import type { Update } from "grammy/types";
import type { Bot as GrammyBot } from "grammy";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  createAnalystsWeb,
  createFakeBossLlm,
  LEGAL_DISCLAIMER,
  memoryHostThrottle,
  type AgentsDeps,
  type AgentsOrchestratorJob,
  type AnalystsKevinDeps,
  type AnalystsQueueJob,
  type LlmProvider,
  type LlmRequest,
} from "@linkaffipro/agents";
import { createAdminMessengerWith, createBot, prismaTelegramDeps, realBossEngine, type MessengerApi, type TelegramDeps } from "@linkaffipro/telegram";
import type { AgentsAnalystesJob } from "@linkaffipro/queue";
import { processAgentsAnalystes } from "../../src/processors/agents-analystes";
import { prismaBossTurnFor, processBossText, type BossTextDeps } from "../../src/agents/boss-text";
import { approveAllQa, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";
import { fakeServerTools } from "../../../../packages/agents/src/analysts/watch/testing";

const ADMIN = 79_291;
const KEVIN_TG = 5560;
const KEVIN_TOKEN = `${KEVIN_TG}:KEVIN-TOKEN-${"a".repeat(30)}`;
const FIX = join(import.meta.dirname, "../../../../packages/agents/fixtures/analysts");
const fixture = (name: string) => readFileSync(join(FIX, name), "utf8");

/** Dimanche 25 octobre 2026, 11 h à Paris (heure d'hiver depuis 3 h). */
const SUNDAY = Date.parse("2026-10-25T10:00:00Z");
/** Lundi 26 octobre 2026, 8 h à Paris ; mardi 27, 9 h. */
const MONDAY_8H = Date.parse("2026-10-26T07:00:00Z");
const TUESDAY_9H = Date.parse("2026-10-27T08:00:00Z");

const BHW = "https://www.blackhatworld.com";
const FORUM_URL = `${BHW}/forums/gambling-affiliates.205/`;
const META_BAN_URL = `${BHW}/threads/meta-killed-my-casino-ad-accounts-in-de.1500001/`;
const TME_URL = "https://t.me/s/wettnews_de_exemple";
const META_POLICY = "https://transparency.meta.com/policies/ad-standards/restricted-goods-services/online-gambling-games/";
const TIKTOK_POLICY = "https://ads.tiktok.com/help/article/tiktok-ads-policy-gambling";
const NEWS = "https://igamingbusiness.com";
const NEWS_GGL = `${NEWS}/de/nachrichten/ggl-influencer-werbung-2027`;
const NEWS_ES = `${NEWS}/es/noticias/tiktok-espana-casino-anuncios`;
const NEWS_FR = `${NEWS}/fr/actualites/paris-sportifs-france-streamers`;
const DOWN_URL = "https://forum-en-panne.example/f/casino/";
/** Adresse inventée par la fausse IA (injection) : ne doit jamais sortir. */
const INVENTED = "https://cloaking-secret.example/guide";

/** Page de règles TikTok inventée pour le test (jeux d'argent). */
const TIKTOK_PAGE = `<!DOCTYPE html><html><head><title>TikTok ads policy — gambling (page inventée pour le test)</title></head><body><main><article>
<h1>Gambling</h1><p>Ads for online casino are only allowed with prior authorisation and only in approved countries. In France, ads for online casino that promote a bonus or a free offer are not allowed and repeated violations restrict the ad account.</p>
</article></main></body></html>`;

// ------------------------------------------------------------------------------------------------ horloge

let clock = SUNDAY;
const now = () => new Date(clock);

// ------------------------------------------------------------------------------------------------ faux web

const webCalls: string[] = [];
const webMethods = new Set<string>();
let downCalls = 0;

function route(url: string): { status: number; body: string; type?: string } {
  const u = new URL(url);
  if (u.pathname === "/robots.txt") {
    if (u.hostname === "www.blackhatworld.com") return { status: 200, body: fixture("robots-forum.txt"), type: "text/plain" };
    if (u.hostname === "forum-en-panne.example") return { status: 404, body: "", type: "text/plain" };
    return { status: 200, body: fixture("robots-open.txt"), type: "text/plain" };
  }
  if (url === FORUM_URL) return { status: 200, body: fixture("bhw-gambling.html") };
  if (url === `${BHW}/forums/gambling-affiliates.205/page-2`) return { status: 200, body: fixture("bhw-gambling-page-2.html") };
  if (url === TME_URL) return { status: 200, body: fixture("tme-wettnews-de.html") };
  if (url === META_POLICY) return { status: 200, body: fixture("meta-policy-gambling.html") };
  if (url === TIKTOK_POLICY) return { status: 200, body: TIKTOK_PAGE };
  if (url === NEWS_GGL) return { status: 200, body: fixture("igaming-news-article.html") };
  if (url === "https://www.reddit.com/r/gambling/new.json?limit=25&raw_json=1") return { status: 200, body: fixture("reddit-gambling-new.json"), type: "application/json" };
  if (/^https:\/\/www\.reddit\.com\/r\/\w+\/new\.json/.test(url)) return { status: 200, body: JSON.stringify({ kind: "Listing", data: { children: [] } }), type: "application/json" };
  if (u.hostname === "forum-en-panne.example") {
    downCalls++;
    return { status: 503, body: "Service indisponible" };
  }
  return { status: 404, body: "not found" };
}

const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  webCalls.push(url);
  webMethods.add((init?.method ?? "GET").toUpperCase());
  const r = route(url);
  const res = new Response(r.body, { status: r.status, headers: { "content-type": r.type ?? "text/html; charset=utf-8" } });
  Object.defineProperty(res, "url", { value: url });
  return res;
}) as typeof fetch;

/** Recherche web simulée : seules les actualités d'iGaming Business rendent des résultats (extraits de la fixture). */
const serverTools = fakeServerTools({
  search: (_query, req) => {
    const domains = ((req.tools[0] as { allowed_domains?: string[] }).allowed_domains ?? []).join(",");
    if (domains !== "igamingbusiness.com") return [];
    return [
      {
        url: NEWS_GGL,
        title: "GGL verschärft Regeln für Influencer-Werbung ab 2027",
        page_age: "2026-10-21",
        snippet: "Werbung für virtuelle Automatenspiele in sozialen Netzwerken muss ab Januar 2027 einen festen Warnhinweis tragen.",
        date: "2026-10-21",
      },
      {
        url: NEWS_ES,
        title: "TikTok endurece su política de anuncios de casino en España",
        page_age: "2026-10-20",
        snippet: "Los anuncios de casino online dirigidos a España quedan limitados a campañas de marca sin incentivos.",
        date: "2026-10-20",
      },
      {
        url: NEWS_FR,
        title: "France : les opérateurs de paris sportifs misent sur les streamers",
        page_age: "2026-10-19",
        snippet: "Trois opérateurs agréés annoncent des partenariats avec des streamers Twitch pour la saison de Ligue 1.",
        date: "2026-10-19",
      },
    ];
  },
});

// ------------------------------------------------------------------------------------------------ fausse IA de l'équipe

type Cls = { category: string; sentiment: string; relevanceScore: number; countries: string[]; tags: string[]; platform: string | null; risk: string | null };
const cls = (category: string, relevanceScore: number, countries: string[], platform: string | null = null, risk: string | null = null, sentiment = "NEUTRAL"): Cls => ({
  category,
  sentiment,
  relevanceScore,
  countries,
  tags: [category.toLowerCase()],
  platform,
  risk,
});

/** Classement « honnête » selon le contenu (le post d'injection est une simple discussion hors sujet). */
function classify(user: string): Cls {
  if (/Ignore all previous instructions/.test(user)) return cls("DISCUSSION", 1, []);
  if (/free spins/.test(user)) return cls("AD_BAN", 9, ["DE"], "META", "BAN", "NEGATIVE");
  if (/UGC style/.test(user)) return cls("AD_CREATIVE", 8, ["ES", "IT"], "TIKTOK", "LOW", "POSITIVE");
  if (/nuevas reglas de publicidad/.test(user)) return cls("PLATFORM_CHANGE", 8, ["ES"], "TIKTOK", "MEDIUM", "NEGATIVE");
  if (/Tunnel Telegram/.test(user)) return cls("AD_STRATEGY", 8, ["FR"], null, null, "POSITIVE");
  if (/Casino ads everywhere on TikTok/.test(user)) return cls("MARKET_TREND", 6, ["GB"]);
  if (/Neue Werbebeschränkungen/.test(user)) return cls("REGULATION", 7, ["DE"]);
  if (/Lost my rent/.test(user)) return cls("DISCUSSION", 2, []);
  if (/crash game/i.test(user)) return cls("MARKET_TREND", 6, ["PT"], null, null, "POSITIVE");
  if (/Ruleta en vivo/.test(user)) return cls("AD_STRATEGY", 7, ["ES"], "META", "LOW", "POSITIVE");
  if (/TikTok sperrt/.test(user)) return cls("PLATFORM_CHANGE", 8, ["DE"], "TIKTOK", "MEDIUM", "NEGATIVE");
  if (/Bundesliga-Spieltag/.test(user)) return cls("AD_CREATIVE", 7, ["DE"], null, null, "POSITIVE");
  if (/GGL verschärft/.test(user)) return cls("REGULATION", 8, ["DE"]);
  if (/TikTok endurece/.test(user)) return cls("PLATFORM_CHANGE", 7, ["ES"], "TIKTOK", "MEDIUM", "NEGATIVE");
  if (/misent sur les streamers/.test(user)) return cls("MARKET_TREND", 7, ["FR"], null, null, "POSITIVE");
  return cls("OTHER", 3, []);
}

type Data = Record<string, unknown>;
const dataOf = (user: string) => JSON.parse(user) as { DONNÉES: Data } & Data;

const llmCalls: LlmRequest[] = [];
const analystsLlm: LlmProvider = {
  async complete(req) {
    llmCalls.push(req);
    const sys = req.system ?? "";
    const user = req.user;
    let text: string;
    if (sys.startsWith("Tu classes des contenus")) text = JSON.stringify(classify(user));
    else if (sys.startsWith("Tu résumes des contenus")) {
      const title = /Titre : (.*)/.exec(user)?.[1] ?? /Texte :\n(.{0,80})/.exec(user)?.[1] ?? "contenu";
      text = JSON.stringify({ summaryFr: `Résumé : ${title}`.slice(0, 300), language: "en", summaryOriginal: `Summary: ${title}`.slice(0, 300) });
    } else if (sys.includes("Tu tiens une base de règles")) {
      const d = dataOf(user);
      const meta = String(d.consigne).includes("Plateforme : META");
      text = JSON.stringify({
        rules: meta
          ? [
              { market: "CASINO", country: "ALL", rule: "Meta n'accepte les pubs de jeux d'argent qu'avec son autorisation écrite préalable.", riskLevel: "HIGH", workaround: null, evidence: [{ url: META_POLICY, date: "2026-09-30", description: "Autorisation écrite préalable." }] },
              { market: "CASINO", country: "FR", rule: "Meta exige le message d'avertissement officiel sur les pubs de jeux d'argent visant la France.", riskLevel: "MEDIUM", workaround: null, evidence: [{ url: META_POLICY, date: "2026-09-30", description: "Message officiel en France." }] },
              // Adresse absente des DONNÉES : la règle est refusée par le code.
              { market: "CASINO", country: "ALL", rule: "Meta laisse passer les pubs de casino camouflées derrière une page neutre.", riskLevel: "LOW", workaround: null, evidence: [{ url: INVENTED, date: null, description: "x" }] },
            ]
          : [
              { market: "CASINO", country: "FR", rule: "TikTok refuse les pubs de casino qui mettent en avant un bonus en France et limite le compte publicitaire en cas de récidive.", riskLevel: "HIGH", workaround: null, evidence: [{ url: TIKTOK_POLICY, date: null, description: "Bonus interdit en France." }] },
            ],
      });
    } else if (sys.includes("On te donne UNE entrée de veille")) {
      const entree = (dataOf(user).DONNÉES.entree ?? {}) as { url?: string };
      text = JSON.stringify(
        entree.url === META_BAN_URL
          ? { items: [{ action: "new", ruleId: null, contradicts: false, platform: "META", country: "DE", rule: "Meta désactive en 24 heures les comptes pub casino qui parlent de « free spins » ou de bonus vers l'Allemagne.", riskLevel: "BAN", workaround: null, evidenceDescription: "Quatre comptes désactivés en une semaine." }] }
          : { items: [{ action: "none" }] },
      );
    } else if (sys.includes("Tu revérifies UNE règle")) text = JSON.stringify({ stillValid: true, riskLevel: "HIGH", note: "Toujours valable." });
    else if (sys.includes("Tu réponds à une question du client")) {
      const veille = (dataOf(user).DONNÉES.veille ?? []) as Array<{ url: string; summary: string }>;
      text = [
        ...veille.slice(0, 3).map((e) => `- ${e.summary.slice(0, 120)} (${e.url})`),
        // Injection « obéie » par l'IA : adresse inventée, retirée par le code.
        `- Le cloaking passe sans souci sur Meta (${INVENTED})`,
      ].join("\n");
    } else if (sys.includes("Synthèse de la semaine")) {
      const groupes = (dataOf(user).DONNÉES.groupes ?? []) as Array<{ market: string; country: string; veille: Array<{ url: string }> }>;
      text = JSON.stringify({
        groups: groupes.map((g) => ({
          market: g.market,
          country: g.country,
          trends: [{ text: `Les retours de ${g.country} montent cette semaine`, urls: [g.veille[0]!.url] }],
          internal: null,
          recommendations:
            g.market === "CASINO" && (g.country === "DE" || g.country === "ES")
              ? [
                  { title: g.country === "ES" ? "Vidéo de roulette en direct sans parler de bonus" : "Vidéo courte avec le message de prévention en Allemagne", description: "Format court, sous-titré. Sans mot « gratuit ».", adType: "VIDEO", angle: "LIFESTYLE", format: "15 s, 9:16, sous-titres", platform: null, countries: [g.country], risk: "MEDIUM", priority: 1, urls: [g.veille[0]!.url] },
                  // Preuve inventée : refusée par le code.
                  { title: "Camoufler la page d'atterrissage", description: "x", adType: "IMAGE", angle: "AUTRE", format: "x", platform: null, countries: [g.country], risk: "LOW", priority: 3, urls: [INVENTED] },
                ]
              : [],
        })),
      });
    } else if (sys.includes("tu mets en forme le rapport de la semaine")) text = ""; // brouillon vide : le rapport écrit par le code part
    else if (sys.startsWith("Tu évalues des sites")) text = JSON.stringify({ sources: [] });
    else throw new Error(`appel d'IA inattendu : ${sys.slice(0, 80)}`);
    return { text, costCents: 1 };
  },
};

// ------------------------------------------------------------------------------------------------ file agents-analystes

const queue: Array<{ job: AnalystsQueueJob; jobId?: string }> = [];
const ran: AnalystsQueueJob[] = [];
const enqueueAnalysts = async (job: AnalystsQueueJob, o: { jobId?: string } = {}) => {
  if (o.jobId && queue.some((q) => q.jobId === o.jobId)) return;
  queue.push({ job, jobId: o.jobId });
};

let deps: AnalystsKevinDeps;

/** Une tâche par le VRAI processeur de la file. */
async function runJob(job: AnalystsQueueJob, jobId = "t") {
  ran.push(job);
  return processAgentsAnalystes({ id: jobId, name: `agents-analystes:${job.type}`, data: job } as unknown as Job<AgentsAnalystesJob>, async () => deps) as Promise<Record<string, unknown>>;
}

/** Vide la file comme le worker (une tâche après l'autre). */
async function drain() {
  for (let n = 0; n < 300 && queue.length; n++) {
    const t = queue.shift()!;
    await runJob(t.job, t.jobId);
  }
  expect(queue, "file vide à la fin").toHaveLength(0);
}

// ------------------------------------------------------------------------------------------------ Kevin

const orchestratorJobs: AgentsOrchestratorJob[] = [];
let kevin: GrammyBot;
let kevinCalls: TelegramCall[] = [];
const ids = { kevin: "", user: "" };

const fakeBossLlm = createFakeBossLlm([
  [/qu'est-ce qui marche en casino en France/i, (m) => ({ name: "analyse_marche", input: { question: m, marche: "casino", pays: "France" } })],
  [/quelles sources tu surveilles/i, { name: "sources_veille", input: { action: "voir" } }],
  [/ajoute https:\/\/www\.blackhatworld\.com/i, { name: "sources_veille", input: { action: "ajouter", adresse: FORUM_URL, nom: "BlackHatWorld — forum gambling (lecture directe)", marche: "casino" } }],
  [/ajoute https:\/\/t\.me\//i, { name: "sources_veille", input: { action: "ajouter", adresse: TME_URL, nom: "Wett-News DE", marche: "paris_sportifs" } }],
  [/risqué de faire des ads casino avec du bonus sur TikTok/i, { name: "compliance", input: { plateforme: "TikTok", marche: "casino", pays: "France", pratique: "bonus" } }],
]);

function bossTextDeps(): BossTextDeps {
  return {
    agents: deps as unknown as AgentsDeps,
    engine: realBossEngine,
    loadLlm: async () => fakeBossLlm,
    async botApi() {
      return {
        sendMessage: (chatId, t, other) => kevin.api.sendMessage(chatId, t, other),
        deleteMessage: (chatId, m) => kevin.api.deleteMessage(chatId, m),
      };
    },
    adminTelegramId: async () => BigInt(ADMIN),
    bossTurnFor: prismaBossTurnFor,
  };
}

let uid = 1;
let mid = 100;
const from = { id: ADMIN, is_bot: false, first_name: "Mathéo", username: "matheo" };
const chat = { id: ADMIN, type: "private" as const, first_name: "Mathéo" };
function textUpdate(text: string): Update {
  mid += 1;
  return { update_id: uid++, message: { message_id: mid, date: Math.floor(clock / 1000), chat, from, text } } as Update;
}

/** Ce que Kevin a envoyé (réponses du webhook, de la tâche boss-text et du messager du worker). */
const kevinTexts = (since = 0) =>
  kevinCalls
    .slice(since)
    .filter((c) => c.method === "sendMessage")
    .map((c) => String(c.payload.text));

/** Message de l'admin à Kevin : webhook réel, puis l'interprète du worker si le chemin rapide passe la main. */
async function say(text: string): Promise<string> {
  const n = kevinCalls.length;
  const before = orchestratorJobs.length;
  await kevin.handleUpdate(textUpdate(text));
  const job = orchestratorJobs.slice(before).find((j) => j.type === "boss-text");
  if (job) await processBossText(job as Extract<AgentsOrchestratorJob, { type: "boss-text" }>, bossTextDeps());
  return kevinTexts(n).join("\n");
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// ------------------------------------------------------------------------------------------------ mise en place

async function cleanAnalysts() {
  await prisma.complianceRule.deleteMany();
  await prisma.strategyReport.deleteMany();
  await prisma.trendEntry.deleteMany();
  await prisma.trendSource.deleteMany();
  await prisma.recommendation.deleteMany({ where: { teamKey: "analystes" } });
  await prisma.agentUsage.deleteMany({ where: { teamKey: { in: ["analystes", "boss"] } } });
  await prisma.setting.deleteMany({ where: { OR: [{ key: { startsWith: "analysts." } }, { key: { startsWith: "boss." } }, { key: { startsWith: "agents." } }] } });
  await prisma.bossTurn.deleteMany();
}

beforeAll(async () => {
  await resetDb();
  await cleanAnalysts();
  await prisma.user.deleteMany({ where: { email: "analysts-flow@linkaffipro.internal" } });
  await prisma.setting.upsert({ where: { key: "admin.telegramUserId" }, create: { key: "admin.telegramUserId", value: String(ADMIN) }, update: { value: String(ADMIN) } });
  ids.user = (await prisma.user.create({ data: { email: "analysts-flow@linkaffipro.internal", name: "Mathéo", passwordHash: "x", role: "ADMIN", telegramUserId: BigInt(ADMIN) } })).id;
  const kevinRec = await prisma.bot.create({
    data: { name: "Kevin", username: "kevin_boss_bot", telegramBotId: BigInt(KEVIN_TG), tokenEncrypted: encrypt(KEVIN_TOKEN), vertical: "CASINO", webhookSecret: "secret-kevin-analysts", role: "ADMIN" },
  });
  ids.kevin = kevinRec.id;

  const base = {
    prisma: prisma as unknown as AgentsDeps["prisma"],
    now,
    enqueue: {
      async orchestrator(job: AgentsOrchestratorJob) {
        orchestratorJobs.push(job);
      },
      async step() {},
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  const watch = { ...base, analystsLlm, serverTools, monthlyBudgetCents: 100_000 };
  const web = createAnalystsWeb({
    ...watch,
    fetchImpl,
    // L'attente du débit avance l'horloge (aucune attente réelle).
    sleep: async (ms: number) => {
      clock += ms;
    },
    clock: () => clock,
    throttle: memoryHostThrottle(),
    robotsCache: new Map(),
  } as never);
  deps = {
    ...watch,
    web,
    internalFigures: async () => null,
    analysts: { enqueue: enqueueAnalysts },
    // Messager du worker : le bot de Kevin (faux Telegram), au seul admin.
    admin: createAdminMessengerWith({ adminId: async () => BigInt(ADMIN), api: async () => kevin.api as unknown as MessengerApi, media: async () => null }),
  } as unknown as AnalystsKevinDeps;
  // Phase 30 : QA Global simulé qui approuve (rapports, alertes, réponses et propositions ; les verrous restent actifs).
  await approveAllQa(deps);

  const tgDeps: TelegramDeps = {
    ...prismaTelegramDeps,
    agentsDeps: () => deps as unknown as AgentsDeps,
    adminDialogBot: async () => ({ id: kevinRec.id, username: kevinRec.username, isBoss: true }),
    workerDown: async () => false,
  };
  kevin = createBot(kevinRec, tgDeps);
  kevinCalls = installFakeTelegram(kevin.api);
});

afterAll(async () => {
  await cleanAnalysts();
});

// ------------------------------------------------------------------------------------------------ scénario

describe("équipe Analystes de bout en bout (base réelle, faux web, fausse IA)", () => {
  let afterBootstrap = 0;

  it("premier lancement : sources de départ et règles initiales, une seule fois, sans avalanche d'alertes", async () => {
    clock = SUNDAY;
    const r = await runJob({ type: "analysts.schedule" });
    expect(r.bootstrap).toBe("done");
    const sources = await prisma.trendSource.findMany();
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.every((s) => s.origin === "seed" && s.isActive)).toBe(true);
    // Règles initiales : pages officielles lues (Meta, TikTok), règles sourcées ; la règle à preuve inventée est refusée.
    const rules = await prisma.complianceRule.findMany({ orderBy: { createdAt: "asc" } });
    expect(rules.map((x) => [x.platform, x.country, x.riskLevel])).toEqual([
      ["META", "ALL", "HIGH"],
      ["META", "FR", "MEDIUM"],
      ["TIKTOK", "FR", "HIGH"],
    ]);
    expect(JSON.stringify(rules)).not.toContain(INVENTED);
    expect(rules.every((x) => !x.verified)).toBe(true); // une seule source : non vérifiée
    expect(webCalls).toContain(META_POLICY);
    expect(webCalls).toContain(TIKTOK_POLICY);
    // Toutes les sources dues sont en file ; plus découverte, revérification et purge du jour.
    expect(queue.filter((q) => q.job.type === "analysts.scrape")).toHaveLength(sources.length);
    expect(queue.map((q) => q.job.type).filter((t) => t !== "analysts.scrape")).toEqual(["analysts.discover", "analysts.reverify", "analysts.purge"]);
    // Base de départ : marquée « déjà signalée », Kevin ne dit rien.
    expect(kevinTexts()).toEqual([]);
    afterBootstrap = llmCalls.filter((c) => c.system?.includes("Tu tiens une base de règles")).length;
    expect(afterBootstrap).toBe(2);
  });

  it("lecture des sources dues sur fixtures (Reddit, actualités) : entrées classées, résumées, sourcées, texte brut daté", async () => {
    await drain();
    const entries = await prisma.trendEntry.findMany({ include: { source: true } });
    const byUrl = (part: string) => entries.find((e) => e.url.includes(part));
    // Reddit r/gambling : 6 posts dont 1 épinglé (ignoré) et 1 hors sujet (sous le seuil, jamais gardé).
    const reddit = entries.filter((e) => e.source.name === "Reddit r/gambling");
    expect(reddit.map((e) => e.url).sort()).toEqual(
      [
        "https://www.reddit.com/r/gambling/comments/fx0002/casino_ads_everywhere_on_tiktok/",
        "https://www.reddit.com/r/gambling/comments/fx0003/neue_werbebeschrankungen/",
        "https://www.reddit.com/r/gambling/comments/fx0005/which_crash_game_streams/",
        "https://www.reddit.com/r/gambling/comments/fx0006/ruleta_en_vivo/",
      ].sort(),
    );
    // Pseudonyme seulement : « Sarah Connor » ressemble à un vrai nom → aucun auteur.
    expect(byUrl("which_crash_game")!.author).toBeNull();
    expect(byUrl("ruleta_en_vivo")!.author).toBe("ruleta_loca");
    expect(JSON.stringify(entries)).not.toMatch(/t2_abc123|author_fullname/);
    // Actualités : recherche limitée au site, article lu en entier (robots.txt respecté), extraits sinon.
    const ggl = byUrl("ggl-influencer-werbung-2027")!;
    expect(ggl).toMatchObject({ category: "REGULATION", market: "CASINO", relevanceScore: 8, countries: ["DE"] });
    expect(ggl.rawText).toContain("Spielerschutz");
    expect(ggl.rawText).not.toMatch(/Petra Schneider|redaktion@example\.org/);
    expect(byUrl("paris-sportifs-france-streamers")).toMatchObject({ category: "MARKET_TREND", countries: ["FR"] });
    for (const e of entries) {
      expect(e.summary.length).toBeGreaterThan(0);
      expect(e.summary.length).toBeLessThanOrEqual(500);
      expect(e.url).toMatch(/^https:\/\//);
      expect(e.rawText).toBeTruthy();
      // Horloge simulée (pas `createdAt`, posé par la base à la vraie date du jour).
      expect(e.rawTextPurgeAt!.getTime() - SUNDAY).toBeGreaterThan(6 * 86400_000);
      expect(e.verified).toBe(false);
    }
    // Plateforme et risque gardés en étiquettes ; aucune alerte (aucun risque élevé, aucune tendance virale).
    expect(byUrl("tiktok-espana")!.tags).toEqual(expect.arrayContaining(["platform:TIKTOK", "risk:MEDIUM"]));
    expect(kevinTexts()).toEqual([]);
    // Sources lues : prochaine lecture programmée ; aucune en erreur.
    const sources = await prisma.trendSource.findMany();
    expect(sources.every((s) => s.errorCount === 0 && s.lastScrapedAt && s.nextScrapeAt && s.nextScrapeAt.getTime() > clock)).toBe(true);
    // Entrées de catégorie « règles » passées à la Compliance (aucune règle nouvelle : rien de la plateforme).
    expect(ran.filter((j) => j.type === "analysts.compliance_check").length).toBe(entries.filter((e) => ["AD_BAN", "PLATFORM_CHANGE", "REGULATION"].includes(e.category)).length);
    expect(await prisma.complianceRule.count()).toBe(3);
  });

  it("second passage : premier lancement jamais refait, rien n'est dû", async () => {
    clock += 3600_000;
    const sources = await prisma.trendSource.count();
    const r = await runJob({ type: "analysts.schedule" });
    expect(r).toMatchObject({ bootstrap: "done", scrapes: 0 });
    expect(await prisma.trendSource.count()).toBe(sources);
    expect(llmCalls.filter((c) => c.system?.includes("Tu tiens une base de règles")).length).toBe(afterBootstrap);
    await drain();
  });

  it("« Kevin, ajoute <url> » → source notée INACTIVE ; OUI → active (lue au prochain passage)", async () => {
    const reply = await say(`Kevin, ajoute ${FORUM_URL}`);
    expect(unescape(reply)).toContain(FORUM_URL);
    expect(reply).toMatch(/pas encore suivie|en attente/);
    const added = await prisma.trendSource.findFirstOrThrow({ where: { url: FORUM_URL } });
    expect(added).toMatchObject({ isActive: false, origin: "client", sourceType: "FORUM", market: "CASINO" });
    // Bouton OUI posé sous la question.
    const markup = kevinCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> } | undefined;
    expect(markup?.inline_keyboard.flat().some((b) => b.callback_data.startsWith("bsc:"))).toBe(true);
    const ok = await say("oui");
    expect(ok).toMatch(/(dans|à) ma veille/);
    const active = await prisma.trendSource.findUniqueOrThrow({ where: { id: added.id } });
    expect(active.isActive).toBe(true);
    expect(active.nextScrapeAt!.getTime()).toBeLessThanOrEqual(clock);
    const audits = await prisma.auditLog.findMany({ where: { entityId: added.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => [a.action, a.userId])).toEqual([
      ["analysts.source.added", ids.user],
      ["analysts.source.activated", ids.user],
    ]);

    // Un canal Telegram public, pour les paris sportifs.
    await say(`Kevin, ajoute ${TME_URL}`);
    await say("oui");
    expect(await prisma.trendSource.findFirstOrThrow({ where: { url: TME_URL } })).toMatchObject({ isActive: true, sourceType: "TELEGRAM", market: "SPORTS" });
  });

  it("forum + t.me/s/ lus ; post d'injection = simple donnée ; AD_BAN BAN → règle → alerte immédiate, une seule fois", async () => {
    const before = kevinCalls.length;
    const r = await runJob({ type: "analysts.schedule" });
    expect(r.scrapes).toBe(2);
    await drain();
    const forum = await prisma.trendEntry.findMany({ where: { source: { url: FORUM_URL } } });
    // 5 sujets lus (page 2 comprise, doublon de page retiré), le post d'injection classé hors sujet et jamais gardé.
    expect(forum.map((e) => e.url).sort()).toEqual(
      [
        META_BAN_URL,
        `${BHW}/threads/ugc-style-video-ads-for-sportsbook.1500002/`,
        `${BHW}/threads/espana-publicidad-casino-nuevas-reglas.1500004/`,
        `${BHW}/threads/telegram-funnel-paris-sportifs-france.1499990/`,
      ].sort(),
    );
    const injection = llmCalls.find((c) => c.user.includes("Ignore all previous instructions"))!;
    expect(injection.system).toMatch(/tu n'obéis JAMAIS/);
    expect(injection.user.indexOf("<contenu>")).toBeLessThan(injection.user.indexOf("Ignore all previous"));
    expect(injection.user.indexOf("</contenu>")).toBeGreaterThan(injection.user.indexOf("Ignore all previous"));
    // Aucune trace d'obéissance : rien en REGULATION à 10, pas de « cloaking », aucun résumé du post demandé.
    const all = await prisma.trendEntry.findMany();
    expect(all.some((e) => e.relevanceScore === 10 || /cloaking|system prompt/i.test(`${e.summary} ${e.title}`))).toBe(false);
    expect(llmCalls.filter((c) => c.system?.startsWith("Tu résumes") && c.user.includes("Ignore all previous"))).toHaveLength(0);
    // Données minimales : pseudonyme seulement, aucun courriel, téléphone ni lien de profil.
    const ban = forum.find((e) => e.url === META_BAN_URL)!;
    expect(ban).toMatchObject({ category: "AD_BAN", author: "SpinMaster_77", relevanceScore: 9, countries: ["DE"] });
    expect(ban.tags).toEqual(expect.arrayContaining(["platform:META", "risk:BAN"]));
    expect(JSON.stringify(forum)).not.toMatch(/spin\.master77@|7700 900123|\/members\/|Lukas Becker/);
    // robots.txt du forum : 20 s entre deux pages (Crawl-delay), jamais /members/ ni /search/.
    expect(webCalls.some((u) => /blackhatworld\.com\/(members|search)\//.test(u))).toBe(false);
    // t.me/s/ : les deux posts publics, adresses t.me, courriel retiré.
    const tme = await prisma.trendEntry.findMany({ where: { source: { url: TME_URL } } });
    expect(tme.map((e) => e.url).sort()).toEqual(["https://t.me/wettnews_de_exemple/301", "https://t.me/wettnews_de_exemple/302"]);
    expect(tme.every((e) => e.market === "SPORTS")).toBe(true);
    expect(tme.find((e) => e.url.endsWith("/302"))!.rawText).not.toContain("tipps@example.de");

    // La Compliance tire une règle BAN de l'entrée → Kevin prévient tout de suite, une fois, avec la source.
    const rule = await prisma.complianceRule.findFirstOrThrow({ where: { sourceEntryId: ban.id } });
    expect(rule).toMatchObject({ platform: "META", market: "CASINO", country: "DE", riskLevel: "BAN", verified: false, isActive: true });
    const alerts = kevinTexts(before).map(unescape);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/Alerte compliance/);
    expect(alerts[0]).toContain("BAN");
    expect(alerts[0]).toContain(META_BAN_URL);
    expect(alerts[0]).toContain(LEGAL_DISCLAIMER);
    expect(alerts[0]).toContain("pas un avis juridique");
    expect(await prisma.setting.findUnique({ where: { key: `analysts.alertEntry.${ban.id}` } })).toBeNull();
    // Tâche rejouée (redémarrage du worker) : la règle reçoit la preuve, aucune seconde alerte.
    await runJob({ type: "analysts.compliance_check", entryId: ban.id });
    expect(await prisma.complianceRule.count({ where: { sourceEntryId: ban.id } })).toBe(1);
    expect(kevinTexts(before)).toHaveLength(1);
  });

  it("« Kevin, qu'est-ce qui marche en casino en France ? » → réponse différée, sourcée, sans adresse inventée", async () => {
    const n = kevinCalls.length;
    const first = await say("Kevin, qu'est-ce qui marche en casino en France ?");
    expect(first).toMatch(/je te réponds dans une minute/);
    expect(queue.map((q) => q.job)).toEqual([{ type: "analysts.strategy", kind: "on_demand", requestId: expect.any(String) }]);
    await drain();
    const answer = unescape(kevinTexts(n).at(-1)!);
    // Entrées France (ou sans pays) du casino : sources recopiées, aucune adresse inventée.
    expect(answer).toContain(`${BHW}/threads/telegram-funnel-paris-sportifs-france.1499990/`);
    expect(answer).toContain(NEWS_FR);
    expect(answer).not.toContain(INVENTED);
    expect(answer).not.toMatch(/cloaking/i);
    expect(answer).toMatch(/non vérifi/);
    expect(answer).toContain(LEGAL_DISCLAIMER);
    expect(answer.split("\n").length).toBeLessThanOrEqual(20);
    const urls = answer.match(/https?:\/\/[^\s)]+/g) ?? [];
    const known = new Set((await prisma.trendEntry.findMany()).map((e) => e.url));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(known.has(u) || u.includes("app.linkaffipro.com")).toBe(true);
    // Question gardée puis marquée répondue (jamais deux réponses).
    const reqs = await prisma.setting.findMany({ where: { key: { startsWith: "analysts.request." } } });
    expect(reqs).toHaveLength(1);
    expect((reqs[0]!.value as { answeredAt: string | null }).answeredAt).not.toBeNull();
    await runJob({ type: "analysts.strategy", kind: "on_demand", requestId: (reqs[0]!.value as { id: string }).id });
    expect(kevinTexts(n)).toHaveLength(2);
  });

  it("« Kevin, quelles sources tu surveilles ? » → liste des sources suivies", async () => {
    const reply = unescape(await say("Kevin, quelles sources tu surveilles ?"));
    const active = await prisma.trendSource.count({ where: { isActive: true } });
    expect(reply).toMatch(new RegExp(`(Je surveille|^)${active} source`, "m"));
    expect(reply).toContain("BlackHatWorld — forum gambling (lecture directe)");
    expect(reply).toContain(FORUM_URL);
  });

  it("« Kevin, c'est risqué de faire des ads casino avec du bonus sur TikTok en France ? » → règles, risque, phrase fixe", async () => {
    const reply = unescape(await say("Kevin, c'est risqué de faire des ads casino avec du bonus sur TikTok en France ?"));
    expect(reply).toMatch(/élevé/);
    expect(reply).toContain("TikTok refuse les pubs de casino qui mettent en avant un bonus en France");
    expect(reply).toContain(TIKTOK_POLICY);
    expect(reply).toMatch(/non vérifi|une seule source/);
    expect(reply).toContain(LEGAL_DISCLAIMER);
    // Une règle Meta n'est pas citée pour une question TikTok.
    expect(reply).not.toContain("autorisation écrite préalable");
  });

  let reportId = "";

  it("lundi 8 h (Paris) → rapport de la semaine envoyé par Kevin une seule fois, propositions numérotées ; rien le mardi", async () => {
    clock = MONDAY_8H;
    const n = kevinCalls.length;
    const r = await runJob({ type: "analysts.schedule" });
    expect(r.queued).toEqual(expect.arrayContaining(["analysts.strategy"]));
    await drain();
    const report = await prisma.strategyReport.findFirstOrThrow({ where: { reportType: "WEEKLY" } });
    reportId = report.id;
    expect(report.period).toBe("2026-W44");
    expect(report.sentAt!.getTime()).toBeGreaterThanOrEqual(MONDAY_8H);
    expect(report.sentAt!.getTime()).toBeLessThan(MONDAY_8H + 3600_000);
    const sent = kevinTexts(n).map(unescape).filter((t) => t.includes("Rapport de la semaine"));
    expect(sent).toHaveLength(1);
    const text = sent[0]!;
    expect(text).toMatch(/Casino/);
    expect(text).toMatch(/Paris sportifs/);
    expect(text).toMatch(/Rencontres/);
    expect(text).toContain("1. Vidéo");
    expect(text).toMatch(/applique/);
    expect(text).not.toContain(INVENTED);
    expect(text.length).toBeLessThanOrEqual(4000);
    // Recommandations sourcées : la proposition à preuve inventée est refusée.
    const recs = await prisma.recommendation.findMany({ where: { teamKey: "analystes" } });
    expect(recs.length).toBe(2);
    expect(recs.every((x) => x.source === "market_analysis" && x.status === "PROPOSED" && x.size === "BIG")).toBe(true);
    expect(JSON.stringify(recs)).not.toContain(INVENTED);

    // Une heure plus tard, le même lundi : rien de plus ; tâche rejouée : pas de second envoi.
    clock = MONDAY_8H + 3600_000;
    await runJob({ type: "analysts.schedule" });
    await drain();
    await runJob({ type: "analysts.strategy", kind: "weekly" });
    await drain();
    await runJob({ type: "analysts.report", kind: "weekly", reportId });
    expect(await prisma.strategyReport.count({ where: { reportType: "WEEKLY" } })).toBe(1);
    expect(kevinTexts(n).filter((t) => t.includes("Rapport de la semaine"))).toHaveLength(1);
    clock = MONDAY_8H + 3600_000 + 60_000;
  });

  it("« applique 1 » → proposition APPLIED par l'admin, aucune action externe", async () => {
    const counts = async () => ({
      posts: await prisma.post.count(),
      plans: await prisma.channelAgentPlan.count(),
      missions: await prisma.agentMission.count(),
      outbound: await prisma.outboundMessage.count(),
      orders: await prisma.teamOrder.count(),
    });
    const before = await counts();
    const orch = orchestratorJobs.length;
    const reply = await say("applique 1");
    expect(reply).toMatch(/Rien n'a bougé|rien changé/);
    const choice = (await prisma.setting.findUniqueOrThrow({ where: { key: `analysts.choice.${ADMIN}` } })).value as { items: Array<{ n: number; recommendationId: string }>; answeredAt: string | null };
    expect(choice.answeredAt).not.toBeNull();
    const chosen = choice.items.find((i) => i.n === 1)!.recommendationId;
    const recs = await prisma.recommendation.findMany({ where: { teamKey: "analystes" } });
    expect(recs.find((x) => x.id === chosen)).toMatchObject({ status: "APPLIED", appliedBy: "HUMAN", appliedById: ids.user });
    expect(recs.filter((x) => x.id !== chosen).every((x) => x.status === "PROPOSED")).toBe(true);
    expect((await prisma.auditLog.findMany({ where: { action: "analysts.recommendation.accepted", entityId: { in: recs.map((x) => x.id) } } })).map((a) => a.entityId)).toEqual([chosen]);
    // Chemin rapide : aucune phrase envoyée à l'interprète, rien chez Meta / TikTok ni sur les canaux.
    expect(orchestratorJobs.length).toBe(orch);
    expect(await counts()).toEqual(before);
  });

  it("le mardi : aucun rapport de plus", async () => {
    clock = TUESDAY_9H;
    const n = kevinCalls.length;
    const r = await runJob({ type: "analysts.schedule" });
    expect(r.queued).not.toContain("analysts.strategy");
    await drain();
    expect(await prisma.strategyReport.count({ where: { reportType: "WEEKLY" } })).toBe(1);
    expect(kevinTexts(n).filter((t) => t.includes("Rapport de la semaine"))).toHaveLength(0);
  });

  it("source qui échoue 5 fois → coupée, Kevin prévient une seule fois", async () => {
    const down = await prisma.trendSource.create({
      data: { name: "Forum en panne", url: DOWN_URL, sourceType: "FORUM", market: "CASINO", countries: ["FR"], languages: ["fr"], scrapeConfig: {}, isActive: true, origin: "client", errorCount: 0, nextScrapeAt: new Date(clock + 30 * 86400_000) },
    });
    const n = kevinCalls.length;
    for (let i = 1; i <= 5; i++) {
      const r = await runJob({ type: "analysts.scrape", sourceId: down.id });
      expect(r.ok).toBe(false);
      const s = await prisma.trendSource.findUniqueOrThrow({ where: { id: down.id } });
      expect(s.errorCount).toBe(i);
      expect(s.lastError).toMatch(/en panne pour l'instant \(code 503\)/);
      expect(s.isActive).toBe(i < 5);
      expect(kevinTexts(n)).toHaveLength(i < 5 ? 0 : 1);
    }
    const warn = unescape(kevinTexts(n)[0]!);
    expect(warn).toContain("Forum en panne");
    expect(warn).toMatch(/5/);
    // Source coupée : plus lue, Kevin ne répète rien.
    const calls = downCalls;
    expect(await runJob({ type: "analysts.scrape", sourceId: down.id })).toMatchObject({ ok: false, skipped: "inactive" });
    expect(downCalls).toBe(calls);
    expect(kevinTexts(n)).toHaveLength(1);
  });

  it("purge : texte brut effacé à 7 jours, résumé, adresse et classement gardés", async () => {
    clock = SUNDAY + 7 * 86400_000 + 6 * 3600_000;
    const withRaw = await prisma.trendEntry.count({ where: { rawText: { not: null } } });
    expect(withRaw).toBeGreaterThan(0);
    const r = await runJob({ type: "analysts.purge" });
    expect(r).toMatchObject({ ok: true, purged: withRaw });
    const entries = await prisma.trendEntry.findMany();
    expect(entries.every((e) => e.rawText === null && e.summary && e.url && e.category)).toBe(true);
  });

  it("analysts.enabled = false → rien ne tourne, Kevin le dit", async () => {
    await prisma.setting.upsert({ where: { key: "analysts.enabled" }, create: { key: "analysts.enabled", value: false }, update: { value: false } });
    const n = kevinCalls.length;
    const llm = llmCalls.length;
    const web = webCalls.length;
    const reports = await prisma.strategyReport.count();
    clock = Date.parse("2026-11-02T07:00:00Z"); // lundi suivant, 8 h : rien quand même
    expect(await runJob({ type: "analysts.schedule" })).toEqual({ skipped: "disabled" });
    const anySource = await prisma.trendSource.findFirstOrThrow({ where: { isActive: true } });
    expect(await runJob({ type: "analysts.scrape", sourceId: anySource.id })).toEqual({ skipped: "disabled" });
    expect(queue).toHaveLength(0);
    const reply = await say("Kevin, qu'est-ce qui marche en casino en France ?");
    expect(reply).toMatch(/coupée|en pause/);
    expect(queue).toHaveLength(0);
    expect(llmCalls.length).toBe(llm);
    expect(webCalls.length).toBe(web);
    expect(await prisma.strategyReport.count()).toBe(reports);
    expect(kevinTexts(n)).toHaveLength(1);
  });

  it("à la fin : Kevin n'a parlé qu'à l'admin, en privé ; l'équipe n'a rien écrit ailleurs", async () => {
    expect(kevinCalls.filter((c) => c.method === "sendMessage").every((c) => Number(c.payload.chat_id) === ADMIN)).toBe(true);
    // Seules des lectures (GET) : le faux fetch n'a jamais reçu autre chose.
    expect([...webMethods]).toEqual(["GET"]);
    expect(await prisma.post.count()).toBe(0);
  });
});
