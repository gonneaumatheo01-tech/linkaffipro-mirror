/**
 * Phase 34, lot D — cœurs partagés par le site et Kevin (agents, univers, Réglages → IA et assistant) : mêmes refus que
 * le site (mêmes textes), droits contrôlés dans le cœur (un responsable ne fait pas ce qui est réservé aux
 * administrateurs), essai à blanc (`dryRun`) qui n'écrit rien et n'appelle aucun moteur, aucun secret dans un message,
 * un aperçu ou le journal ; opérations de Kevin (`LOT_D_IMPL`) : noms résolus, valeurs actuelles gardées, même cœur.
 * Base, moteur des agents, IA et fournisseurs simulés : aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpActor, SiteOpResult } from "@linkaffipro/agents";

type Row = Record<string, unknown>;
const WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

const m = vi.hoisted(() => {
  const fn = <T = unknown>(impl?: (...a: unknown[]) => T) => vi.fn(impl ?? (async () => ({ ok: true, message: "" }) as T));
  return {
    answers: new Map<string, unknown>(),
    dbWrites: [] as string[],
    audits: [] as Record<string, unknown>[],
    engine: {
      createTestMission: fn(async () => ({ ok: true, missionId: "mi1" })),
      createTestPostMission: fn(async () => ({ ok: true, missionId: "mi2" })),
      startBench: fn(async () => ({ ok: true, message: "Banc lancé." })),
      saveSecret: fn(async () => ({ last4: "3456" })),
      verifySecret: fn(async () => ({ ok: true, message: "clé acceptée" })),
      deleteSecret: fn(async () => undefined),
      createTestBetMission: fn(async () => ({ ok: true, missionId: "mi3" })),
      classifyCasinoMedia: fn(async () => ({ ok: true, message: "Média classé ✅" })),
      applyRecommendation: fn(async () => ({ ok: true, message: "Appliqué." })),
      undoRecommendation: fn(),
      rejectRecommendation: fn(),
      runAlgoReportNow: fn(async () => ({ ok: true, message: "Rapport envoyé.", reportIds: ["i1"] })),
      answerHumanRequestFromSite: fn(async () => ({ ok: true, message: "Réponse enregistrée." })),
      skipHumanRequest: fn(async () => ({ ok: true, message: "Passée." })),
      relaunchHumanRequest: fn(async () => ({ ok: true, message: "Relancée." })),
      markAdsRecommendation: fn(async () => ({ ok: true, message: "Noté." })),
      stopOrder: fn(async () => ({ ok: true })),
      extendOrder: fn(async () => ({ ok: true })),
    },
    writers: {
      saveTeamSettings: fn(async () => undefined),
      saveDatingMediaSettings: fn(async () => undefined),
      saveChannelPlan: fn(async () => ({ ok: true })),
      saveTeamBudgets: fn(async () => undefined),
      saveAgentsGeneralSettings: fn(async () => ({ ok: true })),
      writeCasinoSettings: fn(async () => undefined),
      writeSportsSettings: fn(async () => true),
      saveBetCategory: fn(async () => ({ ok: true, id: "cat1", changed: ["minOdds"] })),
      saveAlgoSettings: fn(async () => undefined),
      saveAdsThresholds: fn(async () => undefined),
      saveAdsAlertSettings: fn(async () => undefined),
      saveBossBudget: fn(async () => undefined),
      saveBossName: fn(async () => undefined),
      saveAiConfig: fn(async () => undefined),
      saveAssistantConfig: fn(async (p: unknown) => ({ ...(p as object) })),
    },
    net: {
      verifyApiKey: fn(async () => ({ ok: true })),
      verifyVeniceKey: fn(async () => ({ ok: true, balanceUsd: 3 })),
      listVeniceModels: fn(async () => []),
    },
    budgets: {} as Record<string, Record<string, number>>,
    categories: [] as Row[],
    assistantConfig: { apiKeyEncrypted: "x", activation: "off" } as Row,
  };
});

vi.mock("@linkaffipro/db", () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string | symbol) =>
          method === "then" || typeof method === "symbol"
            ? undefined
            : async (args?: unknown) => {
                const key = `${name}.${method}`;
                if (WRITES.has(method)) m.dbWrites.push(key);
                const a = m.answers.get(key);
                if (typeof a === "function") return (a as (x: unknown) => unknown)(args);
                if (a !== undefined) return a;
                if (method === "findMany") return [];
                return null;
              },
      },
    );
  return {
    prisma: new Proxy({}, { get: (_t, p: string | symbol) => (p === "then" || typeof p === "symbol" ? undefined : model(p)) }),
    audit: vi.fn(async (a: Record<string, unknown>) => void m.audits.push(a)),
  };
});
vi.mock("@linkaffipro/agents", async (orig) => ({ ...(await orig<typeof import("@linkaffipro/agents")>()), ...m.engine }));
vi.mock("@linkaffipro/ai", async (orig) => ({ ...(await orig<typeof import("@linkaffipro/ai")>()), verifyApiKey: m.net.verifyApiKey }));
vi.mock("@linkaffipro/chat", async (orig) => ({
  ...(await orig<typeof import("@linkaffipro/chat")>()),
  verifyVeniceKey: m.net.verifyVeniceKey,
  listVeniceModels: m.net.listVeniceModels,
}));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/save", () => ({
  saveTeamSettings: m.writers.saveTeamSettings,
  saveDatingMediaSettings: m.writers.saveDatingMediaSettings,
  saveChannelPlan: m.writers.saveChannelPlan,
  saveTeamBudgets: m.writers.saveTeamBudgets,
  saveAgentsGeneralSettings: m.writers.saveAgentsGeneralSettings,
}));
vi.mock("@/lib/agents/casino-save", async () => {
  const { parseCasinoSettings } = await import("@/lib/agents/casino");
  return { readCasinoSettingsRaw: async () => ({ raw: null, settings: parseCasinoSettings(null) }), writeCasinoSettings: m.writers.writeCasinoSettings };
});
vi.mock("@/lib/agents/sports-save", () => ({
  saveBetCategory: m.writers.saveBetCategory,
  writeSportsSettings: m.writers.writeSportsSettings,
  loadCategoryKeys: async () => m.categories.map((c) => c.key),
}));
vi.mock("@/lib/agents/sports-queries", () => ({
  loadBetCategories: async () => m.categories,
  loadSportsSettings: async () => ({ runHours: [10, 15, 18], maxOddsDriftPct: 5, minMinutesBeforeKickoff: 30, maxApiCallsPerMonth: 1000 }),
}));
vi.mock("@/lib/agents/algo/save", () => ({ saveAlgoSettings: m.writers.saveAlgoSettings }));
vi.mock("@/lib/agents/ads/save", () => ({ saveAdsThresholds: m.writers.saveAdsThresholds, saveAdsAlertSettings: m.writers.saveAdsAlertSettings }));
vi.mock("@/lib/agents/boss-save", () => ({ saveBossBudget: m.writers.saveBossBudget, saveBossName: m.writers.saveBossName }));
vi.mock("@/lib/agents/dating-queries", () => ({
  loadMediaKeys: async () => ({ fal: true, magichour: false }),
  loadDatingSettings: async () => ({ videoProvider: "fal", videoResolution: "580p" }),
}));
vi.mock("@/lib/agents/casino-queries", () => ({
  loadThemeMediaCounts: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, 0])),
  loadChannelsUsingTheme: async () => [],
  loadToClassify: async () => ({ rows: [{ id: "asset9" }], total: 1 }),
}));
vi.mock("@/lib/agents/queries", () => ({
  loadChannelPlans: async () => [{ id: "c1" }],
  loadPlanChoices: async () => ({ personas: [], campaigns: [] }),
  loadAgentsGeneralSettings: async () => ({ models: { fast: "claude-haiku-5-5", strong: "claude-sonnet-5-5" }, libraryChannelId: null }),
  loadTeamConfig: async (team: string) => ({
    budgets: m.budgets[team] ?? {},
    styleGuidelines: "",
    forbiddenWords: ["garanti"],
    maxTextLength: 900,
    quietHours: [],
  }),
}));
vi.mock("@/lib/agents/orders-engine", () => ({ loadOrdersEngine: async () => ({ stopOrder: m.engine.stopOrder, extendOrder: m.engine.extendOrder }) }));
vi.mock("@/lib/ai/config", () => ({
  loadAiConfig: async () => ({
    defaultModel: "claude-haiku-5-5",
    qualityModel: "claude-sonnet-5-5",
    monthlyCapEur: 20,
    perUserDailyLimit: 50,
    riskNotice: { casino: "Jouer comporte des risques.", sports: "Parier comporte des risques." },
  }),
  loadAiApiKey: async () => "sk-ant-cle_enregistree_secrete_123456",
  saveAiConfig: m.writers.saveAiConfig,
}));
vi.mock("@/lib/assistant/config", () => ({
  loadAssistantConfig: async () => ({
    defaultModel: "venice-a",
    fallbackModel: "venice-b",
    temperature: 0.8,
    maxTokens: 400,
    monthlyCapEur: 30,
    perConversationDailyLimit: 60,
    ...m.assistantConfig,
  }),
  loadAssistantApiKey: async () => "VENICE_cle_enregistree_123456",
  saveAssistantConfig: m.writers.saveAssistantConfig,
}));

import { runCreateTestMission, runCreateTestPost, runSaveChannelPlan, runSaveTeamSettings, runStartBench } from "./teams";
import { runDeleteSecret, runSaveBudgets, runSaveGeneralSettings, runSaveSecret, runVerifySecret } from "./settings";
import { runCreateTestBet, runSaveBetCategory } from "./sports";
import { runAddCasinoTheme, runClassifyCasinoMedia, runCreateCasinoTestPost, runRemoveCasinoTheme, runRenameCasinoTheme } from "./casino";
import { runAlgoReport, runRecommendation, runSaveAlgoSettings } from "./algo";
import { runAnswerHumanRequest, runRelaunchHumanRequest, runSkipHumanRequest } from "./validations";
import { runMarkAdsRecommendation, runSaveAdsAlertSettings, runSaveAdsThresholds } from "./ads";
import { runExtendOrder, runStopOrder } from "./orders";
import { runSaveBossBudget, runSaveBossName } from "./boss";
import { runRemoveAiKey, runSaveAiSettings, runVerifyAiKey } from "./ai";
import { runRemoveAssistantKey, runSaveAssistantSettings, runVerifyAssistantKey } from "./assistant";
import { LOT_D_IMPL } from "../lot-d";

type Core = (fd: FormData, actor: SiteOpActor, opts?: { dryRun?: boolean }) => Promise<SiteOpResult>;

const ADMIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "WEB" };
const MANAGER: SiteOpActor = { userId: "u2", role: "MANAGER", via: "WEB" };
const KEVIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "TELEGRAM", telegramUserId: "42" };
const KEVIN_MANAGER: SiteOpActor = { userId: "u2", role: "MANAGER", via: "TELEGRAM", telegramUserId: "43" };

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

const allMocks = () => [...Object.values(m.engine), ...Object.values(m.writers), ...Object.values(m.net)];
const calledMocks = () => allMocks().filter((f) => f.mock.calls.length > 0);

const PLAN = { team: "dating", channelId: "c1", enabled: "on", postsPerDay: "3", windowStart: "09:00", windowEnd: "22:00", minSpacingMinutes: "60", mix_text: "1" };
const CATEGORY = {
  name: "Corners",
  marketTypes: "corners-all-game-ou-over",
  leagues: "EPL",
  bookmakers: "sportaza",
  minOdds: "1,6",
  maxOdds: "2,5",
  picksPerDay: "2",
  minMinutesBeforeKickoff: "30",
  maxOddsDriftPct: "5",
};
const ALGO = { minPosts: "20", minViews: "1000", minConversations: "30", maxMixPointsPerWeek: "20", maxPostsPerDay: "6", allowedStart: "08:00", allowedEnd: "23:00", frequency: "weekly" };
const THRESHOLDS = Object.fromEntries(
  ["CASINO", "SPORTS", "DATING"].flatMap((u) => [
    [`${u}.observationDays`, "3"],
    [`${u}.minSpend`, "20"],
  ]),
);
const ALERTS = { "alerts.spikePct": "80", "alerts.dropPct": "40", "alerts.minDailySpend": "12,5", "alerts.minRegistrations": "3" };
const AI = {
  defaultModel: "claude-haiku-5-5",
  qualityModel: "claude-sonnet-5-5",
  monthlyCapEur: "20",
  perUserDailyLimit: "50",
  riskCasino: "Jouer comporte des risques.",
  riskSports: "Parier comporte des risques.",
};
const ASSISTANT = {
  activation: "team",
  defaultModel: "venice-a",
  fallbackModel: "venice-b",
  temperature: "0,8",
  maxTokens: "400",
  monthlyCapEur: "30",
  perConversationDailyLimit: "60",
};

/** Chaque cœur avec un formulaire valide : `admin` = réservé aux administrateurs. */
const CASES: Array<{ name: string; core: Core; form: Record<string, string | string[]>; admin: boolean }> = [
  { name: "mission de test", core: runCreateTestMission, form: { team: "casino" }, admin: false },
  { name: "réglages d'une équipe", core: runSaveTeamSettings, form: { team: "casino", casinoLowStock: "3", casinoRotationDays: "30" }, admin: false },
  { name: "plan d'un canal", core: runSaveChannelPlan, form: PLAN, admin: false },
  { name: "post de test Rencontres", core: runCreateTestPost, form: { format: "text" }, admin: false },
  { name: "banc d'essai", core: runStartBench, form: { personaId: "p1" }, admin: true },
  { name: "clé d'un fournisseur", core: runSaveSecret, form: { key: "providers.fal.apiKey", value: "fal_cle_secrete_123456" }, admin: true },
  { name: "vérifier une clé", core: runVerifySecret, form: { key: "providers.fal.apiKey" }, admin: true },
  { name: "retirer une clé", core: runDeleteSecret, form: { key: "providers.fal.apiKey" }, admin: true },
  { name: "modèles et médiathèque", core: runSaveGeneralSettings, form: { modelFast: "claude-haiku-5-5", modelStrong: "claude-sonnet-5-5" }, admin: true },
  { name: "plafonds du mois", core: runSaveBudgets, form: { "dating.budget_video": "80" }, admin: true },
  { name: "répondre à une demande", core: runAnswerHumanRequest, form: { requestId: "req1", answer: "oui" }, admin: false },
  { name: "passer une demande", core: runSkipHumanRequest, form: { requestId: "req1" }, admin: false },
  { name: "relancer une demande", core: runRelaunchHumanRequest, form: { requestId: "req1" }, admin: false },
  { name: "catégorie de paris", core: runSaveBetCategory, form: CATEGORY, admin: true },
  { name: "pari de test", core: runCreateTestBet, form: {}, admin: false },
  { name: "classer un média", core: runClassifyCasinoMedia, form: { assetId: "a1", theme: ["roulette"] }, admin: false },
  { name: "post de test Casino", core: runCreateCasinoTestPost, form: { format: "photo" }, admin: false },
  { name: "ajouter un thème", core: runAddCasinoTheme, form: { label: "Poker" }, admin: true },
  { name: "renommer un thème", core: runRenameCasinoTheme, form: { key: "roulette", label: "Roulette live" }, admin: true },
  { name: "retirer un thème", core: runRemoveCasinoTheme, form: { key: "roulette" }, admin: true },
  { name: "proposition Algorithme", core: runRecommendation, form: { action: "apply", id: "r1" }, admin: false },
  { name: "rapport Algorithme", core: runAlgoReport, form: {}, admin: true },
  { name: "réglages Algorithme", core: runSaveAlgoSettings, form: ALGO, admin: true },
  { name: "recommandation pubs", core: runMarkAdsRecommendation, form: { id: "r1", status: "DONE" }, admin: false },
  { name: "seuils Ads", core: runSaveAdsThresholds, form: THRESHOLDS, admin: true },
  { name: "alertes Ads", core: runSaveAdsAlertSettings, form: ALERTS, admin: true },
  { name: "arrêter un ordre", core: runStopOrder, form: { orderId: "o1" }, admin: true },
  { name: "prolonger un ordre", core: runExtendOrder, form: { orderId: "o1", days: "2" }, admin: true },
  { name: "plafond de Kevin", core: runSaveBossBudget, form: { euros: "50" }, admin: true },
  { name: "prénom de Kevin", core: runSaveBossName, form: { name: "Max" }, admin: true },
  { name: "réglages IA d'écriture", core: runSaveAiSettings, form: AI, admin: true },
  { name: "vérifier la clé Anthropic", core: runVerifyAiKey, form: {}, admin: true },
  { name: "retirer la clé Anthropic", core: runRemoveAiKey, form: {}, admin: true },
  { name: "réglages IA de conversation", core: runSaveAssistantSettings, form: ASSISTANT, admin: true },
  { name: "vérifier la clé Venice", core: runVerifyAssistantKey, form: {}, admin: true },
  { name: "retirer la clé Venice", core: runRemoveAssistantKey, form: {}, admin: true },
];

