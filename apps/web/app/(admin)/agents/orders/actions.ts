"use server";

import { revalidatePath } from "next/cache";
import { audit, prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import {
  ORDERS_PATH,
  canExtend,
  canManageOrders,
  canStop,
  orderEngineResult,
  orderHref,
  orderTitle,
  parseExtendDays,
  safeOrderId,
} from "@/lib/agents/orders";
import { loadOrdersEngine } from "@/lib/agents/orders-engine";
import { backTo, errorText, isRedirectError } from "@/lib/agents/redirect";
import { requireUser } from "@/lib/session";

/**
 * Actions de la fiche d'un ordre (Agents → Ordres, phase 33), réservées aux administrateurs :
 * - « Arrêter » : `stopOrder` annule les missions non commencées et clôt le réglage temporaire du canal ;
 * - « Prolonger de N jours » : `extendOrder` repousse la fin de l'ordre.
 * Les fonctions viennent du Grand Chef (`packages/agents/src/orders/run.ts`) ; chaque geste est noté dans le journal
 * des actions (`AuditLog`, entité `TeamOrder`), qu'il réussisse ou non.
 */

const NOT_YET = "Pas encore disponible : réessayez après la prochaine mise à jour du site.";

async function orderOf(id: string) {
  return prisma.teamOrder.findUnique({ where: { id }, select: { id: true, number: true, status: true } });
}

export async function stopOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orderId = safeOrderId(formData.get("orderId"));
  if (!orderId) backTo(ORDERS_PATH, { error: "Ordre inconnu." });
  const back = orderHref(orderId);
  if (!canManageOrders(user.role)) backTo(back, { error: "Arrêter un ordre est réservé aux administrateurs." });
  const order = await orderOf(orderId);
  if (!order) backTo(ORDERS_PATH, { error: "Cet ordre n'existe plus." });
  const title = orderTitle(order.number);
  if (!canStop(String(order.status))) backTo(back, { error: `${title} est déjà terminé ou arrêté : rien à arrêter.` });

  let result = { ok: false, message: "" };
  try {
    const engine = await loadOrdersEngine();
    if (!engine.stopOrder) backTo(back, { error: NOT_YET });
    result = orderEngineResult(
      await engine.stopOrder(buildAgentsDeps(), orderId, { userId: user.id, via: "SITE" }, "arrêté depuis le site"),
      `${title} arrêté : les missions pas encore commencées sont annulées, le canal reprend son plan habituel.`,
    );
    await audit({
      userId: user.id,
      action: "agents.order_stopped",
      entityType: "TeamOrder",
      entityId: orderId,
      metadata: { number: order.number, previousStatus: String(order.status), ok: result.ok },
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(back, { error: `Arrêt impossible pour l'instant : ${errorText(err)}.` });
  }
  revalidatePath(ORDERS_PATH);
  revalidatePath(back);
  if (!result.ok) backTo(back, { error: result.message });
  backTo(back, { ok: result.message });
}

export async function extendOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orderId = safeOrderId(formData.get("orderId"));
  if (!orderId) backTo(ORDERS_PATH, { error: "Ordre inconnu." });
  const back = orderHref(orderId);
  if (!canManageOrders(user.role)) backTo(back, { error: "Prolonger un ordre est réservé aux administrateurs." });
  const days = parseExtendDays(formData.get("days"));
  if (!days) backTo(back, { error: "Choisissez un nombre de jours entre 1 et 30." });
  const order = await orderOf(orderId);
  if (!order) backTo(ORDERS_PATH, { error: "Cet ordre n'existe plus." });
  const title = orderTitle(order.number);
  if (!canExtend(String(order.status))) backTo(back, { error: `Seul un ordre en cours se prolonge : ${title} ne l'est pas.` });

  let result = { ok: false, message: "" };
  try {
    const engine = await loadOrdersEngine();
    if (!engine.extendOrder) backTo(back, { error: NOT_YET });
    result = orderEngineResult(
      await engine.extendOrder(buildAgentsDeps(), orderId, days, { userId: user.id, via: "SITE" }),
      `${title} prolongé de ${days} jour${days > 1 ? "s" : ""}.`,
    );
    await audit({
      userId: user.id,
      action: "agents.order_extended",
      entityType: "TeamOrder",
      entityId: orderId,
      metadata: { number: order.number, days, ok: result.ok },
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    backTo(back, { error: `Prolongation impossible pour l'instant : ${errorText(err)}.` });
  }
  revalidatePath(ORDERS_PATH);
  revalidatePath(back);
  if (!result.ok) backTo(back, { error: result.message });
  backTo(back, { ok: result.message });
}
