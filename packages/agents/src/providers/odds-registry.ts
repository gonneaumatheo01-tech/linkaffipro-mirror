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
  providers?: { odds?: unknown; llm?: unknown };
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
  },
): Promise<{ provider: OddsProvider; source: OddsSource } | null> {
  const now = deps.now ?? (() => new Date());
  const forced = deps.providers?.odds as OddsProvider | null | undefined;
  if (forced) return { provider: forced, source: forced.name === "fake" ? "fake" : "live" };
  if (opts.source === "fake") return { provider: createFakeOddsProvider({ now, shiftMs: opts.fakeShiftMs }), source: "fake" };
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

// --- Phase 35 : catégories en clés internes (`sports/themes.json`) ------------------------------------------------

export type CategoryMarketsMigration = {
  /** Nouvelle liste : clés internes des thèmes entièrement couverts, puis identifiants du fournisseur restants. */
  marketTypes: string[];
  converted: Array<{ theme: string; markets: string[] }>;
  /** Identifiants du fournisseur sans thème interne qui les couvre tous : gardés tels quels (toujours acceptés). */
  unmatched: string[];
  changed: boolean;
};

/**
 * Clés du fournisseur (SportsGameOdds) → clés internes : un thème est retenu quand TOUS ses marchés sont dans la
 * catégorie (le sens de la catégorie ne change donc pas : la clé interne redonne exactement ces marchés), les plus
 * grands thèmes d'abord, chaque marché une seule fois. Idempotent : une clé interne déjà présente reste. Pur.
 */
export function migrateCategoryMarketTypes(marketTypes: readonly string[], themes: ReadonlyArray<{ key: string; marketTypes: readonly string[] }>): CategoryMarketsMigration {
  const themeKeys = new Set(themes.map((t) => t.key));
  const keep = marketTypes.filter((m) => themeKeys.has(m));
  let rest = marketTypes.filter((m) => !themeKeys.has(m));
  const converted: CategoryMarketsMigration["converted"] = [];
  for (const t of [...themes].sort((a, b) => b.marketTypes.length - a.marketTypes.length || a.key.localeCompare(b.key))) {
    if (keep.includes(t.key) || !t.marketTypes.length) continue;
    if (!t.marketTypes.every((m) => rest.includes(m))) continue;
    converted.push({ theme: t.key, markets: [...t.marketTypes] });
    keep.push(t.key);
    rest = rest.filter((m) => !t.marketTypes.includes(m));
  }
  const out = [...new Set([...keep, ...rest])];
  return { marketTypes: out, converted, unmatched: rest, changed: out.length !== marketTypes.length || out.some((m, i) => m !== marketTypes[i]) };
}
