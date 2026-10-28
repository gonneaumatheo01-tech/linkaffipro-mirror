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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const affiliateWatchCalls: string[] = [];
/** Faux Opus / Sonnet : dossiers (sans chiffre), suivi des affiliés (rien de plus que le code), le reste par l'Enrichisseur. */
const prospectionLlm: LlmProvider = {
  async complete(req) {
    // Suivi d'un affilié signé (Sonnet) : l'IA « voit » une marque absente des posts — elle doit être écartée.
    if (req.system?.includes("affilié à notre marque")) {
      affiliateWatchCalls.push(req.user);
      return { text: JSON.stringify({ competitors: [{ brand: "Unibet", evidence: "Unibet le meilleur bonus du moment" }], risky: [], our_brand_without_link: false }), costCents: 3 };
    }
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

// ------------------------------------------------------------------------------------------------ faux Link Affi (lecture seule)

/** Résultats simulés des fixtures (septembre / octobre) décalés de deux mois : nos trois affiliés signés début novembre. */
const shifted = (aff: string) =>
  Object.values(learnFixtures().stats[aff] ?? {})
    .flat()
    .map((row) => ({ ...row, date: String(row.date).replace(/^2026-09/, "2026-11").replace(/^2026-10/, "2026-12") }));
const reader = createFakeLinkAffiReader({ "1234": shifted("aff-a"), "1235": shifted("aff-b"), "1236": shifted("aff-c") });

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
  [/^Kevin, calibrage$/i, { name: "prospection_calibrage", input: {} }],
  [/^applique 1$/i, { name: "prospection_calibrage_appliquer", input: { choix: "1" } }],
  [/annule le calibrage/i, { name: "prospection_calibrage_annuler", input: {} }],
  [/combien vaut @pronos_maxime/i, { name: "prospection_valeur", input: { canal: "@pronos_maxime" } }],
  [/@pronos_maxime a signé/i, { name: "prospect_statut", input: { canal: "@pronos_maxime", statut: "signe" } }],
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
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "prospection." } } });
}

