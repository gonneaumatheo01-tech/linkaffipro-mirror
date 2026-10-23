import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la fiche Casino (phase 22) : classer et produire un post de test (ADMIN et MANAGER), thèmes de l'équipe
// (ADMIN), journal des actions. Moteur des agents et base simulés (`vi.mock`).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  settings: {} as unknown,
  mediaCount: 0,
  channels: [] as string[],
  classify: vi.fn(async (_d: unknown, _i: unknown, _a: unknown) => ({ ok: true, message: "Média classé ✅ roulette" })),
  createTestPostMission: vi.fn(async (_d: unknown, _i: unknown) => ({ ok: true as const, missionId: "m1" })),
  write: vi.fn(async (..._a: unknown[]) => {}),
  audit: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/agents", () => ({ classifyCasinoMedia: m.classify, createTestPostMission: m.createTestPostMission }));
vi.mock("@linkaffipro/db", () => ({ audit: m.audit }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/casino-queries", () => ({
  loadThemeMediaCounts: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, m.mediaCount]))),
  loadChannelsUsingTheme: vi.fn(async () => m.channels),
}));
vi.mock("@/lib/agents/casino-save", async () => {
  const { parseCasinoSettings } = await import("@/lib/agents/casino");
  return {
    readCasinoSettingsRaw: vi.fn(async () => ({ raw: m.settings, settings: parseCasinoSettings(m.settings) })),
    writeCasinoSettings: m.write,
  };
});

import {
  addCasinoThemeAction,
  classifyCasinoMediaAction,
  createCasinoTestPostAction,
  removeCasinoThemeAction,
  renameCasinoThemeAction,
} from "./casino-actions";

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
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
  m.settings = {};
  m.mediaCount = 0;
  m.channels = [];
  for (const f of [m.classify, m.createTestPostMission, m.write, m.audit]) f.mockClear();
});

describe("fiche Casino : actions", () => {
  it("un responsable classe un média : thèmes connus, acteur du site", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(classifyCasinoMediaAction(fd({ assetId: "a1", theme: ["roulette", "bonus"] })));
    expect(m.classify).toHaveBeenCalledWith({}, { assetId: "a1", themes: ["roulette", "bonus"] }, { userId: "u2", via: "SITE" });
    expect(url).toContain("ok=Média classé");
    const err = await redirectOf(classifyCasinoMediaAction(fd({ assetId: "a1" })));
    expect(err).toContain("Cochez au moins un thème");
  });

  it("post de test : mission casino du type choisi, journalisée", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(createCasinoTestPostAction(fd({ format: "photo" })));
    expect(m.createTestPostMission).toHaveBeenCalledWith({}, { teamKey: "casino", byUserId: "u2", format: "photo" });
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "agents.test_post_requested", metadata: expect.objectContaining({ teamKey: "casino" }) }),
    );
    expect(url).toContain("Post de test (image)");
  });

  it("thèmes réservés aux administrateurs", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(await redirectOf(addCasinoThemeAction(fd({ label: "Poker" })))).toContain("réservés aux administrateurs");
    expect(m.write).not.toHaveBeenCalled();
  });

  it("ajout, renommage, retrait journalisés ; retrait refusé si le thème a des médias", async () => {
    expect(await redirectOf(addCasinoThemeAction(fd({ label: "Poker" })))).toContain("#casino #poker");
    expect(m.write.mock.calls[0]![2]).toBe("agents.casino_theme_added");
    await redirectOf(renameCasinoThemeAction(fd({ key: "live", label: "Tables en direct" })));
    expect(m.write.mock.calls[1]![2]).toBe("agents.casino_theme_renamed");
    m.mediaCount = 3;
    expect(await redirectOf(removeCasinoThemeAction(fd({ key: "live" })))).toContain("encore 3 médias");
    expect(m.write).toHaveBeenCalledTimes(2);
    m.mediaCount = 0;
    expect(await redirectOf(removeCasinoThemeAction(fd({ key: "live" })))).toContain("retiré");
    expect(m.write.mock.calls[2]![2]).toBe("agents.casino_theme_removed");
  });
});
