/**
 * Phase 32 — prospection avancée de bout en bout, sur base réelle (`linkaffipro_test`), sans réseau : même mécanique
 * que `prospection-flow.test.ts` (phase 31) :
 * - la VRAIE file `agents-prospection` (`processAgentsProspection` → `runProspectionJob` → `runProspectionAdvancedJob`)
 *   tourne en processus avec une file simulée (identifiant unique tant qu'une tâche attend, délais sur l'horloge simulée) ;
 * - web : faux `ProspectionWeb` des fixtures (`fixtureWeb` : pages `t.me/<nom>`, aperçus `t.me/s/<nom>`) ; l'attente du
 *   débit avance l'horloge ;
 * - IA : fausse IA de l'Enrichisseur (`fakeProspectionLlm`), faux Opus ; QA Global simulé (`approveAllQa`), compté,
 *   puis en panne ;
 * - Link Affi : faux lecteur en lecture seule (`createFakeLinkAffiReader`, fixtures `fixtures/prospection/learn/`,
 *   dates décalées de deux mois) ;
 * - compte réel : fausse boîte aux lettres du userbot (lignes `Setting userbot.request.<id>` relevées pendant les
 *   attentes, battement `userbot.mailbox.heartbeat`), un vrai `TelegramUserAccount` libre ;
 * - Kevin (bot `role ADMIN`) reçoit les updates simulées par SES vrais handlers grammY (boutons `pra:`, `prospect:`,
 *   `bsc:`, chemin rapide « @x = affilié 1234 ») ; les phrases libres passent par la vraie tâche `boss-text`.
 *
 * Scénario : 10 prospects de la phase 31 (lus et notés) + 2 canaux du même admin → relecture de nuit
 * (`prospection.requalify-one`) → 4 alertes justes (marque lâchée, étoile montante, contact changé, niveau) → réseaux
 * à 6 h 30 → Top de 9 h (réseau en une ligne) puis message de 9 h 10 avec boutons `pra:` → « réseau de @x » → « @x a
 * signé » + CPA 100 (propagé au réseau) → « @x = affilié 1234 » → affilié qui pousse un concurrent (preuve ≤ 15 mots)
 * → résultats Link Affi simulés (1er décembre puis 1er janvier) → ACTIVE → calibrage proposé en choix numérotés →
 * « applique 1 » → coefficients dans les bornes + `Experiment` → « annule le calibrage » → retour ; recherche par compte
 * réel refusée tant que non confirmée, puis lot de 20 demandes, FLOOD_WAIT → arrêt propre et source coupée ; QA en
 * panne → rien n'est envoyé. Aucun appel réseau.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync } from "node:fs";
const dbg = (...a: unknown[]) => appendFileSync("/tmp/lapit/debug.txt", JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
import type { Job } from "bullmq";
import type { Update } from "grammy/types";
import type { Bot as GrammyBot } from "grammy";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  createFakeBossLlm,
  createFakeQaLlm,
  memoryHostThrottle,
  PROSPECTION_MODELS,
  type AgentsDeps,
  type AgentsOrchestratorJob,
  type LlmProvider,
  type ProspectionKevinDeps,
  type ProspectionQueueJob,
} from "@linkaffipro/agents";
import { createAdminMessengerWith, createBot, prismaTelegramDeps, realBossEngine, type MessengerApi, type TelegramDeps } from "@linkaffipro/telegram";
import type { AgentsProspectionJob } from "@linkaffipro/queue";
import { processAgentsProspection } from "../../src/processors/agents-prospection";
import { prismaBossTurnFor, processBossText, type BossTextDeps } from "../../src/agents/boss-text";
import { approveAllQa, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";
import { ENRICH_FIXTURE_NOW, fakeProspectionLlm, fixtureWeb } from "../../../../packages/agents/src/prospection/enrich/testing";
import { createFakeLinkAffiReader, learnFixtures } from "../../../../packages/agents/src/prospection/learn/testing";

const ADMIN = 79_332;
const KEVIN_TG = 5572;
const KEVIN_TOKEN = `${KEVIN_TG}:KEVIN-TOKEN-${"q".repeat(30)}`;
const DAY = 86_400_000;

/** Dix canaux des fixtures de la phase 31 (lus et notés comme en phase 31). */
const CHANNELS = [
  "pronos_maxime",
  "calcio_vip_club",
  "slots_kaiser",
  "apostas_portugal",
  "multi_bets_world",
  "no_preview_bets",
  "petit_prono_fr",
  "dead_pronos_2025",
  "bot_odds_feed",
  "repost_tips_all",
] as const;

