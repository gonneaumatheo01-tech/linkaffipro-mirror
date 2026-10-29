import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la fiche Rencontres (phase 20) : post de test (ADMIN et MANAGER), plafonds réservés aux administrateurs.
// Les vidéos IA (et le banc d'essai) ont été retirées le 29 octobre 2026. Moteur des agents simulé (`vi.mock`).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  createTestPostMission: vi.fn(async (_d: unknown, _i: unknown) => ({ ok: true as const, missionId: "m1" })),
  saveTeamSettings: vi.fn(async (..._a: unknown[]) => {}),
  audit: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/agents", () => ({ createTestPostMission: m.createTestPostMission }));
vi.mock("@linkaffipro/db", () => ({ audit: m.audit }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/save", () => ({
  saveTeamSettings: m.saveTeamSettings,
  saveChannelPlan: vi.fn(),
}));
vi.mock("@/lib/agents/teams", () => ({
  PROVIDER_LABELS: { llm: "IA d'écriture", video: "Vidéos IA", image: "Photos IA", odds: "Cotes", screenshot: "Captures" },
  TEAM_PROVIDERS: { dating: ["llm", "image"], casino: ["llm"], sports: ["llm"], algo: ["llm"] },
  parseTeamParam: (v: unknown) => (["dating", "casino", "sports", "algo"].includes(String(v)) ? v : null),
}));

import { createTestPostAction, saveTeamSettingsAction } from "./actions";

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
  for (const f of [m.createTestPostMission, m.saveTeamSettings, m.audit]) f.mockClear();
});

describe("Produire un post de test", () => {
  it("un responsable le lance : mission en simulation demandée au moteur, journalisée", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(createTestPostAction(fd({ format: "photo", personaId: "p1" })));
    expect(url).toContain("ok=Post de test (photo) lancé en simulation");
    expect(m.createTestPostMission).toHaveBeenCalledWith({}, { teamKey: "dating", byUserId: "u2", format: "photo", personaId: "p1" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.test_post_requested", entityId: "m1" }));
  });

  it("refus du moteur ou saisie incomplète : message clair ; plus de post vidéo", async () => {
    m.createTestPostMission.mockResolvedValueOnce({ ok: false, reason: "plafond photo atteint" } as never);
    expect(await redirectOf(createTestPostAction(fd({ format: "photo", personaId: "p1" })))).toContain(
      "error=Post de test refusé : plafond photo atteint",
    );
    expect(await redirectOf(createTestPostAction(fd({ format: "photo" })))).toContain("Choisissez la persona");
    expect(await redirectOf(createTestPostAction(fd({ format: "video", personaId: "p1" })))).toContain("photo ou texte");
  });
});

describe("réglages de l'équipe Rencontres", () => {
  const form = { team: "dating", budget_image: "10" };

  it("administrateur : plafonds enregistrés", async () => {
    await redirectOf(saveTeamSettingsAction(fd(form)));
    expect(m.saveTeamSettings.mock.calls[0]![1]).toMatchObject({ budgets: { image: 1000 } });
  });

  it("responsable : plafonds ignorés (inchangés)", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    await redirectOf(saveTeamSettingsAction(fd(form)));
    expect(m.saveTeamSettings.mock.calls[0]![1]).toMatchObject({ budgets: null });
  });
});
