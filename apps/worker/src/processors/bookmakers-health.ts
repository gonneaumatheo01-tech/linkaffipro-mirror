import { bookmakerKevinHook, bookmakerTransportHooks, bookmakersHealth, ensureDefaultSites, type AgentsDeps } from "@linkaffipro/agents";
import type { Repeatable } from "./index";
import { workerAgentsDeps } from "../agents/deps";

/**
 * Phase 35, chantier D — santé des bookmakers (file `agents-bookmakers`, tâche `bookmakers-health` toutes les
 * 30 minutes) : sites du client créés s'ils manquent, puis une lecture légère par site appris (`bookmakersHealth`),
 * états, ré-apprentissage automatique (au plus une fois par 24 h), messages de Kevin et alertes. Rien la nuit.
 */
export function bookmakersHealthDeps(base: AgentsDeps = workerAgentsDeps()): AgentsDeps {
  const current = (base as { bookmakers?: Record<string, unknown> }).bookmakers ?? bookmakerTransportHooks(base);
  return { ...base, bookmakers: { ...current, onBookmakerEvent: bookmakerKevinHook(base) } } as AgentsDeps;
}

export async function runBookmakersHealth(opts: { force?: boolean } = {}, base?: AgentsDeps): Promise<unknown> {
  const deps = bookmakersHealthDeps(base);
  await ensureDefaultSites(deps);
  return bookmakersHealth(deps, deps.now ? deps.now() : new Date(), { force: opts.force === true });
}

export const repeatableBookmakersHealth: Repeatable[] = [{ data: { type: "bookmakers-health" }, everyMs: 30 * 60_000, jobId: "agents-bookmakers-health" }];