// ------------------------------------------------------------------------------------------------ horloge

let clock = ENRICH_FIXTURE_NOW.getTime();
const now = () => new Date(clock);
/** Heure de Paris (hiver, UTC+1) → instant UTC. */
const paris = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+01:00`);

// ------------------------------------------------------------------------------------------------ faux web

const fetched: string[] = [];
const base = fixtureWeb();
const web = {
  ...base,
  async fetchText(url: string, opts?: { timeoutMs?: number }) {
    fetched.push(url);
    return base.fetchText(url, opts);
  },
  async search() {
    return [];
  },
};

// ------------------------------------------------------------------------------------------------ fausse IA

const enrichLlm = fakeProspectionLlm();
/** Faux Opus / Sonnet : dossiers (sans chiffre), suivi des affiliés (rien de plus que le code), le reste par l'Enrichisseur. */
const prospectionLlm: LlmProvider = {
  async complete(req) {
    if (req.model === PROSPECTION_MODELS.dossier) return { text: ["Canal suivi de près, audience réelle et régulière.", "Contact public trouvé, à joindre en premier."].join("\n"), costCents: 30 };
    return enrichLlm.complete(req);
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

/** Vide la file comme le worker ; `until` : les tâches différées jusqu'à cette heure passent aussi (horloge avancée). */
async function drain(until = clock) {
  for (let n = 0; n < 3000; n++) {
    const due = queue.filter((q) => q.due <= until).sort((a, b) => a.due - b.due)[0];
    if (!due) return;
    queue.splice(queue.indexOf(due), 1);
    if (due.due > clock) clock = due.due;
    await runJob(due.job, due.jobId);
  }
  throw new Error("file sans fin");
}

// ------------------------------------------------------------------------------------------------ Kevin

const orchestratorJobs: AgentsOrchestratorJob[] = [];
let kevin: GrammyBot;
let kevinCalls: TelegramCall[] = [];

const fakeBossLlm = createFakeBossLlm([]);

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
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const kevinTexts = (since = 0) => sent(since).map((c) => unescape(String(c.payload.text)));
const buttonsOf = (c: TelegramCall) => ((c.payload.reply_markup as { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | undefined)?.inline_keyboard ?? []).flat();

async function say(text: string): Promise<string> {
  const n = kevinCalls.length;
  const before = orchestratorJobs.length;
  await kevin.handleUpdate(textUpdate(text));
  const job = orchestratorJobs.slice(before).find((j) => j.type === "boss-text");
  if (job) await processBossText(job as Extract<AgentsOrchestratorJob, { type: "boss-text" }>, bossTextDeps());
  return kevinTexts(n).join("\n");
}

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
  await prisma.prospectNetwork.deleteMany();
  await prisma.prospectCalibration.deleteMany();
  await prisma.prospectSourceRun.deleteMany();
  await prisma.affiliateOffer.deleteMany();
  await prisma.telegramUserAccount.deleteMany({ where: { phone: "+33600000032" } });
  await prisma.agentUsage.deleteMany({ where: { teamKey: { in: ["prospection", "boss"] } } });
  await prisma.setting.deleteMany({ where: { OR: [{ key: { startsWith: "prospection." } }, { key: { startsWith: "boss." } }, { key: { startsWith: "agents." } }, { key: { startsWith: "userbot." } }] } });
  await prisma.bossTurn.deleteMany();
}

let qaLlm: Awaited<ReturnType<typeof approveAllQa>>;

beforeAll(async () => {
  await resetDb();
  await cleanProspection();
  await prisma.user.deleteMany({ where: { email: "prospection-advanced@linkaffipro.internal" } });
  await prisma.setting.upsert({ where: { key: "admin.telegramUserId" }, create: { key: "admin.telegramUserId", value: String(ADMIN) }, update: { value: String(ADMIN) } });
  await prisma.user.create({ data: { email: "prospection-advanced@linkaffipro.internal", name: "Mathéo", passwordHash: "x", role: "ADMIN", telegramUserId: BigInt(ADMIN) } });
  const kevinRec = await prisma.bot.create({
    data: { name: "Kevin", username: "kevin_prospection2_bot", telegramBotId: BigInt(KEVIN_TG), tokenEncrypted: encrypt(KEVIN_TOKEN), vertical: "CASINO", webhookSecret: "secret-kevin-prospection-2", role: "ADMIN" },
  });
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

describe("prospection avancée de bout en bout (base réelle, faux web, fausse IA, faux Link Affi)", () => {
  it("10 prospects de la phase 31 : lus et notés", async () => {
    for (const n of CHANNELS) {
      const p = await prisma.prospect.create({ data: { username: n, channelUrl: `https://t.me/${n}`, title: n, sourceType: "WEB_SEARCH", discoveredAt: now() } });
      await enqueueProspection({ type: "prospection.enrich", prospectId: p.id }, { jobId: `prospection.enrich:${p.id}` });
    }
    await drain(clock + 3600_000);
    expect(queue).toHaveLength(0);
    const by = new Map((await prisma.prospect.findMany({ where: { username: { in: [...CHANNELS] } } })).map((p) => [p.username!, p]));
    expect(by.get("pronos_maxime")).toMatchObject({ status: "QUALIFIED", tier: "A", bestContact: "@maxime_pub" });
    for (const n of ["calcio_vip_club", "slots_kaiser", "apostas_portugal"]) expect(by.get(n), n).toMatchObject({ status: "QUALIFIED", tier: "B" });
    for (const n of ["multi_bets_world", "no_preview_bets"]) expect(by.get(n), n).toMatchObject({ status: "QUALIFIED", tier: "C" });
    for (const n of ["petit_prono_fr", "dead_pronos_2025", "bot_odds_feed", "repost_tips_all"]) expect(by.get(n), n).toMatchObject({ status: "DISQUALIFIED", tier: "D" });
  });

  it("relecture de nuit : 4 alertes justes", async () => {
    // Deux autres canaux du même admin (même contact, même signature, même groupe lié), sans page publique lisible.
    const maxime = await prospectBy("pronos_maxime");
    for (const n of ["maxime_tennis", "maxime_basket"]) {
      const { id: _id, username: _u, channelUrl: _c, telegramId: _t, createdAt: _ca, updatedAt: _ua, networkId: _n, ...copy } = maxime;
      const p = await prisma.prospect.create({
        data: { ...(copy as never), username: n, channelUrl: `https://t.me/${n}`, title: n, tier: "B", score: 60, sourceType: "GRAPH_MENTION", dossier: null, presentedAt: null },
      });
      await prisma.prospectContact.createMany({
        data: [
          { prospectId: p.id, type: "TELEGRAM_USERNAME", value: "@maxime_pub", source: "description", confidence: "HIGH" },
          { prospectId: p.id, type: "OTHER", value: "Maxime", source: "signature", confidence: "MEDIUM" },
          { prospectId: p.id, type: "LINKED_GROUP", value: "@maxime_chat", source: "description", confidence: "LOW" },
        ],
      });
    }
    // Marque lâchée : la fiche d'@apostas_portugal portait aussi 1xBet (vu le 12 octobre).
    const apostas = await prospectBy("apostas_portugal");
    await prisma.prospect.update({
      where: { id: apostas.id },
      data: { brands: [...(apostas.brands as object[]), { brand: "1xBet", links: 6, country: "GLOBAL", evidence: null, intensity: "HEAVY", promoCode: null, lastSeenAt: "2026-10-12", firstSeenAt: "2026-09-10" }] },
    });
    // Étoile montante : @calcio_vip_club avait 6 000 abonnés et 750 vues par post le 4 octobre.
    const calcio = await prospectBy("calcio_vip_club");
    await prisma.prospectSnapshot.create({
      data: {
        prospectId: calcio.id,
        takenAt: new Date("2026-10-04T08:00:00Z"),
        subscribers: 6000,
        medianViews: 750,
        viewRate: 0.125,
        postsPerDay: calcio.postsPerDay,
        brands: (calcio.brands as Array<Record<string, unknown>>).map((b) => ({ brand: b.brand, intensity: b.intensity, lastSeenAt: b.lastSeenAt })),
        competitiveState: calcio.competitiveState,
        bestContact: calcio.bestContact,
        contactConfidence: calcio.contactConfidence,
        sellsAds: false,
        marketplace: false,
        lastPostAt: calcio.lastPostAt,
        tier: calcio.tier,
        score: calcio.score,
      },
    });
    // Contact changé : @slots_kaiser était joignable par un autre compte.
    const kaiser = await prospectBy("slots_kaiser");
    await prisma.prospect.update({ where: { id: kaiser.id }, data: { bestContact: "@kaiser_alt" } });
    // Niveau : à la lecture d'avant, @pronos_maxime était encore B.
    await prisma.prospect.update({ where: { id: maxime.id }, data: { tier: "B", score: 62 } });

    clock = paris("2026-11-03", "02:00");
    const r = await runJob({ type: "prospection.schedule" });
    // A / B relus tous les 7 jours (4 lus + les 2 canaux du même admin) ; C, écartés et hors cadence : pas encore.
    expect((r.advanced as Record<string, unknown>).requalify).toBe(6);
    const relus = queue.filter((q) => q.job.type === "prospection.requalify-one");
    expect(relus).toHaveLength(6);
    // Étalées dans la nuit (5 minutes entre deux), jamais deux fois la même.
    expect(relus.map((q) => q.due - clock)).toEqual([0, 1, 2, 3, 4, 5].map((k) => k * 300_000));
    expect((await runJob({ type: "prospection.schedule" })).advanced).not.toHaveProperty("requalify");
    const pagesBefore = fetched.length;
    await drain(paris("2026-11-03", "06:00"));
    // Relecture allégée : page + UNE page d'aperçu par canal lisible (jamais la 2e page).
    const tmeS = fetched.slice(pagesBefore).filter((u) => u.startsWith("https://t.me/s/"));
    expect(tmeS.some((u) => u.includes("before="))).toBe(false);
    expect(new Set(tmeS).size).toBe(tmeS.length);

    const alerts = await prisma.prospectAlert.findMany({ include: { prospect: { select: { username: true } } }, orderBy: { strength: "desc" } });
    expect(alerts.map((a) => [a.prospect.username, a.kind, a.family, a.status])).toEqual([
      ["apostas_portugal", "AFFILIATE_DROPPED", "opportunity", "NEW"],
      ["calcio_vip_club", "GROWTH_SPIKE", "opportunity", "NEW"],
      ["pronos_maxime", "TIER_UP", "opportunity", "NEW"],
      ["slots_kaiser", "CONTACT_CHANGED", "info", "NEW"],
    ]);
    expect(alerts[0]!.data).toMatchObject({ brand: "1xBet", lastSeenAt: "2026-10-12", days: 22 });
    // Étoile montante : abonnés ET vues qui suivent (sinon ce serait un signal de faux).
    expect(alerts[1]!.data).toMatchObject({ subscribersFrom: 6000, subscribersTo: 8912, viewsFrom: 750 });
    expect((await prospectBy("calcio_vip_club")).fakeFlags).not.toContain("GROWTH_SPIKE");
    expect(alerts[2]!.data).toMatchObject({ from: "B", to: "A" });
    expect(alerts[3]!.data).toMatchObject({ from: "@kaiser_alt", to: "@kaiser_werbung" });
    // Chaque alerte est aussi dans la chronologie de la fiche ; un point d'historique par relecture ; prochaine relecture posée.
    expect(await prisma.prospectEvent.count({ where: { type: "ALERT" } })).toBe(4);
    for (const n of ["pronos_maxime", "calcio_vip_club", "slots_kaiser", "apostas_portugal"]) {
      const p = await prospectBy(n);
      expect(p.lastRequalifiedAt, n).toBeTruthy();
      expect(p.nextRequalifyAt!.getTime(), n).toBeGreaterThan(clock);
      expect(await prisma.prospectSnapshot.count({ where: { prospectId: p.id } }), n).toBe(2);
    }
    // Rien n'est envoyé la nuit ; aucun texte de post gardé dans les événements de relecture.
    expect(sent()).toEqual([]);
    const ev = await prisma.prospectEvent.findMany({ where: { type: "REQUALIFIED" } });
    expect(JSON.stringify(ev.map((e) => e.payload))).not.toMatch(/PSG|Ligue 1|Primeira/);
  });
});
