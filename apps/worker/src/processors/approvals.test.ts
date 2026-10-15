import type { Job } from "bullmq";
import type { ApprovalsJob } from "@linkaffipro/queue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../approvals/jobs", () => ({
  runApprovalsTick: async () => (calls.push("tick"), { claimed: 0, approved: 0 }),
  runReminders: async () => (calls.push("reminders"), 0),
  runExpirations: async () => (calls.push("expirations"), 0),
  runReminderFor: async (id: string) => (calls.push(`reminder:${id}`), true),
}));
vi.mock("../approvals/gate-sweep", () => ({
  runGateSweep: async () => (calls.push("gate-sweep"), { checked: 0 }),
  runGateBackfill: async (o: { force: boolean }) => (calls.push(`backfill:${o.force}`), {}),
}));
const warn = vi.fn();
vi.mock("../logger", () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }));

const { processApprovals, repeatableApprovals } = await import("./approvals");
const job = (data: unknown) => ({ id: "j1", data }) as unknown as Job<ApprovalsJob>;

beforeEach(() => {
  calls.length = 0;
  warn.mockClear();
});

describe("file approvals (phase 14)", () => {
  it("chaque type de tâche connu est traité", async () => {
    await processApprovals(job({ type: "tick" }));
    await processApprovals(job({ type: "reminders" }));
    await processApprovals(job({ type: "expirations" }));
    await processApprovals(job({ type: "reminder", membershipId: "m1" }));
    await processApprovals(job({ type: "gate-sweep" }));
    await processApprovals(job({ type: "gate-backfill", force: true }));
    expect(calls).toEqual([
      "tick",
      "reminders",
      "expirations",
      "reminder:m1",
      "gate-sweep",
      "backfill:true",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("type inconnu (site plus récent que le worker) : signalé, jamais compté comme réussi", async () => {
    const data = { type: "plus-tard", membershipId: "m1" };
    expect(await processApprovals(job(data))).toEqual({ ok: false });
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      { queue: "approvals", id: "j1", data },
      "type de tâche inconnu",
    );
  });

  it("filet de la validation automatique toutes les 2 minutes", () => {
    expect(repeatableApprovals).toContainEqual({
      data: { type: "gate-sweep" },
      everyMs: 2 * 60_000,
      jobId: "approvals-gate-sweep",
    });
  });
});
