/** Phase 32 — correspondance des actions serveur des pages avancées de la Prospection (« <fichier relatif à apps/web>#<fonction> »). */
import type { SiteParityEntry } from "../contract";

const A = (fn: string) => `app/(admin)/agents/prospection/advanced-actions.ts#${fn}`;

export const LOT_PROSPECTION_AVANCEE_PARITY: Record<string, SiteParityEntry> = {
  [A("markAlertSeenAction")]: { op: "agents.prospection_alerte_vue" },
  [A("muteProspectAlertsAction")]: { op: "agents.prospection_alertes_canal" },
  [A("muteAlertKindAction")]: { op: "agents.prospection_alertes_type" },
  [A("unmuteAlertKindAction")]: { op: "agents.prospection_alertes_type" },
  [A("mergeProspectsAction")]: { op: "agents.prospection_reseau_fusionner" },
  [A("splitProspectAction")]: { op: "agents.prospection_reseau_separer" },
  [A("linkAffiliateAction")]: { op: "agents.prospection_affilie_rattacher" },
  [A("applyCalibrationAction")]: { op: "agents.prospection_calibrage_appliquer" },
  [A("undoCalibrationAction")]: { op: "agents.prospection_calibrage_annuler" },
  [A("stopAccountSearchAction")]: { op: "agents.prospection_recherche_compte_couper" },
};
