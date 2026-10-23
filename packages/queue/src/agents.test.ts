import { describe, expect, it } from "vitest";
import { QUEUE_NAMES, JOB_RETRY_OPTIONS } from "./jobs";
import { addIdempotent, agentStepJobId, createAgentsEnqueue, type AgentsQueueLike } from "./agents";

function fakeQueue() {
  const jobs = new Map<string, { name: string; data: unknown; state: string; opts: Record<string, unknown> }>();
  const added: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];
  const q: AgentsQueueLike = {
    async add(name, data, opts) {
      added.push({ name, data, opts });
      jobs.set(String(opts.jobId ?? `auto${added.length}`), { name, data, state: "waiting", opts });
    },
    async getJob(id) {
      const j = jobs.get(id);
      return j ? { getState: async () => j.state, remove: async () => void jobs.delete(id) } : null;
    },
  };
  return { q, jobs, added };
}

describe("files des agents", () => {
  it("les 6 files sont déclarées avec leurs options de reprise", () => {
    for (const n of ["agents-orchestrator", "agents-dating", "agents-casino", "agents-sports", "agents-algo", "agents-ads"] as const) {
      expect(QUEUE_NAMES).toContain(n);
      expect(JOB_RETRY_OPTIONS[n]).toEqual({ attempts: 1 });
    }
  });

  it("étape : nom = clé de l'agent, identifiant <missionId>:<index> sans deux-points, file de l'équipe", async () => {
    const queues = new Map<string, ReturnType<typeof fakeQueue>>();
    const enq = createAgentsEnqueue((name) => {
      if (!queues.has(name)) queues.set(name, fakeQueue());
      return queues.get(name)!.q;
    });
    await enq.step("dating", "redaction", { type: "step", missionId: "m1", index: 2 });
    const d = queues.get("agents-dating")!;
    expect(d.added).toEqual([{ name: "redaction", data: { type: "step", missionId: "m1", index: 2 }, opts: { jobId: "m1-2" } }]);
    expect(agentStepJobId("m1", 2)).toBe("m1-2");
    // Relecture d'une étape en attente du fournisseur : identifiant distinct (la tâche en cours ne bloque pas l'ajout).
    expect(agentStepJobId("m1", 2, 3)).toBe("m1-2-p3");
    // Même étape encore en attente : jamais doublée.
    await enq.step("dating", "redaction", { type: "step", missionId: "m1", index: 2 });
    expect(d.added).toHaveLength(1);
    await enq.orchestrator({ type: "cycle" }, { delayMs: 1000 });
    expect(queues.get("agents-orchestrator")!.added[0]).toMatchObject({ name: "agents-orchestrator:cycle", opts: { delay: 1000 } });
  });

  it("une tâche terminée ou échouée du même identifiant est remise (reprise)", async () => {
    const { q, jobs, added } = fakeQueue();
    await addIdempotent(q, "controle", {}, "m-3");
    jobs.get("m-3")!.state = "completed";
    expect(await addIdempotent(q, "controle", {}, "m-3")).toBe(true);
    jobs.get("m-3")!.state = "active";
    expect(await addIdempotent(q, "controle", {}, "m-3")).toBe(false);
    expect(added).toHaveLength(2);
  });
});