beforeEach(() => {
  for (const f of allMocks()) f.mockClear();
  m.dbWrites.length = 0;
  m.audits.length = 0;
  m.budgets = {};
  m.categories = [];
  m.assistantConfig = { apiKeyEncrypted: "x", activation: "off" };
  m.answers.clear();
  m.answers.set("recommendation.findUnique", { id: "r1", status: "PROPOSED", size: "SMALL", target: "CHANNEL_PLAN", field: "mix", source: null, teamKey: "ads" });
  m.answers.set("recommendation.findMany", [{ id: "rec1" }]);
  m.answers.set("teamOrder.findUnique", { id: "o1", number: 12, status: "RUNNING" });
  m.answers.set("humanRequest.findUnique", { kind: "CHOICE" });
});

describe("essai à blanc : tout est vérifié, rien n'est écrit ni appelé", () => {
  for (const c of CASES)
    it(c.name, async () => {
      const r = await c.core(fd(c.form), ADMIN, { dryRun: true });
      expect(r).toMatchObject({ ok: true });
      if (r.ok && c.name !== "renommer un thème") expect(r.preview?.summary).toBeTruthy();
      expect(calledMocks().map((f) => f.getMockName())).toEqual([]);
      expect(m.dbWrites).toEqual([]);
      expect(m.audits).toEqual([]);
    });
});

