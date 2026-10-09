import { prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { csvDate, toCsv } from "@/lib/members/csv";
import { actionLabel, journalWhere, parseJournalFilters } from "@/lib/journal/query";

export const dynamic = "force-dynamic";

const MAX_ROWS = 20_000;

/** Export CSV du journal avec les mêmes filtres que la liste (20 000 lignes maximum, les plus récentes). */
export async function GET(req: Request) {
  await requireUser();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseJournalFilters(sp);
  const logs = await prisma.auditLog.findMany({ where: journalWhere(f), orderBy: { createdAt: "desc" }, take: MAX_ROWS, include: { user: { select: { name: true, email: true } } } });
  const csv = toCsv(
    ["Quand (Paris)", "Qui", "E-mail", "Type", "Action", "Objet", "Identifiant", "Détails"],
    logs.map((l) => [csvDate(l.createdAt), l.user?.name ?? "système", l.user?.email ?? "", actionLabel(l.action), l.action, l.entityType ?? "", l.entityId ?? "", l.metadata ? JSON.stringify(l.metadata) : ""]),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journal-${date}.csv"`, "Cache-Control": "no-store" },
  });
}
