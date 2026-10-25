/** Phase 28 — correspondance des actions serveur de la page Agents → Montage (« <fichier relatif à apps/web>#<fonction> »). */
import type { SiteParityEntry } from "../contract";

const A = (fn: string) => `app/(admin)/agents/montage/actions.ts#${fn}`;

export const LOT_MONTAGE_PARITY: Record<string, SiteParityEntry> = {
  [A("approveShortAction")]: { op: "agents.short_valider" },
  [A("modifyShortAction")]: { op: "agents.short_modifier" },
  [A("rejectShortAction")]: { op: "agents.short_refuser" },
  [A("cancelMontageAction")]: { op: "agents.montage_annuler" },
};