let qaLlm: Awaited<ReturnType<typeof approveAllQa>>;
/** Aucun appel réseau : tout `fetch` réel échouerait et serait vu. */
const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("appel réseau interdit dans ce test"));

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
        data: { ...(copy as Record<string, unknown>), username: n, channelUrl: `https://t.me/${n}`, title: n, tier: "B", score: 60, sourceType: "GRAPH_MENTION", dossier: null, presentedAt: null } as never,
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
        brands: (calcio.brands as Array<Record<string, string>>).map((b) => ({ brand: b.brand, intensity: b.intensity, lastSeenAt: b.lastSeenAt })),
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

  it("« @pronos_maxime a signé » + CPA 100 → tout le réseau signé ; « @x = affilié 1234 » par le chemin rapide", async () => {
    clock = paris("2026-11-04", "10:00");
    deps.linkAffiReader = reader;
    expect(await say("Kevin, @pronos_maxime a signé")).toMatch(/@pronos_maxime passe en signé/);
    // Un réseau = un deal : les deux autres canaux du même admin passent signés avec lui.
    const net = await prisma.prospect.findMany({ where: { username: { in: ["pronos_maxime", "maxime_tennis", "maxime_basket"] } } });
    expect(net.map((p) => p.status)).toEqual(["SIGNED", "SIGNED", "SIGNED"]);
    expect(await prisma.prospectEvent.count({ where: { type: "STATUS_CHANGED", payload: { path: ["via"], equals: "network" } } })).toBe(2);
    const maxime = await prospectBy("pronos_maxime");
    expect((await press(`prospect:${maxime.id}:signed`)).reply).toMatch(/Quel type de deal avec @pronos_maxime/);
    expect((await press(`prospect:${maxime.id}:deal_cpa`)).reply).toMatch(/Combien par joueur pour @pronos_maxime/);
    const orch = orchestratorJobs.length;
    const done = await say("100");
    expect(orchestratorJobs.length).toBe(orch);
    expect(done).toMatch(/@pronos_maxime signé en CPA 100\s€/);
    // Kevin demande le numéro d'affilié : derniers affiliés de Link Affi (lecture seule), numérotés.
    expect(done).toMatch(/numéro d'affilié Link Affi/);
    expect(done).toMatch(/^1\. delta_tips/m);
    expect(done).not.toMatch(/secret@example|\+33600000000|FR76/);
    for (const p of await prisma.prospect.findMany({ where: { networkId: maxime.networkId } })) expect(p, p.username!).toMatchObject({ dealType: "CPA", dealTerms: { cpa: 100, currency: "EUR" } });

    // « @x = affilié 1234 » : chemin rapide (aucune IA), un identifiant par canal.
    expect(await say("@pronos_maxime = affilié 1234")).toMatch(/@pronos_maxime = affilié 1234|rattaché/);
    expect(orchestratorJobs.length).toBe(orch);
    expect(await say("@maxime_tennis = affilié 1234")).toMatch(/1234/);
    expect((await prospectBy("maxime_tennis")).linkAffiAffiliateId).toBeNull();
    await say("@maxime_tennis = affilié 1235");
    await say("@maxime_basket = affilié 1236");
    expect(orchestratorJobs.length).toBe(orch);
    const linked = await prisma.prospect.findMany({ where: { linkAffiAffiliateId: { not: null } }, orderBy: { linkAffiAffiliateId: "asc" } });
    expect(linked.map((p) => [p.username, p.linkAffiAffiliateId])).toEqual([
      ["pronos_maxime", "1234"],
      ["maxime_tennis", "1235"],
      ["maxime_basket", "1236"],
    ]);
    expect(await prisma.prospectEvent.count({ where: { type: "LINKAFFI_LINKED" } })).toBe(3);
    expect(await prisma.setting.findUnique({ where: { key: "prospection.link_ask" } })).toBeNull();
    // Lecture seule : le lecteur n'a fait que lister les affiliés récents.
    expect(new Set(reader.calls.map((c) => c.method))).toEqual(new Set(["recentAffiliates"]));
  });

  it("affilié signé qui pousse un concurrent → alerte avec preuve ≤ 15 mots ; marque inventée par l'IA écartée", async () => {
    clock = paris("2026-11-10", "02:00");
    // Les 6 canaux relus il y a 7 jours (entre 2 h et 2 h 25) : dus cette nuit, pas la suivante.
    expect((await runJob({ type: "prospection.schedule" })).advanced).toMatchObject({ requalify: 6 });
    await drain(paris("2026-11-10", "06:00"));
    const alerts = await prisma.prospectAlert.findMany({ where: { createdAt: { gte: new Date(paris("2026-11-10", "00:00")) } }, include: { prospect: { select: { username: true } } } });
    // Une seule nouvelle alerte : la hausse de @calcio_vip_club n'est pas répétée (14 jours), rien d'inventé.
    expect(alerts.map((a) => [a.prospect.username, a.kind, a.family])).toEqual([["pronos_maxime", "AFFILIATE_PUSHES_COMPETITOR", "affiliate"]]);
    const alert = alerts[0]!;
    expect(alert.data).toMatchObject({ brand: "1xBet", postsWithOurLink: 0 });
    // Preuve : 15 mots au plus, recopiés d'un post réel du canal.
    expect(alert.evidence!.split(/\s+/).length).toBeLessThanOrEqual(15);
    expect(alert.evidence).toMatch(/1xbet/i);
    const page = (await base.fetchText("https://t.me/s/pronos_maxime")).body.replace(/<[^>]+>/g, " ").replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, " ");
    expect(page).toContain("cote 1.85 chez 1xbet");
    // L'IA a relu les posts (comme des données) ; la marque qu'elle a inventée est écartée.
    expect(affiliateWatchCalls.length).toBeGreaterThanOrEqual(1);
    expect(affiliateWatchCalls[0]).toMatch(/<donnees>/);
    expect(await prisma.prospectAlert.count({ where: { dedupeKey: { contains: "unibet" } } })).toBe(0);

    clock = paris("2026-11-10", "09:10");
    const n = kevinCalls.length;
    const qa = qaLlm.calls.length;
    await runJob({ type: "prospection.schedule" });
    await drain();
    const texts = kevinTexts(n);
    expect(texts.at(-1)).toMatch(/^@pronos_maxime pousse aussi 1xBet\.\nExtrait : «[\s\S]*1xbet[\s\S]*»$/);
    expect(buttonsOf(sent(n).at(-1)!).map((b) => b.callback_data)).toEqual(["seen", "note", "mute"].map((a) => `pra:${alert.id}:${a}`));
    expect(qaLlm.calls.length - qa).toBe(1);
  });

  it("1er décembre puis 1er janvier : résultats Link Affi (lecture seule) → ACTIVE → calibrage proposé en choix numérotés", async () => {
    clock = paris("2026-12-01", "07:00");
    let n = kevinCalls.length;
    let qa = qaLlm.calls.length;
    expect((await runJob({ type: "prospection.schedule" })).advanced).toMatchObject({ queued: ["monthly"] });
    // Valeurs du matin d'abord, puis le mensuel (résultats → calibrage → bilan) en une tâche.
    expect(queue.map((q) => q.job.type)).toEqual(["prospection.networks", "prospection.values", "prospection.learn-pull"]);
    await drain();
    // Novembre : un résultat par affilié rattaché, champ absent noté (jamais estimé) ; premier dépôt → ACTIVE.
    const nov = await prisma.affiliateResult.findMany({ where: { month: "2026-11" }, include: { prospect: { select: { username: true } } } });
    expect(Object.fromEntries(nov.map((r) => [r.prospect.username, [r.clicks, r.ftd, r.revenueCents, r.missing]]))).toEqual({
      pronos_maxime: [900, 3, 13500, []],
      maxime_tennis: [300, 3, 4500, []],
      maxime_basket: [600, 3, null, ["revenue"]],
    });
    for (const p of await prisma.prospect.findMany({ where: { linkAffiAffiliateId: { not: null } } })) expect(p.status, p.username!).toBe("ACTIVE");
    // 26 jours de données seulement : aucun coefficient proposé ; le bilan du mois passe le QA.
    expect(await prisma.recommendation.count({ where: { source: "prospection_calibration", target: "PROSPECTION_CALIBRATION" } })).toBe(0);
    const decTexts = kevinTexts(n);
    expect(decTexts.at(-1)).toMatch(/novembre : 3 affiliés signés, dont 3 actifs/);
    expect(decTexts.at(-1)).toMatch(/revenus non fournis/);
    expect(decTexts.join("\n")).not.toMatch(/\b1 réglages\b/);
    expect(await prisma.qaCheck.count({ where: { contentType: "REPORT", contentId: { contains: "2026-11" } } })).toBeGreaterThanOrEqual(1);
    expect(qaLlm.calls.length - qa).toBeGreaterThanOrEqual(2);

    // 1er janvier : deux mois de résultats → 3 réglages proposés en choix numérotés, dans les bornes.
    clock = paris("2027-01-01", "07:00");
    n = kevinCalls.length;
    qa = qaLlm.calls.length;
    await runJob({ type: "prospection.schedule" });
    await drain();
    const proposal = kevinTexts(n)[0]!;
    expect(proposal).toMatch(/3 réglages/);
    expect(proposal).toMatch(/^1\. Coefficient du taux de clic pour paris sportifs, FR : 1 → 1,5/m);
    expect(proposal).toMatch(/^2\. Coefficient du taux de premiers dépôts pour paris sportifs, FR : 1 → 0,5/m);
    expect(proposal).toMatch(/^3\. Recherche de canaux/m);
    expect(proposal).toMatch(/Rien ne change sans toi|Rien ne bouge sans ton accord/);
    const recs = await prisma.recommendation.findMany({ where: { source: "prospection_calibration", status: "PROPOSED" }, orderBy: { createdAt: "asc" } });
    expect(recs.map((r) => [r.target, r.field, r.before, r.after])).toEqual([
      ["PROSPECTION_CALIBRATION", "ctrFactor", 1, 1.5],
      ["PROSPECTION_CALIBRATION", "ftdFactor", 1, 0.5],
      ["PROSPECTION_DISCOVERY", "shares", expect.any(Object), expect.any(Object)],
    ]);
    // Bornes : ratio réel ÷ estimé écrêté, ± 50 % au plus par mois ; parts de la recherche ± 20 %, somme 1.
    expect((recs[0]!.evidence as { median: number }).median).toBeGreaterThan(1.5);
    expect((recs[1]!.evidence as { median: number }).median).toBeLessThan(0.5);
    const after = recs[2]!.after as Record<string, number>;
    expect(Object.values(after).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 2);
    for (const v of Object.values(after)) expect(Math.abs(v - 0.2)).toBeLessThanOrEqual(0.2 * 0.2 + 1e-9);
    // La proposition de décembre (parts) est remplacée, jamais appliquée seule.
    expect(await prisma.recommendation.findFirst({ where: { source: "prospection_calibration", status: "REJECTED" } })).toMatchObject({ comment: expect.stringMatching(/Remplacée/) });
    expect(await prisma.prospectCalibration.count({ where: { source: "calibrated" } })).toBe(0);
    // Lecture seule chez Link Affi : agrégats et liste des affiliés, rien d'autre.
    expect(new Set(reader.calls.map((c) => c.method))).toEqual(new Set(["recentAffiliates", "affiliateStats"]));
  });

  it("« calibrage » → « applique 1 » → coefficient changé dans les bornes + Experiment → « annule le calibrage » → retour", async () => {
    clock = paris("2027-01-01", "10:00");
    const list = await say("Kevin, calibrage");
    expect(list).toMatch(/3 réglages proposés/);
    expect(list.split("\n").filter((l) => /^\d\. /.test(l))).toHaveLength(3);
    expect(await say("Kevin, combien vaut @pronos_maxime ?")).toMatch(/estimation non calibrée|pas encore calibrée|non calibrée/i);

    const qa = qaLlm.calls.length;
    expect(await say("applique 1")).toMatch(/Fait pour 1.*30 jours.*annule le calibrage/s);
    // Coefficient changé dans les bornes (1 → 1,5 : + 50 % au plus), un seul ; suivi par une expérience de 30 jours.
    const cal = await prisma.prospectCalibration.findMany();
    expect(cal).toEqual([expect.objectContaining({ segment: "SPORTS|FR|*|*", ctrFactor: 1.5, ftdFactor: 1, source: "calibrated", sample: 3 })]);
    const recs = await prisma.recommendation.findMany({ where: { source: "prospection_calibration", createdAt: { gte: new Date(paris("2027-01-01", "00:00")) } }, orderBy: { createdAt: "asc" } });
    expect(recs.map((r) => r.status)).toEqual(["APPLIED", "PROPOSED", "PROPOSED"]);
    const exp = await prisma.experiment.findFirstOrThrow({ where: { teamKey: "prospection" } });
    expect(exp).toMatchObject({ status: "RUNNING", metric: "prospection_calibration", recommendationId: recs[0]!.id });
    expect(exp.endsAt!.getTime() - clock).toBe(30 * DAY);
    // Les parts de la recherche (choix 3) n'ont pas bougé : rien n'est appliqué sans être choisi.
    expect(await prisma.setting.findUnique({ where: { key: "prospection.discovery_shares" } })).toBeNull();
    // L'estimation tient compte du coefficient dès la lecture suivante.
    expect(await say("Kevin, combien vaut @pronos_maxime ?")).not.toMatch(/non calibrée/i);
    expect((await prospectBy("pronos_maxime")).valueEstimate).toMatchObject({ calibratedBy: "SPORTS|FR|*|*" });
    expect(qaLlm.calls.length - qa).toBe(0);

    expect(await say("Kevin, annule le calibrage")).toMatch(/comme avant/);
    expect(await prisma.prospectCalibration.findMany()).toEqual([expect.objectContaining({ ctrFactor: 1, ftdFactor: 1, source: "default" })]);
    expect(await prisma.experiment.findUniqueOrThrow({ where: { id: exp.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await say("Kevin, combien vaut @pronos_maxime ?")).toMatch(/non calibrée/i);
    expect(await say("Kevin, annule le calibrage")).not.toMatch(/comme avant/);
    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: "prospection.calibration" } }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["prospection.calibration.applied", "prospection.calibration.undone"]);
  });

  it("QA en panne → le message des alertes n'est pas envoyé, les alertes attendent, Kevin le dit", async () => {
    Object.assign(deps, { qaLlm: createFakeQaLlm({ respond: () => new Error("QA en panne") }) });
    clock = paris("2027-01-02", "02:00");
    await runJob({ type: "prospection.schedule" });
    await drain(paris("2027-01-02", "06:00"));
    const fresh = await prisma.prospectAlert.findMany({ where: { createdAt: { gte: new Date(paris("2027-01-02", "00:00")) } }, include: { prospect: { select: { username: true } } } });
    // Relecture du 2 janvier : les canaux des fixtures ne postent plus depuis deux mois → silences signalés ; le canal
    // abandonné (aucun post lisible dans les 90 jours) reste écarté, jamais « remonté ».
    expect(fresh.map((a) => `${a.prospect.username}:${a.kind}`)).toEqual(expect.arrayContaining(["pronos_maxime:AFFILIATE_SILENT", "pronos_maxime:AFFILIATE_NOT_POSTING", "calcio_vip_club:WENT_SILENT"]));
    expect(fresh.some((a) => a.kind === "TIER_UP")).toBe(false);
    expect(await prospectBy("dead_pronos_2025")).toMatchObject({ status: "DISQUALIFIED", tier: "D" });
    // Le canal coupé (🔕) garde ses alertes, en MUTED : jamais envoyées.
    expect(fresh.filter((a) => a.prospect.username === "slots_kaiser").every((a) => a.status === "MUTED")).toBe(true);

    clock = paris("2027-01-02", "09:10");
    const n = kevinCalls.length;
    const qa = qaLlm.calls.length;
    await runJob({ type: "prospection.schedule" });
    await drain();
    // Rien n'est envoyé : ni la liste du jour ni les alertes ; Kevin dit pourquoi (textes fixes, hors QA) ; le faux QA
    // « qui approuve tout » n'a pas été appelé à la place.
    expect(kevinTexts(n)).toEqual([expect.stringMatching(/vérification ne répond pas.*liste du jour/), expect.stringMatching(/vérification ne répond pas.*alertes du jour attendent/)]);
    expect(sent(n).some((c) => buttonsOf(c).length)).toBe(false);
    expect(qaLlm.calls.length).toBe(qa);
    const after = await prisma.prospectAlert.findMany({ where: { createdAt: { gte: new Date(paris("2027-01-02", "00:00")) } } });
    expect(after.every((a) => (a.status === "NEW" || a.status === "MUTED") && a.sentAt === null)).toBe(true);
    const checks = await prisma.qaCheck.findMany({ where: { contentId: { startsWith: "prospection-alerts:2027-01-02" } } });
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.verdict !== "APPROVED")).toBe(true);
    // Une seule tentative par jour (pas de « la vérification ne répond pas » toutes les 10 minutes)…
    await runJob({ type: "prospection.schedule" });
    await drain();
    expect(kevinTexts(n)).toHaveLength(2);
    // … et les alertes attendent le lendemain, quand la vérification répond : 8 au plus, toujours avec leurs boutons.
    Object.assign(deps, { qaLlm });
    clock = paris("2027-01-03", "09:10");
    const n2 = kevinCalls.length;
    await runJob({ type: "prospection.schedule" });
    await drain();
    const cards = sent(n2).filter((c) => buttonsOf(c).some((b) => b.callback_data.startsWith("pra:")));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(8);
    expect(cards.some((c) => /@slots_kaiser/.test(String(c.payload.text)))).toBe(false);
  });

  it("à la fin : tout envoi est passé par le QA, Kevin n'a parlé qu'à l'admin, aucun appel réseau", async () => {
    // Chaque message d'alertes envoyé a son approbation ; chaque bilan et chaque réglage proposé aussi.
    const sentDays = new Set((await prisma.prospectAlert.findMany({ where: { sentAt: { not: null } } })).map((a) => a.sentAt!.toISOString().slice(0, 10)));
    const approved = await prisma.qaCheck.findMany({ where: { verdict: "APPROVED", teamKey: "prospection" } });
    for (const d of sentDays) expect(approved.some((c) => c.contentType === "ALERT" && c.contentId.startsWith(`prospection-alerts:${d}`)), d).toBe(true);
    expect(new Set(approved.map((c) => c.contentType))).toEqual(new Set(["KEVIN_RESPONSE", "ALERT", "REPORT", "RECOMMENDATION"]));
    // Appels au QA Global sur tout le scénario (faux QA qui approuve) : un par contrôle approuvé, jamais d'approbation d'office.
    expect(qaLlm.calls.length).toBeGreaterThanOrEqual(approved.length);
    // Kevin n'écrit qu'à l'admin ; rien n'est jamais envoyé à un canal ni à un tiers.
    expect(sent().length).toBeGreaterThan(20);
    expect(sent().every((c) => Number(c.payload.chat_id) === ADMIN)).toBe(true);
    // Link Affi : seulement les deux lectures du contrat.
    expect(reader.calls.every((c) => c.method === "affiliateStats" || c.method === "recentAffiliates")).toBe(true);
    // Le web n'a servi que les fixtures, et rien n'est sorti par le réseau.
    expect(fetched.every((u) => /^https:\/\//.test(u))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
