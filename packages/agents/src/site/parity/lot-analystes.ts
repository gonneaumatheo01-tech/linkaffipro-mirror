/** Phase 29 — correspondance des actions serveur de la page Agents → Analyses (« <fichier relatif à apps/web>#<fonction> »). */
import type { SiteParityEntry } from "../contract";

const A = (fn: string) => `app/(admin)/agents/analyses/actions.ts#${fn}`;

export const LOT_ANALYSTES_PARITY: Record<string, SiteParityEntry> = {
  [A("activateSourceAction")]: { op: "agents.analyses_source_activer" },
  [A("deactivateSourceAction")]: { op: "agents.analyses_source_desactiver" },
  [A("deleteSourceAction")]: { op: "agents.analyses_source_supprimer" },
  [A("decideMarketRecommendationAction")]: { op: "agents.analyses_recommandation" },
};
