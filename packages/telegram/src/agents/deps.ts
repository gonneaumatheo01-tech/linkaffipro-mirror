/**
 * Dépendances des agents côté bot (phase 19) : base, mise en file (`@linkaffipro/queue`) et messager admin. La file
 * est créée à la première utilisation : un bot démarre même si la mise en file n'est pas encore disponible.
 */
import type { AgentsDeps, AgentsEnqueue } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { createAgentsEnqueue } from "@linkaffipro/queue";
import { createAdminMessenger } from "./admin-messenger";

let cached: AgentsDeps | null = null;

function lazyEnqueue(): AgentsEnqueue {
  let impl: ReturnType<typeof createAgentsEnqueue> | null = null;
  const get = () => (impl ??= createAgentsEnqueue());
  return {
    orchestrator: (job, opts) => get().orchestrator(job, opts),
    step: (teamKey, agent, job, opts) => get().step(teamKey, agent, job, opts),
  };
}

export function createBotAgentsDeps(): AgentsDeps {
  cached ??= {
    // Le client partagé omet `Channel.photoSmall` par défaut : même base, type élargi pour `AgentsDeps`.
    prisma: prisma as unknown as AgentsDeps["prisma"],
    enqueue: lazyEnqueue(),
    admin: createAdminMessenger(),
    logger: {
      info: (o, m) => console.info(m ?? "[agents]", o),
      warn: (o, m) => console.warn(m ?? "[agents]", o),
      error: (o, m) => console.error(m ?? "[agents]", o),
    },
  } satisfies AgentsDeps;
  return cached;
}
