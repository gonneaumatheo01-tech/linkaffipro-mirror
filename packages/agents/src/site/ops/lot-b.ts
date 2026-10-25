/** Phase 34 — métadonnées des opérations du lot B pour Kevin (voir `../contract.ts`) : canaux, messages, pages, étiquettes, catégories. */
import type { SiteOpMeta } from "../contract";
import { LOT_B_CANAUX } from "./lot-b/canaux";
import { LOT_B_MESSAGES } from "./lot-b/messages";

export const LOT_B_OPS: SiteOpMeta[] = [...LOT_B_CANAUX, ...LOT_B_MESSAGES];
