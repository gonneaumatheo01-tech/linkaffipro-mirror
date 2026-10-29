import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../settings/categories/page-checks";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";

// Pages de la rubrique Agents rendues côté serveur avec des données simulées (aucune base, aucune file).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  pausedAll: false,
  validations: [] as unknown[],
  requests: [] as unknown[],
  datingPersonas: [] as unknown[],
  keys: { fal: false },
  algoEmpty: false,
  adsConnectorsMissing: true,
  adsFailing: false,
  overviewFails: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => m.user),
  requireAdminPage: vi.fn(async () => {
    if (m.user.role !== "ADMIN") throw new Error("NEXT_REDIRECT /?forbidden=1");
    return m.user;
  }),
}));
vi.mock("./actions", () => ({
  createTestMissionAction: vi.fn(),
  setTeamPausedAction: vi.fn(),
  setAutonomyLevelAction: vi.fn(),
  setSimulationAction: vi.fn(),
}));
vi.mock("./[equipe]/actions", () => ({
  saveTeamSettingsAction: vi.fn(),
  saveChannelPlanAction: vi.fn(),
  createTestPostAction: vi.fn(),
}));
vi.mock("./[equipe]/casino-actions", () => ({
  classifyCasinoMediaAction: vi.fn(),
  createCasinoTestPostAction: vi.fn(),
  addCasinoThemeAction: vi.fn(),
  renameCasinoThemeAction: vi.fn(),
  removeCasinoThemeAction: vi.fn(),
}));
vi.mock("@/lib/agents/casino-queries", async () => {
  const { parseCasinoSettings } = await import("@/lib/agents/casino");
  return {
    loadCasinoSettings: vi.fn(async () => parseCasinoSettings(null)),
    loadCasinoStock: vi.fn(async () => [
      { channelId: "c1", channelTitle: "Canal Test", theme: "roulette", unused: 1, state: "low" },
      { channelId: "c1", channelTitle: "Canal Test", theme: "bonus", unused: 0, state: "empty" },
    ]),
    loadToClassify: vi.fn(async () => ({
      rows: [{ id: "x1", filename: "v.mp4", mimeType: "video/mp4", createdAt: new Date("2026-10-23T08:00:00Z"), themes: [] }],
      total: 1,
    })),
    loadCasinoRequests: vi.fn(async () => [
      {
        id: "h1",
        themes: ["roulette"],
        channelIds: ["c1"],
        count: 5,
        received: 1,
        status: "PENDING",
        question: "Envoie 5 vidéos",
        createdAt: new Date("2026-10-23T08:00:00Z"),
        askedAt: new Date("2026-10-23T08:00:00Z"),
        answeredAt: null,
      },
    ]),
    loadCasinoRecentUsages: vi.fn(async () => [
      {
        id: "u1",
        usedAt: new Date("2026-10-22T08:00:00Z"),
        channelTitle: "Canal Test",
        asset: { id: "a9", mimeType: "video/mp4", themes: ["roulette"] },
      },
    ]),
    loadThemeMediaCounts: vi.fn(async () => ({ roulette: 4 })),
  };
});
vi.mock("./[equipe]/sports-actions", () => ({
  saveBetCategoryAction: vi.fn(),
  createTestBetAction: vi.fn(),
}));
vi.mock("@/lib/agents/sports-queries", async () => {
  const { parseSportsSettings } = await import("@/lib/agents/sports");
  const category = {
    id: "cat1",
    key: "tirs-cadres",
    name: "Tirs cadrés",
    sport: "SOCCER",
    marketTypes: ["shots_onGoal-all-game-ou-over"],
    leagues: ["EPL"],
    bookmakers: ["sportaza"],
    minOdds: 1.5,
    maxOdds: 3.5,
    picksPerDay: 2,
    channelIds: ["c1"],
    campaignId: null,
    minMinutesBeforeKickoff: 30,
    maxOddsDriftPct: 5,
    active: true,
    sortOrder: 1,
    updatedAt: new Date("2026-10-23T08:00:00Z"),
  };
  const pick = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    categoryName: "Tirs cadrés",
    homeTeam: "Lyon",
    awayTeam: "Lens",
    league: "FR_LIGUE_1",
    kickoffAt: new Date("2026-10-24T19:00:00Z"),
    marketLabel: "Tirs cadrés du match",
    selectionLabel: "Plus de 8,5",
    line: 8.5,
    bookmaker: "sportaza",
    odds: 2.1,
    consensusOdds: 1.9,
    interestScore: 0.08,
    oddsAtSend: null,
    oddsLevel: null,
    reasoning: { valueEdge: 0.09 },
    status,
    skipReason: null,
    result: null,
    createdAt: new Date("2026-10-23T08:00:00Z"),
    missionId: "m1",
    screenshot: { id: "s1", mimeType: "image/png", origin: "HUMAN_SITE" },
    ...extra,
  });
  return {
    loadBetCategories: vi.fn(async () => [category]),
    loadPicksSince: vi.fn(async () => [
      pick("p1", "PUBLISHED"),
      pick("p2", "SKIPPED", { skipReason: "odds_moved", screenshot: { id: "s2", mimeType: "image/png", origin: "TEMPLATE" } }),
    ]),
    loadSportsSettings: vi.fn(async () => parseSportsSettings(null)),
    loadBetSummary: vi.fn(async () => [
      { key: "cat1", label: "Tirs cadrés", published: 4, won: 3, lost: 1, void: 0, hitRate: 0.75, avgOdds: 2.05, roi: 0.12 },
    ]),
    loadOddsCallsThisMonth: vi.fn(async () => 120),
  };
});
vi.mock("@/lib/agents/dating-queries", () => ({
  loadDatingPersonas: vi.fn(async () => m.datingPersonas),
  loadMediaKeys: vi.fn(async () => m.keys),
}));
vi.mock("./[equipe]/algo-actions", () => ({
  recommendationAction: vi.fn(),
  runAlgoReportNowAction: vi.fn(),
  saveAlgoSettingsAction: vi.fn(),
}));
vi.mock("@/lib/agents/algo/queries", async () => {
  const { ALGO_DEFAULTS } = await import("@/lib/agents/algo/settings");
  const ins = (format: string, clicks: number, hour: number, personaId = "p1") => ({
    channelId: "c1",
    personaId,
    format,
    theme: "soirée",
    hourParis: hour,
    weekdayParis: 2,
    textLength: 120,
    views24h: 90,
    viewsFinal: 100,
    offerClicks: clicks,
    registrations: 1,
  });
  return {
    loadAlgoSettings: vi.fn(async () => ALGO_DEFAULTS),
    loadTeamChannels: vi.fn(async () => [{ id: "c1", title: "Canal Test", isTest: true }]),
    loadInsightRows: vi.fn(async () => (m.algoEmpty ? [] : [
      ...Array.from({ length: 20 }, () => ins("VIDEO", 5, 21)),
      ...Array.from({ length: 20 }, () => ins("PHOTO", 3, 19)),
      ...Array.from({ length: 20 }, () => ins("TEXT", 1, 9, "p2")),
      ...Array.from({ length: 3 }, () => ins("ALBUM", 0, 12)),
    ])),
    loadPersonaNames: vi.fn(async () => ({ p1: "Léa", p2: "Chloé" })),
    loadSuggestedWindows: vi.fn(async () => ({ windows: [{ day: 2, start: "19:00", end: "22:00", score: 1 }], styleNotes: "Questions courtes" })),
    loadExperiments: vi.fn(async () => (m.algoEmpty ? [] : [
      {
        id: "e1", teamKey: "dating", channelId: "c1", personaId: null, kind: "STYLE_LEGENDE",
        hypothesis: "Une légende en question fait plus cliquer qu'une affirmation.",
        variants: { A: { label: "Question" }, B: { label: "Affirmation" } }, metric: "offer_ctr", minSamples: 20,
        status: "CLOSED", startedAt: new Date("2026-10-01T08:00:00Z"), endsAt: null, closedAt: new Date("2026-10-15T08:00:00Z"),
        result: { A: { n: 30, rate: 0.04 }, B: { n: 30, rate: 0.02 }, pValue: 0.02 }, winner: "A",
        createdAt: new Date("2026-10-01T08:00:00Z"), targetLabel: "Canal Test",
      },
    ])),
    loadRecommendations: vi.fn(async () => (m.algoEmpty ? [] : [
      {
        id: "r1", teamKey: "dating", target: "CHANNEL_PLAN", targetId: "c1", field: "mix",
        before: { video: 1, photo: 2, text: 1 }, after: { video: 2, photo: 2, text: 0 },
        evidence: { summary: "Les vidéos font plus cliquer.", posts: 60 }, expectedGain: "+20 % de clics", size: "SMALL",
        status: "PROPOSED", appliedAt: null, appliedBy: null, undoneAt: null, rejectedAt: null, weekStart: "2026-10-19",
        createdAt: new Date("2026-10-19T06:00:00Z"), targetLabel: "Canal Test",
      },
      {
        id: "r2", teamKey: "dating", target: "PERSONA", targetId: "p1", field: "messagesBeforeLink",
        before: 4, after: 6, evidence: {}, expectedGain: null, size: "BIG",
        status: "APPLIED", appliedAt: new Date("2026-10-19T07:00:00Z"), appliedBy: "HUMAN", undoneAt: null, rejectedAt: null,
        weekStart: "2026-10-19", createdAt: new Date("2026-10-19T06:00:00Z"), targetLabel: "Léa",
      },
    ])),
    loadReports: vi.fn(async () => (m.algoEmpty ? [] : [
      { id: "i1", teamKey: "algo", weekStart: "2026-10-19", content: "Rencontres : la vidéo marche le mieux, 21 h.", sentAt: new Date(), createdAt: new Date() },
    ])),
    loadConversationProfiles: vi.fn(async () => ({
      weekStart: "2026-10-19",
      profiles: m.algoEmpty ? [] : [
        {
          key: "b1:p1:-", botId: "b1", botLabel: "@lea_bot", kind: "BOT", personaId: "p1", personaName: "Léa", source: null,
          conversations: 42, replyRate: 0.6, medianMessagesBeforeLink: 5, dropStage: null, medianReplyDelaySec: 90,
          replyHours: [21, 22], linksSent: 10, clicks: 6, registrations: 2, ftds: 1, aiCostEur: 1.2,
          costPerRegistrationEur: 0.6, enoughData: true,
        },
      ],
      review: m.algoEmpty ? [] : [{ key: "b1:p1:-", label: null, works: ["Question sur sa soirée"], fails: [], drops: [] }],
    })),
  };
});
vi.mock("./validations/actions", () => ({
  decideValidationAction: vi.fn(),
  answerHumanRequestAction: vi.fn(),
  skipHumanRequestAction: vi.fn(),
  relaunchHumanRequestAction: vi.fn(),
}));
vi.mock("./settings/actions", () => ({
  saveSecretAction: vi.fn(),
  verifySecretAction: vi.fn(),
  deleteSecretAction: vi.fn(),
  saveGeneralSettingsAction: vi.fn(),
  saveAllBudgetsAction: vi.fn(),
  setPausedAllAction: vi.fn(),
}));
vi.mock("@/lib/agents/secrets", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/secrets")>()),
  loadSecretRows: vi.fn(async () => [
    {
      key: "providers.fal.apiKey",
      info: { label: "fal.ai", usage: "Vidéos", createUrl: "https://fal.ai/dashboard/keys" },
      summary: { set: true, last4: "ab12", updatedAt: new Date("2026-10-20T10:00:00Z") },
    },
  ]),
}));
vi.mock("./ads/actions", () => ({
  markAdsRecommendationAction: vi.fn(),
  saveAdsThresholdsAction: vi.fn(),
  saveAdsAlertSettingsAction: vi.fn(),
}));
vi.mock("@/lib/agents/ads/queries", async () => {
  const { parseAdsThresholds } = await import("@/lib/agents/ads/thresholds");
  const metrics = (spend: number, commissions: number, registrations: number, extra: Record<string, number> = {}) => ({
    spend,
    impressions: 10_000,
    adClicks: 400,
    landingVisits: 300,
    telegramJoins: 120,
    members: 110,
    offerClicks: 60,
    registrations,
    ftds: 4,
    deposits: 5,
    commissions,
    gains: commissions - spend,
    roas: spend > 0 ? commissions / spend : null,
    costPerMember: 1,
    costPerRegistration: registrations > 0 ? spend / registrations : null,
    costPerFtd: 25,
    ...extra,
  });
  const row = (level: "campaign" | "ad", id: string, name: string, spend: number, commissions: number, enough = true) => ({
    level,
    id,
    name,
    vertical: "CASINO",
    campaignId: "cp1",
    current: metrics(spend, commissions, 10),
    previous: metrics(spend / 2, commissions / 2, 5),
    variations: {},
    bottleneck: level === "campaign" ? "offerClicks" : null,
    enoughData: enough,
  });
  const analysis = {
    period: "7d",
    from: "2026-10-17",
    to: "2026-10-23",
    connectorsMissing: m.adsConnectorsMissing,
    totals: metrics(300, 450, 30),
    rows: [
      row("campaign", "cp1", "Casino octobre", 300, 450),
      row("ad", "ad1", "Vidéo roulette", 100, 300),
      row("ad", "ad2", "Image bonus", 150, 50),
      row("ad", "ad3", "Nouvelle vidéo", 5, 0, false),
    ],
    cohorts: [{ adId: "ad1", name: "Vidéo roulette", d7: 120, d14: 180, d30: 260, members: 40 }],
  };
  return {
    ADS_TEAM_KEY: "ads",
    loadAdsAnalysis: vi.fn(async (period: string) =>
      m.adsFailing ? { ok: false, error: "base injoignable" } : { ok: true, analysis: { ...analysis, period, connectorsMissing: m.adsConnectorsMissing } },
    ),
    loadAdsRecommendations: vi.fn(async () => [
      {
        id: "r1",
        target: "AD",
        targetId: "ad2",
        action: "STOP",
        evidence: { summary: "Coût par inscription au-dessus du seuil depuis 4 jours.", spend: 150, costPerRegistration: 15, threshold: 10 },
        expectedGain: "≈ 100 € économisés par semaine",
        status: "PROPOSED",
        comment: null,
        doneAt: null,
        rejectedAt: null,
        createdAt: new Date("2026-10-24T07:00:00Z"),
        targetLabel: "Image bonus (Groupe A)",
        campaignId: "cp1",
        vertical: "CASINO",
      },
      {
        id: "r2",
        target: "AD",
        targetId: "ad1",
        action: "SCALE",
        evidence: { roas: 3 },
        expectedGain: null,
        status: "DONE",
        comment: "Budget monté à 25 €",
        doneAt: new Date("2026-10-23T10:00:00Z"),
        rejectedAt: null,
        createdAt: new Date("2026-10-22T07:00:00Z"),
        targetLabel: "Vidéo roulette (Groupe A)",
        campaignId: "cp1",
        vertical: "CASINO",
      },
    ]),
    loadAdsReports: vi.fn(async () => [
      {
        id: "ir1",
        weekStart: "2026-10-24",
        content: "<b>Pubs hier</b> : 300 € dépensés, gains 150 €.",
        stats: { kind: "daily" },
        sentAt: new Date("2026-10-24T07:05:00Z"),
        createdAt: new Date("2026-10-24T07:00:00Z"),
      },
    ]),
    loadAdsThresholds: vi.fn(async () => parseAdsThresholds({ CASINO: { targetCostPerRegistration: 12, minRoas: 1.5, observationDays: 4, minSpend: 30 } })),
    loadAdsAlertSettings: vi.fn(async () => ({ spikePct: 70, dropPct: 50, minDailySpend: 10, minRegistrations: 5 })),
    loadAdsCardFigures: vi.fn(async () => ({ toDecide: 1, done30d: 1, lastReportAt: new Date("2026-10-24T07:00:00Z") })),
  };
});
vi.mock("@/lib/agents/queries", async (orig) => {
  const real = await orig<typeof import("@/lib/agents/queries")>();
  const { teamConfigView } = await import("@/lib/agents/config");
  const fig = { missionsToday: 2, waiting: 1, publishedToday: 1, refusedToday: 0, blocked: 0 };
  const mission = {
    id: "m1",
    teamKey: "dating",
    kind: "POST",
    status: "WAITING_VALIDATION",
    channelId: "c1",
    channelTitle: "Canal Test",
    currentStep: 1,
    steps: [
      { agent: "redaction", status: "DONE", startedAt: null, endedAt: null, summary: "Accroche", costCents: 2, error: null },
      { agent: "controle", status: "RUNNING", startedAt: null, endedAt: null, summary: null, costCents: 0, error: null },
    ],
    payload: { format: "text", simulation: true },
    costCents: 2,
    postId: null,
    scheduledFor: null,
    isTest: true,
    createdBy: "HUMAN",
    attempts: 0,
    lastError: null,
    lastActivityAt: new Date("2026-10-23T09:00:00Z"),
    createdAt: new Date("2026-10-23T09:00:00Z"),
  };
  return {
    sumCents: real.sumCents,
    loadTeamConfigs: vi.fn(async () => ({
      dating: teamConfigView("dating", null),
      casino: teamConfigView("casino", null),
      sports: teamConfigView("sports", null),
      algo: teamConfigView("algo", null),
    })),
    loadTeamConfig: vi.fn(async (t: "dating") => teamConfigView(t, null)),
    loadDayFigures: vi.fn(async () => ({ dating: fig, casino: fig, sports: fig, algo: fig })),
    loadMonthUsage: vi.fn(async () => ({ dating: { llm: 120 } })),
    loadDailyReports: vi.fn(async () => [
      { id: "e1", day: "2026-10-23", lines: ["Rencontres : 1 publié, 1 en attente"], at: new Date() },
    ]),
    loadPausedAll: vi.fn(async () => m.pausedAll),
    loadPendingCounts: vi.fn(async () => ({ validations: 1, requests: 0 })),
    loadChannelPlans: vi.fn(async () => [{ id: "c1", title: "Canal Test", username: null, isTest: true, plan: null }]),
    loadPlanChoices: vi.fn(async () => ({ personas: [{ id: "p1", name: "Léa", isActive: true }], campaigns: [] })),
    loadAgentsOfTeam: vi.fn(async () => [
      { agentKey: "mediatheque", runs: [] },
      { agentKey: "media-ia", runs: [] },
    ]),
    loadMissions: vi.fn(async () => ({ rows: [mission], total: 1 })),
    loadRuns: vi.fn(async () => ({ rows: [], total: 0 })),
    loadValidations: vi.fn(async () => ({ pending: m.validations, recent: [] })),
    loadHumanRequests: vi.fn(async () => ({ open: m.requests, closed: [] })),
    loadAgentsGeneralSettings: vi.fn(async () => ({
      models: { fast: "claude-haiku-5-5", strong: "claude-sonnet-5-5" },
      libraryChannelId: null,
      pausedAll: m.pausedAll,
      channels: [{ id: "c1", title: "Canal Test", username: null, isTest: true, isMediaLibrary: false }],
    })),
  };
});

