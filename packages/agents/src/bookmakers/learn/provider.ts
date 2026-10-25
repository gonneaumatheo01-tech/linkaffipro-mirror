/**
 * Phase 35 (chantier B) — moteur de paris (« sportsbook ») d'un site, reconnu aux domaines et chemins des cadres,
 * scripts et réponses vus pendant l'enregistrement. Souvent un même moteur sert plusieurs marques : une recette apprise
 * sur l'une est essayée d'abord sur les autres (`reuseRecipeByProvider`). Règle pure.
 */
export const PROVIDER_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["betby", /betby|invisiblesport|sptpub\.com|bt-renderer/i],
  ["altenar", /altenar|biahosted/i],
  ["digitain", /digitain|sportdigi|digi-?tain/i],
  ["betconstruct", /betconstruct|swarm\.|bcapps|springbuilder|bc\.games-sport/i],
  ["kambi", /kambi(cdn)?/i],
  ["sportradar", /sportradar|betradar|sir\.sportradar/i],
  ["softswiss", /softswiss/i],
  ["sbtech", /sbtech/i],
  ["openbet", /openbet/i],
  ["playtech", /playtech/i],
  ["oddsmatrix", /oddsmatrix|everymatrix/i],
];

export const UNKNOWN_PROVIDER = "inconnu";

/** Moteur le plus cité dans ces adresses (ou « inconnu »). */
export function detectProviderHint(urls: readonly string[]): string {
  const score = new Map<string, number>();
  for (const u of urls) for (const [name, re] of PROVIDER_PATTERNS) if (re.test(u)) score.set(name, (score.get(name) ?? 0) + 1);
  let best: string = UNKNOWN_PROVIDER;
  let n = 0;
  for (const [name, c] of score) if (c > n) [best, n] = [name, c];
  return best;
}
