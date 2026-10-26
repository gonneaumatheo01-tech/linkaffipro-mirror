/**
 * Phase 30 — QA Global (« dernier verrou ») de bout en bout, sur base réelle (`linkaffipro_test`), sans réseau :
 * - fausse IA du QA SCRIPTÉE (`createFakeQaLlm({ respond })`) qui juge d'après le type, le CONTENU et le CONTEXTE croisé
 *   reçus (mot interdit, sous-titre faux, chiffre inventé, hallucination, règle publicitaire contredite, faux positif),
 *   en panne (`qaUnavailable`) ou trop lente (délai de 1 s posé dans `qa.timeout_ms`) ;
 * - fausse IA des équipes (Rédaction casino scriptée, relecture qui accepte), fausse IA de Kevin (`createFakeBossLlm`),
 *   faux Telegram (`installFakeTelegram`) pour le bot du canal Test et pour Kevin ;
 * - VRAIS processeurs : `telegram-send` (avec le vrai verrou d'envoi `passesQaGate`), `agents-montage` (aperçu des
 *   shorts), `agents-analystes` (rapport de la semaine), `agents-algo` (`qa-sweep`, `qa-alerts`), tâche `boss-text`
 *   de Kevin, handlers grammY de Kevin (`handleUpdate` : OUI, boutons `agh:`), chaîne des missions (`runNextStep`).
 *
 * Scénarios : post casino → QA → publié sur le canal Test ; mot interdit → refusé → Rédaction avec corrections →
 * corrigé → publié ; post modifié après approbation → revérifié au point d'envoi ; short au sous-titre faux → refusé →
 * Habillage → corrigé → aperçu ; rapport au chiffre inventé → refusé → réécrit → envoyé ; réponse de Kevin hallucinée →
 * refusée → régénérée → envoyée ; recommandation contraire à une règle publicitaire → refusée, jamais montrée ni
 * appliquée ; alerte faux positif → annulée, journalisée ; 3 refus → Kevin demande (boutons) → choix appliqué ; QA en
 * panne → rien ne sort, jamais approuvé, Kevin prévient ; délai dépassé → TIMEOUT ; post de l'équipe humaine et textes
 * fixes de Kevin jamais retenus ; « combien de refus cette semaine ? » juste ; chaque vérification a son `QaCheck`
 * (Fable 5.1, empreinte, contenu masqué).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import type { Update } from "grammy/types";
import type { Bot as GrammyBot } from "grammy";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  createFakeBossLlm,
  createFakeLlm,
  createFakeQaLlm,
  createMission,
  decideValidation,
  isRecommendationApproved,
  QA_ALERT_TEXTS,
  QA_MODEL,
  qaUnavailable,
  recommendationNotApproved,
  respondToRequest,
  runNextStep,
  type AgentStepJob,
  type AgentsDeps,
  type AgentsOrchestratorJob,
  type AnalystsKevinDeps,
  type AnalystsQueueJob,
  type EngineDeps,
  type FakeQaCall,
  type FakeQaStep,
  type HumanRequestRow,
  type LlmRequest,
  type MontagePipelineDeps,
  type MontageQueueJob,
  type QaDeps,
} from "@linkaffipro/agents";
import { createAdminMessengerWith, createBot, prismaTelegramDeps, realBossEngine, type MessengerApi, type TelegramDeps } from "@linkaffipro/telegram";
import type { AgentsAnalystesJob, AgentsMontageJob } from "@linkaffipro/queue";
import { QA_PAUSED_TEXT, QA_REC_REFUSED_TEXT } from "../../../../packages/agents/src/boss/qa-gate-texts";
import { processAgentsAlgo } from "../../src/processors/agents-algo";
import { processAgentsAnalystes } from "../../src/processors/agents-analystes";
import { processAgentsMontage } from "../../src/processors/agents-montage";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { prismaBossTurnFor, processBossText, type BossTextDeps } from "../../src/agents/boss-text";
import { setWorkerAgentsDeps } from "../../src/agents/deps";
import { apiForBot } from "../../src/sending/api";
import { createBotAndChannel, fakeJob, installFakeTelegram, resetDb, TEST_BOT_TOKEN, type TelegramCall } from "./helpers";

const ADMIN = 79_330;
const KEVIN_TG = 5580;
const KEVIN_TOKEN = `${KEVIN_TG}:KEVIN-TOKEN-${"q".repeat(30)}`;
const NEWS_URL = "https://igamingbusiness.com/fr/actualites/videos-courtes-casino-2026";
/** Jeton de bot glissé dans un rapport : jamais gardé en clair dans `QaCheck.content`. */
const LEAKED_TOKEN = "987654321:AAHfakeFAKEfakeFAKEfakeFAKEfake12345";

// ------------------------------------------------------------------------------------------------ fausse IA du QA

type QaMode = "normal" | "down" | "slow";
let qaMode: QaMode = "normal";
const judged: Array<{ type: string; content: Record<string, unknown>; context: Record<string, unknown> }> = [];

function between(user: string, tag: string): Record<string, unknown> {
  const m = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(user);
  return m ? (JSON.parse(m[1]!) as Record<string, unknown>) : {};
}

const reject = (code: string, message: string, field: string, suggestion: string): FakeQaStep => ({
  verdict: "REJECTED",
  reasons: [{ code, message, severity: "critical" }],
  corrections: [{ field, expected: "conforme", got: "non conforme", suggestion }],
});
const APPROVE: FakeQaStep = { verdict: "APPROVED", reasons: [], corrections: [] };

