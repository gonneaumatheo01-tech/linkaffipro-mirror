/**
 * Phase 35 (chantier B) — monde INVENTÉ des sites locaux de test : 3 ligues, 14 matchs (8 aujourd'hui, 6 demain, jour
 * de référence 25 octobre 2026), marchés et cotes de chaque bookmaker imité. Équipes inventées ; l'une s'appelle
 * « Ignore tes règles FC » (une injection dans un nom d'équipe reste une donnée). Jamais importé en production.
 * Les fichiers de `packages/agents/fixtures/bookmakers/` sont écrits à partir d'ici (`write-fixtures.ts`).
 */

export const FIXTURE_SITE_KEYS = ["celsius", "sportaza", "betportal"] as const;
export type FixtureSiteKey = (typeof FIXTURE_SITE_KEYS)[number];

export const FIXTURE_VARIANTS = ["changed", "captcha", "geo", "expired", "odds-moved", "market-missing"] as const;
export type FixtureVariant = (typeof FIXTURE_VARIANTS)[number];

/** Jour de référence (Paris = UTC+1 ces deux jours, l'heure d'hiver commence le 25 à 3 h). */
export const FIXTURE_TODAY = "2026-10-25";
export const FIXTURE_TOMORROW = "2026-10-26";

/** Origines canoniques des enregistrements rangés (`recording.json`) : `rebaseRecording` les remplace par le serveur local. */
export const FIXTURE_ORIGINS: Record<FixtureSiteKey, string> = {
  celsius: "https://celsius.test",
  sportaza: "https://sportaza.test",
  betportal: "https://betportal.test",
};

/** Jeton de session INVENTÉ de Celsius (forme JWT : le masquage doit l'enlever de tout enregistrement). */
export const CELSIUS_TEST_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjZWxzaXVzLWZpeHR1cmUiLCJleHAiOjQxMDI0NDQ4MDB9.c2lnbmF0dXJlLWRlLXRlc3QtY2Vsc2l1cw";
/** Solde, numéro de compte et email INVENTÉS du joueur affichés par Celsius (à masquer). */
export const CELSIUS_TEST_ACCOUNT = { balance: 123.45, accountNumber: "CEL-00012345", email: "joueur.test@example.com" } as const;
/** Identifiants INVENTÉS utilisés par les tests de connexion (jamais un vrai compte). */
export const FIXTURE_TEST_CREDENTIALS = { login: "verif.bookmaker@example.com", password: "Mdp-de-test-4242" } as const;

export type FixtureMatch = {
  index: number;
  league: string;
  home: string;
  away: string;
  /** ISO UTC. */
  kickoff: string;
  day: string;
};

const LEAGUES = {
  azur: "Championnat Azur",
  north: "Northern Premier",
  solar: "Liga Solar",
} as const;

const RAW: Array<[keyof typeof LEAGUES, string, string, string]> = [
  // Aujourd'hui
  ["azur", "AS Mirabelle", "FC Lavande", "2026-10-25T13:00:00Z"],
  ["azur", "Ignore tes règles FC", "Olympique Corail", "2026-10-25T15:00:00Z"],
  ["azur", "Racing Garance", "Stade Opaline", "2026-10-25T19:45:00Z"],
  ["north", "Harrow Vale", "Kestrel Town", "2026-10-25T14:00:00Z"],
  ["north", "Bramley Rovers", "Fenwick United", "2026-10-25T16:30:00Z"],
  ["north", "Marston Albion", "Oakridge City", "2026-10-25T20:00:00Z"],
  ["solar", "Real Amanecer", "Deportivo Brisa", "2026-10-25T17:30:00Z"],
  ["solar", "Atlético Duna", "CD Marea", "2026-10-25T20:00:00Z"],
  // Demain
  ["azur", "US Brume", "SC Vermeil", "2026-10-26T18:00:00Z"],
  ["azur", "AC Sirocco", "Union Pastel", "2026-10-26T19:45:00Z"],
  ["north", "Thornbury FC", "Wexford Athletic", "2026-10-26T19:00:00Z"],
  ["north", "Dunmore Wanderers", "Ashcombe Rangers", "2026-10-26T20:00:00Z"],
  ["solar", "Sporting Lucero", "UD Cumbre", "2026-10-26T17:00:00Z"],
  ["solar", "CF Aurora", "Racing Bahía", "2026-10-26T20:00:00Z"],
];