describe("exécution : le cœur agit et journalise avec `via`", () => {
  for (const c of CASES)
    it(c.name, async () => {
      const r = await c.core(fd(c.form), ADMIN);
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      for (const a of m.audits) expect(a.metadata).toMatchObject({ via: expect.stringMatching(/^(WEB|verify)$/) });
    });
});

describe("droits : un responsable ne fait pas ce qui est réservé aux administrateurs", () => {
  for (const c of CASES.filter((x) => x.admin))
    it(c.name, async () => {
      const r = await c.core(fd(c.form), MANAGER);
      expect(r).toMatchObject({ ok: false, code: "forbidden" });
      expect(calledMocks()).toEqual([]);
      expect(m.audits).toEqual([]);
    });

  it("les textes de refus sont ceux du site", async () => {
    expect(await runSaveSecret(fd({}), MANAGER)).toMatchObject({ error: "Action réservée aux administrateurs" });
    expect(await runSaveBetCategory(fd(CATEGORY), MANAGER)).toMatchObject({ error: "Les catégories de paris : réservé aux administrateurs." });
    expect(await runAddCasinoTheme(fd({ label: "Poker" }), MANAGER)).toMatchObject({ error: "Les thèmes de l'équipe sont réservés aux administrateurs." });
    expect(await runStartBench(fd({ personaId: "p1" }), MANAGER)).toMatchObject({ error: "Le banc d'essai est réservé aux administrateurs." });
    expect(await runStopOrder(fd({ orderId: "o1" }), MANAGER)).toMatchObject({ error: "Arrêter un ordre est réservé aux administrateurs." });
  });

  it("un responsable règle son équipe sans toucher aux plafonds ni au fournisseur des vidéos", async () => {
    const r = await runSaveTeamSettings(fd({ team: "dating", budget_video: "999", videoProvider: "magichour", videoResolution: "720p" }), MANAGER);
    expect(r.ok).toBe(true);
    expect(m.writers.saveTeamSettings.mock.calls[0]![1]).toMatchObject({ budgets: null });
    expect(m.writers.saveDatingMediaSettings).not.toHaveBeenCalled();
  });
});

