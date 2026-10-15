import { prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { csvDate, toCsv } from "@/lib/members/csv";
import { auditActionLabel, journalWhere, parseJournalFilters } from "@/lib/journal/query";
import { eventRowLabels } from "@/lib/journal/event-row-labels";
import { eventsWhere, parseEventFilters } from "@/lib/journal/events";

export const dynamic = "force-dynamic";

const MAX_ROWS = 20_000;

/**
 * Export CSV du journal avec les mêmes filtres que la liste (20 000 lignes maximum, les plus récentes).
 * `view=events` : export de la vue « Événements » (bots et membres) au lieu des actions de l'équipe.
 */
export async function GET(req: Request) {
  await requireUser();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  if (sp.view === "events") return exportEvents(sp);
  const f = parseJournalFilters(sp);
  const logs = await prisma.auditLog.findMany({
    where: journalWhere(f),
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    include: { user: { select: { name: true, email: true } } },
  });
  const csv = toCsv(
    ["Quand (Paris)", "Qui", "E-mail", "Type", "Action", "Objet", "Identifiant", "Détails"],
    logs.map((l) => [
      csvDate(l.createdAt),
      l.user?.name ?? "système",
      l.user?.email ?? "",
      auditActionLabel(l.action, l.metadata),
      l.action,
      l.entityType ?? "",
      l.entityId ?? "",
      l.metadata ? JSON.stringify(l.metadata) : "",
    ]),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="journal-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

async function exportEvents(sp: Record<string, string>): Promise<Response> {
  const events = await prisma.event.findMany({
    where: eventsWhere(parseEventFilters(sp)),
    orderBy: { occurredAt: "desc" },
    take: MAX_ROWS,
    select: {
      id: true,
      occurredAt: true,
      type: true,
      bot: { select: { username: true } },
      channel: { select: { title: true } },
      member: { select: { id: true, username: true, firstName: true, anonymizedAt: true } },
    },
  });
  // Libellés précisés par le détail de l'événement quand il en dépend (phase 14).
  const labels = await eventRowLabels(events);
  const csv = toCsv(
    ["Quand (Paris)", "Type", "Code", "Bot", "Canal", "Membre", "Identifiant membre"],
    events.map((e) => [
      csvDate(e.occurredAt),
      labels.get(e.id)!,
      e.type,
      e.bot ? `@${e.bot.username}` : "",
      e.channel?.title ?? "",
      e.member
        ? e.member.anonymizedAt
          ? "Membre anonymisé"
          : e.member.username
            ? `@${e.member.username}`
            : (e.member.firstName ?? "")
        : "",
      e.member?.id ?? "",
    ]),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="journal-evenements-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
