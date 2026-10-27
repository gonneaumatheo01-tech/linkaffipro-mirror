import Link from "next/link";
import { FormSection } from "@/components/admin/form-section";
import { StatCard } from "@/components/admin/stat-card";
import { channelName, daysText, prospectHref } from "@/lib/agents/prospection/display";
import { PIPELINE_COLUMNS, type PipelineSummary } from "@/lib/agents/prospection/pipeline";
import type { PipelineCard } from "@/lib/agents/prospection/queries";
import { fmtNum, fmtPct } from "@/lib/format";
import { StatusBadge, statusLabel } from "@/lib/status-badges";

/**
 * Vue « Avancement » : une colonne par étape (à contacter → contacté → a répondu → en discussion → signé → actif,
 * puis a arrêté et pas intéressé), avec le nombre de canaux, le temps passé dans l'étape (médiane) et les meilleurs
 * canaux de chaque colonne. Pour changer l'étape d'un canal : sa fiche. Composant serveur.
 */
export function PipelineView({ summary, cards }: { summary: PipelineSummary; cards: Record<string, PipelineCard[]> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Contactés" value={fmtNum(summary.contactedTotal)} />
        <StatCard label="Ont répondu" value={fmtPct(summary.responseRate, 0)} />
        <StatCard label="Signés" value={fmtPct(summary.signRate, 0)} />
        <StatCard label="Du contact à la signature" value={daysText(summary.contactToSigned)} />
      </div>
      <p className="text-note text-muted-foreground">
        Délais en médiane : du contact à la réponse {daysText(summary.contactToResponse)}, de la réponse à la signature {daysText(summary.responseToSigned)}.
      </p>
      <FormSection title="Où en sont les canaux" description="Ouvrez un canal pour changer son étape.">
        <div className="flex gap-3 overflow-x-auto pb-2" role="region" aria-label="Colonnes de l'avancement" tabIndex={0}>
          {PIPELINE_COLUMNS.map((status) => {
            const list = cards[status] ?? [];
            const count = summary.counts[status] ?? 0;
            const days = summary.medianDaysInStatus[status] ?? null;
            return (
              <section key={status} aria-label={statusLabel("prospectStatus", status)} className="w-60 shrink-0 space-y-2 rounded-xl border border-border bg-card p-3">
                <header className="flex items-center justify-between gap-2">
                  <StatusBadge kind="prospectStatus" value={status} />
                  <span className="text-body font-semibold tabular-nums">{fmtNum(count)}</span>
                </header>
                <p className="text-note text-muted-foreground">{count ? `Depuis ${daysText(days)} en médiane` : "Aucun canal"}</p>
                <ul className="space-y-1.5">
                  {list.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-note">
                      <Link href={prospectHref(c.id)} className="min-w-0 truncate text-foreground underline-offset-4 hover:underline">
                        {channelName(c)}
                      </Link>
                      {c.tier ? <span className="shrink-0 text-muted-foreground tabular-nums">{c.tier} · {c.score ?? "—"}</span> : null}
                    </li>
                  ))}
                </ul>
                {count > list.length ? <p className="text-note text-muted-foreground">et {fmtNum(count - list.length)} autres</p> : null}
              </section>
            );
          })}
        </div>
      </FormSection>
    </div>
  );
}
