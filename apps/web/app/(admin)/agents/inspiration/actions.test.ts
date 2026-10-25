import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la page Inspiration (phase 27) : Annuler (une proposition ou toute la référence) et Retirer, réservées
// aux administrateurs, appellent les fonctions de Kevin et écrivent le journal des actions. Moteur simulé.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  applied: [{ id: "rec1" }] as Array<{ id: string }>,
  ref: { id: "ref1", username: "roulette_pro", title: "Roulette Pro" } as Record<string, string | null> | null,
  undo: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "" }) as unknown),
  remove: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as unknown),
  engine: {} as Record<string, unknown>,
  audit: vi.fn(async (_a: unknown) => {}),
  recWhere: null as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({ deps: true }) }));
vi.mock("@/lib/agents/inspiration-engine", () => ({ loadInspirationEngine: vi.fn(async () => m.engine) }));
vi.mock("@linkaffipro/db", () => ({
  audit: m.audit,
  prisma: {
    recommendation: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        m.recWhere = args.where;
        return m.applied;
      }),
    },
    referenceChannel: { findFirst: vi.fn(async () => m.ref) },
  },
}));

import { removeReferenceAction, undoInspirationAction } from "./actions";

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
  m.applied = [{ id: "rec1" }];
  m.ref = { id: "ref1", username: "roulette_pro", title: "Roulette Pro" };
  m.engine = { undoInspiration: m.undo, removeReference: m.remove };
  m.undo.mockReset();
  m.undo.mockImplementation(async () => ({ ok: true, message: "" }));
  m.remove.mockReset();
  m.remove.mockImplementation(async () => ({ ok: true }));
  m.audit.mockClear();
});

describe("Annuler une inspiration", () => {
  it("une proposition appliquée : `undoInspiration` avec son identifiant, journal écrit", async () => {
    const url = await redirectOf(undoInspirationAction(fd({ referenceId: "ref1", recommendationId: "rec1" })));
    expect(m.undo).toHaveBeenCalledWith({ deps: true }, ["rec1"], { userId: "u1", via: "SITE" });
    expect(JSON.stringify(m.recWhere)).toContain('"source":"inspiration"');
    expect(JSON.stringify(m.recWhere)).toContain('"status":"APPLIED"');
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "agents.inspiration_undo_requested",
        entityType: "Recommendation",
        entityId: "rec1",
        metadata: { referenceChannelId: "ref1", recommendationIds: ["rec1"], ok: true, via: "WEB" },
      }),
    );
    expect(url).toContain("/agents/inspiration/ref1?ok=Réglage annulé");
    expect(url).toContain("#propositions");
  });

  it("toute la référence : `undoInspiration` avec l'identifiant de la référence", async () => {
    m.applied = [{ id: "rec1" }, { id: "rec2" }];
    const url = await redirectOf(undoInspirationAction(fd({ referenceId: "ref1" })));
    expect(m.undo).toHaveBeenCalledWith({ deps: true }, "ref1", { userId: "u1", via: "SITE" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "ReferenceChannel", entityId: "ref1" }));
    expect(url).toContain("ok=Inspiration annulée");
  });

  it("responsable : refusé, sans appel ni journal", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(undoInspirationAction(fd({ referenceId: "ref1", recommendationId: "rec1" })));
    expect(url).toContain("error=Annuler une inspiration est réservé aux administrateurs.");
    expect(m.undo).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("rien d'appliqué, identifiant douteux, moteur absent ou refus du moteur", async () => {
    m.applied = [];
    expect(await redirectOf(undoInspirationAction(fd({ referenceId: "ref1", recommendationId: "rec1" })))).toContain("n'est plus appliquée");
    expect(await redirectOf(undoInspirationAction(fd({ referenceId: "../x" })))).toContain("Référence inconnue");
    m.applied = [{ id: "rec1" }];
    m.engine = {};
    expect(await redirectOf(undoInspirationAction(fd({ referenceId: "ref1" })))).toContain("Pas encore disponible");
    m.engine = { undoInspiration: m.undo };
    m.undo.mockImplementation(async () => ({ ok: false, message: "Plus de 30 jours : demandez à Kevin." }));
    const url = await redirectOf(undoInspirationAction(fd({ referenceId: "ref1", recommendationId: "rec1" })));
    expect(url).toContain("error=Plus de 30 jours");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ ok: false }) }));
  });
});

describe("Retirer une référence", () => {
  it("administrateur : `removeReference`, journal, retour à la liste", async () => {
    const url = await redirectOf(removeReferenceAction(fd({ referenceId: "ref1" })));
    expect(m.remove).toHaveBeenCalledWith({ deps: true }, "ref1", { userId: "u1", via: "SITE" });
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "agents.inspiration_reference_removed",
        entityType: "ReferenceChannel",
        entityId: "ref1",
        metadata: { name: "@roulette_pro", ok: true, via: "WEB" },
      }),
    );
    expect(url).toContain("/agents/inspiration?ok=@roulette_pro est retirée");
  });

  it("responsable : refusé ; référence déjà retirée", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(await redirectOf(removeReferenceAction(fd({ referenceId: "ref1" })))).toContain("réservé aux administrateurs");
    expect(m.remove).not.toHaveBeenCalled();
    m.user = { id: "u1", role: "ADMIN" };
    m.ref = null;
    expect(await redirectOf(removeReferenceAction(fd({ referenceId: "ref1" })))).toContain("déjà été retirée");
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("panne du moteur : message d'erreur, rien de cassé", async () => {
    m.remove.mockImplementation(async () => Promise.reject(new Error("base injoignable")));
    expect(await redirectOf(removeReferenceAction(fd({ referenceId: "ref1" })))).toContain("Retrait impossible pour l'instant : base injoignable.");
  });
});
