/**
 * Phase 35 : recette active d'un site (`BookmakerRecipe.isActive`, la plus haute version), lue de façon tolérante,
 * et mémorisation du bon candidat d'une étape de page (`DomStep.lastGood`) dans la recette (sans nouvelle version :
 * c'est la même méthode, seul l'ordre d'essai change).
 */
import type { DomStep, RecipeData, RecipeEndpoint } from "../contract";
import type { AgentsDeps } from "../../types";

export type ActiveRecipe = RecipeData & { id: string; version: number; domains: string[] };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseRecipeRow(r: Record<string, unknown>): ActiveRecipe | null {
  const mapping = rec(r.mapping);
  const level = r.level === "api" || r.level === "dom" ? r.level : null;
  if (!level) return null;
  const api = rec(r.api);
  const endpoints = Array.isArray(api.endpoints) ? (api.endpoints as RecipeEndpoint[]).filter((e) => e && typeof e.urlTemplate === "string" && e.responseShape && typeof e.responseShape === "object") : [];
  const dom = r.dom && typeof r.dom === "object" ? (r.dom as RecipeData["dom"]) : null;
  const validation = rec(r.validation);
  const domains = Array.isArray(validation.domains) ? validation.domains.filter((d): d is string => typeof d === "string") : [];
  const format = mapping.oddsFormat === "fractional" || mapping.oddsFormat === "american" ? mapping.oddsFormat : "decimal";
  return {
    id: String(r.id),
    version: Number(r.version ?? 0),
    level,
    api: endpoints.length ? { endpoints, tokenSource: typeof api.tokenSource === "string" ? api.tokenSource : null } : null,
    dom: dom && dom.eventList && dom.market ? dom : null,
    mapping: {
      marketMap: rec(mapping.marketMap) as Record<string, string | null>,
      selectionMap: rec(mapping.selectionMap) as Record<string, string>,
      oddsFormat: format,
      timezone: typeof mapping.timezone === "string" && mapping.timezone ? mapping.timezone : "Europe/Paris",
    },
    domains,
  };
}

export async function loadActiveRecipe(deps: Pick<AgentsDeps, "prisma">, siteKey: string): Promise<ActiveRecipe | null> {
  const row = (await deps.prisma.bookmakerRecipe.findFirst({ where: { siteKey, isActive: true }, orderBy: { version: "desc" } })) as Record<string, unknown> | null;
  return row ? parseRecipeRow(row) : null;
}

export function endpointFor(r: ActiveRecipe, purpose: RecipeEndpoint["purpose"] | Array<RecipeEndpoint["purpose"]>): RecipeEndpoint | null {
  const list = Array.isArray(purpose) ? purpose : [purpose];
  for (const p of list) {
    const e = r.api?.endpoints.find((x) => x.purpose === p);
    if (e) return e;
  }
  return null;
}

/** Applique les rangs `lastGood` retenus (`"eventRow.home"` → `dom.eventRow.home.lastGood`) ; rend vrai si changé. */
export function applyLastGood(dom: NonNullable<RecipeData["dom"]>, good: Record<string, number>): boolean {
  let changed = false;
  for (const [path, index] of Object.entries(good)) {
    const parts = path.split(".");
    let cur: unknown = dom;
    for (const p of parts) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
    const step = cur as DomStep | undefined;
    if (step && Array.isArray(step.candidates) && step.lastGood !== index) {
      step.lastGood = index;
      changed = true;
    }
  }
  return changed;
}

/** Mémorise le bon candidat dans la recette (erreur d'écriture : sans conséquence sur la lecture). */
export async function rememberLastGood(deps: Pick<AgentsDeps, "prisma" | "logger">, recipe: ActiveRecipe, good: Record<string, number>): Promise<void> {
  if (!recipe.dom || !Object.keys(good).length) return;
  const dom = JSON.parse(JSON.stringify(recipe.dom)) as NonNullable<RecipeData["dom"]>;
  if (!applyLastGood(dom, good)) return;
  try {
    await deps.prisma.bookmakerRecipe.update({ where: { id: recipe.id }, data: { dom: dom as never } });
    recipe.dom = dom;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, recipeId: recipe.id }, "[bookmakers] rang du bon candidat non mémorisé");
  }
}
