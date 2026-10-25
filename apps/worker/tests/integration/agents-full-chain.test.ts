/**
 * Phase 25 : toute la chaîne des agents sur 3 jours simulés (base réelle, horloge injectée), les quatre équipes et
 * l'Agent Ads ensemble, en simulation (tout part sur le canal Test) :
 * - jour 1 (samedi 10 h) : plan du jour Dating (vidéo, photo, texte : faux fournisseur) et Casino (vidéo déposée,
 *   repli en texte, demande groupée), passage Paris (fausses cotes, fausse capture) ; « redémarrage du worker » avant
 *   la première étape (tâches perdues, reprises par le balayage `resume`) ; validations par le faux Telegram (« ok n »,
 *   « non n ») et par le site (`decideValidation` via SITE) ; envoi par le scheduler ; rapports du Grand Chef et Ads ;
 *   le soir, fiches des posts, horaires, un test A/B lancé, une recommandation appliquée par le Grand Chef ;
 * - jour 2 : la Planification Dating utilise la fenêtre recommandée ; variante du test A/B tirée ; pause de l'équipe
 *   Dating en pleine mission (« pause dating » / « reprends dating ») ; mission casino « coupée » en pleine
 *   publication et reprise sans second message ;
 * - jour 3 : recommandation annulée (plan d'origine remis), plafond vidéo atteint (repli vidéo → photo), résultats des
 *   paris réglés ; supervision (`agentsOverview`) cohérente ; AUCUN `Post` hors canal Test.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  agentsOverview,
  autoApplyPending,
  createExperiment,
  createFakeImageProvider,
  createFakeLlm,
  createFakeOddsProvider,
  createFakeVideoProvider,
  decideValidation,
  FAKE_ODDS_ANCHOR,
  fallbackPng,
  fromParis,
  handleAdminText,
  overviewLines,
  parisDay,
  parisMinutes,
  runAdsTick,
  runAlgoNightly,
  runCycle,
  runNextStep,
  runSportsSettle,
  storeLibraryMedia,
  undoRecommendation,
  type AgentStepJob,
  type CaptureRequest,
  type CaptureResult,
  type EngineDeps,
  type FrameExtractor,
  type VideoProvider,
} from "@linkaffipro/agents";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { createBotAndChannel, fakeJob, installFakeTelegram, resetDb } from "./helpers";

const MIN = 60_000;
// Samedi 24 octobre 2026, 10 h à Paris (heure de passage du Chef Paris et des fixtures de cotes).
const DAY1 = parisDay(FAKE_ODDS_ANCHOR);
const at10 = (d: number) => fromParis(addDays(DAY1, d), 10 * 60);
function addDays(day: string, n: number): string {
  const [y, m, dd] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}

let now = at10(0);
const steps: AgentStepJob[] = [];
const adminSent: Array<{ html: string; messageId: number }> = [];
let nextMsg = 50_000;

const loadAsset = async (id: string) => {
  const a = await prisma.mediaAsset.findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true } });
  return a ? { bytes: new Uint8Array(a.bytes), mimeType: a.mimeType, filename: a.filename } : null;
};
const frames: FrameExtractor = async () => ({ frames: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])], durationSec: 8 });
const fakeVideo = createFakeVideoProvider({ loadAsset });
/** Même faux fournisseur, mais chaque vidéo est estimée à 50 c : sert à atteindre le plafond le jour 3. */
const pricedVideo: VideoProvider = { ...fakeVideo, estimateCents: () => 50 };
const odds = createFakeOddsProvider({ now: () => now });
const screenshot = {
  name: "fake",
  async capture(req: CaptureRequest): Promise<CaptureResult> {
    return { ok: true, png: fallbackPng(320, 200), readOdds: req.expectedOdds, pageUrl: "https://www.sportaza.example/match" };
  },
  async testConnection(): Promise<CaptureResult> {
    return { ok: true, png: fallbackPng(10, 10), readOdds: 0, pageUrl: "https://www.sportaza.example" };
  },
  async renderTemplate(): Promise<Uint8Array> {
    return fallbackPng(1080, 1080);
  },
};
const providers: NonNullable<EngineDeps["providers"]> = {
  llm: createFakeLlm(),
  video: fakeVideo,
  image: createFakeImageProvider({ loadAsset }),
  odds,
  screenshot,
};
const deps: EngineDeps = {
  prisma,
  now: () => now,
  enqueue: {
    async orchestrator() {},
    async step(_team, _agent, job) {
      if (!steps.some((s) => s.missionId === job.missionId && s.index === job.index)) steps.push(job);
    },
  },
  admin: {
    async send(html) {
      const messageId = nextMsg++;
      adminSent.push({ html, messageId });
      return { messageId };
    },
  },
  providers,
  frames,
};