/** Le « modèle » juge ce qu'il reçoit : type, contenu (masqué) et contexte croisé chargé par le moteur. */
function judge(req: FakeQaCall): FakeQaStep {
  if (qaMode === "down") return qaUnavailable("server");
  if (qaMode === "slow") return { delayMs: 3000, verdict: { verdict: "APPROVED" } };
  const type = /^Type : ([A-Z_]+)/.exec(req.user)?.[1] ?? "";
  const content = between(req.user, "contenu");
  const context = between(req.user, "contexte");
  judged.push({ type, content, context });
  const all = JSON.stringify(content);
  switch (type) {
    case "POST": {
      const text = String(content.text ?? "");
      if (/argent facile/i.test(text)) return reject("CHANNEL_RULE", "Mot interdit sur ce canal : « argent facile ».", "text", "Retire « argent facile », parle de l'ambiance du jeu.");
      if (/jackpot assuré/i.test(text)) return reject("GAIN_PROMISE", "Promesse de gain : « jackpot assuré ».", "text", "Aucune promesse de gain.");
      return APPROVE;
    }
    case "SHORT":
      return /Bienvenu /.test(String(content.subtitlesSrt ?? ""))
        ? reject("SUBTITLE_ERROR", "Sous-titre faux : « Bienvenu » au lieu de « Bienvenue ».", "subtitlesSrt", "Corrige « Bienvenu » en « Bienvenue ».")
        : APPROVE;
    case "REPORT":
      return /87 %/.test(String(content.text ?? ""))
        ? reject("INVENTED_NUMBER", "Chiffre inventé : « 87 % » ne vient d'aucune source.", "text", "Retire le chiffre ou cite sa source.")
        : APPROVE;
    case "KEVIN_RESPONSE":
      return /record/i.test(String(content.response ?? ""))
        ? reject("HALLUCINATION", "La réponse invente un record absent des données consultées.", "response", "Ne parle que des données consultées.")
        : APPROVE;
    case "RECOMMENDATION": {
      // Vérification croisée : la règle publicitaire active (Analystes) vient du CONTEXTE chargé par le moteur.
      const rules = Array.isArray(context.complianceRules) ? (context.complianceRules as Array<{ rule?: string }>) : [];
      const bonusRule = rules.find((r) => /bonus/i.test(String(r.rule ?? "")));
      return bonusRule && /bonus/i.test(all)
        ? reject("COMPLIANCE", `Contredit une règle publicitaire active : ${bonusRule.rule}`, "after", "Retire le bonus de la proposition.")
        : APPROVE;
    }
    case "ALERT":
      return /rumeur/i.test(String(content.message ?? ""))
        ? reject("FALSE_ALERT", "Faux positif : une rumeur isolée d'un forum, aucune source fiable.", "message", "N'alerte pas sur une rumeur isolée.")
        : APPROVE;
    default:
      return APPROVE;
  }
}

const qaLlm = createFakeQaLlm({ respond: (req) => judge(req) });

// ------------------------------------------------------------------------------------------------ fausses IA des équipes

/** Brouillons de la Rédaction, dans l'ordre (le dernier se répète) ; demandes reçues gardées. */
let drafts: string[] = [];
const redactionCalls: string[] = [];
const teamLlm = createFakeLlm({
  responses: {
    redaction: (req: LlmRequest) => {
      redactionCalls.push(req.user);
      const text = drafts.length > 1 ? drafts.shift()! : (drafts[0] ?? "Une soirée au casino, ça se vit.");
      return JSON.stringify({ text, hook: text.slice(0, 40), topic: "soirée" });
    },
  },
});

const analystsLlm = {
  async complete(req: LlmRequest) {
    // Rapporteur : brouillon vide → le rapport écrit par le code (repasse au QA).
    if ((req.system ?? "").includes("tu mets en forme le rapport de la semaine")) return { text: "", costCents: 0 };
    throw new Error(`appel d'IA inattendu : ${(req.system ?? "").slice(0, 60)}`);
  },
};

const HALLUCINATED = "Les équipes tournent bien et le casino a battu son record de clics cette nuit, tout roule.";
const HONEST = "Les équipes tournent normalement, rien d'anormal à signaler pour le moment de mon côté.";
const fakeBossLlm = createFakeBossLlm(
  [
    [/combien de refus/i, { name: "qa_history", input: { jours: 7 } }],
    [/comment vont les équipes/i, (m) => ({ name: "repondre_question", input: { sujet: "etat", question: m } })],
    [/plafond/i, { name: "plafond", input: { equipe: "casino", poste: "ia", euros: 900 } }],
  ],
  {
    writer: (user) => {
      if (!user.includes("QUESTION DE L'ADMIN")) return "";
      return user.includes("CORRECTIONS DEMANDÉES") ? HONEST : HALLUCINATED;
    },
  },
);

// ------------------------------------------------------------------------------------------------ files simulées

const steps: AgentStepJob[] = [];
/** Étapes remises à plus tard (QA indisponible : relecture dans 5 minutes) : jamais rejouées tout de suite. */
const delayed: Array<{ job: AgentStepJob; delayMs: number }> = [];
const montageQueue: Array<{ job: MontageQueueJob; jobId?: string }> = [];
const analystsQueue: Array<{ job: AnalystsQueueJob; jobId?: string }> = [];
const orchestratorJobs: AgentsOrchestratorJob[] = [];
const previews: Array<{ clipId: string; srt: string | null }> = [];

let deps: EngineDeps & QaDeps & MontagePipelineDeps & AnalystsKevinDeps;

async function drain(limit = 60): Promise<string[]> {
  const out: string[] = [];
  while (steps.length && out.length < limit) {
    const s = steps.shift()!;
    out.push(await runNextStep(deps, s.missionId, s.index));
  }
  return out;
}

/** Validations « À valider » acceptées comme le bouton ✅, jusqu'à ce qu'il n'y en ait plus. */
async function approveValidations(): Promise<number> {
  let n = 0;
  for (let round = 0; round < 4; round++) {
    const pending = await prisma.agentValidation.findMany({ where: { status: "PENDING" } });
    if (!pending.length) break;
    for (const v of pending) {
      expect((await decideValidation(deps, { validationId: v.id, decision: "approve", via: "TELEGRAM" })).ok).toBe(true);
      n++;
    }
    await drain();
  }
  return n;
}

// ------------------------------------------------------------------------------------------------ Kevin

let kevin: GrammyBot;
let kevinCalls: TelegramCall[] = [];
let channelCalls: TelegramCall[] = [];
let uid = 1;
let mid = 100;
const from = { id: ADMIN, is_bot: false, first_name: "Mathéo", username: "matheo" };
const chat = { id: ADMIN, type: "private" as const, first_name: "Mathéo" };
const textUpdate = (text: string): Update => {
  mid += 1;
  return { update_id: uid++, message: { message_id: mid, date: Math.floor(Date.now() / 1000), chat, from, text } } as Update;
};
const callbackUpdate = (data: string): Update =>
  ({ update_id: uid++, callback_query: { id: `cb${uid}`, chat_instance: "ci", data, from, message: { message_id: 50, date: 0, chat, text: "q" } } }) as Update;

