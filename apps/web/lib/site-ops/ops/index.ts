/** Phase 34 — tous les cœurs d'opérations du site (un lot par chantier). */
import type { SiteOpImpl } from "@linkaffipro/agents";
import { LOT_B_IMPL } from "./lot-b";
import { LOT_C_IMPL } from "./lot-c";
import { LOT_D_IMPL } from "./lot-d";
import { LOT_E_IMPL } from "./lot-e";
import { LOT_MONTAGE_IMPL } from "./lot-montage";

export const SITE_OP_IMPLS: SiteOpImpl[] = [...LOT_B_IMPL, ...LOT_C_IMPL, ...LOT_D_IMPL, ...LOT_E_IMPL, ...LOT_MONTAGE_IMPL];
