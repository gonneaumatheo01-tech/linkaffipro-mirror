/**
 * Phase 35 (chantier B) — changement d'origine d'un enregistrement ou d'une recette :
 * - réutilisation d'une recette d'un même moteur de paris sur une autre marque (son propre domaine, `reuseRecipeByProvider`) ;
 * - enregistrements de référence des tests (origines canoniques `https://<site>.test` ↔ serveur local `127.0.0.1:<port>`).
 * Règles pures : seule l'origine change (schéma http/ws et hôte:port), jamais un chemin ni une valeur.
 */
import type { RecipeData, SiteRecording } from "../contract";

function originParts(origin: string): { http: string; ws: string; host: string; hostname: string } {
  const u = new URL(origin);
  const secure = u.protocol === "https:";
  return {
    http: `${u.protocol}//${u.host}`,
    ws: `${secure ? "wss" : "ws"}://${u.host}`,
    host: u.host,
    hostname: u.hostname,
  };
}

/** Remplace une origine par une autre dans une chaîne (http(s), ws(s), et l'hôte nu dans les adresses). Pur. */
export function replaceOrigin(s: string, fromOrigin: string, toOrigin: string): string {
  const f = originParts(fromOrigin);
  const t = originParts(toOrigin);
  const other = f.http.startsWith("https") ? `http://${f.host}` : `https://${f.host}`;
  const otherWs = f.ws.startsWith("wss") ? `ws://${f.host}` : `wss://${f.host}`;
  return s
    .split(f.http)
    .join(t.http)
    .split(other)
    .join(t.http)
    .split(f.ws)
    .join(t.ws)
    .split(otherWs)
    .join(t.ws);
}

function mapStrings<T>(v: T, fn: (s: string) => string): T {
  if (typeof v === "string") return fn(v) as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn)) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, mapStrings(x, fn)]),
    ) as T;
  return v;
}

/** Enregistrement vu depuis une autre origine (adresses, corps, HTML, domaines). Pur. */
export function rebaseRecording(rec: SiteRecording, toOrigin: string): SiteRecording {
  const fromOrigin = new URL(rec.baseUrl).origin;
  if (fromOrigin === new URL(toOrigin).origin) return rec;
  const f = originParts(fromOrigin);
  const t = originParts(toOrigin);
  const out = mapStrings(rec, (s) => replaceOrigin(s, fromOrigin, toOrigin));
  out.domains = [...new Set(rec.domains.map((d) => (d === f.hostname ? t.hostname : d)))];
  return out;
}

/** Recette vue depuis une autre origine (modèles d'adresse et source du jeton). Pur. */
export function rebaseRecipe(recipe: RecipeData, fromOrigin: string, toOrigin: string): RecipeData {
  if (!recipe.api) return recipe;
  return {
    ...recipe,
    api: {
      ...recipe.api,
      tokenSource: recipe.api.tokenSource
        ? replaceOrigin(recipe.api.tokenSource, fromOrigin, toOrigin)
        : (recipe.api.tokenSource ?? null),
      endpoints: recipe.api.endpoints.map((e) => ({
        ...e,
        urlTemplate: replaceOrigin(e.urlTemplate, fromOrigin, toOrigin),
      })),
    },
  };
}

/** Origines des points d'entrée d'une recette (la première = celle du site). Pur. */
export function recipeOrigins(recipe: RecipeData): string[] {
  const out: string[] = [];
  for (const e of recipe.api?.endpoints ?? []) {
    try {
      const o = new URL(e.urlTemplate.replace(/\{[^}]+\}/g, "x")).origin;
      if (!out.includes(o)) out.push(o);
    } catch {
      /* modèle illisible : refusé ailleurs */
    }
  }
  return out;
}
