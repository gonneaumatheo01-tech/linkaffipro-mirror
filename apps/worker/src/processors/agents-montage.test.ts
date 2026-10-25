import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ steps: [] as Array<{ job: unknown; attempt: number | undefined }>, sweep: 0, cleanup: 0 }));
vi.mock("@linkaffipro/agents", () => ({
  MONTAGE_LIMITS: { maxAttempts: 3 },
  runMontageStep: vi.fn(async (_d: unknown, job: unknown, o: { attempt?: number }) => {
    calls.steps.push({ job, attempt: o.attempt });
    return { ok: true };
  }),
  resumeStalledMontage: vi.fn(async () => {
    calls.sweep++;
    return { requeued: 0 };
  }),
  sweepMontageWorkDir: vi.fn(async () => {
    calls.cleanup++;
    return { removed: ["a", "b"] };
  }),
}));
vi.mock("../montage/deps", () => ({ workerMontageDeps: () => ({}) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { processAgentsMontage, repeatableAgentsMontage } = await import("./agents-montage");
const { JOB_RETRY_OPTIONS, QUEUE_NAMES } = await import("@linkaffipro/queue");

const job = (data: unknown, attemptsMade = 0, attempts = 3) => ({ data, attemptsMade, opts: { attempts }, id: "1", name: "n" }) as never;

describe("file agents-montage", () => {
  it("déclarée : une tâche à la fois, 3 essais avec attente croissante", () => {
    expect(QUEUE_NAMES).toContain("agents-montage");
    expect(JOB_RETRY_OPTIONS["agents-montage"]).toEqual({ attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
    expect(repeatableAgentsMontage.map((r) => r.data.type)).toEqual(["montage.sweep", "montage.cleanup"]);
  });

  it("transmet le rang de l'essai ; le dernier essai BullMQ est le dernier pour la chaîne", async () => {
    const step = { type: "montage.cut", montageJobId: "j", shortClipId: "c" };
    await processAgentsMontage(job(step, 0));
    await processAgentsMontage(job(step, 1));
    await processAgentsMontage(job(step, 2));
    await processAgentsMontage(job(step, 0, 1));
    expect(calls.steps.map((s) => s.attempt)).toEqual([1, 2, 3, 3]);
    expect(await processAgentsMontage(job({ type: "montage.cleanup" }))).toEqual({ removed: 2 });
    await processAgentsMontage(job({ type: "montage.sweep" }));
    expect(calls.sweep).toBe(1);
    expect(await processAgentsMontage(job({ type: "autre" }))).toMatchObject({ ok: false });
  });
});
