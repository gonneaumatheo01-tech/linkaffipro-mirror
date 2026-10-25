/** Phase 34 — correspondance de toutes les actions serveur du site (un lot par chantier). */
import type { SiteParityEntry } from "../contract";
import { LOT_B_PARITY } from "./lot-b";
import { LOT_C_PARITY } from "./lot-c";
import { LOT_D_PARITY } from "./lot-d";
import { LOT_E_PARITY } from "./lot-e";
import { LOT_MONTAGE_PARITY } from "./lot-montage";

export const SITE_PARITY: Record<string, SiteParityEntry> = { ...LOT_B_PARITY, ...LOT_C_PARITY, ...LOT_D_PARITY, ...LOT_E_PARITY, ...LOT_MONTAGE_PARITY };
