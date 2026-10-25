/** Phase 34 — correspondance des actions serveur du lot C (« <fichier relatif à apps/web>#<fonction> »). */
import type { SiteParityEntry } from "../contract";
import { LOT_C_OPS } from "../ops/lot-c";

/** Chaque action serveur du lot C → l'opération qui la couvre (tirée des `serverActions` des métadonnées). */
export const LOT_C_PARITY: Record<string, SiteParityEntry> = Object.fromEntries(
  LOT_C_OPS.flatMap((op) => op.serverActions.map((a) => [a, { op: op.key }] as const)),
);