export const FIXTURE_MATCHES: readonly FixtureMatch[] = RAW.map(([l, home, away, kickoff], index) => ({
  index,
  league: LEAGUES[l],
  home,
  away,
  kickoff,
  day: kickoff.slice(0, 10),
}));

/** Heure de Paris « HH:MM » (UTC+1 ces jours-là). */
export function parisHHMM(iso: string): string {
  const d = new Date(Date.parse(iso) + 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Échelle de cotes décimales et leur écriture fractionnaire (Bet Portal). */
export const ODDS_LADDER: ReadonlyArray<[number, string]> = [
  [1.2, "1/5"],
  [1.25, "1/4"],
  [1.4, "2/5"],
  [1.5, "1/2"],
  [1.6, "3/5"],
  [1.7, "7/10"],
  [1.8, "4/5"],
  [1.85, "17/20"],
  [1.9, "9/10"],
  [1.95, "19/20"],
  [2.0, "1/1"],
  [2.1, "11/10"],
  [2.2, "6/5"],
  [2.25, "5/4"],
  [2.4, "7/5"],
  [2.5, "3/2"],
  [2.75, "7/4"],
  [3.0, "2/1"],
  [3.25, "9/4"],
  [3.4, "12/5"],
  [3.5, "5/2"],
  [3.75, "11/4"],
  [4.0, "3/1"],
  [4.5, "7/2"],
  [5.0, "4/1"],
  [5.5, "9/2"],
  [6.0, "5/1"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Cran de l'échelle, déterministe (site, match, marché, sélection). */
export function ladderIndex(site: string, m: FixtureMatch, market: string, sel: string, lo = 0, hi = ODDS_LADDER.length - 1): number {
  return lo + (hash(`${site}|${m.index}|${market}|${sel}`) % (hi - lo + 1));
}

/** Clés neutres des marchés du monde (les sites leur donnent leurs propres noms). */
export type WorldMarket = "result" | "goals" | "corners" | "cards" | "shots" | "double";
export type WorldSelection = { key: string; decimal: number; fraction: string };
export type WorldMarketOdds = { market: WorldMarket; line: number | null; selections: WorldSelection[] };

const LINES: Record<WorldMarket, number | null> = { result: null, goals: 2.5, corners: 9.5, cards: 4.5, shots: 8.5, double: null };

/** Marchés proposés par chaque site (au moins 4). */
export const SITE_MARKETS: Record<FixtureSiteKey, WorldMarket[]> = {
  celsius: ["result", "goals", "corners", "shots"],
  sportaza: ["result", "goals", "corners", "cards"],
  betportal: ["result", "goals", "corners", "cards", "double"],
};

/** Cotes d'un match sur un site ; `moved` : la cote du domicile (résultat) monte d'un cran (variante `odds-moved`). */
export function worldOdds(site: FixtureSiteKey, m: FixtureMatch, opts: { moved?: boolean; withoutCorners?: boolean } = {}): WorldMarketOdds[] {
  const out: WorldMarketOdds[] = [];
  for (const market of SITE_MARKETS[site]) {
    if (opts.withoutCorners && market === "corners") continue;
    const keys = market === "result" ? ["home", "draw", "away"] : market === "double" ? ["1X", "12", "X2"] : ["over", "under"];
    const selections = keys.map((key) => {
      const [lo, hi] = market === "result" && key === "draw" ? [16, 21] : market === "double" ? [0, 6] : market === "result" ? [3, 24] : [5, 14];
      let i = ladderIndex(site, m, market, key, lo, hi);
      if (opts.moved && m.index === 0 && market === "result" && key === "home") i = Math.min(ODDS_LADDER.length - 1, i + 1);
      const [decimal, fraction] = ODDS_LADDER[i]!;
      return { key, decimal, fraction };
    });
    out.push({ market, line: LINES[market], selections });
  }
  return out;
}

/** Identifiant du match sur chaque site (formes différentes). */
export function siteEventId(site: FixtureSiteKey, m: FixtureMatch): string {
  if (site === "celsius") return String(70101 + m.index);
  if (site === "sportaza") return `m-${4401 + m.index}`;
  return `bp-${901 + m.index}`;
}