describe("mêmes refus que le site", () => {
  const cases: Array<[string, Core, Record<string, string | string[]>, string]> = [
    ["équipe inconnue", runCreateTestMission, { team: "sports" }, "Équipe inconnue."],
    ["fenêtre à l'envers", runSaveChannelPlan, { ...PLAN, windowStart: "22:00", windowEnd: "09:00" }, "Fenêtre horaire : la fin doit être après le début (même journée)."],
    ["photo sans persona", runCreateTestPost, { format: "photo" }, "Choisissez la persona : une vidéo ou une photo est faite pour un personnage."],
    ["banc sans persona", runStartBench, {}, "Choisissez la persona."],
    ["clé vide", runSaveSecret, { key: "providers.fal.apiKey" }, "Collez d'abord la clé dans le champ."],
    ["clé inconnue", runSaveSecret, { key: "providers.autre", value: "abcdefghijk" }, "Clé inconnue : rechargez la page."],
    ["plafond négatif", runSaveBudgets, { "dating.budget_video": "-3" }, "Plafond « Vidéos IA » : saisissez un montant en euros (0 ou plus)."],
    ["cotes à l'envers", runSaveBetCategory, { ...CATEGORY, minOdds: "3", maxOdds: "2" }, "La cote minimale doit être plus petite que la cote maximale."],
    ["aucun thème coché", runClassifyCasinoMedia, { assetId: "a1" }, "Cochez au moins un thème pour ranger ce média."],
    ["thème en double", runAddCasinoTheme, { label: "Roulette" }, "Le thème « Roulette » existe déjà."],
    ["demande sans réponse", runAnswerHumanRequest, { requestId: "req1" }, "Écrivez ou choisissez une réponse."],
    ["recommandation inconnue", runMarkAdsRecommendation, { id: "r1", status: "PEUT-ÊTRE" }, "Recommandation inconnue."],
    ["prolonger de 31 jours", runExtendOrder, { orderId: "o1", days: "31" }, "Choisissez un nombre de jours entre 1 et 30."],
    ["plafond de Kevin trop haut", runSaveBossBudget, { euros: "800" }, "Le plafond est de 500 € par mois au plus."],
    ["clé Anthropic mal formée", runSaveAiSettings, { ...AI, apiKey: "pas-une-cle" }, "La clé Anthropic commence par « sk-ant- » : collez-la entièrement, sans espace."],
  ];
  for (const [name, core, form, error] of cases)
    it(name, async () => {
      const r = await core(fd(form), ADMIN);
      expect(r).toMatchObject({ ok: false, error });
      expect(calledMocks()).toEqual([]);
    });

  it("assistant activé sans clé : refusé, rien n'est enregistré", async () => {
    m.assistantConfig = { apiKeyEncrypted: null, activation: "off" };
    const r = await runSaveAssistantSettings(fd(ASSISTANT), ADMIN);
    expect(r).toMatchObject({ ok: false, error: "Collez d'abord la clé Venice : sans clé, l'assistant ne peut répondre à personne." });
    expect(m.writers.saveAssistantConfig).not.toHaveBeenCalled();
  });

  it("ordre déjà fini, proposition qui a changé d'état", async () => {
    m.answers.set("teamOrder.findUnique", { id: "o1", number: 12, status: "DONE" });
    expect(await runStopOrder(fd({ orderId: "o1" }), ADMIN)).toMatchObject({ error: "Ordre n°12 est déjà terminé ou arrêté : rien à arrêter." });
    m.answers.set("recommendation.findUnique", { id: "r1", status: "APPLIED", size: "SMALL", target: "CHANNEL_PLAN", field: "mix", source: null });
    expect(await runRecommendation(fd({ action: "apply", id: "r1" }), ADMIN)).toMatchObject({ error: "Cette proposition a déjà changé d'état : rechargez la page." });
  });
});

