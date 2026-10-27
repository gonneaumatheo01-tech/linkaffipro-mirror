/**
 * Phase 31 — lien d'export donné par Kevin : `${APP_BASE_URL}/agents/prospection?export=csv` (avec les filtres
 * éventuels). La page renvoie vers la route d'export (`/agents/prospection/export`), en gardant les filtres et en
 * retirant `export` / `vue` / les messages. Règle pure.
 */
import { PROSPECTION_PATH } from "./display";
import { filterParams, parseProspectFilters } from "./filters";

export function exportRedirect(sp: Record<string, unknown>): string | null {
  const v = Array.isArray(sp.export) ? sp.export[0] : sp.export;
  if (typeof v !== "string" || v.toLowerCase() !== "csv") return null;
  const q = new URLSearchParams(filterParams(parseProspectFilters(sp))).toString();
  return `${PROSPECTION_PATH}/export${q ? `?${q}` : ""}`;
}
