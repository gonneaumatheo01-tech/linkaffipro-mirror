/**
 * Thèmes de l'équipe Casino (règles pures) : thèmes d'un canal avec leur poids (`ChannelAgentPlan.themes`), thèmes d'un
 * média (`MediaAsset.theme` + tags `theme:<clé>`), thème du jour d'un canal par rotation pondérée, corrigée par les
 * résultats mesurés par l'équipe Algorithme quand il y en a assez.
 */
export type WeightedTheme = { theme: string; weight: number };

export const THEME_TAG_PREFIX = "theme:";
export const TO_CLASSIFY_TAG = "a-classer";

export function themeTag(theme: string): string {
  return `${THEME_TAG_PREFIX}${theme}`;
}

/**
 * `ChannelAgentPlan.themes` → thèmes pondérés. Accepte `[{ theme, weight }]` (phase 22) et l'ancien `string[]`
 * (poids 1). Poids absent, nul ou abîmé → 1 ; doublons fusionnés (premier gardé). Le texte est gardé tel quel (les
 * thèmes Dating sont libres) : l'équipe Casino le ramène à une clé avec `themeKey`.
 */
export function parsePlanThemes(v: unknown): WeightedTheme[] {
  if (!Array.isArray(v)) return [];
  const out: WeightedTheme[] = [];
  for (const x of v) {
    const raw = typeof x === "string" ? x : x && typeof x === "object" ? (x as { theme?: unknown }).theme : null;
    if (typeof raw !== "string") continue;
    const theme = raw.trim().slice(0, 60);
    if (!theme || out.some((t) => t.theme === theme)) continue;
    const w = x && typeof x === "object" ? Number((x as { weight?: unknown }).weight) : 1;
    out.push({ theme, weight: Number.isFinite(w) && w > 0 ? Math.min(w, 100) : 1 });
  }
  return out;
}

/** Thèmes d'un média : principal (`theme`) puis ceux des tags `theme:<clé>`. */
export function assetThemes(asset: { theme: string | null; tags: unknown }): string[] {
  const out: string[] = [];
  if (asset.theme) out.push(asset.theme);
  if (Array.isArray(asset.tags))
    for (const t of asset.tags)
      if (typeof t === "string" && t.startsWith(THEME_TAG_PREFIX)) {
        const k = t.slice(THEME_TAG_PREFIX.length);
        if (k && !out.includes(k)) out.push(k);
      }
  return out;
}

export function assetHasTheme(asset: { theme: string | null; tags: unknown }, theme: string): boolean {
  return assetThemes(asset).includes(theme);
}

/** Posts minimum d'un thème sur un canal pour que ses résultats corrigent son poids. */
export const ALGO_MIN_POSTS_PER_THEME = 3;
const FACTOR_MIN = 0.5;
const FACTOR_MAX = 2;

/**
 * Facteurs des thèmes d'après les vues des posts mesurés (`PostInsight` : vues à 24 h, sinon finales) : moyenne du
 * thème ÷ moyenne du canal, bornée entre 0,5 et 2 ; un thème sans assez de posts garde 1.
 */
export function themeFactors(rows: ReadonlyArray<{ theme: string | null; views: number }>, minPosts = ALGO_MIN_POSTS_PER_THEME): Map<string, number> {
  const out = new Map<string, number>();
  const measured = rows.filter((r) => r.theme);
  if (!measured.length) return out;
  const avgAll = measured.reduce((s, r) => s + r.views, 0) / measured.length;
  if (avgAll <= 0) return out;
  const by = new Map<string, number[]>();
  for (const r of measured) by.set(r.theme!, [...(by.get(r.theme!) ?? []), r.views]);
  for (const [theme, views] of by) {
    if (views.length < minPosts) continue;
    const avg = views.reduce((a, b) => a + b, 0) / views.length;
    out.set(theme, Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, avg / avgAll)));
  }
  return out;
}

/**
 * Thème du jour d'un canal : celui qui manque le plus par rapport à sa part pondérée, compte tenu des thèmes du jour
 * des jours précédents (`history`, du plus récent au plus ancien). À égalité : le plus anciennement choisi, puis
 * l'ordre du plan. Null si le canal n'a aucun thème.
 */
export function pickDayTheme(themes: readonly WeightedTheme[], history: readonly string[], factors: ReadonlyMap<string, number> = new Map()): string | null {
  if (!themes.length) return null;
  const weights = themes.map((t) => ({ theme: t.theme, w: t.weight * (factors.get(t.theme) ?? 1) }));
  const total = weights.reduce((s, t) => s + t.w, 0);
  const past = history.filter((h) => weights.some((w) => w.theme === h));
  const n = past.length + 1;
  const lastSeen = (theme: string) => {
    const i = past.indexOf(theme);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  let best: { theme: string; deficit: number; seen: number } | null = null;
  for (const { theme, w } of weights) {
    const deficit = (w / total) * n - past.filter((h) => h === theme).length;
    const seen = lastSeen(theme);
    if (!best || deficit > best.deficit + 1e-9 || (Math.abs(deficit - best.deficit) <= 1e-9 && seen > best.seen)) best = { theme, deficit, seen };
  }
  return best!.theme;
}

/** Ordre d'essai des thèmes d'un post : le thème du jour, puis les autres thèmes du canal par poids décroissant. */
export function themeTryOrder(dayTheme: string | null, themes: readonly WeightedTheme[]): string[] {
  const rest = [...themes].sort((a, b) => b.weight - a.weight).map((t) => t.theme).filter((t) => t !== dayTheme);
  return dayTheme ? [dayTheme, ...rest] : rest;
}
