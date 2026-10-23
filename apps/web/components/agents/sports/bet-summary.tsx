import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { PeriodSelect } from "@/components/admin/period-select";
import { TabNav } from "@/components/admin/tab-nav";
import type { BetSummaryRow } from "@linkaffipro/agents";
import { SUMMARY_BY, fmtOdds, fmtSignedPct, summaryRowLabel, summaryTotal, type SummaryBy } from "@/lib/agents/sports";
import { fmtNum, fmtPct } from "@/lib/format";
import { periodLabelWithDates, periodParams, type Period } from "@/lib/periods";

/** Bilan des paris publiés : par catégorie, ligue, bookmaker ou semaine, sur la période commune. */
export function BetSummary({
  rows,
  by,
  period,
}: {
  rows: BetSummaryRow[] | null;
  by: SummaryBy;
  period: Period;
}) {
  const pp = periodParams(period);
  const total = rows && rows.length > 1 ? summaryTotal(rows) : null;
  const dimension = SUMMARY_BY.find((b) => b.value === by)!.label.replace(/^Par /, "");
  return (
    <FormSection
      id="bilan"
      title="Bilan des paris"
      description={`${periodLabelWithDates(period)} · paris publiés, réglés après le match. Taux de réussite = gagnés ÷ (gagnés + perdus) ; rendement = ce qu'aurait rapporté la même mise sur chaque pari.`}
      className="scroll-mt-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TabNav
          label="Regrouper le bilan"
          current={by}
          items={SUMMARY_BY.map((b) => ({
            key: b.value,
            href: `/agents/sports?${new URLSearchParams({ ...pp, bilan: b.value }).toString()}#bilan`,
            label: b.label,
          }))}
        />
        <PeriodSelect period={period} compare={false} action="/agents/sports" extra={{ bilan: by }} />
      </div>
      {rows === null ? (
        <p className="text-body text-muted-foreground">
          Le bilan ne peut pas être calculé pour l&apos;instant : rechargez la page dans quelques minutes.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Aucun pari publié sur cette période"
          description="Le bilan se remplit dès que les premiers paris publiés sont réglés (toutes les 2 heures après les matchs)."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-body">
            <caption className="sr-only">Bilan des paris, {dimension.toLowerCase()}</caption>
            <thead>
              <tr className="border-b border-border text-left text-note text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">
                  {dimension.charAt(0).toUpperCase() + dimension.slice(1)}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Publiés</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Gagnés</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Perdus</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Annulés</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Taux de réussite</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Cote moyenne</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Term term="Rendement à mise constante : (gains − mises) ÷ mises">Rendement</Term>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...rows.map((r) => ({ ...r, label: summaryRowLabel(by, r) })), ...(total ? [{ ...total, key: "__total", label: "Total" }] : [])].map(
                (r) => (
                  <tr
                    key={r.key}
                    className={r.key === "__total" ? "border-t-2 border-border font-semibold" : "border-b border-border last:border-0"}
                  >
                    <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                      {r.label}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.published)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.won)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.lost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.void)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.hitRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtOdds(r.avgOdds)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${r.roi !== null && r.roi < 0 ? "text-danger" : "text-foreground"}`}
                    >
                      {fmtSignedPct(r.roi)}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-note text-muted-foreground">
        Un bilan passé ne promet rien pour la suite : les posts ne présentent jamais un pari comme sûr.
      </p>
    </FormSection>
  );
}
