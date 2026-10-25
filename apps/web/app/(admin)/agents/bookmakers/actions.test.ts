import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la page Bookmakers (phase 35) : réservées aux administrateurs, elles appellent les gestes des agents
// (qui écrivent le journal des actions « via SITE ») et ne font que déposer des lectures. Moteur simulé.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  site: { key: "sportaza", label: "Sportaza", baseUrl: "https://sportaza.com/fr/sports" } as Record<
    string,
    string | null
  > | null,
  creds: [{ key: "agents.secret.providers.bookmakers.default.credentials" }] as Array<{
    key: string;
  }>,
  testSite: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "" })),
  relearnSite: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "" })),
  openVisibleBrowser: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "" })),
  setSiteUrl: vi.fn(
    async (..._a: unknown[]) =>
      ({ ok: true, message: "", site: { baseUrl: "https://betportal.io/" } }) as unknown,
  ),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({ deps: true }) }));
vi.mock("@linkaffipro/agents", () => ({
  testSite: m.testSite,
  relearnSite: m.relearnSite,
  openVisibleBrowser: m.openVisibleBrowser,
  setSiteUrl: m.setSiteUrl,
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    bookmakerSite: { findUnique: vi.fn(async () => m.site) },
    setting: { findMany: vi.fn(async () => m.creds) },
  },
}));

import { openBrowserAction, relearnSiteAction, setSiteUrlAction, testSiteAction } from "./actions";

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
  return "";
}

describe("actions de la page Bookmakers", () => {
  beforeEach(() => {
    m.user = { id: "u1", role: "ADMIN" };
    m.site = { key: "sportaza", label: "Sportaza", baseUrl: "https://sportaza.com/fr/sports" };
    m.creds = [{ key: "agents.secret.providers.bookmakers.default.credentials" }];
    for (const f of [m.testSite, m.relearnSite, m.openVisibleBrowser, m.setSiteUrl]) f.mockClear();
  });

  it("manager : refusé, rien n'est déposé", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    for (const a of [testSiteAction, relearnSiteAction, openBrowserAction, setSiteUrlAction])
      expect(await redirectOf(a(fd({ siteKey: "sportaza", url: "x.com" })))).toMatch(
        /réservé aux administrateurs/,
      );
    expect(m.testSite).not.toHaveBeenCalled();
    expect(m.relearnSite).not.toHaveBeenCalled();
    expect(m.openVisibleBrowser).not.toHaveBeenCalled();
    expect(m.setSiteUrl).not.toHaveBeenCalled();
  });

  it("administrateur : tester, ré-apprendre, navigateur, adresse — via le site, avec l'auteur", async () => {
    expect(await redirectOf(testSiteAction(fd({ siteKey: "sportaza" })))).toMatch(
      /ok=Test de Sportaza lancé/,
    );
    expect(m.testSite).toHaveBeenCalledWith({ deps: true }, "sportaza", {
      userId: "u1",
      via: "SITE",
    });
    expect(await redirectOf(relearnSiteAction(fd({ siteKey: "sportaza" })))).toMatch(
      /Apprentissage de Sportaza demandé/,
    );
    expect(await redirectOf(openBrowserAction(fd({ siteKey: "sportaza" })))).toMatch(
      /navigateur s'ouvre sur le Mac/,
    );
    expect(
      await redirectOf(setSiteUrlAction(fd({ siteKey: "sportaza", url: "betportal.io" }))),
    ).toMatch(/Nouvelle adresse de Sportaza/);
    expect(m.setSiteUrl).toHaveBeenCalledWith({ deps: true }, "sportaza", "betportal.io", {
      userId: "u1",
      via: "SITE",
    });
  });

  it("sans identifiants ni adresse : le dire, sans rien déposer ; Mac éteint : le dire", async () => {
    m.creds = [];
    expect(await redirectOf(testSiteAction(fd({ siteKey: "sportaza" })))).toMatch(
      /identifiants bookmakers/,
    );
    m.site = { key: "betportal", label: "Bet Portal", baseUrl: null };
    expect(await redirectOf(relearnSiteAction(fd({ siteKey: "betportal" })))).toMatch(
      /adresse du site/,
    );
    expect(m.testSite).not.toHaveBeenCalled();
    expect(m.relearnSite).not.toHaveBeenCalled();
    m.site = { key: "sportaza", label: "Sportaza", baseUrl: "https://sportaza.com/fr/sports" };
    m.openVisibleBrowser.mockResolvedValueOnce({ ok: false, message: "" });
    expect(await redirectOf(openBrowserAction(fd({ siteKey: "sportaza" })))).toMatch(
      /Mac ne lit pas/,
    );
    expect(await redirectOf(testSiteAction(fd({ siteKey: "../../x" })))).toMatch(
      /Bookmaker inconnu/,
    );
  });
});