async function drain(limit = Number.POSITIVE_INFINITY): Promise<string[]> {
  const out: string[] = [];
  while (steps.length && out.length < limit) {
    const s = steps.shift()!;
    out.push(await runNextStep(deps, s.missionId, s.index));
  }
  return out;
}

/** Message texte de l'admin au bot (faux Telegram). */
async function admin(text: string) {
  const r = await handleAdminText(deps, { text, messageId: nextMsg++ });
  await r.followUp?.();
  return r;
}

/**
 * Validations en attente : la première par « ok n » (Telegram), la suivante par le site, en alternance ; `reject`
 * refuse par « non n » celles de ces missions.
 */
async function decideAll(reject: ReadonlySet<string> = new Set()): Promise<{ telegram: number; site: number; rejected: number }> {
  const out = { telegram: 0, site: 0, rejected: 0 };
  for (let round = 0; round < 4; round++) {
    const pending = await prisma.agentValidation.findMany({ where: { status: "PENDING" }, orderBy: { number: "asc" } });
    if (!pending.length) break;
    for (const [i, v] of pending.entries()) {
      if (reject.has(v.missionId)) {
        expect((await admin(`non ${v.number} trop long`)).reply).toBeTruthy();
        out.rejected++;
      } else if (i % 2 === 0) {
        await admin(`ok ${v.number}`);
        out.telegram++;
      } else {
        expect((await decideValidation(deps, { validationId: v.id, decision: "approve", via: "SITE" })).ok).toBe(true);
        out.site++;
      }
    }
    await drain();
  }
  return out;
}

/** Fin de journée : les posts programmés partent par le scheduler existant (bot simulé, heure réelle). */
async function sendScheduled(): Promise<number> {
  const posts = await prisma.post.findMany({ where: { status: "SCHEDULED", agentMissionId: { not: null } } });
  if (!posts.length) return 0;
  await prisma.post.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { scheduledAt: new Date(Date.now() - 1000) } });
  await processScheduler(fakeJob({ type: "tick" as const }));
  for (const p of posts) await processTelegramSend(fakeJob({ type: "post" as const, postId: p.id }));
  return posts.length;
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4VmFDEmIY1TCqYfhqAACh3JoQLIL4OAAAAABJRU5ErkJggg==", "base64");

