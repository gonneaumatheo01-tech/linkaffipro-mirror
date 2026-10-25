/**
 * Choix du fournisseur de cotes (phase 23) :
 * - imposé par les tests (`providers.odds`) ;
 * - mission ou pari de test (`source = "fake"`) → faux fournisseur sur fixtures ;
 * - clé `providers.odds.apiKey` réglée → SportsGameOdds, avec cache (Redis du worker, mémoire sinon) et quota ;
 * - phase 35 : catégorie (ou pari) visant un bookmaker du client lu directement (`BookmakerSite` READY) →
 *   `bookmaker-direct` pour ces sites ; SportsGameOdds y sert alors aux résultats et à la comparaison ;
 * - sinon aucun (le Chef Paris ne crée alors aucune mission réelle).
 */
import { readSecret } from "../human/secrets";
import type { AgentsDeps } from "../types";
import { createFakeOddsProvider } from "./fake-odds";
import type { OddsProvider } from "./odds";
import { createMemoryOddsCache, withOddsCache, type OddsCache } from "./odds-cache";
import { createOddsQuota } from "./odds-quota";
import { createSportsGameOddsProvider } from "./sportsgameodds";
import { createBookmakerDirectProvider, readySites } from "./bookmaker-direct";
import type { BookmakerReadDeps } from "../bookmakers/read/deps";

export const ODDS_SECRET_KEY = "providers.odds.apiKey";
export type OddsSource = "fake" | "live";

/** Cache de repli par processus (site, tests sans Redis). */
let processCache: OddsCache | null = null;

export type OddsResolveDeps = AgentsDeps & {
  /** `sgo` : SportsGameOdds imposé aux tests du fournisseur direct (résultats, consensus). */
  providers?: { odds?: unknown; sgo?: unknown; llm?: unknown };
  /** Branchements du lecteur des bookmakers (phase 35, worker) : transport, verrou, rythme, crochets. */
  bookmakers?: BookmakerReadDeps["bookmakers"];
  oddsCache?: OddsCache | null;
  fetch?: typeof fetch;
};

export async function hasOddsKey(prisma: AgentsDeps["prisma"]): Promise<boolean> {
  return !!(await readSecret(prisma, ODDS_SECRET_KEY));
}

export async function resolveOddsProvider(
  deps: OddsResolveDeps,
  opts: {
    source?: OddsSource | null;
    maxCalls: number;
    fakeShiftMs?: number | null;
    /** Bookmakers visés (catégorie) : un site du client READY parmi eux → lecture directe. */
    bookmakers?: readonly string[] | null;
    /** Pari déjà lu sur un site du client (`BettingPick.siteKey`). */
    siteKey?: string | null;
  },
): Promise<{ provider: OddsProvider; source: OddsSource } | null> {
  const now = deps.now ?? (() => new Date());
  const forced = deps.providers?.odds as OddsProvider | null | undefined;
  if (forced) return { provider: forced, source: forced.name === "fake" ? "fake" : "live" };
  if (opts.source === "fake") return { provider: createFakeOddsProvider({ now, shiftMs: opts.fakeShiftMs }), source: "fake" };
  const wanted = opts.siteKey ? [opts.siteKey] : (opts.bookmakers ?? []).map((b) => b.toLowerCase());
  if (wanted.length) {
    // Un pari déjà lu sur un site reste lu sur ce site (résultats, relecture), même si le site n'est plus READY.
    const sites = opts.siteKey ? wanted : await readySites(deps, wanted);
    if (sites.length) {
      const sgo = (deps.providers?.sgo as OddsProvider | null | undefined) ?? (await resolveSgoProvider(deps, opts.maxCalls));
      return { provider: createBookmakerDirectProvider({ ...(deps as BookmakerReadDeps), sgo, sites }), source: "live" };
    }
  }
  return resolveSgo(deps, opts.maxCalls);
}

/** SportsGameOdds seul (clé réglée), avec cache et quota ; null sans clé. */
export async function resolveSgoProvider(deps: OddsResolveDeps, maxCalls: number): Promise<OddsProvider | null> {
  return (await resolveSgo(deps, maxCalls))?.provider ?? null;
}

async function resolveSgo(deps: OddsResolveDeps, maxCalls: number): Promise<{ provider: OddsProvider; source: OddsSource } | null> {
  const now = deps.now ?? (() => new Date());
  const key = await readSecret(deps.prisma, ODDS_SECRET_KEY);
  if (!key) return null;
  const client = createSportsGameOddsProvider({
    apiKey: key,
    fetch: deps.fetch,
    beforeRequest: createOddsQuota({ prisma: deps.prisma, admin: deps.admin, logger: deps.logger, now }, maxCalls),
  });
  const cache = deps.oddsCache ?? (processCache ??= createMemoryOddsCache());
  return { provider: withOddsCache(client, cache), source: "live" };
}
