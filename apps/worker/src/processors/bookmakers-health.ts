import {
  askBookmakerCredentials,
  bookmakerKevinHook,
  bookmakerTransportHooks,
  bookmakersHealth,
  ensureDefaultSites,
  bookmakersNight,
  type AgentsDeps,
} from "@linkaffipro/agents";
import type { Repeatable } from "./index";
import { workerAgentsDeps } from "../agents/deps";

/**
 * Phase 35, chantier D — santé des bookmakers (file `agents-bookmakers`, tâche `bookmakers-health` toutes les
 * 30 minutes) : sites du client créés s'ils manquent, identifiants communs demandés par Kevin en privé (une seule fois
 * pour toujours, de jour), puis une lecture légère par site appris (`bookmakersHealth`), états, ré-apprentissage
 * automatique (au plus une fois par 24 h), messages de Kevin et alertes. Rien la nuit.
 */
export function bookmakersHealthDeps(base: AgentsDeps = workerAgentsDeps()): AgentsDeps {
  const current =
    (base as { bookmakers?: Record<string, unknown> }).bookmakers ?? bookmakerTransportHooks(base);
  return {
    ...base,
    bookmakers: { ...current, onBookmakerEvent: bookmakerKevinHook(base) },
  } as AgentsDeps;
}

export async function runBookmakersHealth(
  opts: { force?: boolean } = {},
  base?: AgentsDeps,
): Promise<unknown> {
  const deps = bookmakersHealthDeps(base);
  const now = deps.now ? deps.now() : new Date();
  await ensureDefaultSites(deps);
  let credentials: string | null = null;
  if (!bookmakersNight(now)) {
    try {
      credentials = (await askBookmakerCredentials(deps, { auto: true })).reason;
    } catch (err) {
      deps.logger?.warn(
        { err: (err as Error).message },
        "[bookmakers] demande des identifiants impossible",
      );
    }
  }
  const health = await bookmakersHealth(deps, now, { force: opts.force === true });
  return { ...health, credentials };
}

export const repeatableBookmakersHealth: Repeatable[] = [
  { data: { type: "bookmakers-health" }, everyMs: 30 * 60_000, jobId: "agents-bookmakers-health" },
];
