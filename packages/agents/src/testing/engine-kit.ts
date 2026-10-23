/**
 * Outils des tests du moteur (chantier A) : base en mémoire avec un vrai canal et le canal Test, file simulée (les
 * étapes enfilées sont rejouées par `drain`), messager admin simulé, horloge réglable. Jamais importé en production.
 */
import { runNextStep, type StepOutcome } from "../chiefs/engine";
import type { EngineDeps } from "../missions/context";
import { createFakeLlm, type FakeLlmOptions } from "../providers/fake";
import type { AgentStepJob, AgentsOrchestratorJob, FrameExtractor, LlmProvider, Providers, TeamKey } from "../types";
import { createFakePrisma, type FakePrisma } from "./fake-prisma";

export type QueuedStep = { teamKey: TeamKey; agent: string; job: AgentStepJob; delayMs?: number };

export function createEngineKit(
  opts: { start?: Date; llm?: LlmProvider | null; fake?: FakeLlmOptions; providers?: Partial<Providers>; frames?: FrameExtractor } = {},
) {
  let now = opts.start ?? new Date("2026-10-23T08:07:00Z");
  const prisma: FakePrisma = createFakePrisma({
    channel: [
      { id: "real", title: "Rencontres VIP", vertical: "DATING", isTest: false, telegramChatId: -1001n },
      { id: "test", title: "Canal Test", vertical: null, isTest: true, telegramChatId: -1002n },
    ],
  });
  const steps: QueuedStep[] = [];
  const orchestrator: AgentsOrchestratorJob[] = [];
  const sent: Array<{ html: string; opts?: unknown }> = [];
  let nextMsg = 500;
  const llm = opts.llm !== undefined ? opts.llm : createFakeLlm(opts.fake);
  const deps: EngineDeps = {
    prisma,
    now: () => now,
    enqueue: {
      async orchestrator(job) {
        orchestrator.push(job);
      },
      async step(teamKey, agent, job, o) {
        // Comme BullMQ : une étape encore en file n'est pas doublée (même mission, index et relecture).
        if (!steps.some((s) => s.job.missionId === job.missionId && s.job.index === job.index && (s.job.poll ?? 0) === (job.poll ?? 0)))
          steps.push({ teamKey, agent, job, ...(o?.delayMs ? { delayMs: o.delayMs } : {}) });
      },
    },
    admin: {
      async send(html, o) {
        sent.push({ html, opts: o });
        return { messageId: nextMsg++ };
      },
    },
    providers: { llm, ...(opts.providers ?? {}) },
    ...(opts.frames ? { frames: opts.frames } : {}),
  };
  /** Exécute les étapes en file jusqu'à épuisement (ou `max`). */
  async function drain(max = 50): Promise<StepOutcome[]> {
    const out: StepOutcome[] = [];
    while (steps.length && out.length < max) {
      const s = steps.shift()!;
      out.push(await runNextStep(deps, s.job.missionId, s.job.index));
    }
    return out;
  }
  const t = (name: string) => prisma._tables[name] ?? [];
  return {
    prisma,
    deps,
    steps,
    orchestrator,
    sent,
    llm,
    drain,
    t,
    setNow: (d: Date) => (now = d),
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    mission: (id: string) => t("agentMission").find((m) => m.id === id) as Record<string, unknown>,
  };
}
