import { prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { csvDate, toCsv } from "@/lib/members/csv";
import { actionLabel, journalWhere, parseJournalFilters } from "@/lib/journal/query";
import { eventLabel } from "@/lib/journal/event-labels";
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
      actionLabel(l.action),
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
      occurredAt: true,
      type: true,
      bot: { select: { username: true } },
      channel: { select: { title: true } },
      member: { select: { id: true, username: true, firstName: true, anonymizedAt: true } },
    },
  });
  const csv = toCsv(
    ["Quand (Paris)", "Type", "Code", "Bot", "Canal", "Membre", "Identifiant membre"],
    events.map((e) => [
      csvDate(e.occurredAt),
      eventLabel(e.type),
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
