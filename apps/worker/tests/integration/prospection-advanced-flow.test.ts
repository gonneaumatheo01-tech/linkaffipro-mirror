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

// ------------------------------------------------------------------------------------------------ fausse boîte aux lettres du userbot

type UserbotReq = { kind: string; accountId: string; op: "search" | "profile"; query?: string; channel?: { username: string | null }; status: string };
/** Faux userbot : relève les demandes `prospect-search` pendant les attentes ; FLOOD_WAIT à partir de la demande `floodFrom`. */
const userbot = { on: false, floodFrom: 23, seen: [] as UserbotReq[] };
async function beat() {
  const value = { at: now().toISOString() };
  await prisma.setting.upsert({ where: { key: "userbot.mailbox.heartbeat" }, create: { key: "userbot.mailbox.heartbeat", value }, update: { value } });
}
async function serveUserbot() {
  await beat();
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: "userbot.request." } } });
  for (const row of rows) {
    const v = row.value as unknown as UserbotReq;
    if (v.status !== "PENDING" || v.kind !== "prospect-search") continue;
    userbot.seen.push(v);
    const k = userbot.seen.length;
    const response =
      k >= userbot.floodFrom
        ? { ok: false, floodWaitSeconds: 420 }
        : v.op === "search"
          ? { ok: true, calls: 1, channels: [{ id: String(9000 + k), accessHash: "h", username: `trouve_compte_${k}`, title: `Trouvé ${k}`, subscribers: 4000 + k }] }
          : { ok: true, calls: 1, profile: { id: "x", username: v.channel?.username ?? null, title: "Canal trouvé", subscribers: 4100, about: "Pronos", linkedChat: null } };
    await prisma.setting.update({ where: { key: row.key }, data: { value: { ...v, status: "DONE", response } as never } });
  }
}
let offerButtons: string[] = [];