describe("secrets : jamais dans un message, un aperçu ni le journal", () => {
  const SECRETS = ["fal_cle_secrete_123456", "motdepasse_secret", "proxy_secret", "sk-ant-nouvelle_cle_secrete_abcdef", "VENICE_toute_nouvelle_cle_789"];
  const leaks = (r: SiteOpResult) => {
    const text = JSON.stringify([r, m.audits]);
    return SECRETS.filter((s) => text.includes(s));
  };
  it("clé d'un fournisseur, clé Anthropic, clé Venice", async () => {
    const runs: Array<[Core, Record<string, string>]> = [
      [runSaveSecret, { key: "providers.fal.apiKey", value: SECRETS[0]! }],
      [runSaveAiSettings, { ...AI, apiKey: SECRETS[3]! }],
      [runVerifyAssistantKey, { apiKey: SECRETS[4]! }],
    ];
    for (const [core, form] of runs) {
      for (const dryRun of [true, false]) {
        const r = await core(fd(form), KEVIN, { dryRun });
        expect(r.ok, JSON.stringify(r)).toBe(true);
        expect(leaks(r)).toEqual([]);
      }
    }
    // La valeur va seulement à la couche qui chiffre.
    expect(m.engine.saveSecret).toHaveBeenCalledWith({}, "providers.fal.apiKey", SECRETS[0], { userId: "u1", via: "TELEGRAM" });
    expect(m.writers.saveAiConfig.mock.calls[0]![0]).toMatchObject({ apiKey: SECRETS[3] });
  });

  it("aucune opération secrète ne déclare son secret dans les paramètres envoyés à l'IA", async () => {
    const { SITE_OPS } = await vi.importActual<typeof import("@linkaffipro/agents")>("@linkaffipro/agents");
    const mine = SITE_OPS.filter((o) => LOT_D_IMPL.some((i) => i.key === o.key));
    for (const op of mine.filter((o) => o.kind === "secret")) {
      expect(op.secretParams?.length, op.key).toBeGreaterThan(0);
      const props = Object.keys((op.params.properties as Record<string, unknown>) ?? {});
      for (const s of op.secretParams ?? []) expect(props, op.key).not.toContain(s);
    }
  });

  it("une demande qui attend une clé ne se répond pas par une phrase à Kevin", async () => {
    m.answers.set("humanRequest.findUnique", { kind: "SECRET" });
    const r = await runAnswerHumanRequest(fd({ requestId: "req1", answer: "sk-quelque-chose" }), KEVIN);
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(m.engine.answerHumanRequestFromSite).not.toHaveBeenCalled();
  });

  it("passage en vrai, autonomie totale, plafond vidéo : jamais une réponse rédigée par Kevin (le site reste permis)", async () => {
    for (const onAnswer of [
      { action: "set-simulation", simulation: false },
      { action: "set-autonomy", level: 2 },
      { action: "dating-video-budget", skipAnswer: "100 €" },
    ]) {
      m.answers.set("humanRequest.findUnique", { kind: "CONFIRM", onAnswer });
      for (const dryRun of [true, false])
        expect(await runAnswerHumanRequest(fd({ requestId: "req1", answer: "oui" }), KEVIN, { dryRun })).toMatchObject({ ok: false, code: "conflict" });
      if (onAnswer.skipAnswer)
        expect(await runSkipHumanRequest(fd({ requestId: "req1" }), KEVIN)).toMatchObject({ ok: false, code: "conflict" });
      expect(m.engine.answerHumanRequestFromSite).not.toHaveBeenCalled();
      expect(m.engine.skipHumanRequest).not.toHaveBeenCalled();
      expect(await runAnswerHumanRequest(fd({ requestId: "req1", answer: "oui" }), ADMIN)).toMatchObject({ ok: true });
      m.engine.answerHumanRequestFromSite.mockClear();
    }
    m.answers.set("humanRequest.findUnique", { kind: "CONFIRM", onAnswer: { action: "set-simulation", simulation: true } });
    expect(await runAnswerHumanRequest(fd({ requestId: "req1", answer: "oui" }), KEVIN)).toMatchObject({ ok: true });
  });
});

