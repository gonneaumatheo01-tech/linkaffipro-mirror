import { statsCsv } from "@/lib/conversations/csv";
import { loadConversationStats } from "@/lib/conversations/stats-queries";
import { periodLabelWithDates, resolvePeriod } from "@/lib/periods";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Export CSV des chiffres de l'assistant de conversation (bouton « Exporter » de /conversations/stats) : même période
 * que la page (`range`, `from`, `to`) ; le total, puis une ligne par persona et une ligne par source.
 */
export async function GET(req: Request) {
  await requireUser();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const period = resolvePeriod(sp);
  const stats = await loadConversationStats(period);
  return new Response(statsCsv(stats, periodLabelWithDates(period)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chiffres-conversations-${period.from}-${period.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
