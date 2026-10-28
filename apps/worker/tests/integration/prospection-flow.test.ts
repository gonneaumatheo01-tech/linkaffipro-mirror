/**
 * Phase 31 — équipe Prospection de bout en bout, sur base réelle (`linkaffipro_test`), sans réseau :
 * - la VRAIE file `agents-prospection` (`processAgentsProspection` → `runProspectionJob`) tourne en processus, avec une
 *   file simulée (identifiant de tâche unique tant qu'elle attend, délai respecté sur l'horloge simulée) ;
 * - web : faux `ProspectionWeb` des fixtures (`fixtureWeb` : pages `t.me/<nom>`, aperçus `t.me/s/<nom>`, pages liées)
 *   complété par les annuaires et la page de blog des fixtures, recherche web simulée ; l'attente du débit avance
 *   l'horloge (aucune attente réelle) ;
 * - IA : fausse IA de l'Enrichisseur (`fakeProspectionLlm`, réponses `fixtures/prospection/ai/`) et faux Opus pour les
 *   dossiers ; QA Global simulé (`approveAllQa`), puis en panne ;
 * - Kevin (bot `role ADMIN`) reçoit les updates simulées par SES vrais handlers grammY (`createBot` + `handleUpdate` :
 *   boutons `prospect:<id>:<action>`, chemin rapide du montant) ; les phrases libres passent par la vraie tâche
 *   `boss-text` (`processBossText`, interprète réel, fausse IA de Kevin `createFakeBossLlm`).
 *
 * Scénario : découverte (annuaire + recherche + graphe, doublons comptés) → lecture et note des canaux des fixtures
 * (A / B / C qualifiés ; LatAm, Brésil, robot, repost, mort, faible audience écartés avec la bonne raison ; page
 * introuvable et invitation privée illisibles) → dossiers Opus des A → Top du jour à 9 h (Paris) avec boutons, QA
 * appelé → ✅ Contacté → « @x a signé » → 🤝 → CPA → 100 → SIGNED avec `dealTerms` → 6 jours plus tard : rappel → rapport
 * du lundi → « cherche des canaux casino en Pologne » → lots dédiés → QA en panne : rien n'est envoyé, Kevin le dit →
 * aucun texte de post en base.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import type { Update } from "grammy/types";
import type { Bot as GrammyBot } from "grammy";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  copiesPostText,
  createFakeBossLlm,
  createFakeQaLlm,
  memoryHostThrottle,
  readProspectPosts,
  PROSPECTION_MODELS,
  type AgentsDeps,
  type AgentsOrchestratorJob,
  type LlmProvider,
  type ProspectionKevinDeps,
  type ProspectionQueueJob,
  type ProspectPost,
} from "@linkaffipro/agents";
import { createAdminMessengerWith, createBot, prismaTelegramDeps, realBossEngine, type MessengerApi, type TelegramDeps } from "@linkaffipro/telegram";
import type { AgentsProspectionJob } from "@linkaffipro/queue";
import { processAgentsProspection } from "../../src/processors/agents-prospection";
import { prismaBossTurnFor, processBossText, type BossTextDeps } from "../../src/agents/boss-text";
import { approveAllQa, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";
import { ENRICH_FIXTURE_CHANNELS, ENRICH_FIXTURE_NOW, fakeProspectionLlm, fixtureWeb } from "../../../../packages/agents/src/prospection/enrich/testing";
import { readProspectionFixture } from "../../../../packages/agents/src/prospection/discover/testing";

const ADMIN = 79_331;
const KEVIN_TG = 5571;
const KEVIN_TOKEN = `${KEVIN_TG}:KEVIN-TOKEN-${"p".repeat(30)}`;

/** Lundi 26 octobre 2026, 10 h à Paris : date de référence des fixtures (âge des posts). */
const MONDAY_26 = ENRICH_FIXTURE_NOW.getTime();
/** Mardi 27 octobre, 9 h à Paris (Top du jour). */
const TUESDAY_9H = Date.parse("2026-10-27T08:00:00Z");
/** Mercredi 28 octobre, 15 h à Paris. */
const WEDNESDAY = Date.parse("2026-10-28T14:00:00Z");
/** Lundi 2 novembre, 9 h puis 9 h 05 à Paris (rapport, Top, rappels). */
const MONDAY_9H = Date.parse("2026-11-02T08:00:00Z");
const MONDAY_9H05 = Date.parse("2026-11-02T08:05:00Z");
/** Mardi 3 novembre, 9 h 01 à Paris. */
const TUESDAY_NOV_3 = Date.parse("2026-11-03T08:01:00Z");