const kevinTexts = (since = 0) =>
  kevinCalls
    .slice(since)
    .filter((c) => c.method === "sendMessage")
    .map((c) => String(c.payload.text));

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

/** Message de l'admin à Kevin : webhook réel, puis la tâche `boss-text` du worker si le chemin rapide passe la main. */
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

const ids = { bot: "", test: "", casino: "", kevin: "", user: "", entry: "", source: "", rule: "" };
let workDir = "";

async function cleanQa() {
  await prisma.qaCheck.deleteMany();
  await prisma.shortClip.deleteMany();
  await prisma.montageJob.deleteMany();
  await prisma.mediaAsset.deleteMany({ where: { filename: { startsWith: "it-qa-" } } });
  await prisma.complianceRule.deleteMany();
  await prisma.strategyReport.deleteMany();
  await prisma.trendEntry.deleteMany();
  await prisma.trendSource.deleteMany();
  await prisma.bossTurn.deleteMany();
  await prisma.setting.deleteMany({
    where: { OR: ["qa.", "agents.", "boss.", "analysts."].map((p) => ({ key: { startsWith: p } })) },
  });
}

beforeAll(async () => {
  await resetDb();
  await cleanQa();
  await prisma.user.deleteMany({ where: { email: "qa-flow@linkaffipro.internal" } });
  workDir = await mkdtemp(join(tmpdir(), "lap-qa-montage-"));
  // Questions de mise en route des équipes déjà posées : la file des demandes ne contient que celles du QA.
  for (const key of ["agents.dailyReportAsked", "agents.datingSetupAsked", "agents.algoSetupAsked", "agents.sportsSetupAsked", "agents.adsSetupAsked", "agents.casinoSetupAsked"])
    await prisma.setting.create({ data: { key, value: "2026-10-01T00:00:00.000Z" } });
  await prisma.setting.upsert({ where: { key: "admin.telegramUserId" }, create: { key: "admin.telegramUserId", value: String(ADMIN) }, update: { value: String(ADMIN) } });
  ids.user = (await prisma.user.create({ data: { email: "qa-flow@linkaffipro.internal", name: "Mathéo", passwordHash: "x", role: "ADMIN", telegramUserId: BigInt(ADMIN) } })).id;

  const { bot, channel } = await createBotAndChannel({ title: "Canal test" });
  ids.bot = bot.id;
  ids.test = channel.id;
  const casino = await prisma.channel.create({ data: { telegramChatId: -1007766550001n, title: "Casino VIP", type: "CHANNEL", language: "fr", vertical: "CASINO", primaryBotId: bot.id } });
  ids.casino = casino.id;
  await prisma.channelAgentPlan.create({
    data: { channelId: casino.id, teamKey: "casino", enabled: true, postsPerDay: 20, windowStart: "00:00", windowEnd: "24:00", minSpacingMinutes: 0, mix: { video: 0, photo: 0, text: 1 } },
  });
  await prisma.agentTeamConfig.create({ data: { teamKey: "casino", simulation: true, autonomyLevel: 2 } });

  const kevinRec = await prisma.bot.create({
    data: { name: "Kevin", username: "kevin_qa_bot", telegramBotId: BigInt(KEVIN_TG), tokenEncrypted: encrypt(KEVIN_TOKEN), vertical: "CASINO", webhookSecret: "secret-kevin-qa", role: "ADMIN" },
  });
  ids.kevin = kevinRec.id;

  deps = {
    prisma,
    enqueue: {
      async orchestrator(job: AgentsOrchestratorJob) {
        orchestratorJobs.push(job);
      },
      async step(_team: string, _agent: string, job: AgentStepJob, opts?: { delayMs?: number }) {
        if (opts?.delayMs) {
          delayed.push({ job, delayMs: opts.delayMs });
          return;
        }
        if (!steps.some((s) => s.missionId === job.missionId && s.index === job.index)) steps.push(job);
      },
    },
    // Messager du worker : le bot de Kevin (faux Telegram), au seul admin.
    admin: createAdminMessengerWith({ adminId: async () => BigInt(ADMIN), api: async () => kevin.api as unknown as MessengerApi, media: async () => null }),
    logger: { info() {}, warn() {}, error() {} },
    providers: { llm: teamLlm },
    qaLlm,
    analystsLlm,
    analysts: {
      async enqueue(job: AnalystsQueueJob, o: { jobId?: string } = {}) {
        analystsQueue.push({ job, jobId: o.jobId });
      },
    },
    montage: {
      workDir,
      async enqueue(job: MontageQueueJob, o: { jobId?: string } = {}) {
        if (o.jobId && montageQueue.some((q) => q.jobId === o.jobId)) return;
        montageQueue.push({ job, jobId: o.jobId });
      },
      hooks: {
        async onPreviewReady(_d: unknown, _job: unknown, clip: { id: string; subtitlesSrt: string | null }) {
          previews.push({ clipId: clip.id, srt: clip.subtitlesSrt });
          return { messageId: 7000 + previews.length };
        },
      },
    },
  } as unknown as typeof deps;
  // Les processeurs du worker (envoi des posts, agents-algo) utilisent ces mêmes dépendances (fausse IA du QA comprise).
  setWorkerAgentsDeps(deps);

  const tgDeps: TelegramDeps = {
    ...prismaTelegramDeps,
    agentsDeps: () => deps as unknown as AgentsDeps,
    adminDialogBot: async () => ({ id: kevinRec.id, username: kevinRec.username, isBoss: true }),
    workerDown: async () => false,
  };
  kevin = createBot(kevinRec, tgDeps);
  kevinCalls = installFakeTelegram(kevin.api);
  channelCalls = installFakeTelegram((await apiForBot(bot.id)).api);
});

afterAll(async () => {
  setWorkerAgentsDeps(null);
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  await cleanQa();
});

