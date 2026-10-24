import { statsCsv } from "@/lib/conversations/csv";
import { parseStatsUniverse } from "@/lib/conversations/stats";
import { loadConversationStats } from "@/lib/conversations/stats-queries";
import { periodLabelWithDates, resolvePeriod } from "@/lib/periods";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Export CSV des chiffres de l'assistant de conversation (bouton « Exporter » de /conversations/stats) : même période
 * que la page (`range`, `from`, `to`) et même univers (`universe`) ; le total, puis une ligne par univers, par persona
 * et par source.
 */
export async function GET(req: Request) {
  await requireUser();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const period = resolvePeriod(sp);
  const universe = parseStatsUniverse(sp.universe);
  const stats = await loadConversationStats(period, { universe });
  return new Response(statsCsv(stats, periodLabelWithDates(period)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chiffres-conversations-${period.from}-${period.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