vi.mock("@/lib/agents/overview", () => {
  const team = (teamKey: string, label: string, posts: number) => ({
    teamKey,
    label,
    enabled: true,
    simulation: true,
    paused: false,
    autonomyLevel: 1,
    today: { created: 4, published: 2, waiting: 1, rejected: 0, failed: 1, fallbacks: 1 },
    spend: teamKey === "dating"
      ? [
          { provider: "llm", cents: 1230, capCents: 5000, projectedCents: 3000 },
          { provider: "video", cents: 8500, capCents: 10000, projectedCents: 12000 },
        ]
      : [],
    results: {
      d7: { posts, views: 1200, clicks: 40, registrations: 5, ftds: 2, commissions: 150 },
      d28: { posts: posts * 4, views: 5000, clicks: 160, registrations: 20, ftds: 8, commissions: 600 },
    },
  });
  const overview = {
    at: "2026-10-24T08:00:00Z",
    pausedAll: false,
    teams: [team("dating", "Rencontres", 7), team("casino", "Casino", 0), team("sports", "Paris sportifs", 3), team("algo", "Algorithme", 0)],
    ads: { paused: false, openRecommendations: 1, lastReportAt: "2026-10-24T07:00:00Z" },
    algoAppliedThisWeek: [
      { id: "r1", teamKey: "dating", field: "mix", targetLabel: "Canal Test", appliedAt: "2026-10-21T07:00:00Z" },
      { id: "r2", teamKey: "dating", field: "messagesBeforeLink", targetLabel: "Léa", appliedAt: "2026-10-22T07:00:00Z" },
    ],
    experimentsRunning: 2,
    openAlerts: 3,
    openHumanRequests: 1,
    pendingValidations: 4,
    health: { lastGrandChefAt: "2026-10-24T07:30:00Z", stuckMissions: 0, providers: [] },
  };
  return {
    loadAgentsOverview: vi.fn(async () => (m.overviewFails ? { ok: false, error: "moteur muet" } : { ok: true, overview })),
    loadAppliedDetails: vi.fn(async (rows: typeof overview.algoAppliedThisWeek) =>
      rows.map((r) => ({ ...r, size: r.id === "r2" ? "BIG" : "SMALL", target: r.id === "r2" ? "PERSONA" : "CHANNEL_PLAN", status: "APPLIED" })),
    ),
  };
});
import AgentsPage from "./page";
import TeamPage from "./[equipe]/page";
import ValidationsPage from "./validations/page";
import JournalPage from "./journal/page";
import SettingsPage from "./settings/page";
import AdsPage from "./ads/page";