// ------------------------------------------------------------------------------------------------ outils des posts

async function newCasinoMission(texts: string[]): Promise<string> {
  drafts = [...texts];
  const r = await createMission(deps, { teamKey: "casino", channelId: ids.casino, createdBy: "HUMAN", createdById: ids.user, format: "text" });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return (r as { missionId: string }).missionId;
}

/** Envoi d'un post par le VRAI processeur `telegram-send` (verrou du QA compris) ; rend les messages envoyés. */
async function sendPost(postId: string): Promise<TelegramCall[]> {
  await prisma.post.update({ where: { id: postId }, data: { scheduledAt: new Date(Date.now() - 1000) } });
  const n = channelCalls.length;
  // Le scheduler existant réserve le post (SENDING), puis le vrai processeur `telegram-send` l'envoie.
  await processScheduler(fakeJob({ type: "tick" as const }));
  await processTelegramSend(fakeJob({ type: "post" as const, postId }));
  return channelCalls.slice(n).filter((c) => /^send(Message|Photo|Video)$/.test(c.method));
}

const qaRows = (contentId: string) => prisma.qaCheck.findMany({ where: { contentId }, orderBy: { createdAt: "asc" } });

// ------------------------------------------------------------------------------------------------ scénario

describe("QA Global de bout en bout (base réelle, fausse IA du QA, faux Telegram)", () => {
  it("post casino d'agent → QA Global approuve → publié sur le canal Test (approbation réutilisée au point d'envoi)", async () => {
    const missionId = await newCasinoMission(["<b>Ce soir, la roulette tourne pour toi</b>\nUne ambiance de vraie salle, sans bouger de chez toi."]);
    await drain();
    await approveValidations();
    const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(m.status).toBe("DONE");
    const rows = await qaRows(missionId);
    expect(rows.map((r) => r.verdict)).toEqual(["APPROVED"]);
    expect(rows[0]).toMatchObject({ contentType: "POST", teamKey: "casino", modelUsed: QA_MODEL });
    const post = await prisma.post.findUniqueOrThrow({ where: { id: m.postId! } });
    expect(post.channelId).toBe(ids.test);
    const calls = qaLlm.calls.length;
    const sent = await sendPost(post.id);
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.payload.text)).toContain("[SIMULATION équipe Casino → Casino VIP]");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("SENT");
    // Même empreinte à l'étape et au point d'envoi : aucune nouvelle vérification payante.
    expect(qaLlm.calls.length).toBe(calls);
    expect(await qaRows(missionId)).toHaveLength(1);
  });

  it("mot interdit → refusé par le QA → retour à la Rédaction avec les corrections → corrigé → repasse → publié", async () => {
    const missionId = await newCasinoMission([
      "<b>La table de blackjack t'attend</b>\nDe l'argent facile, il suffit de t'asseoir.",
      "<b>La table de blackjack t'attend</b>\nUn croupier en direct et une vraie ambiance de salle.",
    ]);
    const before = redactionCalls.length;
    await drain();
    await approveValidations();
    const rows = await qaRows(missionId);
    expect(rows.map((r) => r.verdict)).toEqual(["REJECTED", "APPROVED"]);
    expect(rows[0]!.attempt).toBe(1);
    expect(rows[1]!.attempt).toBe(2);
    expect((rows[0]!.reasons as Array<{ code: string }>)[0]!.code).toBe("CHANNEL_RULE");
    expect(rows[0]!.contentHash).not.toBe(rows[1]!.contentHash);
    // La Rédaction a reçu les motifs ET les corrections du QA Global.
    const redo = redactionCalls.slice(before)[1]!;
    expect(redo).toContain("contrôle qualité global");
    expect(redo).toContain("argent facile");
    expect(redo).toContain("parle de l'ambiance du jeu");
    expect((await prisma.event.count({ where: { type: "qa.gate.rejected" } })) >= 1).toBe(true);
    const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(m.status).toBe("DONE");
    const post = await prisma.post.findUniqueOrThrow({ where: { id: m.postId! } });
    expect(post.text).not.toContain("argent facile");
    const sent = await sendPost(post.id);
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.payload.text)).not.toContain("argent facile");
  });

  it("contenu modifié après l'approbation → revérifié au point d'envoi → refusé, jamais envoyé, retour à la Rédaction", async () => {
    const missionId = await newCasinoMission(["<b>Le live casino ouvre ses portes</b>\nDes croupiers souriants et des tables pleines."]);
    await drain();
    await approveValidations();
    const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    expect((await qaRows(missionId)).map((r) => r.verdict)).toEqual(["APPROVED"]);
    // Quelqu'un change le texte du post déjà approuvé (avant l'envoi).
    await prisma.post.update({ where: { id: m.postId! }, data: { text: "[SIMULATION équipe Casino → Casino VIP]\nDe l'argent facile au live casino, viens vite." } });
    drafts = ["<b>Le live casino ouvre ses portes</b>\nUne soirée entre amis autour des tables."];
    const sent = await sendPost(m.postId!);
    expect(sent).toHaveLength(0);
    const rows = await qaRows(missionId);
    expect(rows.map((r) => r.verdict)).toEqual(["APPROVED", "REJECTED"]);
    const held = await prisma.post.findUniqueOrThrow({ where: { id: m.postId! } });
    expect(held.status).toBe("CANCELLED");
    expect(held.lastError).toMatch(/^Retenu par le contrôle qualité global/);
    expect(await prisma.event.count({ where: { type: "qa.post.rejected", payload: { path: ["postId"], equals: m.postId! } } })).toBe(1);
    // La mission revient à la Rédaction avec les corrections, refait un post propre, qui part.
    await drain();
    await approveValidations();
    const again = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(again.status).toBe("DONE");
    expect(again.postId).not.toBe(m.postId);
    expect((await qaRows(missionId)).map((r) => r.verdict)).toEqual(["APPROVED", "REJECTED", "APPROVED"]);
    const resent = await sendPost(again.postId!);
    expect(resent).toHaveLength(1);
    expect(String(resent[0]!.payload.text)).not.toContain("argent facile");
  });

  it("post écrit par l'équipe humaine (sans mission) → jamais retenu, aucune vérification", async () => {
    const n = await prisma.qaCheck.count();
    const post = await prisma.post.create({
      data: { channelId: ids.test, botId: ids.bot, code: "it-qa-humain", text: "Message de l'équipe : de l'argent facile ce soir (écrit à la main)", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000) },
    });
    const sent = await sendPost(post.id);
    expect(sent).toHaveLength(1);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("SENT");
    expect(await prisma.qaCheck.count()).toBe(n);
  });

  it("3 refus du même contenu → Kevin demande au client (boutons) → « Publier quand même » appliqué, le post part", async () => {
    const missionId = await newCasinoMission(["<b>Grosse soirée machines à sous</b>\nCe soir c'est jackpot assuré pour tout le monde."]);
    const n = kevinCalls.length;
    await drain();
    const rows = await qaRows(missionId);
    expect(rows.map((r) => r.verdict)).toEqual(["REJECTED", "REJECTED", "REJECTED"]);
    expect(rows.map((r) => r.attempt)).toEqual([1, 2, 3]);
    expect((await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("WAITING_HUMAN");
    expect(await prisma.post.count({ where: { agentMissionId: missionId } })).toBe(0);
    // Une seule question à la fois : la demande de vidéos du casino (posée par la Médiathèque) est passée « plus tard ».
    for (const other of await prisma.humanRequest.findMany({ where: { status: "PENDING", key: { not: `qa.decision.POST.${missionId}` } } }))
      await respondToRequest(deps, other as HumanRequestRow, "plus tard", { via: "TELEGRAM", userId: null });
    const req = await prisma.humanRequest.findFirstOrThrow({ where: { key: `qa.decision.POST.${missionId}` } });
    expect(req.status, JSON.stringify(await prisma.humanRequest.findMany({ select: { key: true, status: true } }))).toBe("PENDING");
    const ask = kevinCalls.slice(n).find((c) => c.method === "sendMessage" && /refusé 3 fois|bloque toujours/.test(String(c.payload.text)));
    expect(ask, kevinTexts(n).join("\n---\n")).toBeDefined();
    expect(unescape(String(ask!.payload.text))).toContain("Promesse de gain");
    const keyboard = (ask!.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard;
    expect(keyboard[0]!.map((b) => b.text)).toEqual(["Publier quand même", "Non"]);
    expect(keyboard[0]![0]!.callback_data).toBe(`agh:${req.id}:oui`);
    // Le client appuie sur « Publier quand même » (vrai handler du bouton de Kevin).
    await kevin.handleUpdate(callbackUpdate(`agh:${req.id}:oui`));
    expect((await prisma.humanRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("ANSWERED");
    expect(await prisma.auditLog.count({ where: { action: "qa.override.approved", entityId: missionId } })).toBe(1);
    await drain();
    await approveValidations();
    const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(m.status).toBe("DONE");
    // L'accord du client vaut pour ce contenu exact : aucun 4e refus, le post part.
    expect((await qaRows(missionId)).filter((r) => r.verdict === "REJECTED")).toHaveLength(3);
    const sent = await sendPost(m.postId!);
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.payload.text)).toContain("jackpot assuré");
    expect(await prisma.event.count({ where: { type: "qa.gate.client_approved" } })).toBeGreaterThanOrEqual(1);
  });

  it("short au sous-titre faux → refusé → retour à l'Habillage → corrigé → repasse → aperçu envoyé", async () => {
    const source = await prisma.mediaAsset.create({
      data: { filename: "it-qa-source.mp4", mimeType: "video/mp4", size: 1, sha256: "it-qa-source", bytes: Buffer.alloc(0), storage: "telegram", kind: "LONG_VIDEO", teamKey: "montage", telegramRef: { chatId: "-1009999", messageId: 1 } },
    });
    const v1 = await prisma.mediaAsset.create({
      data: { filename: "it-qa-short-v0.mp4", mimeType: "video/mp4", size: 3_000_000, sha256: "it-qa-short-v0", bytes: Buffer.alloc(0), storage: "telegram", kind: "SHORT", teamKey: "montage", width: 1080, height: 1920, telegramRef: { chatId: "-1009999", messageId: 2, fileId: "f-v0", fileUniqueId: "u-v0" } },
    });
    const job = await prisma.montageJob.create({
      data: { sourceAssetId: source.id, instructions: { theme: "roulette", subtitles: true, format: "VERTICAL_9_16", durationTarget: 15 }, status: "QC", planApprovedAt: new Date(), sourceMeta: { durationMs: 60_000, width: 1920, height: 1080 } },
    });
    const clip = await prisma.shortClip.create({
      data: {
        montageJobId: job.id,
        index: 1,
        startMs: 0,
        endMs: 15_000,
        durationMs: 15_000,
        subtitles: true,
        subtitlesSrt: "1\n00:00:00,000 --> 00:00:03,000\nBienvenu à la table de roulette\n",
        status: "QC",
        assetId: v1.id,
        qc: { ok: true, problems: [] },
      },
    });
    const run = (j: MontageQueueJob) => processAgentsMontage(fakeJob(j, `montage-${j.type}`) as unknown as Job<AgentsMontageJob>, deps);
    const r1 = (await run({ type: "montage.preview", montageJobId: job.id, shortClipId: clip.id })) as { outcome: string };
    expect(r1.outcome).toMatch(/retour à l'Habillage/);
    expect(previews).toHaveLength(0);
    const redone = await prisma.shortClip.findUniqueOrThrow({ where: { id: clip.id } });
    expect(redone).toMatchObject({ status: "REDO", redoCount: 1, assetId: null, subtitlesSrt: null });
    expect(redone.clientFeedback).toContain("Bienvenue");
    // L'Habillage repart (refabrication en file) : la chaîne refait le short avec le sous-titre corrigé.
    expect(montageQueue.some((q) => q.job.type === "montage.cut" && q.job.shortClipId === clip.id)).toBe(true);
    const v2 = await prisma.mediaAsset.create({
      data: { filename: "it-qa-short-v1.mp4", mimeType: "video/mp4", size: 3_100_000, sha256: "it-qa-short-v1", bytes: Buffer.alloc(0), storage: "telegram", kind: "SHORT", teamKey: "montage", width: 1080, height: 1920, telegramRef: { chatId: "-1009999", messageId: 3, fileId: "f-v1", fileUniqueId: "u-v1" } },
    });
    await prisma.shortClip.update({
      where: { id: clip.id },
      data: { subtitlesSrt: "1\n00:00:00,000 --> 00:00:03,000\nBienvenue à la table de roulette\n", status: "QC", assetId: v2.id, qc: { ok: true, problems: [] } },
    });
    const r2 = (await run({ type: "montage.preview", montageJobId: job.id, shortClipId: clip.id })) as { outcome: string };
    expect(r2.outcome).toBe("aperçu envoyé");
    expect(previews).toEqual([{ clipId: clip.id, srt: expect.stringContaining("Bienvenue à la table") }]);
    expect((await prisma.shortClip.findUniqueOrThrow({ where: { id: clip.id } })).status).toBe("PREVIEW_SENT");
    const rows = await qaRows(clip.id);
    expect(rows.map((r) => [r.contentType, r.verdict])).toEqual([
      ["SHORT", "REJECTED"],
      ["SHORT", "APPROVED"],
    ]);
    expect((rows[0]!.reasons as Array<{ code: string }>)[0]!.code).toBe("SUBTITLE_ERROR");
  });

  it("rapport des Analystes avec un chiffre inventé (et un jeton glissé) → refusé → réécrit → repasse → envoyé", async () => {
    const src = await prisma.trendSource.create({ data: { name: "iGaming Business", url: "https://igamingbusiness.com", sourceType: "NEWS", market: "CASINO" } });
    ids.source = src.id;
    const entry = await prisma.trendEntry.create({
      data: { sourceId: src.id, market: "CASINO", countries: ["FR"], language: "fr", title: "Vidéos courtes casino", summary: "Les vidéos courtes de casino progressent en France.", url: NEWS_URL, urlHash: "it-qa-news", category: "MARKET_TREND", sentiment: "POSITIVE", relevanceScore: 7, verified: true, publishedAt: new Date() },
    });
    const now = new Date();
    const period = (() => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const day = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - day);
      const y = d.getUTCFullYear();
      const w = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
      return `${y}-W${String(w).padStart(2, "0")}`;
    })();
    const markets = [
      { market: "CASINO", label: "Casino", trends: [{ text: "Les vidéos courtes de casino progressent en France", url: NEWS_URL, verified: true }], alert: null, recommendation: null },
      { market: "SPORTS", label: "Paris sportifs", trends: [], alert: null, recommendation: null },
      { market: "DATING", label: "Rencontres", trends: [], alert: null, recommendation: null },
    ];
    const badText = [
      `Rapport de la semaine ${Number(period.slice(-2))}`,
      "",
      "Casino",
      `- 87 % des pubs casino passent mieux en vidéo courte (${NEWS_URL})`,
      `Jeton du bot pour tester : ${LEAKED_TOKEN}`,
      "",
      "0 nouvelles règles compliance ajoutées.",
      "Détail complet sur le site : https://app.linkaffipro.com/agents/analyses",
    ].join("\n");
    const report = await prisma.strategyReport.create({
      data: { market: null, period, reportType: "WEEKLY", title: "Rapport de la semaine", summary: badText.slice(0, 200), content: { text: badText, markets, newRules: 0, usedEntryIds: [entry.id], sources: [{ url: NEWS_URL }] }, recommendations: [] },
    });
    const n = kevinCalls.length;
    const r = (await processAgentsAnalystes(
      { id: "rep", name: "agents-analystes:analysts.report", data: { type: "analysts.report", kind: "weekly", reportId: report.id } } as unknown as Job<AgentsAnalystesJob>,
      async () => deps,
    )) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, sent: true });
    const rows = await qaRows(report.id);
    expect(rows.map((x) => x.verdict)).toEqual(["REJECTED", "APPROVED"]);
    const codes = (rows[0]!.reasons as Array<{ code: string }>).map((x) => x.code);
    expect(codes).toContain("INVENTED_NUMBER");
    expect(codes).toContain("SENSITIVE_DATA");
    expect(await prisma.event.count({ where: { type: "qa.report.returned" } })).toBe(1);
    const sentText = unescape(kevinTexts(n).join("\n"));
    expect(sentText).toContain("Rapport de la semaine");
    expect(sentText).not.toContain("87 %");
    expect(sentText).not.toContain(LEAKED_TOKEN);
    expect((await prisma.strategyReport.findUniqueOrThrow({ where: { id: report.id } })).sentAt).toBeInstanceOf(Date);
    ids.entry = entry.id;
  });

  it("réponse de Kevin rédigée par l'IA hallucinée → refusée → régénérée avec les corrections → repasse → envoyée", async () => {
    const reply = unescape(await say("Kevin, comment vont les équipes ?"));
    expect(reply).toContain(HONEST);
    expect(reply).not.toContain("record");
    const rows = await prisma.qaCheck.findMany({ where: { contentType: "KEVIN_RESPONSE" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((x) => x.verdict)).toEqual(["REJECTED", "APPROVED"]);
    expect(rows[0]!.contentId).toBe(rows[1]!.contentId);
    expect((rows[0]!.reasons as Array<{ code: string }>)[0]!.code).toBe("HALLUCINATION");
    // La nouvelle rédaction a reçu les corrections du QA.
    expect(fakeBossLlm.calls.write.some((w) => w.user.includes("CORRECTIONS DEMANDÉES") && w.user.includes("Ne parle que des données consultées"))).toBe(true);
  });

  it("recommandation qui contredit une règle publicitaire active → refusée par le QA, jamais montrée ni appliquée", async () => {
    const rule = await prisma.complianceRule.create({
      data: { platform: "TIKTOK", market: "CASINO", country: "FR", rule: "TikTok refuse les pubs de casino qui mettent en avant un bonus en France.", riskLevel: "HIGH", verified: true, lastVerifiedAt: new Date(), evidence: [{ url: NEWS_URL }] },
    });
    ids.rule = rule.id;
    const good = await prisma.recommendation.create({
      data: { teamKey: "analystes", target: "MARKET", targetId: "CASINO:FR", field: "adIdea", after: { title: "Vidéo courte de roulette en direct, sans incitation" }, evidence: { urls: [NEWS_URL] }, source: "market_analysis" },
    });
    const bad = await prisma.recommendation.create({
      data: { teamKey: "analystes", target: "MARKET", targetId: "CASINO:FR", field: "adIdea", after: { title: "Pub TikTok casino avec un bonus de bienvenue en France" }, evidence: { urls: [NEWS_URL] }, source: "market_analysis" },
    });
    // File de rattrapage `qa-sweep` (vrai processeur `agents-algo`).
    const r = (await processAgentsAlgo(fakeJob({ type: "qa-sweep" as const }) as never)) as Record<string, unknown>;
    expect(r).toMatchObject({ checked: 2, approved: 1, rejected: 1 });
    const badRow = await prisma.recommendation.findUniqueOrThrow({ where: { id: bad.id } });
    expect(badRow.status).toBe("REJECTED");
    expect(badRow.comment).toMatch(/^Refusée par le contrôle qualité : Contredit une règle publicitaire active/);
    expect(badRow.appliedAt).toBeNull();
    // Contexte croisé : la règle des Analystes est bien arrivée au QA avec la recommandation.
    const seen = judged.filter((j) => j.type === "RECOMMENDATION");
    expect(seen.every((j) => JSON.stringify(j.context.complianceRules).includes("bonus en France"))).toBe(true);
    // Jamais montrée comme prête, jamais appliquée.
    const recLike = { ...badRow, after: badRow.after, evidence: badRow.evidence };
    expect(await isRecommendationApproved(deps, recLike)).toBe(false);
    expect(await recommendationNotApproved(deps, recLike)).toBe(QA_REC_REFUSED_TEXT);
    expect(await isRecommendationApproved(deps, { ...good, after: good.after, evidence: good.evidence })).toBe(true);
    expect(await prisma.event.count({ where: { type: "qa.recommendation.rejected", payload: { path: ["recommendationId"], equals: bad.id } } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.event.count({ where: { type: "qa.recommendation.rejected", payload: { path: ["recommendationId"], equals: good.id } } })).toBe(0);
  });

  it("alerte faux positif → refusée par le QA → annulée et journalisée, jamais envoyée", async () => {
    const entry = await prisma.trendEntry.create({
      data: { sourceId: ids.source, market: "CASINO", countries: ["FR"], language: "fr", title: "Rumeur de forum", summary: "Une rumeur dit que Meta va bannir tous les comptes casino demain.", url: "https://igamingbusiness.com/fr/forum/rumeur-meta", urlHash: "it-qa-rumeur", category: "AD_BAN", sentiment: "NEGATIVE", relevanceScore: 9, verified: false },
    });
    // Alerte retenue faute de QA plus tôt : la file de rattrapage la relance (vraie fonction des Analystes).
    await prisma.setting.create({ data: { key: `qa.pendingAlert.entry.${entry.id}`, value: { at: new Date().toISOString(), mode: "risk" } } });
    const n = kevinCalls.length;
    const r = (await processAgentsAlgo(fakeJob({ type: "qa-sweep" as const }) as never)) as Record<string, unknown>;
    expect(r.alerts).toBe(0);
    expect(kevinTexts(n).join("\n")).not.toMatch(/rumeur/i);
    const rows = await qaRows(`entry:${entry.id}`);
    expect(rows.map((x) => [x.contentType, x.verdict])).toEqual([["ALERT", "REJECTED"]]);
    expect((rows[0]!.reasons as Array<{ code: string }>)[0]!.code).toBe("FALSE_ALERT");
    expect(await prisma.setting.findUnique({ where: { key: `qa.alertCancelled.entry.${entry.id}` } })).not.toBeNull();
    expect(await prisma.setting.findUnique({ where: { key: `qa.pendingAlert.entry.${entry.id}` } })).toBeNull();
    expect(await prisma.event.count({ where: { type: "qa.alert.cancelled", payload: { path: ["id"], equals: entry.id } } })).toBe(1);
    // Relancée : jamais renvoyée (annulée pour de bon).
    await prisma.setting.create({ data: { key: `qa.pendingAlert.entry.${entry.id}`, value: { at: new Date().toISOString(), mode: "risk" } } });
    await processAgentsAlgo(fakeJob({ type: "qa-sweep" as const }) as never);
    expect(kevinTexts(n).join("\n")).not.toMatch(/rumeur/i);
  });

  it("QA indisponible (faux modèle en panne) → rien ne sort, jamais approuvé par défaut, Kevin prévient", async () => {
    qaMode = "down";
    try {
      // Post d'agent : l'étape attend (rien ne part).
      const missionId = await newCasinoMission(["<b>Soirée poker entre amis</b>\nDes tables calmes et des joueurs sympas."]);
      const outcomes = await drain();
      expect(outcomes.at(-1)).not.toBe("done");
      const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
      expect(m.postId).toBeNull();
      expect(await prisma.post.count({ where: { agentMissionId: missionId } })).toBe(0);
      expect((m.payload as { qaWaitingSince?: string }).qaWaitingSince).toBeTruthy();
      const rows = await qaRows(missionId);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.verdict === "ERROR" && r.modelUsed === QA_MODEL)).toBe(true);
      expect((rows[0]!.reasons as Array<{ code: string }>).map((r) => r.code)).toContain("QA_MODEL_UNAVAILABLE");

      // Post d'agent déjà programmé mais jamais approuvé : retenu au point d'envoi, remis à plus tard.
      const orphan = await prisma.post.create({
        data: { channelId: ids.test, botId: ids.bot, code: "it-qa-orphelin", text: "[SIMULATION équipe Casino → Casino VIP]\nUn post jamais vérifié.", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000), agentMissionId: missionId },
      });
      expect(await sendPost(orphan.id)).toHaveLength(0);
      const held = await prisma.post.findUniqueOrThrow({ where: { id: orphan.id } });
      expect(held.status).toBe("SCHEDULED");
      expect(held.scheduledAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
      expect(held.lastError).toMatch(/En attente du contrôle qualité global/);
      await prisma.post.delete({ where: { id: orphan.id } });

      // Réponse de Kevin rédigée par l'IA : jamais envoyée sans vérification, phrase fixe à la place.
      await prisma.setting.deleteMany({ where: { key: "qa.kevin.pauseSaidAt" } });
      const reply = unescape(await say("Kevin, comment vont les équipes ?"));
      expect(reply.startsWith(QA_PAUSED_TEXT)).toBe(true);
      expect(reply).not.toContain(HALLUCINATED);
      expect(reply).not.toContain(HONEST);

      // Panne de plus de 5 minutes : Kevin prévient le client (vrai processeur `qa-alerts`).
      // Horloge : les vérifications d'avant la panne datent d'il y a 10 minutes, la panne commence il y a 6 minutes.
      await prisma.qaCheck.updateMany({ where: { verdict: { not: "ERROR" } }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
      await prisma.qaCheck.updateMany({ where: { verdict: "ERROR" }, data: { createdAt: new Date(Date.now() - 6 * 60_000) } });
      await prisma.qaCheck.create({
        data: { contentType: "POST", contentId: missionId, teamKey: "casino", contentHash: "f".repeat(64), verdict: "ERROR", reasons: [{ code: "QA_MODEL_UNAVAILABLE", message: "panne", severity: "critical" }], modelUsed: QA_MODEL, durationMs: 1 },
      });
      const n = kevinCalls.length;
      await processAgentsAlgo(fakeJob({ type: "qa-alerts" as const }) as never);
      expect(kevinTexts(n)).toContain(QA_ALERT_TEXTS.unavailable);
      // Une seule fois par panne.
      const n2 = kevinCalls.length;
      await processAgentsAlgo(fakeJob({ type: "qa-alerts" as const }) as never);
      expect(kevinTexts(n2)).not.toContain(QA_ALERT_TEXTS.unavailable);
      await prisma.qaCheck.deleteMany({ where: { contentHash: "f".repeat(64) } });

      // Le QA revient : la mission retenue repart et finit publiée.
      qaMode = "normal";
      await prisma.agentMission.update({ where: { id: missionId }, data: { status: "RUNNING" } });
      steps.push({ type: "step", missionId, index: m.currentStep });
      await drain();
      await approveValidations();
      const done = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
      expect(done.status).toBe("DONE");
      expect((await qaRows(missionId)).at(-1)!.verdict).toBe("APPROVED");
    } finally {
      qaMode = "normal";
    }
  });

  it("délai dépassé → TIMEOUT, rien ne sort", async () => {
    await prisma.setting.create({ data: { key: "qa.timeout_ms", value: 1000 } });
    qaMode = "slow";
    try {
      const missionId = await newCasinoMission(["<b>Le baccara en direct</b>\nUne table élégante et un croupier attentif."]);
      await drain();
      const rows = await qaRows(missionId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ verdict: "TIMEOUT", modelUsed: QA_MODEL });
      expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(900);
      expect((rows[0]!.reasons as Array<{ code: string }>).map((r) => r.code)).toContain("QA_TIMEOUT");
      expect(await prisma.post.count({ where: { agentMissionId: missionId } })).toBe(0);
      await prisma.agentMission.update({ where: { id: missionId }, data: { status: "CANCELLED" } });
    } finally {
      qaMode = "normal";
      await prisma.setting.deleteMany({ where: { key: "qa.timeout_ms" } });
    }
  });

  it("texte fixe de Kevin (confirmation OUI) → jamais retenu, aucune vérification", async () => {
    const n = await prisma.qaCheck.count();
    const ask = unescape(await say("Kevin, monte le plafond IA du casino"));
    expect(ask).toMatch(/OUI/);
    const done = unescape(await say("OUI"));
    expect(done.length).toBeGreaterThan(0);
    expect(done).not.toMatch(/Rien à confirmer/);
    expect(done).not.toContain(QA_PAUSED_TEXT);
    expect(await prisma.qaCheck.count()).toBe(n);
  });

  it("« Kevin, combien de refus cette semaine ? » → réponse juste (lue en base)", async () => {
    const all = await prisma.qaCheck.findMany();
    const refused = all.filter((r) => r.verdict === "REJECTED").length;
    expect(refused).toBeGreaterThanOrEqual(10);
    const n = all.length;
    const reply = unescape(await say("Kevin, combien de refus cette semaine ?"));
    expect(reply).toContain(`Sur 7 jours : ${refused} refus sur ${n} contenus vérifiés.`);
    // Lecture seule : la réponse elle-même n'est pas vérifiée (texte écrit par le code).
    expect(await prisma.qaCheck.count()).toBe(n);
  });

  it("chaque vérification a son QaCheck : Fable 5.1, empreinte, contenu masqué sans secret", async () => {
    const rows = await prisma.qaCheck.findMany();
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) {
      expect(r.modelUsed).toBe("claude-fable-5-1");
      expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.checkedBy).toBe("qa-global");
      expect(r.content).not.toBeNull();
      const stored = JSON.stringify(r.content);
      expect(stored).not.toContain(LEAKED_TOKEN);
      expect(stored).not.toContain(TEST_BOT_TOKEN);
      expect(stored).not.toContain(KEVIN_TOKEN);
    }
    const report = rows.find((r) => r.contentType === "REPORT" && r.verdict === "REJECTED")!;
    expect(JSON.stringify(report.content)).toContain("[masqué]");
    // Le modèle n'a jamais vu le jeton non plus.
    expect(qaLlm.calls.some((c) => c.user.includes(LEAKED_TOKEN))).toBe(false);
    // Jamais un autre modèle, jamais d'approbation par défaut : toute approbation vient d'un verdict du modèle.
    expect(rows.filter((r) => r.verdict === "APPROVED").every((r) => r.durationMs >= 0 && Array.isArray(r.reasons))).toBe(true);
    // Le journal du QA ne contient jamais le texte vérifié.
    const events = await prisma.event.findMany({ where: { type: { startsWith: "qa." } } });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(JSON.stringify(e.payload)).not.toMatch(/argent facile|jackpot assuré|Bienvenu |87 %/);
  });
});
