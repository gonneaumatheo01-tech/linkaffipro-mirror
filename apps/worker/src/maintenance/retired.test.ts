/** Restes des fonctions retirées le 28 octobre 2026 : planifications effacées, file vidée, alertes closes, sans lever. */
import { describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
const { cleanupRetired, RETIRED_ALERT_KINDS } = await import("./retired");

function fakeQueue() {
  return { removeJobScheduler: vi.fn(async (id: string) => id !== "agents-bookmakers-health"), obliterate: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
}

describe("ménage des fonctions retirées", () => {
  it("planifications retirées effacées, file des bookmakers vidée puis fermée, file du worker jamais fermée, alertes ouvertes closes", async () => {
    const algo = fakeQueue();
    const bookmakers = fakeQueue();
    const now = new Date("2026-10-28T18:00:00Z");
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const out = await cleanupRetired({
      queueFor: (name) => (name === "agents-algo" ? { queue: algo as never, owned: false } : { queue: bookmakers as never, owned: true }),
      db: { alert: { updateMany } } as never,
      now,
    });
    expect(algo.removeJobScheduler).toHaveBeenCalledWith("agents-algo-inspiration-reread");
    expect(bookmakers.removeJobScheduler.mock.calls.map((c) => c[0])).toEqual(["agents-bookmakers-tick", "agents-bookmakers-health"]);
    expect(bookmakers.obliterate).toHaveBeenCalledWith({ force: true });
    expect(bookmakers.close).toHaveBeenCalledTimes(1);
    expect(algo.close).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({ where: { kind: { in: [...RETIRED_ALERT_KINDS] }, resolvedAt: null }, data: { resolvedAt: now } });
    expect(out).toEqual({ schedulers: 2, queues: 1, alerts: 2 });
  });

  it("Redis ou base en panne : rien ne lève, la file ouverte pour l'occasion est fermée", async () => {
    const q = fakeQueue();
    q.obliterate.mockRejectedValueOnce(new Error("Redis indisponible"));
    const out = await cleanupRetired({
      queueFor: () => ({ queue: q as never, owned: true }),
      db: { alert: { updateMany: async () => Promise.reject(new Error("base indisponible")) } } as never,
    });
    expect(out.queues).toBe(0);
    expect(q.close).toHaveBeenCalled();
  });
});
