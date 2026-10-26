import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { FilterChips } from "@/components/admin/filter-chips";
import { FormSection } from "@/components/admin/form-section";
import { StatCard } from "@/components/admin/stat-card";
import { TimeChart } from "@/components/charts/time-chart";
import {
  averageLatencyMs,
  byTeam,
  byType,
  countsOf,
  dailyRates,
  fmtSeconds,
  hourlyRates,
  qualiteHref,
  type GroupRow,
  type QaCheckLite,
  type QualiteStep,
} from "@/lib/agents/qualite";
import { parisDayKey } from "@/lib/posts/time";
import { fmtNum, fmtPct } from "@/lib/format";
import { statusLabel } from "@/lib/status-badges";

/** Tableau « par équipe » ou « par type » : vérifiés, part acceptée, refusés, bloqués, temps moyen. */
export function GroupTable({ rows, caption, first }: { rows: GroupRow[]; caption: string; first: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-note">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="py-1 pr-2 text-left font-normal">
              {first}
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Vérifiés
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Acceptés
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Refusés
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Bloqués
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Temps moyen
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} className="border-t border-border">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-foreground">
                {g.label}
              </th>
              <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{fmtNum(g.total)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{fmtPct(g.rate, 0)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{fmtNum(g.rejected)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{fmtNum(g.timeout + g.error)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{fmtSeconds(g.latencyMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Vue « Tableau de bord » : part des contenus acceptés aujourd'hui et sur 7 jours, courbe par jour ou par heure, temps
 * moyen d'une vérification, blocages faute de contrôle, puis les chiffres par équipe et par type de contenu.
 */
export function QualiteDashboardView({ rows, now, step }: { rows: QaCheckLite[]; now: Date; step: QualiteStep }) {
  if (rows.length === 0)
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Rien de vérifié ces 7 derniers jours"
        description="Dès qu'une équipe produit un post, un short, un rapport ou une recommandation, le contrôle qualité le vérifie et ses chiffres arrivent ici."
      />
    );
  const today = parisDayKey(now);
  const day = countsOf(rows.filter((r) => parisDayKey(r.createdAt) === today));
  const week = countsOf(rows);
  const latency = averageLatencyMs(rows);
  const series = step === "heure" ? hourlyRates(rows, now) : dailyRates(rows, now);
  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Acceptés aujourd'hui"
          value={fmtPct(day.rate, 0)}
          hint={`${fmtNum(day.total)} vérifié${day.total > 1 ? "s" : ""}, ${fmtNum(day.rejected)} refusé${day.rejected > 1 ? "s" : ""}`}
        />
        <StatCard
          label="Acceptés sur 7 jours"
          value={fmtPct(week.rate, 0)}
          hint={`${fmtNum(week.total)} vérifié${week.total > 1 ? "s" : ""}, ${fmtNum(week.rejected)} refusé${week.rejected > 1 ? "s" : ""}`}
        />
        <StatCard label="Temps moyen d'une vérification" value={fmtSeconds(latency)} hint="30 secondes au plus, sinon le contenu est bloqué" />
        <StatCard
          label="Bloqués faute de contrôle"
          value={fmtNum(week.error + week.timeout)}
          hint={`${fmtNum(week.error)} contrôle indisponible, ${fmtNum(week.timeout)} contrôle trop long (7 jours)`}
        />
      </div>

      <FormSection
        title="Part des contenus acceptés"
        description="Sur les 7 derniers jours. Un jour ou une heure sans vérification n'est pas dessiné."
      >
        <FilterChips
          label="Pas"
          chips={[
            { key: "jour", label: "Par jour", href: qualiteHref("tableau"), selected: step === "jour" },
            { key: "heure", label: "Par heure", href: qualiteHref("tableau", { pas: "heure" }), selected: step === "heure" },
          ]}
        />
        <TimeChart
          title={step === "heure" ? "Part des contenus acceptés heure par heure" : "Part des contenus acceptés jour par jour"}
          period="7 derniers jours"
          labels={series.labels}
          series={[{ id: "rate", label: "Acceptés", values: series.rates, tone: "current" }]}
          format="ratio"
          kind={step === "heure" ? "bar" : "line"}
          unitLabel={step === "heure" ? "Heure" : "Jour"}
          valuesSummary={step === "heure" ? "Voir les chiffres heure par heure" : "Voir les chiffres jour par jour"}
        />
      </FormSection>

      <FormSection title="Par équipe" description="Équipe qui a produit le contenu, sur 7 jours.">
        <GroupTable rows={byTeam(rows)} caption="Vérifications par équipe sur 7 jours" first="Équipe" />
      </FormSection>

      <FormSection title="Par type de contenu" description="Posts, shorts, rapports, recommandations, alertes, réponses de Kevin, sur 7 jours.">
        <GroupTable rows={byType(rows, (t) => statusLabel("qaContentType", t))} caption="Vérifications par type de contenu sur 7 jours" first="Type" />
      </FormSection>
    </div>
  );
}
