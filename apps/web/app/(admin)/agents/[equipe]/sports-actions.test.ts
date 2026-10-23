import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la fiche Paris sportifs (phase 23) : pari de test (ADMIN et MANAGER), catégories, identifiants du
// bookmaker, adresse de secours et test de connexion (ADMIN), journal des actions. Moteur et base simulés.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  createTestBetMission: vi.fn(async (_d: unknown, _i: unknown) => ({ ok: true as const, missionId: "m1" })),
  testBookmakerConnection: vi.fn(async (_d: unknown, _b: string) => ({
    result: { ok: true as const, png: new Uint8Array(), readOdds: 0, pageUrl: "x" },
    assetId: "a1" as string | null,
    message: "connexion réussie",
  })),
  saveSecret: vi.fn(async (..._a: unknown[]) => ({ last4: "abcd" })),
  deleteSecret: vi.fn(async (..._a: unknown[]) => {}),
  saveBetCategory: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, id: "cat9", changed: ["création"] })),
  audit: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/agents", () => ({
  createTestBetMission: m.createTestBetMission,
  testBookmakerConnection: m.testBookmakerConnection,
  saveSecret: m.saveSecret,
  deleteSecret: m.deleteSecret,
}));
vi.mock("@linkaffipro/db", () => ({ audit: m.audit }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/queries", () => ({
  loadChannelPlans: vi.fn(async () => [{ id: "c1", title: "Test", isTest: true }]),
  loadPlanChoices: vi.fn(async () => ({ personas: [], campaigns: [{ id: "camp1", name: "Camp" }] })),
}));
vi.mock("@/lib/agents/sports-queries", () => ({
  loadBetCategories: vi.fn(async () => [{ id: "cat1" }]),
}));
vi.mock("@/lib/agents/sports-save", () => ({
  loadCategoryKeys: vi.fn(async () => []),
  saveBetCategory: m.saveBetCategory,
}));

import {
  createTestBetAction,
  deleteBookmakerCredentialsAction,
  saveBetCategoryAction,
  saveBookmakerCredentialsAction,
  saveScreenshotProxyAction,
  testBookmakerConnectionAction,
} from "./sports-actions";

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
  for (const f of [m.createTestBetMission, m.testBookmakerConnection, m.saveSecret, m.deleteSecret, m.saveBetCategory, m.audit])
    f.mockClear();
});

describe("fiche Paris sportifs : actions", () => {
  it("un responsable produit un pari de test, journalisé", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(createTestBetAction(fd({ categoryId: "cat1" })));
    expect(m.createTestBetMission).toHaveBeenCalledWith({}, { categoryId: "cat1", byUserId: "u2" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.test_bet_requested", entityId: "m1" }));
    expect(url).toContain("ok=Pari de test lancé");
    expect(await redirectOf(createTestBetAction(fd({ categoryId: "inconnue" })))).toContain("Catégorie inconnue");
  });

  it("catégories, identifiants et test de connexion réservés aux administrateurs", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(await redirectOf(saveBetCategoryAction(fd({ name: "X" })))).toContain("réservé aux administrateurs");
    expect(await redirectOf(saveBookmakerCredentialsAction(fd({ bookmaker: "sportaza", login: "a", password: "b" })))).toContain(
      "réservé aux administrateurs",
    );
    expect(await redirectOf(testBookmakerConnectionAction(fd({ bookmaker: "sportaza" })))).toContain("réservé aux administrateurs");
    expect(m.saveBetCategory).not.toHaveBeenCalled();
    expect(m.saveSecret).not.toHaveBeenCalled();
    expect(m.testBookmakerConnection).not.toHaveBeenCalled();
  });

  it("création d'une catégorie (canaux et campagne vérifiés)", async () => {
    const url = await redirectOf(
      saveBetCategoryAction(
        fd({
          name: "Corners",
          marketTypes: "corners-all-game-ou-over",
          leagues: "EPL",
          bookmakers: "sportaza",
          minOdds: "1,5",
          maxOdds: "3",
          picksPerDay: "1",
          channelIds: "c1",
          campaignId: "camp1",
          minMinutesBeforeKickoff: "30",
          maxOddsDriftPct: "5",
        }),
      ),
    );
    expect(m.saveBetCategory).toHaveBeenCalledWith(expect.objectContaining({ key: "corners", channelIds: ["c1"] }), "u1");
    expect(url).toContain("Catégorie « Corners » créée (inactive");
  });

  it("identifiants : deux clés chiffrées par le moteur, jamais dans l'adresse", async () => {
    const url = await redirectOf(saveBookmakerCredentialsAction(fd({ bookmaker: "sportaza", login: "moi", password: "secret1" })));
    expect(m.saveSecret).toHaveBeenNthCalledWith(1, {}, "providers.bookmakers.sportaza.login", "moi", { userId: "u1", via: "SITE" });
    expect(m.saveSecret).toHaveBeenNthCalledWith(2, {}, "providers.bookmakers.sportaza.password", "secret1", {
      userId: "u1",
      via: "SITE",
    });
    expect(url).not.toContain("secret1");
    await redirectOf(deleteBookmakerCredentialsAction(fd({ bookmaker: "sportaza" })));
    expect(m.deleteSecret).toHaveBeenCalledTimes(2);
  });

  it("test de connexion : résultat journalisé, capture dans l'adresse", async () => {
    const url = await redirectOf(testBookmakerConnectionAction(fd({ bookmaker: "sportaza" })));
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agents.bookmaker_tested",
        entityId: "sportaza",
        metadata: expect.objectContaining({ ok: true, assetId: "a1" }),
      }),
    );
    expect(url).toContain("capture=a1");
    expect(url).toContain("Sportaza : connexion réussie");
    m.testBookmakerConnection.mockResolvedValueOnce({
      result: { ok: false, kind: "captcha", message: "captcha" } as never,
      assetId: null,
      message: "bloqué par une vérification",
    });
    expect(await redirectOf(testBookmakerConnectionAction(fd({ bookmaker: "sportaza" })))).toContain("error=Sportaza : bloqué");
  });

  it("adresse de secours vérifiée avant l'enregistrement", async () => {
    expect(await redirectOf(saveScreenshotProxyAction(fd({ proxy: "pas une adresse" })))).toContain("Adresse illisible");
    await redirectOf(saveScreenshotProxyAction(fd({ proxy: "http://u:p@h:8080" })));
    expect(m.saveSecret).toHaveBeenCalledWith({}, "providers.screenshotProxy", "http://u:p@h:8080", { userId: "u1", via: "SITE" });
  });
});
