"use server";

import { revalidatePath } from "next/cache";
import { ORDERS_PATH, orderHref, safeOrderId } from "@/lib/agents/orders";
import { backTo } from "@/lib/agents/redirect";
import { siteActor } from "@/lib/site-ops/ops/lot-d/kit";
import { runExtendOrder, runStopOrder } from "@/lib/site-ops/ops/lot-d/orders";
import { requireUser } from "@/lib/session";

/**
 * Actions de la fiche d'un ordre (Agents → Ordres, phase 33), réservées aux administrateurs :
 * - « Arrêter » : `stopOrder` annule les missions non commencées et clôt le réglage temporaire du canal ;
 * - « Prolonger de N jours » : `extendOrder` repousse la fin de l'ordre.
 * Les fonctions viennent du Grand Chef (`packages/agents/src/orders/run.ts`) ; chaque geste est noté dans le journal
 * des actions (`AuditLog`, entité `TeamOrder`), qu'il réussisse ou non.
 */

// Phase 34 : logique dans les cœurs uniques (`@/lib/site-ops/ops/lot-d/orders`), que Kevin appelle aussi.

function finish(
  formData: FormData,
  r: { ok: true; message: string } | { ok: false; error: string; code?: string; field?: string | null },
): never {
  const orderId = safeOrderId(formData.get("orderId"));
  if (!r.ok && (r.field === "orderId" || r.code === "not_found" || !orderId)) backTo(ORDERS_PATH, { error: r.error });
  const back = orderHref(orderId!);
  if (r.ok || r.code === "conflict") {
    revalidatePath(ORDERS_PATH);
    revalidatePath(back);
  }
  backTo(back, r.ok ? { ok: r.message } : { error: r.error });
}

export async function stopOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(formData, await runStopOrder(formData, siteActor(user)));
}

export async function extendOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  finish(formData, await runExtendOrder(formData, siteActor(user)));
}
