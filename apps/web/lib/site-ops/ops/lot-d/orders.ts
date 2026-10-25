/**
 * Phase 34, lot D — cœurs de la fiche d'un ordre (Agents → Ordres, phase 33), administrateurs seulement : « Arrêter »
 * (`stopOrder` : missions non commencées annulées, réglage temporaire du canal clos) et « Prolonger de N jours »
 * (`extendOrder`). Chaque geste est noté dans le journal (`AuditLog`, entité `TeamOrder`), qu'il réussisse ou non.
 */
import { audit, prisma } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { canExtend, canManageOrders, canStop, orderEngineResult, orderTitle, parseExtendDays, safeOrderId } from "@/lib/agents/orders";
import { loadOrdersEngine } from "@/lib/agents/orders-engine";
import { engineActor, errorText, fail, forbidden, formOf, ok, preview, type CoreRun, type Fail } from "./kit";

const NOT_YET = "Pas encore disponible : réessayez après la prochaine mise à jour du site.";

async function orderOf(id: string) {
  return prisma.teamOrder.findUnique({ where: { id }, select: { id: true, number: true, status: true } });
}

export const runStopOrder: CoreRun = async (fd, actor, opts = {}) => {
  const orderId = safeOrderId(fd.get("orderId"));
  if (!orderId) return fail("Ordre inconnu.", "invalid", "orderId");
  if (!canManageOrders(actor.role)) return forbidden("Arrêter un ordre est réservé aux administrateurs.");
  const order = await orderOf(orderId);
  if (!order) return fail("Cet ordre n'existe plus.", "not_found");
  const title = orderTitle(order.number);
  if (!canStop(String(order.status))) return fail(`${title} est déjà terminé ou arrêté : rien à arrêter.`, "conflict");
  if (opts.dryRun)
    return preview(`Arrêter ${title} : les missions pas encore commencées sont annulées, le canal reprend son plan habituel.`);
  let result = { ok: false, message: "" };
  try {
    const engine = await loadOrdersEngine();
    if (!engine.stopOrder) return fail(NOT_YET, "unavailable");
    result = orderEngineResult(
      await engine.stopOrder(
        buildAgentsDeps(),
        orderId,
        engineActor(actor),
        actor.via === "TELEGRAM" ? "arrêté par l'admin" : "arrêté depuis le site",
      ),
      `${title} arrêté : les missions pas encore commencées sont annulées, le canal reprend son plan habituel.`,
    );
    await audit({
      userId: actor.userId,
      action: "agents.order_stopped",
      entityType: "TeamOrder",
      entityId: orderId,
      metadata: { number: order.number, previousStatus: String(order.status), ok: result.ok, via: actor.via },
    });
  } catch (err) {
    return fail(`Arrêt impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return result.ok ? ok(result.message) : fail(result.message, "conflict");
};

export const runExtendOrder: CoreRun = async (fd, actor, opts = {}) => {
  const orderId = safeOrderId(fd.get("orderId"));
  if (!orderId) return fail("Ordre inconnu.", "invalid", "orderId");
  if (!canManageOrders(actor.role)) return forbidden("Prolonger un ordre est réservé aux administrateurs.");
  const days = parseExtendDays(fd.get("days"));
  if (!days) return fail("Choisissez un nombre de jours entre 1 et 30.", "invalid", "days");
  const order = await orderOf(orderId);
  if (!order) return fail("Cet ordre n'existe plus.", "not_found");
  const title = orderTitle(order.number);
  if (!canExtend(String(order.status))) return fail(`Seul un ordre en cours se prolonge : ${title} ne l'est pas.`, "conflict");
  const words = `${days} jour${days > 1 ? "s" : ""}`;
  if (opts.dryRun) return preview(`Prolonger ${title} de ${words}.`);
  let result = { ok: false, message: "" };
  try {
    const engine = await loadOrdersEngine();
    if (!engine.extendOrder) return fail(NOT_YET, "unavailable");
    result = orderEngineResult(await engine.extendOrder(buildAgentsDeps(), orderId, days, engineActor(actor)), `${title} prolongé de ${words}.`);
    await audit({
      userId: actor.userId,
      action: "agents.order_extended",
      entityType: "TeamOrder",
      entityId: orderId,
      metadata: { number: order.number, days, ok: result.ok, via: actor.via },
    });
  } catch (err) {
    return fail(`Prolongation impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  return result.ok ? ok(result.message) : fail(result.message, "conflict");
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

/** Ordre par numéro (« l'ordre 3 ») ou identifiant ; `jours` pour prolonger. */
export async function kevinOrderForm(input: Record<string, unknown>): Promise<{ ok: true; fd: FormData } | { ok: false; result: Fail }> {
  const { resolveOrder } = await import("./resolve");
  const r = await resolveOrder(input.ordre ?? input.orderId ?? input.numero);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ orderId: r.id, days: input.jours ?? input.days }) };
}
