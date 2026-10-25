/** Phase 34 — toutes les opérations du site connues de Kevin (un lot par chantier). */
import type { SiteOpMeta } from "../contract";
import { LOT_B_OPS } from "./lot-b";
import { LOT_C_OPS } from "./lot-c";
import { LOT_D_OPS } from "./lot-d";
import { LOT_E_OPS } from "./lot-e";

export const SITE_OPS: SiteOpMeta[] = [...LOT_B_OPS, ...LOT_C_OPS, ...LOT_D_OPS, ...LOT_E_OPS];
