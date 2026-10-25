import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de la fiche d'un ordre (phase 33) : Arrêter et Prolonger, réservées aux administrateurs, appellent
// `stopOrder` / `extendOrder` du Grand Chef et écrivent le journal des actions. Base et moteur simulés.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  order: { id: "o1", number: 12, status: "RUNNING" } as { id: string; number: number; status: string } | null,
  stop: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as unknown),
  extend: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as unknown),
  engine: {} as Record<string, unknown>,
  audit: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({ deps: true }) }));
vi.mock("@/lib/agents/orders-engine", () => ({ loadOrdersEngine: vi.fn(async () => m.engine) }));
vi.mock("@linkaffipro/db", () => ({
  audit: m.audit,
  prisma: { teamOrder: { findUnique: vi.fn(async () => m.order) } },
}));

import { extendOrderAction, stopOrderAction } from "./actions";

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
  m.order = { id: "o1", number: 12, status: "RUNNING" };
  m.engine = { stopOrder: m.stop, extendOrder: m.extend };
  m.stop.mockReset();
  m.stop.mockImplementation(async () => ({ ok: true }));
  m.extend.mockReset();
  m.extend.mockImplementation(async () => ({ ok: true }));
  m.audit.mockClear();
});

describe("Arrêter un ordre", () => {
  it("administrateur : `stopOrder(deps, id, acteur)`, journal écrit, retour sur la fiche", async () => {
    const url = await redirectOf(stopOrderAction(fd({ orderId: "o1" })));
    expect(m.stop).toHaveBeenCalledWith({ deps: true }, "o1", { userId: "u1", via: "SITE" });
    expect(m.audit).toHaveBeenCalledWith({
      userId: "u1",
      action: "agents.order_stopped",
      entityType: "TeamOrder",
      entityId: "o1",
      metadata: { number: 12, previousStatus: "RUNNING", ok: true },
    });
    expect(url).toContain("/agents/orders/o1?ok=Ordre n°12 arrêté");
  });

  it("responsable : refusé, sans appel ni journal", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(stopOrderAction(fd({ orderId: "o1" })));
    expect(url).toContain("error=Arrêter un ordre est réservé aux administrateurs.");
    expect(m.stop).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("identifiant douteux, ordre absent, déjà fini, moteur absent, refus du moteur, erreur", async () => {
    expect(await redirectOf(stopOrderAction(fd({ orderId: "../x" })))).toContain("/agents/orders?error=Ordre inconnu.");
    m.order = null;
    expect(await redirectOf(stopOrderAction(fd({ orderId: "o1" })))).toContain("Cet ordre n'existe plus.");
    m.order = { id: "o1", number: 12, status: "DONE" };
    expect(await redirectOf(stopOrderAction(fd({ orderId: "o1" })))).toContain("déjà terminé ou arrêté");
    m.order = { id: "o1", number: 12, status: "RUNNING" };
    m.engine = {};
    expect(await redirectOf(stopOrderAction(fd({ orderId: "o1" })))).toContain("Pas encore disponible");
    expect(m.audit).not.toHaveBeenCalled();
    m.engine = { stopOrder: m.stop };
    m.stop.mockImplementation(async () => ({ ok: false, message: "Ordre déjà arrêté par Kevin." }));
    expect(await redirectOf(stopOrderAction(fd({ orderId: "o1" })))).toContain("error=Ordre déjà arrêté par Kevin.");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ ok: false }) }));
    m.stop.mockImplementation(async () => {
      throw new Error("base injoignable");
    });
    expect(await redirectOf(stopOrderAction(fd({ orderId: "o1" })))).toContain("Arrêt impossible pour l'instant : base injoignable.");
  });
});

describe("Prolonger un ordre", () => {
  it("administrateur : `extendOrder(deps, id, jours)`, journal écrit", async () => {
    const url = await redirectOf(extendOrderAction(fd({ orderId: "o1", days: "2" })));
    expect(m.extend).toHaveBeenCalledWith({ deps: true }, "o1", 2);
    expect(m.audit).toHaveBeenCalledWith({
      userId: "u1",
      action: "agents.order_extended",
      entityType: "TeamOrder",
      entityId: "o1",
      metadata: { number: 12, days: 2, ok: true },
    });
    expect(url).toContain("ok=Ordre n°12 prolongé de 2 jours.");
  });

  it("responsable refusé ; jours hors bornes ; ordre pas en cours", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(await redirectOf(extendOrderAction(fd({ orderId: "o1", days: "2" })))).toContain("réservé aux administrateurs");
    m.user = { id: "u1", role: "ADMIN" };
    expect(await redirectOf(extendOrderAction(fd({ orderId: "o1", days: "31" })))).toContain("entre 1 et 30");
    expect(await redirectOf(extendOrderAction(fd({ orderId: "o1", days: "abc" })))).toContain("entre 1 et 30");
    m.order = { id: "o1", number: 12, status: "WAITING_CONFIRM" };
    expect(await redirectOf(extendOrderAction(fd({ orderId: "o1", days: "2" })))).toContain("Seul un ordre en cours se prolonge");
    expect(m.extend).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});