describe("opérations de Kevin (LOT_D_IMPL)", () => {
  const impl = (key: string) => {
    const o = LOT_D_IMPL.find((i) => i.key === key);
    if (!o) throw new Error(`opération absente : ${key}`);
    return o;
  };

  it("chaque opération du lot a son cœur, et inversement ; clés uniques", async () => {
    const { SITE_OPS } = await vi.importActual<typeof import("@linkaffipro/agents")>("@linkaffipro/agents");
    const keys = LOT_D_IMPL.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(SITE_OPS.some((o) => o.key === k), k).toBe(true);
  });

  it("« monte le budget vidéo à 80 € ce mois-ci » : Rencontres, les autres plafonds gardés, OUI demandé avant", async () => {
    m.budgets = { dating: { llm: 1500, video: 5000, image: 1000 }, sports: { odds: 2000 } };
    const dry = await impl("agents.budget_fournisseur").run({ poste: "video", euros: 80 }, KEVIN, { dryRun: true });
    expect(dry).toMatchObject({ ok: true });
    expect(dry.ok && dry.preview?.summary).toContain("Rencontres, Vidéos IA : 50 € → 80 €");
    expect(m.writers.saveTeamBudgets).not.toHaveBeenCalled();
    const r = await impl("agents.budget_fournisseur").run({ poste: "video", euros: 80 }, KEVIN, {});
    expect(r.ok).toBe(true);
    expect(m.writers.saveTeamBudgets).toHaveBeenCalledTimes(1);
    expect(m.writers.saveTeamBudgets).toHaveBeenCalledWith("dating", { llm: 1500, video: 8000, image: 1000 }, "u1", "TELEGRAM");
  });

  it("un responsable ne change pas un plafond par Kevin", async () => {
    const r = await impl("agents.budget_fournisseur").run({ poste: "video", euros: 80 }, KEVIN_MANAGER, {});
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(m.writers.saveTeamBudgets).not.toHaveBeenCalled();
  });

  it("« active la catégorie corners avec des cotes entre 1,6 et 2,5 » : les autres champs gardés", async () => {
    m.categories = [
      {
        id: "cat1",
        key: "corners",
        name: "Corners",
        sport: "SOCCER",
        marketTypes: ["corners-all-game-ou-over"],
        leagues: ["EPL", "FR_LIGUE_1"],
        bookmakers: ["sportaza"],
        minOdds: 1.5,
        maxOdds: 3,
        picksPerDay: 1,
        channelIds: ["c1"],
        campaignId: null,
        minMinutesBeforeKickoff: 30,
        maxOddsDriftPct: 5,
        active: false,
        sortOrder: 2,
      },
    ];
    m.answers.set("betCategory.findMany", [{ id: "cat1", name: "Corners", key: "corners" }]);
    const r = await impl("univers.categorie_paris_regler").run({ categorie: "corners", active: true, minOdds: "1,6", maxOdds: 2.5 }, KEVIN, {});
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(m.writers.saveBetCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cat1",
        key: "corners",
        active: true,
        minOdds: 1.6,
        maxOdds: 2.5,
        leagues: ["EPL", "FR_LIGUE_1"],
        channelIds: ["c1"],
        picksPerDay: 1,
        sortOrder: 2,
      }),
      "u1",
      "TELEGRAM",
    );
  });

  it("thèmes casino par leur nom ; média à classer le plus ancien par défaut", async () => {
    expect(await impl("univers.theme_casino_renommer").run({ theme: "Roulette", label: "Roulette live" }, KEVIN, {})).toMatchObject({ ok: true });
    expect(m.writers.writeCasinoSettings.mock.calls[0]![2]).toBe("agents.casino_theme_renamed");
    expect(m.writers.writeCasinoSettings.mock.calls[0]![3]).toMatchObject({ theme: "roulette", via: "TELEGRAM" });
    expect(await impl("univers.theme_casino_retirer").run({ theme: "Poker" }, KEVIN, {})).toMatchObject({ ok: false, code: "not_found" });
    await impl("univers.media_casino_classer").run({ themes: ["#blackjack"] }, KEVIN, {});
    expect(m.engine.classifyCasinoMedia).toHaveBeenCalledWith({}, { assetId: "asset9", themes: ["blackjack"] }, { userId: "u1", via: "TELEGRAM" });
  });

  it("réglages Algorithme et alertes Ads : seules les valeurs données changent", async () => {
    await impl("agents.algo_reglages").run({ maxPostsPerDay: 5 }, KEVIN, {});
    expect(m.writers.saveAlgoSettings).toHaveBeenCalledWith(expect.objectContaining({ maxPostsPerDay: 5, minPosts: 20, frequency: "weekly" }), "u1", "TELEGRAM");
    await impl("agents.ads_alertes").run({ spikePct: 80 }, KEVIN, {});
    expect(m.writers.saveAdsAlertSettings).toHaveBeenCalledWith({ spikePct: 80, dropPct: 50, minDailySpend: 10, minRegistrations: 5 }, "u1", "TELEGRAM");
    await impl("agents.ads_seuils").run({ univers: "casino", targetCostPerRegistration: 8 }, KEVIN, {});
    expect(m.writers.saveAdsThresholds.mock.calls[0]![0]).toMatchObject({
      CASINO: { targetCostPerRegistration: 8, minRoas: null, observationDays: 3, minSpend: 20 },
      SPORTS: { targetCostPerRegistration: null },
    });
  });

  it("demandes : la demande en cours par défaut ; relance de la dernière passée", async () => {
    m.answers.set("humanRequest.findFirst", { id: "reqABCDEFGH" });
    await impl("agents.demande_repondre").run({ reponse: "oui" }, KEVIN, {});
    expect(m.engine.answerHumanRequestFromSite).toHaveBeenCalledWith({}, "reqABCDEFGH", "oui", { userId: "u1", via: "TELEGRAM" }, "ADMIN");
    await impl("agents.demande_relancer").run({}, KEVIN, {});
    expect(m.engine.relaunchHumanRequest).toHaveBeenCalledWith({}, "reqABCDEFGH", { userId: "u1", via: "TELEGRAM" });
  });

  it("ordre par son numéro ; Kevin note sa raison d'arrêt", async () => {
    m.answers.set("teamOrder.findFirst", { id: "o1", number: 12 });
    await impl("agents.ordre_arreter").run({ ordre: "12" }, KEVIN, {});
    expect(m.engine.stopOrder).toHaveBeenCalledWith({}, "o1", { userId: "u1", via: "TELEGRAM" }, "arrêté par l'admin");
  });

  it("clé Anthropic par Kevin : les autres réglages enregistrés restent", async () => {
    const r = await impl("reglages.ia_cle").run({ apiKey: "sk-ant-nouvelle_cle_secrete_abcdef" }, KEVIN, {});
    expect(r.ok).toBe(true);
    expect(m.writers.saveAiConfig.mock.calls[0]![0]).toMatchObject({ apiKey: "sk-ant-nouvelle_cle_secrete_abcdef", monthlyCapEur: 20, perUserDailyLimit: 50 });
    expect(JSON.stringify(m.audits)).not.toContain("nouvelle_cle");
  });
});
