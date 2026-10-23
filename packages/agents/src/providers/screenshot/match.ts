/**
 * Lecture et rapprochement des textes d'un site de bookmaker (pur) : cote affichée (décimale, fractionnaire,
 * américaine), noms d'équipes (abréviations courantes), libellés de marché et de sélection, écart de cote.
 */
import { fold } from "./errors";

/** Cote affichée → décimale (« 2,10 », « 2.10 », « 11/10 », « +110 », « -125 ») ; null si illisible. */
export function parseOddsText(raw: string): number | null {
  const t = raw.replace(/\s+/g, " ").trim();
  const ok = (v: number) => (Number.isFinite(v) && v >= 1.01 && v <= 1000 ? round2(v) : null);
  const dec = /(\d{1,3})[.,](\d{1,3})/.exec(t);
  if (dec) return ok(Number(`${dec[1]}.${dec[2]}`));
  const frac = /(\d{1,3})\s*\/\s*(\d{1,3})/.exec(t);
  if (frac && Number(frac[2]) > 0) return ok(1 + Number(frac[1]) / Number(frac[2]));
  const us = /([+-])(\d{3,4})\b/.exec(t);
  if (us && Number(us[2]) >= 100) return ok(us[1] === "+" ? 1 + Number(us[2]) / 100 : 1 + 100 / Number(us[2]));
  const int = /(?:^|[^\d])(\d{1,3})(?:$|[^\d])/.exec(t);
  return int ? ok(Number(int[1])) : null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Écart relatif en % entre la cote lue et la cote retenue (toujours positif). */
export function oddsDriftPct(expected: number, read: number): number {
  if (!(expected > 0)) return Infinity;
  return (Math.abs(read - expected) / expected) * 100;
}

/** La cote lue est-elle dans l'écart toléré (5 % par défaut, réglé par catégorie) ? */
export function oddsWithinTolerance(expected: number, read: number, tolerancePct: number): boolean {
  return oddsDriftPct(expected, read) <= Math.max(0, tolerancePct) + 1e-9;
}

// Mots qui ne distinguent pas une équipe (« FC », « Olympique »…) ; retirés avant de comparer.
const TEAM_NOISE = new Set(["fc", "cf", "sc", "ac", "as", "afc", "club", "de", "du", "la", "le", "les", "the", "real", "sporting", "athletic", "olympique", "stade", "rc", "us", "ssc", "sv", "fk", "sk", "cd", "ud", "1."]);
const TEAM_ALIASES: Record<string, string[]> = {
  "paris saint germain": ["psg", "paris sg", "paris saint-germain", "paris"],
  "manchester united": ["man utd", "man united", "manchester utd"],
  "manchester city": ["man city"],
  "olympique de marseille": ["marseille", "om"],
  "olympique lyonnais": ["lyon", "ol"],
  "bayern munich": ["bayern", "bayern munchen", "fc bayern"],
  "inter milan": ["inter", "internazionale"],
  "ac milan": ["milan"],
  "atletico madrid": ["atletico", "atl. madrid", "atl madrid"],
};

export function teamTokens(name: string): string[] {
  return fold(name)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !TEAM_NOISE.has(w));
}

/** Pur : le texte affiché nomme-t-il cette équipe (nom, alias ou mot significatif le plus long) ? */
export function textMentionsTeam(text: string, team: string): boolean {
  const hay = ` ${fold(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  const full = fold(team).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (full && hay.includes(` ${full} `)) return true;
  for (const [canon, aliases] of Object.entries(TEAM_ALIASES)) {
    const names = [canon, ...aliases].map((a) => fold(a).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
    if (names.includes(full) && names.some((n) => n.length > 2 && hay.includes(` ${n} `))) return true;
  }
  const tokens = teamTokens(team).sort((a, b) => b.length - a.length);
  return tokens.length > 0 && tokens[0]!.length >= 4 && hay.includes(` ${tokens[0]} `);
}

export function textMentionsMatch(text: string, home: string, away: string): boolean {
  return textMentionsTeam(text, home) && textMentionsTeam(text, away);
}

// Synonymes de marchés (fournisseur anglais → site en français ou anglais).
const MARKET_SYNONYMS: Array<[RegExp, string[]]> = [
  [/shots? on (target|goal)|tirs? cadres?/, ["tirs cadres", "tirs au but", "shots on target", "tir cadre"]],
  [/corners?/, ["corners", "corner", "coups de coin"]],
  [/cards?|cartons?|bookings?/, ["cartons", "carton", "cards", "bookings"]],
  [/(total )?goals?|buts?|over\/under|plus\/moins/, ["buts", "total de buts", "plus/moins", "goals", "over/under", "nombre de buts"]],
  [/(anytime )?(goal ?scorer|buteur)/, ["buteur", "buteurs", "goalscorer", "marquer"]],
  [/(match result|1x2|moneyline|resultat|full time result)/, ["resultat", "1x2", "resultat du match", "vainqueur", "match result"]],
];

/** Libellés possibles d'un marché sur le site (le libellé donné, puis ses synonymes). */
export function marketCandidates(label: string): string[] {
  const f = fold(label);
  const out = [f];
  for (const [re, syn] of MARKET_SYNONYMS) if (re.test(f)) out.push(...syn);
  return [...new Set(out)];
}

export function textMatchesMarket(text: string, label: string): boolean {
  const hay = fold(text);
  return marketCandidates(label).some((c) => c.length > 1 && hay.includes(c));
}

const OVER = /^(over|plus( de)?|\+|more than|au moins)\b/;
const UNDER = /^(under|moins( de)?|-|less than|fewer than)\b/;

/**
 * Pur : la ligne affichée correspond-elle à la sélection retenue ? « Over 4.5 » ≈ « Plus de 4,5 » ; une équipe ou un
 * joueur par son nom ; « Oui / Non » ; la ligne doit être la même quand elle est donnée.
 */
export function textMatchesSelection(text: string, selection: string, line: number | null): boolean {
  const hay = fold(text).replace(",", ".");
  const sel = fold(selection).replace(",", ".");
  if (line !== null && !new RegExp(`(^|[^\\d.])${String(line).replace(".", "\\.")}($|[^\\d])`).test(hay)) return false;
  const selSide = OVER.test(sel) ? "over" : UNDER.test(sel) ? "under" : null;
  if (selSide) {
    const hayWords = hay.replace(/^[^a-z+-]*/, "");
    const haySide = OVER.test(hayWords) || /\b(over|plus)\b/.test(hay) ? "over" : UNDER.test(hayWords) || /\b(under|moins)\b/.test(hay) ? "under" : null;
    return haySide === selSide;
  }
  if (/^(yes|oui)$/.test(sel)) return /\b(yes|oui)\b/.test(hay);
  if (/^(no|non)$/.test(sel)) return /\b(no|non)\b/.test(hay);
  if (/^(draw|nul|match nul|x)$/.test(sel)) return /\b(draw|nul|x)\b/.test(hay);
  const core = sel.replace(/\b(over|under|plus de|moins de)\b/g, "").replace(/[\d.]+/g, "").trim();
  if (!core) return true;
  return hay.includes(core) || textMentionsTeam(hay, core);
}