const sp = (v: Record<string, string> = {}) => Promise.resolve(v);
const render = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);

function checks(html: string) {
  expect(h1Count(html)).toBe(1);
  expect(primaryButtonCount(html)).toBeLessThanOrEqual(1);
  const text = visibleText(html);
  expect(jargonIn(text)).toEqual([]);
  expect(text).not.toMatch(/\bDating\b|BullMQ|worker|webhook|\bJSON\b|\bAPI\b/);
  return text;
}

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.adsConnectorsMissing = true;
  m.adsFailing = false;
  m.overviewFails = false;
  m.pausedAll = false;
  m.validations = [];
  m.requests = [];
  m.keys = { fal: false };
  m.algoEmpty = false;
  m.datingPersonas = [
    {
      id: "p1",
      name: "Léa",
      isActive: true,
      references: 1,
      hasCharacterFile: false,
      photosMonth: 4,
      latest: [
        { id: "a1", mimeType: "image/jpeg", createdAt: new Date("2026-10-23T08:00:00Z"), providerName: "fal", resolution: null },
        { id: "a2", mimeType: "image/png", createdAt: new Date("2026-10-22T08:00:00Z"), providerName: "fake", resolution: null },
      ],
    },
  ];
});

describe("rubrique Agents", () => {
  it("tableau de bord : quatre équipes, mission de test pour Rencontres et Casino, rapports", async () => {
    const html = await render(AgentsPage({ searchParams: sp() } as never));
    const text = checks(html);
    for (const t of ["Équipe Rencontres", "Équipe Casino", "Équipe Paris sportifs", "Équipe Algorithme"])
      expect(text).toContain(t);
    expect(text.match(/Créer une mission de test/g)?.length).toBe(3); // 2 cartes + l'aide de la page
    expect(text).toContain("Rencontres : 1 publié, 1 en attente");
    expect(text).toContain("Simulation");
  });

  it("tableau de bord complet : à faire, missions du jour, dépense par poste, résultats, réglages appliqués", async () => {
    const html = await render(AgentsPage({ searchParams: sp() } as never));
    const text = checks(html);
    for (const t of [
      "Validations à faire",
      "Demandes du bot",
      "Alertes ouvertes",
      "Tests A/B en cours",
      "Missions du jour",
      "Échouées",
      "Replis",
      "Dépense du mois",
      "IA d'écriture",
      "Vidéos IA",
      "prévus à la fin du mois : au-dessus du plafond",
      "Résultats des posts de l'équipe",
      "Premiers dépôts",
      "Aucun post publié sur les 28 derniers jours",
      "Cette équipe ne publie rien",
      "Réglages appliqués cette semaine",
      "Gros réglage",
      "Pause générale",
      "Derniers rapports",
    ])
      expect(text, t).toContain(t);
    expect(text.match(/Annuler/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('href="/agents/validations"');
    expect(html).toContain('href="/settings/alerts"');
    expect(html).toContain('href="/agents/algo#tests"');
    expect(html).toContain('value="/agents"');
  });

  it("tableau de bord pour un manager : ni pause générale ni annulation d'un gros réglage", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const html = await render(AgentsPage({ searchParams: sp() } as never));
    const text = checks(html);
    expect(text).not.toContain("Pause générale");
    expect(text).toContain("Annulation réservée aux administrateurs");
    expect(html).not.toContain('href="/settings/alerts"');
  });

  it("tableau de bord : résumé du moteur indisponible, la page garde l'ancien résumé", async () => {
    m.overviewFails = true;
    const text = checks(await render(AgentsPage({ searchParams: sp() } as never)));
    expect(text).toContain("Résumé détaillé indisponible");
    expect(text).toContain("Missions du jour");
    expect(text).not.toContain("Réglages appliqués cette semaine");
  });

  it("pause générale : bandeau sur le tableau de bord", async () => {
    m.pausedAll = true;
    const text = checks(await render(AgentsPage({ searchParams: sp() } as never)));
    expect(text).toContain("Toutes les équipes sont en pause");
  });

  it("fiche d'équipe : 404 pour une équipe inconnue", async () => {
    await expect(
      TeamPage({ params: Promise.resolve({ equipe: "inconnue" }), searchParams: sp() } as never),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("fiche d'équipe : pilotage, réglages, plan, agents à venir, missions étape par étape", async () => {
    const text = checks(
      await render(TeamPage({ params: Promise.resolve({ equipe: "dating" }), searchParams: sp() } as never)),
    );
    for (const t of ["Pilotage", "Réglages de l'équipe", "Plafonds du mois", "Plan par canal", "Agents de l'équipe", "Missions"])
      expect(text).toContain(t);
    expect(text).toContain("Publier sur les vrais canaux");
    // Phase 20 : Média IA existe, la chaîne Rencontres n'a plus d'agent « à venir ».
    expect(text).not.toContain("Arrive dans une prochaine étape");
    expect(text).toContain("Attend votre validation");
  });

  it("fiche Rencontres : photos, productions, dépenses, post de test, conversation ; plus de vidéos IA", async () => {
    const html = await render(TeamPage({ params: Promise.resolve({ equipe: "dating" }), searchParams: sp() } as never));
    const text = checks(html);
    for (const t of [
      "Photos des personas",
      "Produire un post de test",
      "Léa",
      "Photos produites ce mois",
      "Dernières productions",
      "Coller une clé",
      "Persona du canal (obligatoire)",
      "Conversation",
      "Ouvrir Conversations",
    ])
      expect(text, t).toContain(t);
    for (const t of ["Banc d'essai", "Vidéos IA", "vidéos sources", "Fournisseur des vidéos", "Résolution des vidéos"])
      expect(text, t).not.toContain(t);
    expect(html).toContain('src="/api/agents/media/a1"');
    expect(html).not.toContain("<video");
    expect(html).toContain('href="/conversations"');
    // Plafond par défaut de l'équipe : 15 € de photos ; plus de plafond vidéo ni de part de vidéos.
    expect(html).toMatch(/name="budget_image"[^>]*value="15"|value="15"[^>]*name="budget_image"/);
    expect(html).not.toContain('name="budget_video"');
    expect(html).not.toContain('name="mix_video"');
    expect(text).not.toContain("Créer une mission de test");
    expect(text).not.toMatch(/\bLoRA\b/);
    m.keys = { fal: true };
    const withKey = visibleText(
      await render(TeamPage({ params: Promise.resolve({ equipe: "dating" }), searchParams: sp() } as never)),
    );
    expect(withKey).toContain("faites avec le fichier du personnage");
  });

  it("fiche Rencontres pour un manager : post de test, plafonds en lecture seule", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const html = await render(TeamPage({ params: Promise.resolve({ equipe: "dating" }), searchParams: sp() } as never));
    const text = checks(html);
    expect(text).toContain("Produire un post de test");
    expect(html).toMatch(/name="budget_image"[^>]*disabled|disabled[^>]*name="budget_image"/);
  });

  it("fiche d'équipe pour un manager : ni vrais canaux ni niveau 2", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const text = checks(
      await render(TeamPage({ params: Promise.resolve({ equipe: "casino" }), searchParams: sp() } as never)),
    );
    expect(text).not.toContain("Publier sur les vrais canaux");
    expect(text).toContain("Seul un administrateur peut faire publier");
    expect(text).toContain("Réservé aux administrateurs");
    expect(text).not.toContain("Réglages des agents");
  });

  it("fiche Casino : stock, à classer, demandes, post de test, dépôt, thèmes, seuil et rotation", async () => {
    const html = await render(TeamPage({ params: Promise.resolve({ equipe: "casino" }), searchParams: sp() } as never));
    const text = checks(html);
    for (const t of [
      "Stock de vidéos par canal",
      "Roulette : 1",
      "Bonus : 0",
      "Médias à classer",
      "Ranger",
      "Demandes de vidéos",
      "Mot-clé : #casino #roulette",
      "Produire un post de test",
      "Dernières publications",
      "Déposer des vidéos ou des images",
      "Thèmes de l'équipe",
      "Machines à sous",
      "Ajouter le thème",
      "Seuil de manque",
      "Rotation (jours)",
      "Thèmes du canal et leur poids",
      "Créneaux conseillés par l'équipe Algorithme",
    ])
      expect(text, t).toContain(t);
    expect(text).not.toContain("Créer une mission de test");
    expect(html).toContain('src="/api/agents/media/x1"');
    expect(html).toContain('name="ptheme_roulette"');
    // Mélange par défaut d'un canal Casino : 2 vidéos, 1 image, 1 texte.
    expect(html).toMatch(/name="mix_video"[^>]*value="2"|value="2"[^>]*name="mix_video"/);
    // Un thème avec des médias ne se retire pas ; un thème sans média, oui.
    expect(text.match(/Retirer/g)?.length).toBe(8);
  });

  it("fiche Casino pour un manager : classer, déposer, produire ; ni thèmes ni seuil", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const html = await render(TeamPage({ params: Promise.resolve({ equipe: "casino" }), searchParams: sp() } as never));
    const text = checks(html);
    expect(text).toContain("Ranger");
    expect(text).toContain("Produire un post de test");
    expect(text).toContain("Déposer des vidéos ou des images");
    expect(text).not.toContain("Ajouter le thème");
    expect(html).not.toContain('name="casinoLowStock"');
    expect(text).toContain("Seuil de manque : 3 vidéos, rotation : 30 jours.");
  });

  it("fiche Paris sportifs : paris du jour, catégories, bilan, réglages", async () => {
    const html = await render(
      TeamPage({ params: Promise.resolve({ equipe: "sports" }), searchParams: sp() } as never),
    );
    const text = checks(html);
    for (const t of [
      "Paris du jour",
      "Produire un pari de test",
      "Lyon – Lens",
      "Écart de valeur : +9 %.",
      "Écarté : la cote a bougé au-delà de l'écart toléré.",
      "Image de repli",
      "Catégories de paris",
      "Nouvelle catégorie",
      "Bilan des paris",
      "Taux de réussite",
      "75 %",
      "Passages et cotes",
      "Appels ce mois : 120 sur 2",
      "ne peut pas perdre",
    ])
      expect(text, t).toContain(t);
    expect(html).toContain('src="/api/agents/media/s1"');
    expect(html).toContain('name="sportsRunHours"');
    expect(text).not.toContain("Plan par canal");
    expect(text).not.toMatch(/\bproxy\b|Playwright/i);
  });

  it("fiche Paris sportifs pour un manager : pari de test, rien à régler", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const html = await render(TeamPage({ params: Promise.resolve({ equipe: "sports" }), searchParams: sp() } as never));
    const text = checks(html);
    expect(text).toContain("Produire un pari de test");
    expect(text).not.toContain("Nouvelle catégorie");
    expect(html).not.toContain('name="sportsRunHours"');
    expect(text).toContain("Passages à 10 h, 15 h et 18 h");
  });

  it("Ce qui marche (équipe Algorithme) : classements, heures, tests, propositions, conversations, rapports, réglages", async () => {
    const html = await render(
      TeamPage({ params: Promise.resolve({ equipe: "algo" }), searchParams: sp({ canal: "c1" }) } as never),
    );
    const text = checks(html);
    for (const t of [
      "Ce qui marche",
      "Types de posts",
      "Vidéo",
      "Personas",
      "Léa",
      "1 cas pas encore concluant",
      "Taux de clic sur l'offre selon l'heure d'envoi",
      "Fenêtres conseillées pour ce canal",
      "mar. 19:00-22:00",
      "Ce qui ne marche pas",
      "Tests A/B",
      "La version A gagne",
      "Propositions de réglages",
      "vidéo 50 %, photo 50 %",
      "Gain attendu : +20 % de clics",
      "Appliquer",
      "Refuser",
      "Annuler",
      "Gros réglage",
      "Conversations par profil",
      "@lea_bot",
      "Question sur sa soirée",
      "Rapports de la semaine",
      "Rencontres : la vidéo marche le mieux, 21 h.",
      "Rapport maintenant",
      "Niveau 1 : appliquer les petits réglages seuls (conseillé)",
      "Points de mélange par semaine au maximum",
      "Enregistrer les réglages de l'équipe",
    ])
      expect(text, t).toContain(t);
    expect(text).not.toMatch(/médiane|p-?value/i);
    expect(html).toContain("<svg");
    expect(text).not.toContain("Plan par canal");
  });

  it("Ce qui marche pour un responsable : petits réglages oui, persona et rapport non, réglages en lecture seule", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const html = await render(TeamPage({ params: Promise.resolve({ equipe: "algo" }), searchParams: sp() } as never));
    const text = checks(html);
    expect(text).toContain("Appliquer");
    expect(text).toContain("Réservé aux administrateurs (réglage de persona ou quota)");
    expect(text).not.toContain("Rapport maintenant");
    expect(text).toContain("Ces réglages sont réservés aux administrateurs.");
    expect(html).toMatch(/name="maxPostsPerDay"[^>]*disabled|disabled[^>]*name="maxPostsPerDay"/);
  });

  it("Ce qui marche sans données : phrases claires", async () => {
    m.algoEmpty = true;
    const text = checks(await render(TeamPage({ params: Promise.resolve({ equipe: "algo" }), searchParams: sp() } as never)));
    for (const t of ["Pas encore de fiche de résultats sur cette période", "Aucun test A/B pour l'instant", "Aucune proposition", "Aucun rapport pour l'instant"])
      expect(text, t).toContain(t);
  });

  it("validations : aperçu et trois décisions ; onglet Demandes", async () => {
    m.validations = [
      {
        id: "v1",
        number: 7,
        missionId: "m1",
        teamKey: "dating",
        previewText: "Ce soir, on se lance ?",
        media: null,
        reason: "Niveau 0 : tout est validé",
        status: "PENDING",
        decidedVia: null,
        decidedAt: null,
        rejectReason: null,
        createdAt: new Date(),
        channelTitle: "Mon canal",
        simulation: true,
      },
    ];
    const text = checks(await render(ValidationsPage({ searchParams: sp() } as never)));
    for (const t of ["n° 7", "Publier", "Refuser", "Corriger le texte", "Niveau 0 : tout est validé"])
      expect(text).toContain(t);
    m.requests = [
      {
        id: "h1",
        teamKey: null,
        kind: "CONFIRM",
        key: "agents.dailyReport",
        question: "Veux-tu recevoir chaque matin le rapport des agents ? Réponds oui ou non",
        options: [],
        status: "PENDING",
        answerSummary: null,
        askedAt: new Date(),
        answeredAt: null,
        createdAt: new Date(),
        missionId: null,
      },
    ];
    const req = visibleText(await render(ValidationsPage({ searchParams: sp({ tab: "demandes" }) } as never)));
    expect(req).toContain("Question posée");
    expect(req).toContain("Plus tard");
    expect(req).toContain("Répondre");
  });

  it("journal : missions, export", async () => {
    const html = await render(JournalPage({ searchParams: sp() } as never));
    checks(html);
    expect(html).toContain('href="/agents/journal/export"');
  });

  it("réglages : administrateurs seulement, clé jamais réaffichée", async () => {
    const html = await render(SettingsPage({ searchParams: sp() } as never));
    const text = checks(html);
    expect(text).toContain("Enregistrée (…ab12)");
    expect(text).toContain("Vérifier");
    expect(text).toContain("Tout mettre en pause");
    m.user = { id: "u2", role: "MANAGER" };
    await expect(SettingsPage({ searchParams: sp() } as never)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("Agent Ads (/agents/ads)", () => {
  it("tableau de bord : la carte de l'Agent Ads, à côté des équipes", async () => {
    const text = checks(await render(AgentsPage({ searchParams: sp() } as never)));
    expect(text).toContain("Agent Ads");
    expect(text).toContain("Il ne change jamais rien chez Meta ou TikTok");
    expect(text).toContain("1 à décider");
  });

  it("résumé, recommandations avec preuves, parcours, pubs, membres, seuils, rapports, exports", async () => {
    const html = await render(AdsPage({ searchParams: sp() } as never));
    const text = checks(html);
    for (const t of [
      "Résumé d'hier",
      "Recommandations",
      "Arrêter",
      "Coût par inscription au-dessus du seuil depuis 4 jours.",
      "À faire vous-même",
      "Fait",
      "Refuser",
      "Faites ou refusées",
      "Votre commentaire : Budget monté à 25 €",
      "Campagnes",
      "Parcours : Casino octobre",
      "Étape la plus faible : Clics sur les offres",
      "Meilleures et pires pubs",
      "Vidéo roulette",
      "À surveiller : 1 pub trop jeune",
      "Ce que rapportent les membres de chaque pub",
      "Seuils par univers",
      "Enregistrer les seuils",
      "Alertes sur les campagnes",
      "Hausse de dépense qui déclenche l'alerte",
      "Inscriptions minimales avant de comparer",
      "Enregistrer les réglages des alertes",
      "Rapports archivés",
      "Rapport du jour",
      "Pubs hier : 300 € dépensés",
      "Exporter les recommandations",
      "Exporter les chiffres",
      "c'est vous qui le faites",
    ])
      expect(text).toContain(t);
    expect(text).toContain("Aucun connecteur Meta ou TikTok branché");
    expect(html).toContain('href="/settings/connectors"');
    expect(html).toContain("/stats/funnel?range=custom&amp;from=2026-10-17&amp;to=2026-10-23&amp;campaignId=cp1");
    expect(text).not.toMatch(/\bROAS\b|\bCPA\b|cohorte|entonnoir/i);
  });

  it("connecteur branché : pas de phrase sur les coûts importés", async () => {
    m.adsConnectorsMissing = false;
    const text = checks(await render(AdsPage({ searchParams: sp({ periode: "28d" }) } as never)));
    expect(text).not.toContain("Aucun connecteur Meta ou TikTok branché");
    expect(text).toContain("28 derniers jours");
  });

  it("manager : lit et marque « Fait » / « Refuser », mais ne change pas les seuils", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const text = checks(await render(AdsPage({ searchParams: sp() } as never)));
    expect(text).toContain("Refuser");
    expect(text).not.toContain("Enregistrer les seuils");
    expect(text).toContain("Seuls les administrateurs peuvent changer les seuils.");
    expect(text).not.toContain("Enregistrer les réglages des alertes");
    expect(text).toContain("Seuls les administrateurs peuvent changer ces réglages.");
  });

  it("analyse en panne : la page reste lisible avec un message", async () => {
    m.adsFailing = true;
    const text = checks(await render(AdsPage({ searchParams: sp() } as never)));
    expect(text).toContain("Chiffres indisponibles pour l'instant");
    expect(text).toContain("Recommandations");
    expect(text).not.toContain("Exporter les chiffres");
  });
});
