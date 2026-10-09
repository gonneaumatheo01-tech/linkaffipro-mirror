import { prisma, type BroadcastStatus } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import { BROADCAST_STATUS_LABELS, progressOf } from "@/lib/broadcasts/queries";

export const dynamic = "force-dynamic";

/** Export CSV des envois groupés (filtre `status` conservé) : ciblés, envoyés, échoués, bloqués, clics des boutons traqués. */
export async function GET(req: Request) {
  await requireUser();
  const status = new URL(req.url).searchParams.get("status") ?? "";
  const where = status && status in BROADCAST_STATUS_LABELS ? { status: status as BroadcastStatus } : {};
  const [broadcasts, links] = await Promise.all([
    prisma.broadcast.findMany({ where, orderBy: { createdAt: "desc" }, take: 5000, include: { bot: { select: { username: true } }, createdBy: { select: { name: true } } } }),
    prisma.trackingLink.findMany({ where: { post: { templateName: { startsWith: "broadcast:" } } }, select: { clicks: true, uniqueClicks: true, post: { select: { templateName: true } } } }),
  ]);
  const clicksBy = new Map<string, { clicks: number; unique: number }>();
  for (const l of links) {
    const id = l.post?.templateName?.slice("broadcast:".length);
    if (!id) continue;
    const c = clicksBy.get(id) ?? { clicks: 0, unique: 0 };
    c.clicks += l.clicks;
    c.unique += l.uniqueClicks;
    clicksBy.set(id, c);
  }
  const csv = toCsv(
    ["Nom", "Bot", "Statut", "Test A/B", "Créé le (Paris)", "Par", "Programmé (Paris)", "Démarré (Paris)", "Terminé (Paris)", "Ciblés", "Envoyés", "Échoués", "Bloqués", "Progression (%)", "Clics", "Cliqueurs uniques", "Taux de clic"],
    broadcasts.map((b) => {
      const c = clicksBy.get(b.id) ?? { clicks: 0, unique: 0 };
      return [
        b.name,
        `@${b.bot.username}`,
        BROADCAST_STATUS_LABELS[b.status] ?? b.status,
        b.abGroupId ? (b.abVariant === "REST" ? "envoi au reste" : `version ${b.abVariant ?? ""}${b.abSplit !== null ? ` (${b.abSplit} %)` : ""}`) : "",
        csvDate(b.createdAt),
        b.createdBy?.name ?? "",
        csvDate(b.scheduledAt),
        csvDate(b.startedAt),
        csvDate(b.finishedAt),
        b.targeted,
        b.sent,
        b.failed,
        b.blocked,
        progressOf(b).pct,
        c.clicks,
        c.unique,
        b.sent > 0 ? csvNumber((c.unique / b.sent) * 100, 1) + " %" : "",
      ];
    }),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="envois-${date}.csv"`, "Cache-Control": "no-store" },
  });
}
