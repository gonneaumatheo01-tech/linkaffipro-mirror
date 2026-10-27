/** Phase 31 — correspondance des actions serveur de la page Agents → Prospection (« <fichier relatif à apps/web>#<fonction> »). */
import type { SiteParityEntry } from "../contract";

const A = (fn: string) => `app/(admin)/agents/prospection/actions.ts#${fn}`;

export const LOT_PROSPECTION_PARITY: Record<string, SiteParityEntry> = {
  [A("setProspectStatusAction")]: { op: "agents.prospection_statut" },
  [A("bulkProspectStatusAction")]: { op: "agents.prospection_statut_lot" },
  [A("addProspectNoteAction")]: { op: "agents.prospection_note" },
  [A("addManualProspectAction")]: { op: "agents.prospection_ajouter" },
  [A("saveOfferAction")]: { op: "agents.prospection_offre" },
  [A("toggleOfferAction")]: { op: "agents.prospection_offre_activer" },
  [A("proposeDictAction")]: { op: "agents.prospection_repere_proposer" },
  [A("decideDictAction")]: { op: "agents.prospection_repere_valider" },
  [A("toggleSourcePauseAction")]: { op: "agents.prospection_source_pause" },
  [A("saveProspectionSettingsAction")]: { op: "agents.prospection_reglages" },
};
