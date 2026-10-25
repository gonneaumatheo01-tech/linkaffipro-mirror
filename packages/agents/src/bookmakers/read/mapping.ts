/**
 * Phase 35 : traduction INTERNE des noms du site (règle 4 : les noms restent ceux du site, la recette les traduit).
 * - marché du site → thème de `sports/themes.json` (`mapping.marketMap`, valeur « corners » ou « corners:home ») ;
 * - sélection du site → issue (`mapping.selectionMap`, valeur « over », « home », « away:over »… ou identifiant
 *   complet `corners-all-game-ou-over`) ; à défaut les noms des deux équipes et les mots universels (Plus / Moins,
 *   Oui / Non, 1 / X / 2, 1X / X2 / 12) ;
 * - thème + issue → identifiant de marché du format commun (`oddID` SportsGameOdds : le règlement et la comparaison
 *   au consensus le lisent tels quels). Une sélection sans traduction sûre est écartée (jamais devinée).
 * Règles pures.
 */
import { SPORTS_THEMES, themeByKey, type SportsTheme } from "../../sports/themes";
import { parseMarketId } from "../../sports/labels";
import { marketMatches } from "../../rules/bets";
import { fold } from "../../providers/screenshot/errors";
import { textMentionsTeam } from "../../providers/screenshot/match";
import type { RecipeData } from "../contract";

export type Mapping = RecipeData["mapping"];

const norm = (s: string) => fold(s).replace(/[^a-z0-9+/.\- ]/g, " ").replace(/\s+/g, " ").trim();

function lookup<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  if (!map) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  const n = norm(key);
  for (const [k, v] of Object.entries(map)) if (norm(k) === n) return v;
  return undefined;
}

export type MarketRef = { theme: SportsTheme; entity: string | null };

/** Marché du site → thème (et entité éventuelle) ; null = marché sans correspondance (gardé hors de l'équipe). */
export function marketRefOf(marketSite: string, mapping: Pick<Mapping, "marketMap">): MarketRef | null {
  const v = lookup(mapping.marketMap, marketSite);
  if (typeof v !== "string" || !v) return null;
  const [key, entity] = v.split(":");
  const theme = themeByKey(key ?? "");
  return theme ? { theme, entity: entity || null } : null;
}

const SIDE_WORDS: Array<[RegExp, string]> = [
  [/^(over|plus( de)?|more than|au moins|\+)(\s|$)/, "over"],
  [/^(under|moins( de)?|less than|fewer than)(\s|$)/, "under"],
  [/^(yes|oui|si|ja)$/, "yes"],
  [/^(no|non|nein)$/, "no"],
  [/^(x|draw|nul|match nul|egalite|n)$/, "draw"],
  [/^(1x|1 x|1 ou x|home or draw)$/, "home+draw"],
  [/^(x2|x 2|x ou 2|draw or away)$/, "away+draw"],
  [/^(12|1 2|1 ou 2|home or away|pas de nul)$/, "not_draw"],
  [/^(1|home|domicile)$/, "home"],
  [/^(2|away|exterieur)$/, "away"],
];

export type Teams = { homeTeam: string; awayTeam: string };

/** Issue d'une sélection du site (« over », « home », « away:over », ou identifiant complet) ; null si inconnue. */
export function sideOf(selectionSite: string, mapping: Pick<Mapping, "selectionMap">, teams: Teams): string | null {
  const mapped = lookup(mapping.selectionMap, selectionSite);
  if (typeof mapped === "string" && mapped) return mapped;
  const n = norm(selectionSite.replace(/[-+]?\d+(?:[.,]\d+)?/g, " ")).trim();
  const raw = norm(selectionSite);
  for (const [re, side] of SIDE_WORDS) if (re.test(raw) || (n && re.test(n))) return side;
  const home = textMentionsTeam(selectionSite, teams.homeTeam);
  const away = textMentionsTeam(selectionSite, teams.awayTeam);
  if (home && !away) return "home";
  if (away && !home) return "away";
  return null;
}

