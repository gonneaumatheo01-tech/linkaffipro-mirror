/**
 * Thèmes de paris (phase 33, ordres de Kevin) : un thème en français courant (ou en anglais) → marchés du fournisseur
 * de cotes (`marketTypes` au format de `BetCategory`, `oddID` SportsGameOdds), d'après `themes.json`.
 * - `resolveTheme(text)` : règle pure (synonymes, accents, pluriels, le plus long synonyme gagne) ;
 * - `marketsAvailable(deps, theme, period)` : demande au fournisseur (un appel groupé, cache du fournisseur) si le
 *   thème a des cotes sur la période dans les ligues actives ; sinon la raison précise et les thèmes qui en ont.
 * Lecture seule : rien n'est écrit (le quota d'appels du fournisseur compte l'appel, comme tout appel de cotes).
 */
import data from "./themes.json";
import { nowOf } from "../admin/journal";
import { marketMatches } from "../rules/bets";
import { parisDayStart } from "../rules/time";
import { marketsForEvents } from "../providers/odds-batch";
import { OddsQuotaError } from "../providers/odds-quota";
import { hasOddsKey, resolveOddsProvider, type OddsResolveDeps } from "../providers/odds-registry";
import { activeCategories } from "./data";
import { loadSportsSettings } from "./settings";

export type SportsTheme = { key: string; label: string; synonyms: string[]; marketTypes: string[] };

export const SPORTS_THEMES: readonly SportsTheme[] = Object.freeze(
  (data as { themes: SportsTheme[] }).themes.map((t) => ({ ...t, synonyms: [...t.synonyms], marketTypes: [...t.marketTypes] })),
);

/** Ligues par défaut quand aucune catégorie active n'en donne (les 5 grands championnats). */
export const DEFAULT_THEME_LEAGUES = ["EPL", "LA_LIGA", "BUNDESLIGA", "IT_SERIE_A", "FR_LIGUE_1"] as const;

/** Matchs examinés au plus pour la vérification (un appel groupé). */
const MAX_CHECK_EVENTS = 25;
/** Au-delà, le fournisseur n'a en général pas encore de cotes : la vérification regarde 7 jours au plus. */
const MAX_LOOKAHEAD_MS = 7 * 86_400_000;

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      let x = w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
      if (/(eu|au)x$/.test(x)) x = x.slice(0, -1);
      return x;
    })
    .join(" ");
}

export function themeByKey(key: string | null | undefined): SportsTheme | null {
  return SPORTS_THEMES.find((t) => t.key === key) ?? null;
}

/** Thème d'un texte (« les hors-jeux », « Corners », « both teams to score ») ; null si aucun (pur). */
export function resolveTheme(text: string | null | undefined): SportsTheme | null {
  if (!text) return null;
  const direct = themeByKey(text.trim().toLowerCase());
  if (direct) return direct;
  const n = ` ${norm(text)} `;
  if (!n.trim()) return null;
  let best: { theme: SportsTheme; len: number } | null = null;
  for (const t of SPORTS_THEMES)
    for (const syn of [t.label, t.key.replace(/-/g, " "), ...t.synonyms]) {
      const s = norm(syn);
      if (!s) continue;
      if (n.includes(` ${s} `) && (!best || s.length > best.len)) best = { theme: t, len: s.length };
    }
  return best?.theme ?? null;
}

/** Thème dont les marchés sont ceux d'une catégorie (au moins un marché commun), pour relier une catégorie existante. */
export function themeOfMarkets(marketTypes: readonly string[]): SportsTheme | null {
  return SPORTS_THEMES.find((t) => t.marketTypes.some((m) => marketTypes.some((x) => marketMatches(m, x) || marketMatches(x, m)))) ?? null;
}

export type ThemePeriod = { start: string; days: number } | { from: Date; to: Date };

export type ThemeAvailability =
  | { ok: true; theme: SportsTheme; events: number; withOdds: number; source: "fake" | "live" }
  | {
      ok: false;
      code: "unknown_theme" | "no_provider" | "no_events" | "no_market";
      theme: SportsTheme | null;
      reason: string;
      /** Thèmes qui ont des cotes sur la période (replis), du plus fourni au moins fourni. */
      available: SportsTheme[];
    };

export type ThemeOddsDeps = OddsResolveDeps;

function windowOf(period: ThemePeriod, now: Date): { from: Date; to: Date } {
  const raw = "from" in period ? period : { from: parisDayStart(period.start), to: new Date(parisDayStart(period.start).getTime() + Math.max(1, period.days) * 86_400_000) };
  const from = new Date(Math.max(raw.from.getTime(), now.getTime()));
  const to = new Date(Math.min(raw.to.getTime(), now.getTime() + MAX_LOOKAHEAD_MS));
  return { from, to: to.getTime() > from.getTime() ? to : new Date(from.getTime() + 86_400_000) };
}

