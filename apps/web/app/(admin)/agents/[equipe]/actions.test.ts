import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la fiche Rencontres (phase 20) : post de test (ADMIN et MANAGER), banc d'essai (ADMIN, rien sans clé),
// plafonds et fournisseur réservés aux administrateurs. Moteur des agents simulé (`vi.mock`).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  keys: { fal: true, magichour: false },
  createTestPostMission: vi.fn(async (_d: unknown, _i: unknown) => ({ ok: true as const, missionId: "m1" })),
  startBench: vi.fn(async (_d: unknown, _i: unknown) => ({ ok: true, message: "Banc d'essai lancé." })),
  saveTeamSettings: vi.fn(async (..._a: unknown[]) => {}),
  saveDatingMediaSettings: vi.fn(async (..._a: unknown[]) => {}),
  audit: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/agents", () => ({ createTestPostMission: m.createTestPostMission, startBench: m.startBench }));
vi.mock("@linkaffipro/db", () => ({ audit: m.audit }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/dating-queries", () => ({ loadMediaKeys: vi.fn(async () => m.keys) }));
vi.mock("@/lib/agents/save", () => ({
  saveTeamSettings: m.saveTeamSettings,
  saveDatingMediaSettings: m.saveDatingMediaSettings,
  saveChannelPlan: vi.fn(),
}));
vi.mock("@/lib/agents/teams", () => ({
  PROVIDER_LABELS: { llm: "IA d'écriture", video: "Vidéos IA", image: "Photos IA", odds: "Cotes", screenshot: "Captures" },
  TEAM_PROVIDERS: { dating: ["llm", "video", "image"], casino: ["llm"], sports: ["llm"], algo: ["llm"] },
  parseTeamParam: (v: unknown) => (["dating", "casino", "sports", "algo"].includes(String(v)) ? v : null),
}));

import { createTestPostAction, saveTeamSettingsAction, startBenchAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return decodeURIComponent(String((err as Error).message).replace(/\+/g, " "));
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.keys = { fal: true, magichour: false };
  for (const f of [m.createTestPostMission, m.startBench, m.saveTeamSettings, m.saveDatingMediaSettings, m.audit])
    f.mockClear();
});

describe("Produire un post de test", () => {
  it("un responsable le lance : mission en simulation demandée au moteur, journalisée", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(createTestPostAction(fd({ format: "photo", personaId: "p1" })));
    expect(url).toContain("ok=Post de test (photo) lancé en simulation");
    expect(m.createTestPostMission).toHaveBeenCalledWith({}, { teamKey: "dating", byUserId: "u2", format: "photo", personaId: "p1" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.test_post_requested", entityId: "m1" }));
  });

  it("refus du moteur ou saisie incomplète : message clair", async () => {
    m.createTestPostMission.mockResolvedValueOnce({ ok: false, reason: "plafond vidéo atteint" } as never);
    expect(await redirectOf(createTestPostAction(fd({ format: "video", personaId: "p1" })))).toContain(
      "error=Post de test refusé : plafond vidéo atteint",
    );
    expect(await redirectOf(createTestPostAction(fd({ format: "video" })))).toContain("Choisissez la persona");
  });
});

describe("Banc d'essai", () => {
  it("réservé aux administrateurs", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(await redirectOf(startBenchAction(fd({ personaId: "p1" })))).toContain("réservé aux administrateurs");
    expect(m.startBench).not.toHaveBeenCalled();
  });

  it("sans aucune clé : rien n'est lancé, le message dit quoi faire", async () => {
    m.keys = { fal: false, magichour: false };
    const url = await redirectOf(startBenchAction(fd({ personaId: "p1" })));
    expect(url).toContain("collez d'abord la clé fal.ai");
    expect(m.startBench).not.toHaveBeenCalled();
  });

  it("avec une clé : banc lancé et journalisé", async () => {
    const url = await redirectOf(startBenchAction(fd({ personaId: "p1" })));
    expect(url).toContain("ok=Banc d'essai lancé.");
    expect(m.startBench).toHaveBeenCalledWith({}, { personaId: "p1", byUserId: "u1" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.bench_requested", entityId: "p1" }));
  });
});

describe("réglages de l'équipe Rencontres", () => {
  const form = { team: "dating", budget_video: "50", budget_image: "10", videoProvider: "magichour", videoResolution: "720p" };

  it("administrateur : plafonds, fournisseur et résolution enregistrés", async () => {
    await redirectOf(saveTeamSettingsAction(fd(form)));
    expect(m.saveTeamSettings.mock.calls[0]![1]).toMatchObject({ budgets: { video: 5000, image: 1000 } });
    expect(m.saveDatingMediaSettings).toHaveBeenCalledWith({ videoProvider: "magichour", videoResolution: "720p" }, "u1");
  });

  it("responsable : plafonds et fournisseur ignorés (inchangés)", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    await redirectOf(saveTeamSettingsAction(fd(form)));
    expect(m.saveTeamSettings.mock.calls[0]![1]).toMatchObject({ budgets: null });
    expect(m.saveDatingMediaSettings).not.toHaveBeenCalled();
  });
});
