import { prisma } from "@linkaffipro/db";

/**
 * Met à jour les compteurs d'un envoi groupé après l'issue d'un message privé, et le clôture (SENT)
 * quand plus aucun message n'est en attente. Appelé par `sendDm` ; ne lève jamais.
 */
export async function recordBroadcastOutcome(broadcastId: string | null | undefined, status: "SENT" | "FAILED" | "BLOCKED"): Promise<void> {
  if (!broadcastId) return;
  try {
    const inc = status === "SENT" ? { sent: { increment: 1 } } : status === "BLOCKED" ? { blocked: { increment: 1 } } : { failed: { increment: 1 } };
    await prisma.broadcast.update({ where: { id: broadcastId }, data: inc });
    await closeIfFinished(broadcastId);
  } catch {
    /* compteurs non bloquants */
  }
}

/** Clôture un envoi SENDING sans message en attente (recalcule les compteurs depuis les messages). */
export async function closeIfFinished(broadcastId: string): Promise<boolean> {
  const b = await prisma.broadcast.findUnique({ where: { id: broadcastId }, select: { status: true, targeted: true } });
  if (!b || b.status !== "SENDING") return false;
  const queued = await prisma.outboundMessage.count({ where: { broadcastId, status: "QUEUED" } });
  if (queued > 0) return false;
  const groups = await prisma.outboundMessage.groupBy({ by: ["status"], where: { broadcastId }, _count: { _all: true } });
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "SENT", finishedAt: new Date(), sent: n("SENT"), failed: n("FAILED"), blocked: n("BLOCKED") } });
  return true;
}

/** Tick : ferme les envois SENDING démarrés depuis plus d'une minute dont plus rien n'est en attente. */
export async function closeFinishedBroadcasts(now: Date = new Date()): Promise<string[]> {
  const candidates = await prisma.broadcast.findMany({ where: { status: "SENDING", startedAt: { lt: new Date(now.getTime() - 60_000) } }, select: { id: true } });
  const closed: string[] = [];
  for (const c of candidates) if (await closeIfFinished(c.id)) closed.push(c.id);
  return closed;
}
