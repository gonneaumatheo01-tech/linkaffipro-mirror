import { TrendingDown } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { BarList } from "@/components/charts/bar-list";
import { TimeChart } from "@/components/charts/time-chart";
import { dailyRefusals, mostRejectedTeams, topReasons, weekOverWeek, type QaCheckLite, type QaCounts } from "@/lib/agents/qualite";
import { fmtNum, fmtPct } from "@/lib/format";

const refusalShare = (c: QaCounts) => (c.total ? c.rejected / c.total : null);

function weekSentence(current: QaCounts, previous: QaCounts): string {
  const now = `${fmtNum(current.rejected)} refus sur ${fmtNum(current.total)} vérification${current.total > 1 ? "s" : ""} (${fmtPct(refusalShare(current), 0)})`;
  if (!previous.total) return `7 derniers jours : ${now}. Rien de vérifié la semaine d'avant.`;
  return `7 derniers jours : ${now}. Semaine d'avant : ${fmtNum(previous.rejected)} refus sur ${fmtNum(previous.total)} (${fmtPct(refusalShare(previous), 0)}).`;
}

/**
 * Vue « Tendances » (28 jours) : les motifs de refus les plus fréquents, les équipes les plus refusées, les refus jour
 * par jour et la comparaison avec la semaine d'avant.
 */
export function QualiteTrendsView({ rows, now }: { rows: QaCheckLite[]; now: Date }) {
  const reasons = topReasons(rows, 5);
  const teams = mostRejectedTeams(rows, 5);
  const curve = dailyRefusals(rows, now, 28);
  const wow = weekOverWeek(rows, now);
  if (!rows.some((r) => r.verdict === "REJECTED"))
    return (
      <EmptyState
        icon={<TrendingDown />}
        title="Aucun refus sur 4 semaines"
        description={rows.length ? "Tout ce qui a été vérifié est passé : rien à analyser pour le moment." : "Rien n'a encore été vérifié."}
      />
    );
  return (
    <div className="space-y-8">
      <p className="text-body text-foreground">{weekSentence(wow.current, wow.previous)}</p>

      <FormSection title="Motifs de refus les plus fréquents" description="Sur 4 semaines ; un refus compte une fois par motif bloquant.">
        <BarList
          label="Motifs de refus les plus fréquents"
          items={reasons.map((r) => ({ key: r.label, label: r.label, value: r.count, valueText: `${fmtNum(r.count)} refus` }))}
        />
      </FormSection>

      <FormSection title="Équipes les plus refusées" description="Nombre de refus et part refusée de ce que l'équipe a produit, sur 4 semaines.">
        <BarList
          label="Équipes les plus refusées"
          items={teams.map((t) => ({
            key: t.key,
            label: t.label,
            value: t.rejected,
            valueText: `${fmtNum(t.rejected)} refus`,
            note: `${fmtPct(t.total ? t.rejected / t.total : null, 0)} de ${fmtNum(t.total)}`,
          }))}
        />
      </FormSection>

      <FormSection title="Refus jour par jour" description="Évolution sur les 4 dernières semaines.">
        <TimeChart
          title="Refus du contrôle qualité jour par jour"
          period="28 derniers jours"
          labels={curve.labels}
          series={[{ id: "refusals", label: "Refus", values: curve.refusals, tone: "current" }]}
          format="number"
          integer
          kind="bar"
        />
      </FormSection>
    </div>
  );
}
