/**
 * Choix du fournisseur de cotes (phase 23) :
 * - imposé par les tests (`providers.odds`) ;
 * - mission ou pari de test (`source = "fake"`) → faux fournisseur sur fixtures ;
 * - clé `providers.odds.apiKey` réglée → SportsGameOdds, avec cache (Redis du worker, mémoire sinon) et quota ;
 * - sinon aucun (le Chef Paris ne crée alors aucune mission réelle).
 */
import { readSecret } from "../human/secrets";
import type { AgentsDeps } from "../types";
import { createFakeOddsProvider } from "./fake-odds";
import type { OddsProvider } from "./odds";
import { createMemoryOddsCache, withOddsCache, type OddsCache } from "./odds-cache";
import { createOddsQuota } from "./odds-quota";
import { createSportsGameOddsProvider } from "./sportsgameodds";

export const ODDS_SECRET_KEY = "providers.odds.apiKey";
export type OddsSource = "fake" | "live";

/** Cache de repli par processus (site, tests sans Redis). */
let processCache: OddsCache | null = null;

export type OddsResolveDeps = AgentsDeps & {
  providers?: { odds?: unknown };
  oddsCache?: OddsCache | null;
  fetch?: typeof fetch;
};

export async function hasOddsKey(prisma: AgentsDeps["prisma"]): Promise<boolean> {
  return !!(await readSecret(prisma, ODDS_SECRET_KEY));
}

export async function resolveOddsProvider(
  deps: OddsResolveDeps,
  opts: { source?: OddsSource | null; maxCalls: number },
): Promise<{ provider: OddsProvider; source: OddsSource } | null> {
  const now = deps.now ?? (() => new Date());
  const forced = deps.providers?.odds as OddsProvider | null | undefined;
  if (forced) return { provider: forced, source: forced.name === "fake" ? "fake" : "live" };
  if (opts.source === "fake") return { provider: createFakeOddsProvider({ now }), source: "fake" };
  const key = await readSecret(deps.prisma, ODDS_SECRET_KEY);
  if (!key) return null;
  const client = createSportsGameOddsProvider({
    apiKey: key,
    fetch: deps.fetch,
    beforeRequest: createOddsQuota({ prisma: deps.prisma, admin: deps.admin, logger: deps.logger, now }, opts.maxCalls),
  });
  const cache = deps.oddsCache ?? (processCache ??= createMemoryOddsCache());
  return { provider: withOddsCache(client, cache), source: "live" };
}