/**
 * Nombre de matchs qui ont au moins une cote ouverte, par thème (un seul appel groupé pour tous les thèmes). Rend
 * aussi le nombre de matchs examinés. Erreur du fournisseur → `error`.
 */
export async function themeOddsCounts(
  deps: ThemeOddsDeps,
  period: ThemePeriod,
  opts: { leagues?: readonly string[]; bookmakers?: readonly string[] } = {},
): Promise<{ counts: Map<string, number>; events: number; source: "fake" | "live" } | { error: string; code: "no_provider" }> {
  const now = nowOf(deps);
  const s = await loadSportsSettings(deps.prisma);
  const forced = !!deps.providers?.odds;
  const source = forced || (await hasOddsKey(deps.prisma)) ? "live" : "fake";
  const resolved = await resolveOddsProvider(deps, { source, maxCalls: s.maxApiCallsPerMonth });
  if (!resolved) return { error: "aucun fournisseur de cotes n'est branché (clé SportsGameOdds absente)", code: "no_provider" };
  let leagues = opts.leagues?.length ? [...opts.leagues] : [...new Set((await activeCategories(deps.prisma)).flatMap((c) => c.leagues))];
  if (!leagues.length) leagues = [...DEFAULT_THEME_LEAGUES];
  const { from, to } = windowOf(period, now);
  try {
    const events = (await resolved.provider.listEvents({ sport: "SOCCER", leagues, from, to }))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, MAX_CHECK_EVENTS);
    const counts = new Map<string, number>();
    if (!events.length) return { counts, events: 0, source: resolved.source };
    const all = [...new Set(SPORTS_THEMES.flatMap((t) => t.marketTypes))];
    const markets = await marketsForEvents(resolved.provider, events.map((e) => e.eventId), all);
    const books = (opts.bookmakers ?? []).map((b) => b.toLowerCase());
    for (const t of SPORTS_THEMES) {
      let n = 0;
      for (const e of events) {
        const sels = markets.get(e.eventId) ?? [];
        const has = sels.some(
          (sel) =>
            t.marketTypes.some((m) => marketMatches(sel.marketId, m)) &&
            Object.entries(sel.byBookmaker).some(([b, odds]) => odds > 1 && (!books.length || books.includes(b.toLowerCase()))),
        );
        if (has) n++;
      }
      counts.set(t.key, n);
    }
    return { counts, events: events.length, source: resolved.source };
  } catch (err) {
    if (err instanceof OddsQuotaError) return { error: "le plafond mensuel d'appels au fournisseur de cotes est atteint", code: "no_provider" };
    return { error: `le fournisseur de cotes ne répond pas (${(err as Error).message.slice(0, 120)})`, code: "no_provider" };
  }
}

/** Thèmes qui ont des cotes (pur), du plus fourni au moins fourni, sans `except`. */
export function themesWithOdds(counts: ReadonlyMap<string, number>, except?: string | null): SportsTheme[] {
  return SPORTS_THEMES.filter((t) => t.key !== except && (counts.get(t.key) ?? 0) > 0).sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0));
}

/**
 * Le thème a-t-il des cotes chez le fournisseur sur la période, dans les ligues actives ? Thème inconnu → « je ne
 * connais pas ce thème » + les thèmes connus qui ont des cotes ; aucun marché → raison précise + replis.
 */
export async function marketsAvailable(
  deps: ThemeOddsDeps,
  theme: string | SportsTheme,
  period: ThemePeriod,
  opts: { leagues?: readonly string[]; bookmakers?: readonly string[] } = {},
): Promise<ThemeAvailability> {
  const t = typeof theme === "string" ? resolveTheme(theme) : theme;
  const counts = await themeOddsCounts(deps, period, opts);
  if ("error" in counts) return { ok: false, code: "no_provider", theme: t, reason: `Je ne peux pas vérifier les cotes : ${counts.error}.`, available: [] };
  const available = themesWithOdds(counts.counts, t?.key);
  if (!t)
    return {
      ok: false,
      code: "unknown_theme",
      theme: null,
      reason: `Je ne connais pas le thème « ${String(theme).slice(0, 60)} ». Thèmes connus : ${SPORTS_THEMES.map((x) => x.label).join(", ")}.`,
      available,
    };
  if (!counts.events)
    return { ok: false, code: "no_events", theme: t, reason: `Le fournisseur de cotes n'a aucun match à venir sur la période dans les ligues suivies.`, available };
  const n = counts.counts.get(t.key) ?? 0;
  if (!n)
    return {
      ok: false,
      code: "no_market",
      theme: t,
      reason: `Le fournisseur de cotes n'a pas de marché « ${t.label} » sur les ${counts.events} matchs à venir des ligues suivies${opts.bookmakers?.length ? ` chez ${opts.bookmakers.join(", ")}` : ""}.`,
      available,
    };
  return { ok: true, theme: t, events: counts.events, withOdds: n, source: counts.source };
}