// ------------------------------------------------------------------------------------------------ horloge

let clock = MONDAY_26;
const now = () => new Date(clock);

// ------------------------------------------------------------------------------------------------ faux web

const fetched: Array<{ url: string; at: number }> = [];
const searches: string[] = [];
const no = { status: 404, body: "" };
const base = fixtureWeb({
  // Annuaires (lot casino, français) et page de blog trouvée par la recherche.
  "https://tgstat.com/gambling": { body: readProspectionFixture("directories/tgstat-gambling.html") },
  "https://telega.io/catalog?category=gambling&language=fr": { body: readProspectionFixture("directories/telega-catalog.html") },
  "https://www.exemple-pronos.fr/meilleurs-canaux-telegram": { body: readProspectionFixture("linked/blog-best-channels.html") },
  "https://linktr.ee/tipsterlucas": { body: readProspectionFixture("linked/linktree-tipster.html") },
  "https://interdit.exemple.com/robots.txt": { body: readProspectionFixture("directories/robots-deny-all.txt") },
  "https://www.exemple-pronos.fr/robots.txt": no,
});
const searchResults = (JSON.parse(readProspectionFixture("search/web-fr-sports.json")) as { results: Array<{ url: string; title: string; snippet: string }> }).results;
/** Recherche « site:t.me » : les canaux des fixtures (un en double sous une autre forme d'adresse). */
const tmeResults = [
  ...ENRICH_FIXTURE_CHANNELS.map((n) => ({ url: `https://t.me/${n}`, title: `${n} – Telegram`, snippet: "" })),
  { url: "https://t.me/s/Pronos_Maxime", title: "Pronos Maxime", snippet: "" },
];
let servedWeb = false;
/** La recherche garde 8 résultats par requête : les canaux sont servis par paquets de 8, une requête « site:t.me » après l'autre. */
let tmeChunk = 0;
const web = {
  ...base,
  async fetchText(url: string, opts?: { timeoutMs?: number }) {
    fetched.push({ url, at: clock });
    return base.fetchText(url, opts);
  },
  async search(req: { query: string }) {
    searches.push(req.query);
    if (req.query.endsWith(" telegram") && !servedWeb) {
      servedWeb = true;
      return searchResults;
    }
    if (req.query.endsWith(" site:t.me") && tmeChunk * 8 < tmeResults.length) {
      tmeChunk++;
      return tmeResults.slice((tmeChunk - 1) * 8, tmeChunk * 8);
    }
    return [];
  },
};

// ------------------------------------------------------------------------------------------------ fausse IA

const enrichLlm = fakeProspectionLlm();
const opusCalls: string[] = [];
let enrichAnswered = 0;
/** Faux Opus des dossiers : lignes sans chiffre (aucun chiffre hors des données), ton de Kevin. */
const prospectionLlm: LlmProvider = {
  async complete(req) {
    if (req.model === PROSPECTION_MODELS.dossier) {
      opusCalls.push(req.user);
      return {
        text: ["Canal suivi de près, audience réelle et régulière.", "Contact public trouvé, à joindre en premier.", "Pourquoi maintenant : il colle à notre thème et à notre pays."].join("\n"),
        costCents: 30,
      };
    }
    // Clé absente des fixtures → exception (l'Enrichisseur s'en passe, ex. langue déjà sûre) : rien n'est compté.
    const res = await enrichLlm.complete(req);
    enrichAnswered++;
    return res;
  },
};

// ------------------------------------------------------------------------------------------------ file agents-prospection

type Queued = { job: ProspectionQueueJob; jobId?: string; due: number };
const queue: Queued[] = [];
const ran: ProspectionQueueJob[] = [];
const enqueueProspection = async (job: ProspectionQueueJob, o: { jobId?: string; delayMs?: number; priority?: number } = {}) => {
  if (o.jobId && queue.some((q) => q.jobId === o.jobId)) return;
  queue.push({ job, jobId: o.jobId, due: clock + (o.delayMs ?? 0) });
};

let deps: ProspectionKevinDeps;

async function runJob(job: ProspectionQueueJob, jobId = "t") {
  ran.push(job);
  return processAgentsProspection({ id: jobId, name: `agents-prospection:${job.type}`, data: job } as unknown as Job<AgentsProspectionJob>, async () => deps) as Promise<Record<string, unknown>>;
}

/** Vide la file comme le worker : les tâches dues, une après l'autre (les tâches différées restent). */
async function drain() {
  for (let n = 0; n < 2000; n++) {
    const i = queue.findIndex((q) => q.due <= clock);
    if (i < 0) return;
    const [t] = queue.splice(i, 1);
    await runJob(t!.job, t!.jobId);
  }
  throw new Error("file sans fin");
}

