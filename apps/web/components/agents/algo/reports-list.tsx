import { stripHtml } from "@linkaffipro/core";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusPill } from "@/components/admin/status-pill";
import type { ReportView } from "@/lib/agents/algo/queries";
import { teamName } from "@/lib/agents/teams";
import { fmtDate } from "@/lib/format";
import { fmtDayKey } from "@/lib/periods";

/** Rapports « Ce qui marche » archivés : le plus récent ouvert, les autres repliés. */
export function ReportsList({ reports }: { reports: ReportView[] }) {
  if (reports.length === 0)
    return (
      <EmptyState
        title="Aucun rapport pour l'instant"
        description="Le premier rapport part le lundi matin sur Telegram et s'archive ici. Un administrateur peut aussi cliquer sur « Rapport maintenant »."
      />
    );
  return (
    <ul className="space-y-3">
      {reports.map((r, i) => (
        <li key={r.id} className="rounded-xl border border-border bg-card px-4 py-3">
          <details open={i === 0}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">Semaine du {fmtDayKey(r.weekStart)}</span>
              <span className="text-note text-muted-foreground">{r.teamKey === "algo" ? "Toutes les équipes" : teamName(r.teamKey)}</span>
              {r.sentAt ? (
                <StatusPill tone="success" title={`Envoyé le ${fmtDate(r.sentAt)}`}>
                  Envoyé sur Telegram
                </StatusPill>
              ) : (
                <StatusPill tone="muted">Pas encore envoyé</StatusPill>
              )}
            </summary>
            <div className="mt-3 whitespace-pre-line text-body text-foreground">{/* Le rapport est écrit en HTML Telegram : on montre le texte, sans les balises. */}
              {stripHtml(r.content)}</div>
          </details>
        </li>
      ))}
    </ul>
  );
}
