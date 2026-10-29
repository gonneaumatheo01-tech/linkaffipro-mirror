/** Restes des fonctions retirées les 28 et 29 octobre 2026 : planifications effacées, file vidée, alertes closes, sans lever. */
import { describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
const { cleanupRetired, RETIRED_ALERT_KINDS } = await import("./retired");

function fakeQueue() {
  return { removeJobScheduler: vi.fn(async (id: string) => id !== "agents-bookmakers-health"), obliterate: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
}

describe("ménage des fonctions retirées", () => {
  it("questions sans objet closes, planifications retirées effacées, files des bookmakers et du montage vidées puis fermées, file du worker jamais fermée, alertes ouvertes closes", async () => {
    const algo = fakeQueue();
    const bookmakers = fakeQueue();
    const montage = fakeQueue();
    const now = new Date("2026-10-28T18:00:00Z");
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const requests = vi.fn(async () => ({ count: 1 }));
    const out = await cleanupRetired({
      queueFor: (name) =>
        name === "agents-algo" ? { queue: algo as never, owned: false } : { queue: (name === "agents-montage" ? montage : bookmakers) as never, owned: true },
      db: { alert: { updateMany }, humanRequest: { updateMany: requests } } as never,
      now,
    });
    expect(algo.removeJobScheduler).toHaveBeenCalledWith("agents-algo-inspiration-reread");
    expect(bookmakers.removeJobScheduler.mock.calls.map((c) => c[0])).toEqual(["agents-bookmakers-tick", "agents-bookmakers-health"]);
    expect(montage.removeJobScheduler.mock.calls.map((c) => c[0])).toEqual(["agents-montage-sweep", "agents-montage-cleanup"]);
    expect(bookmakers.obliterate).toHaveBeenCalledWith({ force: true });
    expect(montage.obliterate).toHaveBeenCalledWith({ force: true });
    expect(bookmakers.close).toHaveBeenCalledTimes(1);
    expect(montage.close).toHaveBeenCalledTimes(1);
    expect(algo.close).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({ where: { kind: { in: [...RETIRED_ALERT_KINDS] }, resolvedAt: null }, data: { resolvedAt: now } });
    expect(requests).toHaveBeenCalledWith({ where: expect.objectContaining({ status: { in: ["QUEUED", "PENDING"] } }), data: { status: "SKIPPED", answerSummary: "fonction retirée" } });
    expect(out).toEqual({ schedulers: 4, queues: 2, alerts: 2, requests: 1 });
  });

  it("Redis ou base en panne : rien ne lève, la file ouverte pour l'occasion est fermée", async () => {
    const q = fakeQueue();
    q.obliterate.mockRejectedValueOnce(new Error("Redis indisponible"));
    const out = await cleanupRetired({
      queueFor: () => ({ queue: q as never, owned: true }),
      db: {
        alert: { updateMany: async () => Promise.reject(new Error("base indisponible")) },
        humanRequest: { updateMany: async () => Promise.reject(new Error("base indisponible")) },
      } as never,
    });
    expect(out.queues).toBe(0);
    expect(q.close).toHaveBeenCalled();
  });
});
