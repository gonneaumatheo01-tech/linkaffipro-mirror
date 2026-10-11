/**
 * Règles pures de `RememberFilters` (mémoire des filtres d'une liste), testées à part (sans DOM).
 */

/** Paramètres qui ne sont pas des filtres (messages de retour, pagination). */
export const IGNORED_PARAMS: readonly string[] = ["ok", "error", "page"];
/** Paramètres gardés par « Effacer les filtres » : la vue choisie (Liste / Calendrier / Modèles), l'onglet. */
export const DEFAULT_KEEP_PARAMS: readonly string[] = ["view", "tab"];

type Params = Pick<URLSearchParams, "entries" | "keys" | "get">;

/** Ce qui est mémorisé : les paramètres de l'adresse sans les messages de retour, la page ni les valeurs vides. */
export function cleanParams(sp: Params): string {
  const p = new URLSearchParams();
  for (const [k, v] of sp.entries()) if (!IGNORED_PARAMS.includes(k) && v !== "") p.append(k, v);
  return p.toString();
}

/** L'adresse porte au moins un paramètre (autre qu'un retour ou la page) : rien à rappeler de la mémoire. */
export function hasAnyParam(sp: Params): boolean {
  return [...sp.keys()].some((k) => !IGNORED_PARAMS.includes(k));
}

/** Rappeler les filtres mémorisés : seulement sur une adresse nue, et s'il y a quelque chose en mémoire. */
export function shouldRestore(sp: Params, stored: string | null | undefined): boolean {
  return !hasAnyParam(sp) && Boolean(stored);
}

/**
 * Au moins un filtre actif (une valeur non vide hors retours, page et paramètres gardés) : c'est la condition pour
 * montrer « Effacer les filtres ». La mémoire suit toujours l'adresse (elle est rappelée sur une adresse nue, puis
 * réécrite), donc « rien de filtré » veut aussi dire « rien de mémorisé ».
 */
export function hasActiveFilters(
  sp: Params,
  keepParams: readonly string[] = DEFAULT_KEEP_PARAMS,
): boolean {
  for (const [k, v] of sp.entries()) {
    if (IGNORED_PARAMS.includes(k) || keepParams.includes(k)) continue;
    if (v !== "") return true;
  }
  return false;
}

/** Adresse après « Effacer les filtres » : la même page, avec seulement les paramètres gardés. */
export function resetHref(
  pathname: string,
  sp: Params,
  keepParams: readonly string[] = DEFAULT_KEEP_PARAMS,
): string {
  const kept = new URLSearchParams();
  for (const name of keepParams) {
    const v = sp.get(name);
    if (v) kept.set(name, v);
  }
  const q = kept.toString();
  return q ? `${pathname}?${q}` : pathname;
}