async function runJob(job: ProspectionQueueJob, jobId = "t") {
  ran.push(job);
  // La boucle du userbot bat en continu quand il tourne.
  if (userbot.on) await beat();
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

const fakeBossLlm = createFakeBossLlm([
  [/réseau de @pronos_maxime/i, { name: "prospection_reseau", input: { canal: "@pronos_maxime" } }],
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
      if (userbot.on) await serveUserbot();
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

  let alertCards: TelegramCall[] = [];

  it("6 h 30 : réseaux puis valeurs ; 9 h : Top avec le réseau en une ligne ; 9 h 10 : alertes avec boutons, QA appelé", async () => {
    clock = paris("2026-11-03", "06:30");
    expect((await runJob({ type: "prospection.schedule" })).advanced).toMatchObject({ morning: true });
    expect(queue.map((q) => q.job.type)).toEqual(["prospection.networks", "prospection.values"]);
    await drain();
    // Un seul réseau : les 3 canaux du même admin (même contact, signature, groupe lié), jamais les autres.
    const nets = await prisma.prospectNetwork.findMany({ include: { members: { select: { username: true } } } });
    expect(nets).toHaveLength(1);
    expect(nets[0]).toMatchObject({ name: "Réseau @maxime_pub", mainContact: "@maxime_pub", origin: "AUTO" });
    expect(nets[0]!.members.map((m) => m.username).sort()).toEqual(["maxime_basket", "maxime_tennis", "pronos_maxime"]);
    expect((nets[0]!.evidence as Array<{ kind: string }>).map((e) => e.kind)).toEqual(expect.arrayContaining(["same_contact", "same_signature", "same_linked_group"]));
    // Valeurs : toujours une fourchette, jamais un chiffre seul, « non calibrée ».
    const vals = await prisma.prospect.findMany({ where: { status: "QUALIFIED" }, select: { username: true, valueEstimate: true } });
    const withValue = vals.filter((v) => v.valueEstimate);
    expect(withValue.length).toBeGreaterThanOrEqual(5);
    for (const v of withValue) {
      const e = v.valueEstimate as { low: number; base: number; high: number; calibratedBy: string };
      expect(e.low, v.username!).toBeLessThan(e.base);
      expect(e.base, v.username!).toBeLessThan(e.high);
      expect(e.calibratedBy).toBe("default");
    }

    clock = paris("2026-11-03", "09:10");
    const n = kevinCalls.length;
    const qa = qaLlm.calls.length;
    const r = await runJob({ type: "prospection.schedule" });
    expect(r.queued).toContain("daily-top");
    expect((r.advanced as Record<string, unknown>).queued).toEqual(["alerts-digest"]);
    await drain();
    const texts = kevinTexts(n);
    // Top : un réseau = UNE carte (titre en une ligne, ses 3 canaux, un seul deal), les boutons de sa tête de liste.
    expect(texts[0]).toMatch(/7 canaux/);
    const netCard = texts.find((t) => t.startsWith("Réseau @maxime_pub"))!;
    expect(netCard.split("\n")[0]).toBe("Réseau @maxime_pub : 3 canaux FR, 6,3k vues/post cumulées");
    expect(netCard).toMatch(/Un seul deal pour 3 canaux/);
    expect(netCard).toMatch(/estimation non calibrée/);
    expect(texts.filter((t) => /@maxime_tennis/.test(t))).toHaveLength(1);
    const maxime = await prospectBy("pronos_maxime");
    const netCall = sent(n).find((c) => String(c.payload.text).startsWith("Réseau @maxime_pub"))!;
    expect(buttonsOf(netCall).map((b) => b.callback_data)).toEqual(["contacted", "signed", "dossier", "later", "no"].map((a) => `prospect:${maxime.id}:${a}`));

    // 9 h 10 : en-tête puis une alerte par message, opportunités d'abord, chacune avec ✅ Vu, 📝 Note, 🔕.
    const head = texts.findIndex((t) => /4 choses ont bougé/.test(t));
    expect(head).toBeGreaterThan(0);
    expect(texts.slice(head + 1)).toEqual([
      expect.stringMatching(/1xBet.*@apostas_portugal.*22 jours/),
      expect.stringMatching(/@calcio_vip_club.*750.*1,1k.*30 jours/),
      expect.stringMatching(/@pronos_maxime.*niveau A.*B/),
      expect.stringMatching(/@slots_kaiser.*@kaiser_werbung.*@kaiser_alt/),
    ]);
    alertCards = sent(n).slice(-4);
    const alerts = await prisma.prospectAlert.findMany({ orderBy: { strength: "desc" } });
    alertCards.forEach((c, k) => expect(buttonsOf(c).map((b) => b.callback_data)).toEqual(["seen", "note", "mute"].map((a) => `pra:${alerts[k]!.id}:${a}`)));
    expect(alerts.every((a) => a.status === "SENT" && a.sentAt?.getTime() === clock)).toBe(true);
    // QA Global : la liste du jour et le message des alertes, une fois chacun.
    expect(qaLlm.calls.length - qa).toBe(2);
    expect(await prisma.qaCheck.findFirstOrThrow({ where: { contentId: "prospection-alerts:2026-11-03:4" } })).toMatchObject({ verdict: "APPROVED", contentType: "ALERT" });
    // Une fois par jour.
    const n2 = kevinCalls.length;
    await runJob({ type: "prospection.schedule" });
    await drain();
    expect(sent(n2)).toEqual([]);
  });

  it("boutons pra: : ✅ Vu, 📝 Note (la réponse va sur la fiche), 🔕 Plus pour ce canal", async () => {
    clock = paris("2026-11-03", "09:20");
    const alerts = await prisma.prospectAlert.findMany({ orderBy: { strength: "desc" } });
    const seen = await press(`pra:${alerts[0]!.id}:seen`);
    expect(seen.toast).toBeTruthy();
    expect(await prisma.prospectAlert.findUniqueOrThrow({ where: { id: alerts[0]!.id } })).toMatchObject({ status: "SEEN" });
    expect(kevinCalls.at(-1)!.method).toBe("editMessageReplyMarkup");

    const ask = await press(`pra:${alerts[1]!.id}:note`);
    expect(ask.reply).toMatch(/@calcio_vip_club/);
    const orch = orchestratorJobs.length;
    expect(await say("Il cherche un nouveau partenaire, je l'appelle jeudi")).toMatch(/@calcio_vip_club/);
    expect(orchestratorJobs.length).toBe(orch);
    const calcio = await prospectBy("calcio_vip_club");
    expect(await prisma.prospectNote.findFirst({ where: { prospectId: calcio.id } })).toMatchObject({ note: expect.stringContaining("nouveau partenaire"), authorType: "client" });

    const kaiser = await prospectBy("slots_kaiser");
    await press(`pra:${alerts[3]!.id}:mute`);
    expect(await prospectBy("slots_kaiser")).toMatchObject({ watchMuted: true });
    expect(await prisma.prospectAlert.findUniqueOrThrow({ where: { id: alerts[3]!.id } })).toMatchObject({ status: "MUTED", prospectId: kaiser.id });
  });

  it("« réseau de @pronos_maxime » : les 3 canaux et les preuves ; la recherche par compte est proposée une fois", async () => {
    clock = paris("2026-11-03", "09:30");
    const reply = await say("Kevin, réseau de @pronos_maxime");
    expect(reply).toMatch(/^Réseau @maxime_pub : 3 canaux FR/);
    for (const n of ["@maxime_tennis", "@maxime_basket", "@pronos_maxime"]) expect(reply).toContain(n);
    expect(reply).toMatch(/Preuves : même contact @maxime_pub/);
    // Après une lecture de l'admin en privé : la recherche par compte réel, proposée une seule fois, à confirmer.
    const offer = sent().at(-1)!;
    expect(String(offer.payload.text)).toMatch(/compte réel, en lecture seule, sans rien rejoindre ni écrire/);
    offerButtons = buttonsOf(offer).map((b) => b.callback_data);
    expect(offerButtons).toEqual([expect.stringMatching(/^bsc:\w+:yes$/), expect.stringMatching(/^bsc:\w+:no$/)]);
    const n = kevinCalls.length;
    await say("Kevin, réseau de @pronos_maxime");
    expect(kevinTexts(n).join("\n")).not.toMatch(/compte réel/);
  });

  it("recherche par compte réel : refusée tant que non confirmée, puis lot de 20 demandes ; FLOOD_WAIT → arrêt propre, source coupée", async () => {
    await prisma.telegramUserAccount.create({ data: { label: "Lecteur", phone: "+33600000032", sessionEncrypted: encrypt("session-de-test"), status: "ACTIVE", isActive: true } });
    // Pas encore confirmée : le lot ne demande rien au userbot.
    userbot.on = true;
    await beat();
    expect((await runJob({ type: "prospection.account-search", lot: { vertical: "SPORTS", languages: ["fr"] } })).search).toMatchObject({ ok: false, requests: 0, stopped: "désactivée" });
    expect(userbot.seen).toHaveLength(0);
    // Planification de nuit : rien non plus.
    clock = paris("2026-11-04", "02:00");
    await runJob({ type: "prospection.schedule" });
    expect(queue.some((q) => q.job.type === "prospection.account-search")).toBe(false);
    queue.length = 0;

    // OUI (bouton sous la proposition, moins de 10 minutes après) → activée.
    clock = paris("2026-11-03", "09:35");
    const yes = await press(offerButtons[0]!);
    expect(yes.reply).toMatch(/recherche par compte|activée|c'est parti/i);
    expect(await prisma.setting.findUnique({ where: { key: "prospection.account_search.enabled" } })).toMatchObject({ value: true });

    // Nuit suivante : un lot par verticale ; Paris = 20 demandes au plus (recherches + fiches publiques) au rythme de 5 s.
    clock = paris("2026-11-04", "02:00");
    expect((await runJob({ type: "prospection.schedule" })).advanced).toMatchObject({ account: 2 });
    expect(queue.map((q) => (q.job as { lot?: { vertical: string } }).lot?.vertical)).toEqual(["SPORTS", "CASINO"]);
    const n = kevinCalls.length;
    const [sports, casino] = [queue.shift()!, queue.shift()!];
    const r1 = (await runJob(sports.job, sports.jobId)).search;
    const r2 = (await runJob(casino.job, casino.jobId)).search;
    // Lot complet : 20 demandes (10 recherches + 10 fiches publiques), un nouveau canal par recherche.
    expect(r1).toEqual({ ok: true, requests: 20, found: 10, newCount: 10, stopped: null });
    // Second lot : FLOOD_WAIT à sa 3e demande → arrêt propre (ce qui est trouvé est gardé), source coupée, Kevin prévient.
    expect(r2).toEqual({ ok: false, requests: 3, found: 1, newCount: 1, stopped: "FLOOD_WAIT" });
    expect(userbot.seen).toHaveLength(23);
    // Lecture seule : recherche globale et fiche publique, rien d'autre (aucune adhésion, aucun message).
    expect(new Set(userbot.seen.map((x) => `${x.kind}/${x.op}`))).toEqual(new Set(["prospect-search/search", "prospect-search/profile"]));
    // 5 secondes au moins entre deux demandes, lots compris.
    const at = userbot.seen.map((x) => Date.parse((x as unknown as { createdAt: string }).createdAt));
    for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!).toBeGreaterThanOrEqual(5000);
    expect(await prisma.setting.findUnique({ where: { key: "prospection.account_search.enabled" } })).toMatchObject({ value: false });
    const counters = (await prisma.setting.findUniqueOrThrow({ where: { key: "prospection.account_search.counters" } })).value as { perAccount: Record<string, number>; flood: { seconds: number } };
    expect(Object.values(counters.perAccount)).toEqual([23]);
    expect(counters.flood).toMatchObject({ seconds: 420 });
    expect(kevinTexts(n)).toEqual([expect.stringMatching(/ralentir.*420 s.*coupée/)]);
    // Les canaux trouvés suivent la chaîne normale (lecture par t.me/s, jamais par le compte).
    expect(await prisma.prospect.count({ where: { sourceType: "ACCOUNT_SEARCH" } })).toBe(11);
    expect(queue.filter((q) => q.job.type === "prospection.enrich")).toHaveLength(11);
    await drain(paris("2026-11-04", "06:00"));
    expect(userbot.seen).toHaveLength(23);
    // Coupée : le lot suivant ne demande plus rien.
    expect((await runJob({ type: "prospection.account-search", lot: { vertical: "SPORTS", languages: [] } })).search).toMatchObject({ requests: 0, stopped: "désactivée" });
    expect(userbot.seen).toHaveLength(23);
    userbot.on = false;
  });
});
