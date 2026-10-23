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
  keys: { fal: false, magichour: false },
  algoEmpty: false,
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
  startBenchAction: vi.fn(),
}));
vi.mock("@/lib/agents/dating-queries", () => ({
  loadDatingPersonas: vi.fn(async () => m.datingPersonas),
  loadDatingSettings: vi.fn(async () => ({ videoProvider: "fal", videoResolution: "580p" })),
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

import AgentsPage from "./page";
import TeamPage from "./[equipe]/page";
import ValidationsPage from "./validations/page";
import JournalPage from "./journal/page";
import SettingsPage from "./settings/page";

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
  m.pausedAll = false;
  m.validations = [];
  m.requests = [];
  m.keys = { fal: false, magichour: false };
  m.algoEmpty = false;
  m.datingPersonas = [
    {
      id: "p1",
      name: "Léa",
      isActive: true,
      references: 1,
      hasCharacterFile: false,
      sourcesUnused: 2,
      sourcesTotal: 5,
      videosMonth: 3,
      photosMonth: 4,
      latest: [
        { id: "a1", mimeType: "video/mp4", createdAt: new Date("2026-10-23T08:00:00Z"), providerName: "fal", resolution: "580p" },
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

  it("fiche Rencontres : stock, productions, dépenses, post de test, banc d'essai, dépôt, conversation", async () => {
    const html = await render(TeamPage({ params: Promise.resolve({ equipe: "dating" }), searchParams: sp() } as never));
    const text = checks(html);
    for (const t of [
      "Vidéos et photos des personas",
      "Produire un post de test",
      "Léa",
      "2 sur 5",
      "Moins de 3 vidéos sources neuves",
      "Dernières productions",
      "Banc d'essai",
      "Collez d'abord la clé fal.ai",
      "Déposer des vidéos sources",
      "Fournisseur des vidéos",
      "Résolution des vidéos",
      "Persona du canal (obligatoire)",
      "Conversation",
      "Ouvrir Conversations",
    ])
      expect(text, t).toContain(t);
    expect(html).toContain('src="/api/agents/media/a1"');
    expect(html).toContain("<video");
    expect(html).toContain('href="/conversations"');
    // Plafonds par défaut de l'équipe : 100 € de vidéos, 15 € de photos.
    expect(html).toMatch(/name="budget_video"[^>]*value="100"|value="100"[^>]*name="budget_video"/);
    expect(text).not.toContain("Créer une mission de test");
    expect(text).not.toMatch(/\bLoRA\b/);
    // Une clé : le banc d'essai est proposé.
    m.keys = { fal: true, magichour: false };
    const withKey = visibleText(
      await render(TeamPage({ params: Promise.resolve({ equipe: "dating" }), searchParams: sp() } as never)),
    );
    expect(withKey).toContain("chez chaque fournisseur disponible");
  });

  it("fiche Rencontres pour un manager : post de test et dépôt, ni banc d'essai ni fournisseur ni plafonds", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const html = await render(TeamPage({ params: Promise.resolve({ equipe: "dating" }), searchParams: sp() } as never));
    const text = checks(html);
    expect(text).toContain("Produire un post de test");
    expect(text).toContain("Déposer des vidéos sources");
    expect(text).not.toContain("Banc d'essai");
    expect(html).not.toContain('name="videoProvider"');
    expect(html).toMatch(/name="budget_video"[^>]*disabled|disabled[^>]*name="budget_video"/);
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
