import { stripHtml } from "@linkaffipro/core";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusPill } from "@/components/admin/status-pill";
import { reportKind } from "@/lib/agents/ads/display";
import type { AdsReportView } from "@/lib/agents/ads/queries";
import { fmtDate } from "@/lib/format";

/** Rapports archivés de l'Agent Ads : le plus récent ouvert, les autres repliés. */
export function AdsReportsList({ reports }: { reports: AdsReportView[] }) {
  if (reports.length === 0)
    return (
      <EmptyState
        title="Aucun rapport pour l'instant"
        description="Le rapport du jour part chaque matin sur Telegram (5 lignes au plus), celui de la semaine le lundi ; ils s'archivent ici."
      />
    );
  return (
    <ul className="space-y-3">
      {reports.map((r, i) => (
        <li key={r.id} className="rounded-xl border border-border bg-card px-4 py-3">
          <details open={i === 0}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">
                {reportKind(r) === "weekly" ? "Rapport de la semaine" : "Rapport du jour"}
              </span>
              <span className="text-note text-muted-foreground">{fmtDate(r.createdAt)}</span>
              {r.sentAt ? (
                <StatusPill tone="success" title={`Envoyé le ${fmtDate(r.sentAt)}`}>
                  Envoyé sur Telegram
                </StatusPill>
              ) : (
                <StatusPill tone="muted">Pas encore envoyé</StatusPill>
              )}
            </summary>
            {/* Le rapport est écrit en HTML Telegram : on montre le texte, sans les balises. */}
            <div className="mt-3 whitespace-pre-line text-body text-foreground">{stripHtml(r.content)}</div>
          </details>
        </li>
      ))}
    </ul>
  );
}
