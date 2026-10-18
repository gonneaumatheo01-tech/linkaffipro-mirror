import { apiUser } from "@/lib/ai/api-user";
import { inboxCsv } from "@/lib/conversations/csv";
import { parseInboxFilters } from "@/lib/conversations/filters";
import { exportConversations } from "@/lib/conversations/inbox";

export const dynamic = "force-dynamic";

/**
 * Export CSV de la boîte de réception (bouton « Exporter » de /conversations) : mêmes filtres que la liste (étape, qui
 * répond, source, persona, non lues), 5 000 conversations au plus, les plus récentes d'abord. Une ligne par
 * conversation, sans aucun texte de la conversation (qui, où, quand et les chiffres). Utilisateurs connectés et actifs
 * seulement (`apiUser`, 401 sinon).
 */
export async function GET(req: Request) {
  if (!(await apiUser())) return new Response("Non connecté.", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const rows = await exportConversations(parseInboxFilters(sp));
  const date = new Date().toISOString().slice(0, 10);
  return new Response(inboxCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="conversations-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