/** Ligne d'une sélection : champ du site, sinon le nombre affiché dans le libellé (« Plus de 2,5 », « PSG (-1,5) »). */
export function lineOf(selectionSite: string, lineRaw: unknown, needsLine: boolean): number | null {
  if (typeof lineRaw === "number" && Number.isFinite(lineRaw)) return lineRaw;
  if (typeof lineRaw === "string" && lineRaw.trim()) {
    const n = Number(lineRaw.trim().replace(",", ".").replace(/^\+/, ""));
    if (Number.isFinite(n)) return n;
  }
  if (!needsLine) return null;
  const m = /([+-]?\d+(?:[.,]\d+)?)(?!.*\d)/.exec(selectionSite.replace(/\s+/g, " "));
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Thème + issue → identifiant de marché du format commun, parmi les marchés du thème (jamais hors du thème). Entité :
 * celle de l'issue (« home:over »), sinon celle du marché (« corners:home »), sinon le total du match.
 */
export function selectionKeyOf(ref: MarketRef, side: string): string | null {
  if (parseMarketId(side)) return ref.theme.marketTypes.some((m) => marketMatches(side, m)) ? side : null;
  const [a, b] = side.split(":");
  const sideKey = b ?? a ?? "";
  const entity = b ? a! : ref.entity;
  const options = ref.theme.marketTypes.map((m) => ({ m, p: parseMarketId(m) })).filter((x) => x.p && x.p.side === sideKey && !x.p.entity.includes("PLAYER"));
  if (!options.length) return null;
  const pick =
    (entity ? options.find((x) => x.p!.entity === entity) : null) ??
    (entity ? null : (options.find((x) => x.p!.entity === "all") ?? (options.length === 1 ? options[0] : null) ?? options.find((x) => x.p!.entity === sideKey)));
  return pick ? pick.m : null;
}

/** Le type de pari du thème demande-t-il une ligne (plus / moins, handicap) ? */
export function themeNeedsLine(ref: MarketRef): boolean {
  return ref.theme.marketTypes.some((m) => {
    const p = parseMarketId(m);
    return p?.betType === "ou" || p?.betType === "sp";
  });
}

/**
 * Clés demandées (clés internes de `themes.json` ou identifiants du fournisseur) → motifs d'identifiants de marché.
 * Liste vide = tout.
 */
export function expandMarketKeys(keys: readonly string[]): string[] {
  const out = new Set<string>();
  for (const k of keys) {
    const t = themeByKey(k);
    if (t) for (const m of t.marketTypes) out.add(m);
    else if (k) out.add(k);
  }
  return [...out];
}

/** Thèmes concernés par des clés demandées (pour savoir quels onglets ouvrir). */
export function themesOfKeys(keys: readonly string[]): SportsTheme[] {
  const patterns = expandMarketKeys(keys);
  return SPORTS_THEMES.filter((t) => t.marketTypes.some((m) => patterns.some((p) => marketMatches(m, p) || marketMatches(p, m))));
}

export function wantedSelection(selectionKey: string | null, patterns: readonly string[]): boolean {
  if (!patterns.length) return selectionKey !== null;
  return selectionKey !== null && patterns.some((p) => marketMatches(selectionKey, p));
}

/** Traduction complète d'une ligne lue. */
export function translateRow(
  row: { marketSite: string; selectionSite: string; lineRaw?: unknown },
  mapping: Mapping,
  teams: Teams,
): { marketKey: string | null; selectionKey: string | null; line: number | null } {
  const ref = marketRefOf(row.marketSite, mapping);
  if (!ref) return { marketKey: null, selectionKey: null, line: lineOf(row.selectionSite, row.lineRaw, false) };
  const side = sideOf(row.selectionSite, mapping, teams);
  const selectionKey = side ? selectionKeyOf(ref, side) : null;
  const line = lineOf(row.selectionSite, row.lineRaw, themeNeedsLine(ref) && selectionKey !== null && /-(ou|sp)-/.test(selectionKey));
  return { marketKey: ref.theme.key, selectionKey, line };
}