describe("toute la chaîne des agents sur 3 jours simulés (base réelle)", { timeout: 600_000 }, () => {
  let testChannelId = "";
  let datingId = "";
  let casinoId = "";
  let sportsId = "";
  let recId = "";
  let experimentId = "";
  const dayMissions: string[][] = [];

  // `createdAt` / `updatedAt` sont posés par la base à l'heure RÉELLE : les missions d'un jour simulé se repèrent par
  // différence d'identifiants, jamais par date de création.
  const known = new Set<string>();
  const missionsOf = async (team: string, day: number) =>
    prisma.agentMission.findMany({ where: { teamKey: team, id: { in: dayMissions[day] ?? [] } }, orderBy: { id: "asc" } });
  /** Range les missions nouvelles dans le jour en cours (`append`) ou dans un nouveau jour. */
  async function markDay(append = false): Promise<string[]> {
    const ids = (await prisma.agentMission.findMany({ select: { id: true } })).map((m) => m.id).filter((id) => !known.has(id));
    for (const id of ids) known.add(id);
    if (append && dayMissions.length) dayMissions.at(-1)!.push(...ids);
    else dayMissions.push(ids);
    return ids;
  }

  beforeAll(async () => {
    await resetDb();
    await prisma.bettingPick.deleteMany();
    await prisma.setting.deleteMany({ where: { OR: [{ key: { startsWith: "agents." } }, { key: { startsWith: "besthours." } }] } });
    await prisma.alert.deleteMany({ where: { OR: [{ kind: { startsWith: "agents_" } }, { kind: { startsWith: "ads_" } }] } });
    const old = await prisma.mediaAsset.findMany({
      where: { OR: [{ teamKey: { in: ["dating", "casino", "sports"] } }, { filename: { startsWith: "it-chain-" } }, { kind: { in: ["SCREENSHOT", "GENERATED", "PHOTO"] } }] },
      select: { id: true },
    });
    await prisma.mediaAssetTelegramFile.deleteMany({ where: { assetId: { in: old.map((a) => a.id) } } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });
    // Questions de mise en route et du rapport déjà posées : la file des demandes ne contient que celles de la chaîne.
    for (const key of ["agents.dailyReportAsked", "agents.datingSetupAsked", "agents.algoSetupAsked", "agents.casinoSetupAsked", "agents.sportsSetupAsked", "agents.adsSetupAsked"])
      await prisma.setting.create({ data: { key, value: "2026-10-01T00:00:00.000Z" } });

    const { bot, channel } = await createBotAndChannel({ title: "Canal test" });
    testChannelId = channel.id;
    const mk = (title: string, vertical: "DATING" | "CASINO" | "SPORTS", chat: bigint) =>
      prisma.channel.create({ data: { telegramChatId: chat, title, type: "CHANNEL", language: "fr", vertical, primaryBotId: bot.id } });
    datingId = (await mk("Rencontres Léa", "DATING", -1001110000001n)).id;
    casinoId = (await mk("Casino VIP", "CASINO", -1001110000002n)).id;
    sportsId = (await mk("Paris VIP", "SPORTS", -1001110000003n)).id;

    // Dating : persona avec photo de référence et 4 vidéos sources ; niveau 0 (tout est validé).
    const ref = await prisma.mediaAsset.create({
      data: { filename: "it-chain-ref.png", mimeType: "image/png", size: PNG.length, sha256: randomBytes(16).toString("hex"), bytes: PNG, kind: "REFERENCE", origin: "HUMAN", teamKey: "dating" },
    });
    const persona = await prisma.persona.create({ data: { name: "Léa Chaîne", referenceImageIds: [ref.id], mediaNotes: "tenue décontractée" } });
    await prisma.mediaAsset.update({ where: { id: ref.id }, data: { personaId: persona.id } });
    for (let i = 0; i < 4; i++) {
      const bytes = randomBytes(64);
      await prisma.mediaAsset.create({
        data: { filename: `it-chain-src${i}.mp4`, mimeType: "video/mp4", size: bytes.length, sha256: randomBytes(16).toString("hex"), bytes, duration: 8, kind: "SOURCE", origin: "HUMAN", teamKey: "dating", personaId: persona.id },
      });
    }
    await prisma.channelAgentPlan.create({
      data: { channelId: datingId, teamKey: "dating", enabled: true, postsPerDay: 3, windowStart: "09:00", windowEnd: "23:00", minSpacingMinutes: 30, mix: { video: 1, photo: 1, text: 1 }, personaId: persona.id },
    });

    // Casino : une seule vidéo « roulette » déposée (comme par le bot), niveau 2.
    await prisma.channelAgentPlan.create({
      data: { channelId: casinoId, teamKey: "casino", enabled: true, postsPerDay: 2, windowStart: "09:00", windowEnd: "23:00", minSpacingMinutes: 30, mix: { video: 1, photo: 0, text: 1 }, themes: [{ theme: "roulette", weight: 1 }] },
    });
    await prisma.agentTeamConfig.create({ data: { teamKey: "casino", autonomyLevel: 2 } });
    const stored = await storeLibraryMedia(deps, {
      bytes: randomBytes(64),
      mimeType: "video/mp4",
      filename: "it-chain-casino.mp4",
      duration: 8,
      caption: "#casino #roulette",
      botId: bot.id,
      telegramFileId: "file-chain",
      fileUniqueId: "uniq-chain",
    });
    expect(stored.ok).toBe(true);

    // Paris : une catégorie de test, 2 paris par jour, passage de 10 h ; niveau 2.
    await prisma.agentTeamConfig.create({ data: { teamKey: "sports", autonomyLevel: 2, settings: { sports: { runHours: [10] } } } });
    await prisma.betCategory.updateMany({ data: { active: false } });
    await prisma.betCategory.upsert({
      where: { key: "it-chain" },
      create: {
        key: "it-chain",
        name: "Tirs cadrés (chaîne)",
        marketTypes: ["shots_onGoal-all-game-ou-over", "shots_onGoal-home-game-ou-over"],
        leagues: ["EPL", "LA_LIGA", "FR_LIGUE_1", "BUNDESLIGA"],
        bookmakers: ["sportaza"],
        minOdds: 1.5,
        maxOdds: 3.5,
        picksPerDay: 2,
        channelIds: [sportsId],
        active: true,
        sortOrder: 99,
      },
      update: { active: true, channelIds: [sportsId], picksPerDay: 2 },
    });
    // Algorithme : niveau 1 (les petits réglages s'appliquent seuls).
    await prisma.agentTeamConfig.create({ data: { teamKey: "algo", autonomyLevel: 1 } });
    installFakeTelegram((await apiForBot(bot.id)).api);
  });

  it("jour 1 : redémarrage avant la 1re étape, reprise, validations Telegram et site, envois, rapports", async () => {
    const cycle = await runCycle(deps);
    expect(cycle.plan).toMatchObject({ created: 5 });
    // « Redémarrage du worker » : les tâches en file sont perdues.
    expect(steps.length).toBeGreaterThan(0);
    steps.length = 0;
    now = new Date(now.getTime() + 20 * MIN);
    const again = await runCycle(deps);
    expect(again.plan).toMatchObject({ created: 0 });
    expect((again.resume as { requeued: number }).requeued).toBe(6);
    await drain();
    await markDay();

    const dating = await missionsOf("dating", 0);
    expect(dating.map((m) => (m.payload as { plannedFormat?: string; format?: string }).format).sort()).toEqual(["photo", "text", "video"]);
    // Le texte du Dating est refusé par « non n » : la mission est annulée.
    const textMission = dating.find((m) => (m.payload as { format?: string }).format === "text")!;
    const decided = await decideAll(new Set([textMission.id]));
    expect(decided.telegram).toBeGreaterThan(0);
    expect(decided.site).toBeGreaterThan(0);
    expect(decided.rejected).toBe(1);

    // Missions sœurs des paris créées par l'étape Cotes : rattachées au jour 1.
    await markDay(true);
    const all = await prisma.agentMission.findMany({ where: { id: { in: dayMissions[0] } } });
    const byTeam = (t: string) => all.filter((m) => m.teamKey === t);
    expect(byTeam("dating").map((m) => m.status).sort()).toEqual(["CANCELLED", "DONE", "DONE"]);
    expect(byTeam("casino").every((m) => m.status === "DONE")).toBe(true);
    expect(byTeam("casino")).toHaveLength(2);
    expect(byTeam("sports").filter((m) => m.status === "DONE").length).toBe(2);
    // Casino : la vidéo déposée est publiée, l'autre post reste un texte ; demande groupée envoyée une fois.
    const casinoMedia = byTeam("casino").map((m) => (m.payload as { mediaAssetId?: string | null }).mediaAssetId).filter(Boolean);
    expect(casinoMedia).toHaveLength(1);
    expect(await prisma.humanRequest.count({ where: { key: { startsWith: "media.casino." } } })).toBe(1);

    expect(await sendScheduled()).toBe(6);
    expect(await prisma.post.count({ where: { status: "SENT" } })).toBe(6);
    // Rapports du jour : Grand Chef (9 h passé) et Ads.
    expect(await prisma.event.count({ where: { type: "agents.report.daily" } })).toBe(1);
    await runAdsTick(deps);
    expect(await prisma.insightReport.count({ where: { teamKey: "ads", weekStart: DAY1 } })).toBe(1);
    expect(adminSent.some((m) => m.html.includes("Rapport des agents"))).toBe(true);
  });

  it("soir du jour 1 : fiches des posts, horaires, test A/B lancé, recommandation appliquée par le Grand Chef", async () => {
    now = fromParis(DAY1, 22 * 60);
    const nightly = await runAlgoNightly(deps);
    expect(nightly.out).not.toHaveProperty("posts.error");
    const insights = await prisma.postInsight.findMany();
    expect(insights).toHaveLength(6);
    expect(insights.every((i) => i.agentMissionId && i.channelId === testChannelId)).toBe(true);
    expect(nightly.horaires).toBeTruthy();

    const exp = await createExperiment(deps, {
      teamKey: "dating",
      channelId: datingId,
      kind: "STYLE_LEGENDE",
      hypothesis: "question contre affirmation",
      variants: { A: { label: "question", style: "Termine par une question." }, B: { label: "affirmation", style: "Affirme." } } as never,
      metric: "offer_ctr",
      start: true,
    });
    expect(exp.ok).toBe(true);
    experimentId = exp.id!;
    expect((await prisma.experiment.findUniqueOrThrow({ where: { id: experimentId } })).status).toBe("RUNNING");

    // Proposition de la Synthèse : fenêtre du soir (petit réglage) ; niveau 1 → appliquée seule par le Grand Chef.
    const rec = await prisma.recommendation.create({
      data: { teamKey: "dating", target: "CHANNEL_PLAN", targetId: datingId, field: "window", before: { windowStart: "09:00", windowEnd: "23:00" }, after: { windowStart: "18:00", windowEnd: "22:00" }, size: "SMALL", status: "PROPOSED" },
    });
    recId = rec.id;
    expect((await autoApplyPending(deps, 1)).applied).toEqual([rec.id]);
    expect(await prisma.channelAgentPlan.findUniqueOrThrow({ where: { channelId: datingId } })).toMatchObject({ windowStart: "18:00", windowEnd: "22:00" });
  });

  it("jour 2 : fenêtre recommandée utilisée, variante A/B tirée, pause en pleine mission puis reprise", async () => {
    now = at10(1);
    await runCycle(deps);
    await markDay();
    // Une étape seulement, puis « pause dating » sur Telegram : plus aucune étape Dating ne tourne.
    await drain(1);
    expect((await admin("pause dating")).reply).toBe("Équipe Rencontres en pause ⏸");
    const out = await drain();
    expect(out).toContain("halted");
    const paused = await missionsOf("dating", 1);
    expect(paused).toHaveLength(3);
    expect(paused.every((m) => ["PENDING", "RUNNING"].includes(m.status))).toBe(true);
    expect(await prisma.agentValidation.count({ where: { missionId: { in: paused.map((m) => m.id) } } })).toBe(0);
    // Un passage du Grand Chef pendant la pause ne relance rien pour le Dating.
    now = new Date(now.getTime() + 20 * MIN);
    await runCycle(deps);
    expect(steps.filter((s) => paused.some((m) => m.id === s.missionId))).toHaveLength(0);

    expect((await admin("reprends dating")).reply).toBe("Équipe Rencontres reprend ▶️");
    now = new Date(now.getTime() + 20 * MIN);
    await runCycle(deps);
    await drain();
    await decideAll();
    await markDay(true);

    const dating = await missionsOf("dating", 1);
    expect(dating.every((m) => m.status === "DONE")).toBe(true);
    for (const m of dating) {
      // Planification : créneau dans la fenêtre recommandée (18 h - 22 h, heure de Paris).
      const minutes = parisMinutes(m.scheduledFor!);
      expect(minutes).toBeGreaterThanOrEqual(18 * 60);
      expect(minutes).toBeLessThan(22 * 60);
      // Test A/B en cours : chaque mission a tiré sa variante.
      expect((m.payload as { experiment?: { id: string; variant: string } }).experiment).toMatchObject({ id: experimentId, variant: expect.stringMatching(/^[AB]$/) });
    }
    const posts = await prisma.post.findMany({ where: { agentMissionId: { in: dating.map((m) => m.id) } } });
    expect(posts.every((p) => p.abGroupId === `exp_${experimentId}` && /^[AB]$/.test(p.abVariant ?? ""))).toBe(true);
  });

  it("jour 2 : mission casino coupée en pleine publication, reprise sans second message", async () => {
    const start = at10(1);
    const casino = await missionsOf("casino", 1);
    expect(casino).toHaveLength(2);
    const m = casino.find((x) => x.status === "DONE" && x.postId)!;
    const stepsJson = m.steps as Array<{ agent: string; status: string }>;
    const pubIndex = stepsJson.findIndex((s) => s.agent === "publication");
    stepsJson[pubIndex] = { ...stepsJson[pubIndex]!, status: "RUNNING" };
    // État d'un worker arrêté juste après la création du message, avant la fin de la mission.
    await prisma.agentMission.update({
      where: { id: m.id },
      data: { status: "RUNNING", currentStep: pubIndex, steps: stepsJson as never, lastActivityAt: new Date(now.getTime() - 20 * MIN) },
    });
    steps.length = 0;
    const cycle = await runCycle(deps);
    expect((cycle.resume as { requeued: number }).requeued).toBeGreaterThanOrEqual(1);
    await drain();
    expect((await prisma.agentMission.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("DONE");
    expect(await prisma.post.count({ where: { agentMissionId: m.id } })).toBe(1);
    // Casino du jour 2 : plus de vidéo inédite → repli en texte journalisé ; la demande groupée n'est pas renvoyée.
    expect(await prisma.event.count({ where: { type: "agents.casino.fallback", occurredAt: { gte: start } } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.humanRequest.count({ where: { key: { startsWith: "media.casino." } } })).toBeLessThanOrEqual(2);
    await sendScheduled();
    await runAdsTick(deps);
    now = fromParis(addDays(DAY1, 1), 22 * 60);
    await runAlgoNightly(deps);
  });

  it("jour 3 : réglage annulé, plafond vidéo atteint (repli), paris réglés, rapports quotidiens", async () => {
    now = fromParis(addDays(DAY1, 2), 8 * 60);
    expect((await undoRecommendation(deps, recId, { userId: null, via: "SITE" })).ok).toBe(true);
    expect(await prisma.channelAgentPlan.findUniqueOrThrow({ where: { channelId: datingId } })).toMatchObject({ windowStart: "09:00", windowEnd: "23:00" });
    expect((await prisma.recommendation.findUniqueOrThrow({ where: { id: recId } })).status).toBe("UNDONE");

    // Plafond vidéo de 10 c, vidéo estimée à 50 c : la vidéo du jour devient une photo.
    await prisma.agentTeamConfig.update({ where: { teamKey: "dating" }, data: { monthlyBudgetCents: { video: 10, image: 1500 } } });
    providers.video = pricedVideo;
    now = at10(2);
    const start = now;
    await runCycle(deps);
    await drain();
    await decideAll();
    await markDay();
    const dating = await missionsOf("dating", 2);
    expect(dating).toHaveLength(3);
    expect(dating.every((m) => m.status === "DONE")).toBe(true);
    const fallbacks = await prisma.event.findMany({ where: { type: "agents.dating.fallback", occurredAt: { gte: start } } });
    expect(fallbacks.map((e) => (e.payload as { from: string; to: string }).from)).toContain("video");
    expect(dating.map((m) => (m.payload as { format?: string }).format).sort()).toEqual(["photo", "photo", "text"]);
    // Aucun centime dépensé au-delà du plafond (aucune vidéo lancée).
    expect((await prisma.agentUsage.aggregate({ where: { teamKey: "dating", provider: "video" }, _sum: { cents: true } }))._sum.cents ?? 0).toBe(0);
    // Fenêtre d'origine remise : la Planification peut reprendre dès 10 h.
    expect(dating.some((m) => parisMinutes(m.scheduledFor!) < 18 * 60)).toBe(true);
    await sendScheduled();
    await runAdsTick(deps);

    // Paris : les matchs du jour 1 sont joués, résultats réglés.
    const settled = await runSportsSettle(deps);
    expect(settled.settled).toBeGreaterThanOrEqual(2);
    expect(await prisma.bettingPick.count({ where: { status: { in: ["WON", "LOST", "VOID"] } } })).toBeGreaterThanOrEqual(2);

    // Rapports quotidiens : un par jour pour le Grand Chef et pour l'Agent Ads.
    const reports = await prisma.event.findMany({ where: { type: "agents.report.daily" }, orderBy: { occurredAt: "asc" } });
    expect(reports.map((r) => (r.payload as { day: string }).day)).toEqual([DAY1, addDays(DAY1, 1), addDays(DAY1, 2)]);
    expect(await prisma.insightReport.count({ where: { teamKey: "ads", weekStart: { in: [DAY1, addDays(DAY1, 1), addDays(DAY1, 2)] } } })).toBe(3);
    expect((reports[1]!.payload as { lines: string[] }).lines.map((l) => l.split(" :")[0])).toEqual(["Rencontres", "Casino", "Paris sportifs", "Algorithme"]);
  });

  it("supervision cohérente, « rapport » et « agents » sur Telegram ; aucun post hors canal Test", async () => {
    const o = await agentsOverview(prisma, { now });
    const dating = o.teams.find((t) => t.teamKey === "dating")!;
    expect(dating).toMatchObject({ simulation: true, paused: false, autonomyLevel: 0 });
    // Compteurs « aujourd'hui » : dates de la base à l'heure réelle, vérifiés par les tests unitaires ; ici : rien en
    // attente ni en échec, et le repli du jour compté (date de l'événement = horloge simulée).
    expect(dating.today).toMatchObject({ waiting: 0, failed: 0 });
    expect(dating.today.fallbacks).toBeGreaterThanOrEqual(1);
    expect(dating.spend.find((s) => s.provider === "video")).toMatchObject({ cents: 0, capCents: 10 });
    // Tous les posts sont sur le canal Test : aucun résultat compté dans la supervision (mêmes règles que Statistiques).
    expect(dating.results.d28.posts).toBe(0);
    expect(o.algoAppliedThisWeek).toHaveLength(0);
    expect(o.experimentsRunning).toBe(1);
    expect(o.health.lastGrandChefAt).toBe(now.toISOString());
    expect(o.health.stuckMissions).toBe(0);
    expect(o.ads.lastReportAt).not.toBeNull();
    expect(overviewLines(o).length).toBeLessThanOrEqual(8);
    // Voix de Kevin (phase 33) : « pour de faux » plutôt que « simulation ».
    expect((await admin("agents")).reply).toContain("Rencontres : active, pour de faux, niveau 0.");
    expect((await admin("rapport")).reply).toContain(`Rapport des agents</b> (${addDays(DAY1, 2)})`);

    // Durées des étapes mesurées (performance) ; 3 jours de missions distincts.
    const runs = await prisma.agentRun.findMany({ where: { status: { in: ["OK", "ERROR"] } }, select: { durationMs: true } });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => typeof r.durationMs === "number" && r.durationMs >= 0)).toBe(true);
    expect(dayMissions).toHaveLength(3);

    // Assertion finale : en simulation, AUCUN message créé ailleurs que sur le canal Test, et un seul par mission.
    const posts = await prisma.post.findMany({ select: { channelId: true, agentMissionId: true, text: true } });
    expect(posts.length).toBeGreaterThanOrEqual(15);
    expect(posts.filter((p) => p.channelId !== testChannelId)).toEqual([]);
    expect(posts.every((p) => p.text.startsWith("[SIMULATION équipe "))).toBe(true);
    const perMission = new Map<string, number>();
    for (const p of posts) if (p.agentMissionId) perMission.set(p.agentMissionId, (perMission.get(p.agentMissionId) ?? 0) + 1);
    expect([...perMission.values()].every((n) => n === 1)).toBe(true);
    for (const id of [datingId, casinoId, sportsId]) expect(await prisma.post.count({ where: { channelId: id } })).toBe(0);
  });
});
