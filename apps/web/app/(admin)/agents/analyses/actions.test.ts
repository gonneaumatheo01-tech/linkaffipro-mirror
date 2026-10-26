import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la page Agents → Analyses (phase 29) : les boutons passent par les cœurs uniques (que Kevin appelle aussi),
// écrivent le journal des actions et reviennent sur la bonne vue avec le message. Base simulée.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  source: { id: "s1", name: "BlackHatWorld", url: "https://www.blackhatworld.com", isActive: false, origin: "discovered", errorCount: 0, lastError: null, lastScrapedAt: null } as Record<string, unknown> | null,
  rec: { id: "r1", source: "market_analysis", status: "PROPOSED", field: "format", targetId: "DATING" } as Record<string, unknown> | null,
  audit: vi.fn(async (_a: unknown) => {}),
  update: vi.fn(async (_a: unknown) => ({})),
  del: vi.fn(async (_a: unknown) => ({})),
  revalidated: [] as string[],
}));

// Phase 30 : la recommandation est approuvée par le QA Global (le refus est testé dans lot-analystes/cores.test.ts).
vi.mock("@linkaffipro/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linkaffipro/agents")>()),
  recommendationNotApproved: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn((p: string) => m.revalidated.push(p)) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/db", () => ({
  audit: m.audit,
  prisma: {
    trendSource: { findUnique: vi.fn(async () => m.source), update: m.update, delete: m.del },
    trendEntry: { count: vi.fn(async () => 3) },
    recommendation: { findUnique: vi.fn(async () => m.rec), update: m.update },
  },
}));

import { activateSourceAction, deactivateSourceAction, decideMarketRecommendationAction, deleteSourceAction } from "./actions";

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
  m.source = { id: "s1", name: "BlackHatWorld", url: "https://www.blackhatworld.com", isActive: false, origin: "discovered", errorCount: 0, lastError: null, lastScrapedAt: null };
  m.rec = { id: "r1", source: "market_analysis", status: "PROPOSED", field: "format", targetId: "DATING" };
  m.audit.mockClear();
  m.update.mockClear();
  m.del.mockClear();
  m.revalidated = [];
});

describe("boutons des sources", () => {
  it("Activer : cœur, journal, retour à la vue Sources", async () => {
    const url = await redirectOf(activateSourceAction(fd({ sourceId: "s1" })));
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "s1" }, data: expect.objectContaining({ isActive: true }) }));
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", action: "agents.analysts_source_activated", metadata: expect.objectContaining({ via: "WEB" }) }));
    expect(url).toMatch(/^NEXT_REDIRECT \/agents\/analyses\?vue=sources&ok=Source « BlackHatWorld » activée/);
    expect(url).toMatch(/#sources$/);
    expect(m.revalidated).toEqual(["/agents/analyses"]);
  });

  it("Désactiver une source déjà inactive : erreur sur la vue Sources", async () => {
    const url = await redirectOf(deactivateSourceAction(fd({ sourceId: "s1" })));
    expect(url).toContain("/agents/analyses?vue=sources&error=La source « BlackHatWorld » est déjà désactivée.");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("Supprimer : sans le mot, refusé ; avec SUPPRIMER, supprimée et journal", async () => {
    expect(await redirectOf(deleteSourceAction(fd({ sourceId: "s1", confirm: "supprimer" })))).toContain("error=Pour confirmer, tapez SUPPRIMER");
    expect(m.del).not.toHaveBeenCalled();
    const url = await redirectOf(deleteSourceAction(fd({ sourceId: "s1", confirm: "SUPPRIMER" })));
    expect(m.del).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.analysts_source_deleted", entityId: "s1" }));
    expect(url).toContain("ok=Source « BlackHatWorld » supprimée. 3 entrées de veille effacées");
  });

  it("responsable : refusé, sans écriture ni journal", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    for (const a of [activateSourceAction, deactivateSourceAction, deleteSourceAction]) {
      expect(await redirectOf(a(fd({ sourceId: "s1", confirm: "SUPPRIMER" })))).toContain("error=Activer, désactiver ou supprimer une source de la veille est réservé aux administrateurs.");
    }
    expect(m.update).not.toHaveBeenCalled();
    expect(m.del).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("boutons des recommandations", () => {
  it("Accepter (responsable compris) : état écrit, journal, retour à la vue Recommandations", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(decideMarketRecommendationAction(fd({ id: "r1", status: "APPLIED", comment: "ok" })));
    expect(m.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: expect.objectContaining({ status: "APPLIED", appliedBy: "HUMAN", appliedById: "u2", comment: "ok" }) });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.analysts_recommendation_accepted", userId: "u2" }));
    expect(url).toContain("/agents/analyses?vue=recommandations&ok=Recommandation acceptée");
    expect(url).toMatch(/#recommandations$/);
  });

  it("déjà décidée : erreur, page rafraîchie", async () => {
    m.rec = { ...m.rec!, status: "REJECTED" };
    const url = await redirectOf(decideMarketRecommendationAction(fd({ id: "r1", status: "APPLIED" })));
    expect(url).toContain("error=Cette recommandation a déjà été décidée");
    expect(m.revalidated).toEqual(["/agents/analyses"]);
    expect(m.update).not.toHaveBeenCalled();
  });
});
