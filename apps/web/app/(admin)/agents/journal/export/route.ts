import { missionsCsv, runsCsv } from "@/lib/agents/csv";
import { JOURNAL_EXPORT_MAX, parseJournalFilters } from "@/lib/agents/journal";
import { loadMissions, loadRuns } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Export CSV du journal des agents (bouton « Exporter » de /agents/journal) : missions ou passages des agents, mêmes
 * filtres que la page, 5 000 lignes au plus. Jamais le texte d'un post.
 */
export async function GET(req: Request) {
  await requireUser();
  const f = parseJournalFilters(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const now = new Date();
  const opts = { teamKey: f.team, take: JOURNAL_EXPORT_MAX };
  const csv =
    f.view === "runs"
      ? runsCsv((await loadRuns(f, now, opts)).rows)
      : missionsCsv(
          (await loadMissions(f, now, opts)).rows.map((m) => ({
            ...m,
            currentAgent: m.steps[m.currentStep]?.agent ?? null,
          })),
        );
  const day = now.toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agents-${f.view === "runs" ? "passages" : "missions"}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