// ------------------------------------------------------------------------------------------------ Kevin

const orchestratorJobs: AgentsOrchestratorJob[] = [];
let kevin: GrammyBot;
let kevinCalls: TelegramCall[] = [];
const ids = { kevin: "", user: "" };

const fakeBossLlm = createFakeBossLlm([
  [/@slots_kaiser a signé/i, { name: "prospect_statut", input: { canal: "@slots_kaiser", statut: "signe" } }],
  [/cherche des canaux casino en Pologne/i, { name: "prospection_cherche", input: { pays: "Pologne", verticale: "casino" } }],
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
function callbackUpdate(data: string): Update {
  return { update_id: uid++, callback_query: { id: `cq${uid}`, from, chat_instance: "ci", data, message: { message_id: 999, date: Math.floor(clock / 1000), chat, text: "…" } } } as Update;
}

const sent = (since = 0) => kevinCalls.slice(since).filter((c) => c.method === "sendMessage");
const kevinTexts = (since = 0) => sent(since).map((c) => unescape(String(c.payload.text)));
const buttonsOf = (c: TelegramCall) => ((c.payload.reply_markup as { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | undefined)?.inline_keyboard ?? []).flat();
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Message de l'admin à Kevin : webhook réel, puis l'interprète du worker si le chemin rapide passe la main. */
async function say(text: string): Promise<string> {
  const n = kevinCalls.length;
  const before = orchestratorJobs.length;
  await kevin.handleUpdate(textUpdate(text));
  const job = orchestratorJobs.slice(before).find((j) => j.type === "boss-text");
  if (job) await processBossText(job as Extract<AgentsOrchestratorJob, { type: "boss-text" }>, bossTextDeps());
  return kevinTexts(n).join("\n");
}

/** Bouton appuyé sous un message de Kevin : petit message au doigt + réponse éventuelle. */
async function press(data: string): Promise<{ toast: string; reply: string }> {
  const n = kevinCalls.length;
  await kevin.handleUpdate(callbackUpdate(data));
  const toast = kevinCalls.slice(n).find((c) => c.method === "answerCallbackQuery")?.payload.text;
  return { toast: unescape(String(toast ?? "")), reply: kevinTexts(n).join("\n") };
}

const prospectBy = (username: string) => prisma.prospect.findUniqueOrThrow({ where: { username } });

// ------------------------------------------------------------------------------------------------ mise en place

async function cleanProspection() {
  await prisma.prospectEvent.deleteMany();
  await prisma.prospectContact.deleteMany();
  await prisma.prospectNote.deleteMany();
  await prisma.prospect.deleteMany();
  await prisma.prospectSourceRun.deleteMany();
  await prisma.affiliateOffer.deleteMany();
  await prisma.agentUsage.deleteMany({ where: { teamKey: { in: ["prospection", "boss"] } } });
  await prisma.setting.deleteMany({ where: { OR: [{ key: { startsWith: "prospection." } }, { key: { startsWith: "boss." } }, { key: { startsWith: "agents." } }] } });
  await prisma.bossTurn.deleteMany();
}

let qaLlm: Awaited<ReturnType<typeof approveAllQa>>;

beforeAll(async () => {
  await resetDb();
  await cleanProspection();
  await prisma.user.deleteMany({ where: { email: "prospection-flow@linkaffipro.internal" } });
  await prisma.setting.upsert({ where: { key: "admin.telegramUserId" }, create: { key: "admin.telegramUserId", value: String(ADMIN) }, update: { value: String(ADMIN) } });
  ids.user = (await prisma.user.create({ data: { email: "prospection-flow@linkaffipro.internal", name: "Mathéo", passwordHash: "x", role: "ADMIN", telegramUserId: BigInt(ADMIN) } })).id;
  const kevinRec = await prisma.bot.create({
    data: { name: "Kevin", username: "kevin_prospection_bot", telegramBotId: BigInt(KEVIN_TG), tokenEncrypted: encrypt(KEVIN_TOKEN), vertical: "CASINO", webhookSecret: "secret-kevin-prospection", role: "ADMIN" },
  });
  ids.kevin = kevinRec.id;
  // Une offre déjà saisie : pas de questions des offres au premier passage.
  await prisma.affiliateOffer.create({ data: { brand: "Winamax", vertical: "SPORTS", countries: ["FR", "BE"], dealTypes: { cpa: 100 }, isActive: true } });

  deps = {
    prisma: prisma as unknown as AgentsDeps["prisma"],
    now,
    enqueue: {
      async orchestrator(job: AgentsOrchestratorJob) {
        orchestratorJobs.push(job);
      },
      async step() {},
    },
    logger: { info() {}, warn() {}, error() {} },
    web,
    clock: () => clock,
    // L'attente du débit avance l'horloge (aucune attente réelle).
    sleep: async (ms: number) => {
      clock += ms;
    },
    throttle: memoryHostThrottle(),
    robotsCache: new Map(),
    prospectionLlm,
    prospection: { enqueue: enqueueProspection },
    admin: createAdminMessengerWith({ adminId: async () => BigInt(ADMIN), api: async () => kevin.api as unknown as MessengerApi, media: async () => null }),
  } as unknown as ProspectionKevinDeps;
  qaLlm = await approveAllQa(deps);

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
  await cleanProspection();
});

// ------------------------------------------------------------------------------------------------ scénario

describe("équipe Prospection de bout en bout (base réelle, faux web, fausse IA)", () => {
  it("découverte : annuaire + recherche (doublons comptés), rien d'autre que des lectures", async () => {
    clock = MONDAY_26;
    const dir = (await runJob({ type: "prospection.discover", lot: { source: "directories", languages: ["fr"], vertical: "CASINO" } })).discovered as Record<string, unknown>;
    const srch = (await runJob({ type: "prospection.discover", lot: { source: "web_search", languages: ["fr"], vertical: "SPORTS" } })).discovered as Record<string, unknown>;
    // Annuaire : TGStat + Telega (fixtures), les autres annuaires absents ; le robot de casino n'est pas un candidat.
    expect(dir).toMatchObject({ found: 4, newCount: 4, duplicates: 0, paused: false });
    expect(dir.errors).toEqual(expect.arrayContaining([expect.stringMatching(/Telemetr : page absente/)]));
    // Recherche : 8 requêtes (2 gabarits × 4 formes), 8 résultats gardés par requête ; doublons : @pronos_du_coin (déjà
    // trouvé par l'annuaire), @petit_prono_fr (blog + t.me) et t.me/s/Pronos_Maxime (même canal que t.me/pronos_maxime).
    expect(searches).toHaveLength(8);
    expect(srch).toMatchObject({ found: 22, newCount: 19, duplicates: 3, paused: false });
    expect(srch.errors).toEqual([expect.stringMatching(/robots\.txt/)]);
    const runs = await prisma.prospectSourceRun.findMany({ orderBy: { started: "asc" } });
    expect(runs.map((r) => [r.sourceType, r.found, r.newCount, r.duplicates])).toEqual([
      ["DIRECTORY", 4, 4, 0],
      ["WEB_SEARCH", 22, 19, 3],
    ]);
    const all = await prisma.prospect.findMany();
    expect(all).toHaveLength(23);
    expect(all.filter((p) => p.sourceType === "DIRECTORY").map((p) => p.username).sort()).toEqual(["apuestas_pro_es", "bonus_casino_fr", "pronos_du_coin", "slots_royale_it"]);
    for (const n of ENRICH_FIXTURE_CHANNELS) expect(all.find((p) => p.username === n), n).toMatchObject({ sourceType: "WEB_SEARCH", status: "DISCOVERED" });
    // Lien d'invitation privé : jamais ouvert, illisible d'office.
    expect(all.find((p) => p.username === null)).toMatchObject({ status: "UNREADABLE" });
    // Chaque nouveau canal est mis en lecture (sauf l'invitation privée).
    expect(queue.filter((q) => q.job.type === "prospection.enrich")).toHaveLength(22);
    // Les pages t.me ne sont pas lues par la découverte ; la page interdite par robots.txt non plus.
    expect(fetched.some((f) => /^https:\/\/t\.me\//.test(f.url))).toBe(false);
    expect(fetched.map((f) => f.url)).not.toContain("https://interdit.exemple.com/prive/liste");
  });

  it("lecture et note : A / B / C qualifiés, écartés avec la bonne raison, illisibles ; graphe ; dossiers Opus", async () => {
    await drain();
    expect(queue).toHaveLength(0);
    const by = new Map((await prisma.prospect.findMany()).map((p) => [p.username, p]));
    const row = (n: string) => by.get(n)!;

    // Qualifiés.
    expect(row("pronos_maxime")).toMatchObject({ status: "QUALIFIED", tier: "A", region: "EU", vertical: "SPORTS", authenticity: "REAL", bestContact: "@maxime_pub" });
    expect(row("pronos_maxime").countries).toEqual(expect.arrayContaining(["FR"]));
    for (const n of ["apostas_portugal", "calcio_vip_club", "slots_kaiser"]) expect(row(n), n).toMatchObject({ status: "QUALIFIED", tier: "B", region: "EU" });
    expect(row("slots_kaiser")).toMatchObject({ vertical: "CASINO", bestContact: "@kaiser_werbung" });
    expect(row("multi_bets_world")).toMatchObject({ status: "QUALIFIED", tier: "C", region: "UNKNOWN" });
    expect(row("no_preview_bets")).toMatchObject({ status: "QUALIFIED", tier: "C", region: "EU", bestContact: "contact@nopreview-bets.fr" });
    expect(row("no_preview_bets").tierReason).toMatch(/aperçu fermé/);
    for (const n of ["pronos_maxime", "apostas_portugal", "calcio_vip_club", "slots_kaiser", "multi_bets_world", "no_preview_bets"]) {
      const p = row(n);
      expect(p.score!, n).toBeGreaterThan(0);
      expect(p.scoreBreakdown, n).toBeTruthy();
      expect(p.tierReason, n).toBeTruthy();
    }

    // Écartés (niveau D), avec la raison.
    const out: Record<string, RegExp> = {
      apuestas_mx_pro: /^hors Europe : MX/,
      palpites_brasil: /^hors Europe : BR/,
      bot_odds_feed: /faux canal \(contenu de robot\)/,
      repost_tips_all: /ne fait que transférer : 100 % de posts transférés/,
      dead_pronos_2025: /abandonné : aucun post depuis 40 jours/,
      petit_prono_fr: /audience trop faible/,
      fixed_matches_100: /vend des matchs truqués/,
      groupe_paris_fr: /aperçu fermé/,
    };
    for (const [n, reason] of Object.entries(out)) {
      expect(row(n), n).toMatchObject({ status: "DISQUALIFIED", tier: "D" });
      expect(row(n).tierReason, n).toMatch(reason);
    }
    expect(row("apuestas_mx_pro").region).toBe("NON_EU");
    expect(row("palpites_brasil").region).toBe("NON_EU");
    expect(row("bot_odds_feed").authenticity).toBe("SUSPECT_BOT");
    expect(row("repost_tips_all").authenticity).toBe("REPOST");
    expect(row("fixed_matches_100").riskFlags).toEqual(expect.arrayContaining(["SCAM_FIXED_MATCHES"]));
    // Hors Europe : aucune lecture IA (coût).
    expect(enrichLlm.calls.some((c) => /apuestas_mx_pro|palpites_brasil/.test(c.user))).toBe(false);

    // Illisibles : page introuvable de Telegram, canaux sans page publique (annuaire, blog, graphe), invitation privée.
    expect(row("canal_introuvable")).toMatchObject({ status: "UNREADABLE", enrichError: "Aucun canal public à ce nom." });
    const unreadable = [...by.values()].filter((p) => p.status === "UNREADABLE");
    expect(unreadable.every((p) => p.tier === null && p.score === null)).toBe(true);
    expect([...by.values()].filter((p) => p.status === "ENRICH_FAILED")).toEqual([]);

    // Graphe : mentions et transferts des canaux lus → nouveaux candidats ; jamais depuis un faux, un repost ou un scam.
    const graph = [...by.values()].filter((p) => p.sourceType.startsWith("GRAPH_"));
    expect(graph.map((p) => p.username).sort()).toEqual(["apostaspt_pub", "kaiser_werbung", "lequipe_paris", "maxime_chat", "maxime_pub", "tennis_pronos_fr"]);
    expect(row("maxime_pub")).toMatchObject({ sourceType: "GRAPH_MENTION", discoveredFromId: row("pronos_maxime").id, graphDepth: 1 });
    expect(row("lequipe_paris").sourceType).toBe("GRAPH_FORWARD");
    const excluded = new Set(["bot_odds_feed", "repost_tips_all", "fixed_matches_100", "apuestas_mx_pro", "palpites_brasil"].map((n) => row(n).id));
    expect(graph.some((p) => excluded.has(p.discoveredFromId ?? ""))).toBe(false);
    const runs = await prisma.prospectSourceRun.findMany({ where: { sourceType: "GRAPH" } });
    expect(runs.reduce((s, r) => s + r.newCount, 0)).toBe(6);

    // Dossiers : le A et le B le mieux noté (moitié haute de la plage B), par Opus, contrôlés par le QA.
    const withDossier = [...by.values()].filter((p) => p.dossier).map((p) => p.username).sort();
    expect(withDossier).toEqual(["apostas_portugal", "pronos_maxime"]);
    expect(opusCalls).toHaveLength(2);
    expect(row("pronos_maxime").dossier).toMatch(/Pourquoi maintenant/);
    const dossierChecks = await prisma.qaCheck.findMany({ where: { contentId: { startsWith: "prospect-dossier:" } } });
    expect(dossierChecks.map((c) => c.verdict)).toEqual(["APPROVED", "APPROVED"]);
    expect(await prisma.agentUsage.findFirst({ where: { teamKey: "prospection", provider: "llm" } })).toMatchObject({
      // Dépense de l'équipe : lectures Sonnet / Haiku de l'Enrichisseur (2 centimes) + 2 dossiers Opus (30 centimes).
      cents: 2 * enrichAnswered + 60,
      calls: enrichAnswered + 2,
    });

    // Aucune invitation privée suivie, aucun dossier t.me/addlist rejoint, rien envoyé à personne.
    expect(fetched.some((f) => /t\.me\/(\+|joinchat)/.test(f.url))).toBe(false);
    expect(sent()).toEqual([]);
  });

  let topCards: TelegramCall[] = [];

  it("Top du jour à 9 h (Paris) : en-tête puis une carte par canal avec ses boutons ; QA appelé", async () => {
    clock = Date.parse("2026-10-27T07:50:00Z");
    expect((await runJob({ type: "prospection.schedule" })).queued).toEqual([]);
    clock = TUESDAY_9H;
    const n = kevinCalls.length;
    const qa = qaLlm.calls.length;
    const r = await runJob({ type: "prospection.schedule" });
    expect(r.queued).toEqual(["daily-top"]);
    await drain();
    const texts = kevinTexts(n);
    expect(texts[0]).toMatch(/5 canaux — 1 A, 3 B, 1 C/);
    topCards = sent(n).filter((c) => buttonsOf(c).length);
    expect(topCards).toHaveLength(5);
    // Ordre (phase 32, `tier_then_value` par défaut) : niveau puis valeur estimée, le score ensuite (@slots_kaiser, casino
    // allemand, n'a pas de valeur avec l'offre Winamax) ; le C sans pays (région inconnue), les écartés et le scam ne sont
    // jamais présentés.
    const order = topCards.map((c) => /@(\w+)<\/a>/.exec(String(c.payload.text))?.[1]);
    expect(order).toEqual(["pronos_maxime", "apostas_portugal", "calcio_vip_club", "slots_kaiser", "no_preview_bets"]);
    const maxime = await prospectBy("pronos_maxime");
    expect(buttonsOf(topCards[0]!).map((b) => b.callback_data)).toEqual(["contacted", "signed", "dossier", "later", "no"].map((a) => `prospect:${maxime.id}:${a}`));
    expect(texts.join("\n")).toContain("Contact : contact@nopreview-bets.fr");
    // QA Global : la liste entière vérifiée une fois, approuvée ; l'e-mail de contact public est masqué dans la copie.
    expect(qaLlm.calls.length - qa).toBe(1);
    const check = await prisma.qaCheck.findFirstOrThrow({ where: { contentId: "prospection-top:2026-10-27:morning:5" } });
    expect(check.verdict).toBe("APPROVED");
    expect(JSON.stringify(check.content)).not.toContain("nopreview-bets.fr");
    // Présentés, une seule fois par jour.
    const presented = await prisma.prospect.findMany({ where: { presentedAt: { not: null } } });
    expect(presented).toHaveLength(5);
    expect(await prisma.prospectEvent.count({ where: { type: "PRESENTED" } })).toBe(5);
    const again = await runJob({ type: "prospection.daily-top" });
    expect(again).toEqual({ skipped: "déjà envoyé" });
  });

  it("✅ Contacté → CONTACTED ; ⏰ Plus tard → remontré dans 7 jours", async () => {
    const maxime = await prospectBy("pronos_maxime");
    const r = await press(`prospect:${maxime.id}:contacted`);
    expect(r.toast).toMatch(/@pronos_maxime/);
    expect(r.toast).toMatch(/contacté/);
    expect(await prospectBy("pronos_maxime")).toMatchObject({ status: "CONTACTED", contactedAt: new Date(TUESDAY_9H) });
    const calcio = await prospectBy("calcio_vip_club");
    expect((await press(`prospect:${calcio.id}:later`)).toast).toMatch(/7 jours/);
    expect((await prospectBy("calcio_vip_club")).snoozedUntil).toEqual(new Date(TUESDAY_9H + 7 * 86400_000));
  });

  it("« @x a signé » → 🤝 → CPA → « 100 » → SIGNED avec dealTerms", async () => {
    clock = WEDNESDAY;
    const kaiser = await prospectBy("slots_kaiser");
    expect(await say("Kevin, @slots_kaiser a signé")).toMatch(/@slots_kaiser est maintenant signé/);
    expect(await prospectBy("slots_kaiser")).toMatchObject({ status: "SIGNED", dealTerms: null });
    const ask = await press(`prospect:${kaiser.id}:signed`);
    expect(ask.reply).toMatch(/quel type de deal/);
    const dealButtons = buttonsOf(sent().at(-1)!).map((b) => b.callback_data);
    expect(dealButtons).toEqual(["deal_cpa", "deal_revshare", "deal_hybrid"].map((a) => `prospect:${kaiser.id}:${a}`));
    expect((await press(dealButtons[0]!)).reply).toMatch(/Quelle CPA pour @slots_kaiser|Combien par joueur pour @slots_kaiser/);
    // « 100 » : chemin rapide de Kevin (aucune IA), avant toute autre lecture du message.
    const orch = orchestratorJobs.length;
    expect(await say("100")).toMatch(/@slots_kaiser signé en CPA 100\s€/);
    expect(orchestratorJobs.length).toBe(orch);
    expect(await prospectBy("slots_kaiser")).toMatchObject({ status: "SIGNED", dealType: "CPA", dealTerms: { cpa: 100, currency: "EUR" }, signedAt: new Date(WEDNESDAY) });
    expect(await prisma.setting.count({ where: { key: { startsWith: "prospection.pending_deal." } } })).toBe(0);
  });

  it("lundi 9 h : rapport de la semaine (avant le Top), 9 h 05 : rappel du canal contacté il y a 6 jours", async () => {
    clock = MONDAY_9H;
    const n = kevinCalls.length;
    const qa = qaLlm.calls.length;
    const r = await runJob({ type: "prospection.schedule" });
    expect(r.queued).toEqual(["weekly-report", "daily-top"]);
    await drain();
    const texts = kevinTexts(n);
    expect(texts).toHaveLength(2);
    const report = texts[0]!;
    expect(report).toMatch(/^Ta semaine de prospection : 6 nouveaux canaux à contacter\.|^Semaine de prospection : 6 nouveaux canaux qualifiés\./);
    expect(report).toContain("Par niveau : 1 A, 3 B, 2 C");
    expect(report).toContain("Suivi : à contacter 4 · contacté 1 · signé 1");
    expect(report).toContain("Top 5 de la semaine :");
    expect(report).toContain("@apostas_portugal");
    expect(report).not.toMatch(/@(apuestas_mx_pro|palpites_brasil|bot_odds_feed|fixed_matches_100)/);
    expect(qaLlm.calls.length - qa).toBe(1);
    expect(await prisma.qaCheck.findFirstOrThrow({ where: { contentId: "prospection-weekly:2026-11-02" } })).toMatchObject({ verdict: "APPROVED", contentType: "REPORT" });
    // Puis le Top : tout a déjà été présenté il y a moins de 7 jours, « Plus tard » pas encore échu.
    expect(texts[1]).toMatch(/Rien de nouveau|Pas de nouveau canal/);
    expect(await prisma.setting.findUnique({ where: { key: "prospection.sent.weekly-report.2026-11-02" } })).not.toBeNull();

    const n2 = kevinCalls.length;
    clock = MONDAY_9H05;
    expect((await runJob({ type: "prospection.schedule" })).queued).toEqual(["reminders"]);
    await drain();
    const reminders = sent(n2);
    expect(reminders).toHaveLength(1);
    expect(kevinTexts(n2)[0]).toMatch(/6 jours/);
    expect(kevinTexts(n2)[0]).toContain("@pronos_maxime");
    const maxime = await prospectBy("pronos_maxime");
    expect(buttonsOf(reminders[0]!).map((b) => b.callback_data)).toEqual(["relaunched", "snooze3", "abandon"].map((a) => `prospect:${maxime.id}:${a}`));
    // Une seule fois : nouveau passage le même jour, rien.
    await runJob({ type: "prospection.schedule" });
    await drain();
    expect(sent(n2)).toHaveLength(1);
  });

  it("« Kevin, cherche des canaux casino en Pologne » → trois lots dédiés en polonais, retenus pour le retour de Kevin", async () => {
    const reply = await say("Kevin, cherche des canaux casino en Pologne");
    expect(reply).toMatch(/je cherche des canaux casino en Pologne/);
    const lots = queue.map((q) => q.job);
    expect(lots).toHaveLength(3);
    for (const j of lots) expect(j).toMatchObject({ type: "prospection.discover", lot: { languages: ["pl"], vertical: "CASINO", countries: ["PL"], requestId: expect.any(String) } });
    expect(lots.map((j) => (j as Extract<ProspectionQueueJob, { type: "prospection.discover" }>).lot.source)).toEqual(["directories", "web_search", "social"]);
    const requestId = (lots[0] as Extract<ProspectionQueueJob, { type: "prospection.discover" }>).lot.requestId!;
    expect(await prisma.setting.findUnique({ where: { key: `prospection.request.${requestId}` } })).toMatchObject({ value: expect.objectContaining({ vertical: "CASINO", countries: ["PL"] }) });
    const s = searches.length;
    await drain();
    // Les lots tournent (requêtes en polonais avec le nom du pays), rien trouvé sur le faux web : aucun nouveau canal.
    expect(searches.length).toBeGreaterThan(s);
    const runs = await prisma.prospectSourceRun.findMany({ where: { sourceDetail: `demande ${requestId}` } });
    expect(runs.map((r) => r.sourceType).sort()).toEqual(["DIRECTORY", "SOCIAL", "WEB_SEARCH"]);
    expect(runs.every((r) => r.newCount === 0)).toBe(true);
  });

  it("QA en panne → la liste du jour n'est pas envoyée, Kevin le dit", async () => {
    clock = TUESDAY_NOV_3;
    Object.assign(deps, { qaLlm: createFakeQaLlm({ respond: () => new Error("QA en panne") }) });
    const calcio = await prospectBy("calcio_vip_club");
    const n = kevinCalls.length;
    const r = await runJob({ type: "prospection.schedule" });
    expect(r.queued).toEqual(["daily-top"]);
    await drain();
    // @calcio_vip_club revient de son « Plus tard » : la liste est prête, mais la vérification ne répond pas.
    expect(kevinTexts(n)).toEqual([expect.stringMatching(/La vérification ne répond pas|Je ne peux pas faire vérifier la liste du jour/)]);
    expect(sent(n).some((c) => buttonsOf(c).length)).toBe(false);
    expect(await prospectBy("calcio_vip_club")).toMatchObject({ presentedAt: calcio.presentedAt });
    expect(await prisma.prospectEvent.count({ where: { type: "PRESENTED" } })).toBe(5);
    const blocked = await prisma.qaCheck.findMany({ where: { contentId: { startsWith: "prospection-top:2026-11-03" } } });
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((c) => c.verdict !== "APPROVED")).toBe(true);
  });

  it("à la fin : aucun texte de post en base, Kevin n'a parlé qu'à l'admin", async () => {
    // Textes des posts des fixtures (lus comme l'Enrichisseur les lit).
    const posts: ProspectPost[] = [];
    const readDeps = { prisma, now, web: fixtureWeb(), sleep: async () => {}, clock: () => 0, throttle: memoryHostThrottle(), robotsCache: new Map() } as never;
    for (const name of ENRICH_FIXTURE_CHANNELS) {
      const r = await readProspectPosts(readDeps, name);
      if (r.ok) posts.push(...r.posts);
    }
    expect(posts.filter((p) => p.text.split(/\s+/).length > 16).length).toBeGreaterThan(50);
    const dump = JSON.stringify(
      {
        prospects: await prisma.prospect.findMany(),
        contacts: await prisma.prospectContact.findMany(),
        events: await prisma.prospectEvent.findMany(),
        notes: await prisma.prospectNote.findMany(),
        runs: await prisma.prospectSourceRun.findMany(),
        settings: await prisma.setting.findMany(),
        qa: await prisma.qaCheck.findMany(),
        journal: await prisma.event.findMany(),
        audit: await prisma.auditLog.findMany(),
        turns: await prisma.bossTurn.findMany(),
      },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    // Jamais plus de 15 mots d'affilée d'un post, dans aucune colonne.
    expect(copiesPostText(dump, posts)).toBe(false);
    // Contrôle du contrôle : un vrai extrait de post serait vu.
    const long = posts.find((p) => p.text.split(/\s+/).length > 20)!;
    expect(copiesPostText(`${dump} ${long.text}`, posts)).toBe(true);
    // Kevin n'écrit qu'à l'admin ; l'équipe n'a jamais rien envoyé à un canal ni à un tiers.
    expect(sent().every((c) => Number(c.payload.chat_id) === ADMIN)).toBe(true);
    expect(kevinCalls.some((c) => /^(send(Message|Photo|Video|Document)|forwardMessage|copyMessage)$/.test(c.method) && Number(c.payload.chat_id) !== ADMIN)).toBe(false);
  });
});
