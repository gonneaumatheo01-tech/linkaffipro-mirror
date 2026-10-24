import { cn } from "@/components/ui/cn";
import { fmtMoney, fmtNum } from "@/lib/format";
import {
  RESULT_COLUMNS,
  hasResults,
  spendRows,
  todayFigures,
  type TeamOverview,
} from "@/lib/agents/overview-view";
import { TEAM_NAMES, type TeamKey } from "@/lib/agents/teams";

const BAR_TONES = { brand: "bg-brand-ink", warning: "bg-warning", danger: "bg-danger" } as const;
const FIGURE_TONES = { warning: "text-warning", danger: "text-danger" } as const;

/**
 * Partie « chiffres » de la carte d'une équipe (phase 25) : missions du jour, dépense du mois par poste avec plafond et
 * projection, résultats des posts sur 7 et 28 jours (mêmes règles que Statistiques). Données du résumé du moteur.
 */
export function TeamOverviewFigures({ team, overview }: { team: TeamKey; overview: TeamOverview }) {
  const spend = spendRows(overview);
  const name = TEAM_NAMES[team];
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h3 className="text-note font-medium text-muted-foreground">Missions du jour</h3>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-6">
          {todayFigures(overview).map((f) => (
            <div key={f.key} className="space-y-0.5">
              <dt className="text-note text-muted-foreground">{f.label}</dt>
              <dd
                className={cn(
                  "text-title font-semibold tabular-nums",
                  f.tone ? FIGURE_TONES[f.tone] : "text-foreground",
                )}
              >
                {fmtNum(f.value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-2">
        <h3 className="text-note font-medium text-muted-foreground">Dépense du mois</h3>
        {spend.length === 0 ? (
          <p className="text-note text-muted-foreground">Rien dépensé ce mois-ci.</p>
        ) : (
          <ul className="space-y-2">
            {spend.map((s) => (
              <li key={s.provider} className="space-y-1">
                <p className="flex flex-wrap justify-between gap-x-3 text-note">
                  <span className="text-foreground">{s.label}</span>
                  <span className="tabular-nums text-foreground">{s.text}</span>
                </p>
                {s.pct !== null ? (
                  <span
                    className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`${s.label} : part du plafond du mois utilisée, équipe ${name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={s.pct}
                  >
                    <span className={cn("block h-full rounded-full", BAR_TONES[s.tone])} style={{ width: `${s.pct}%` }} />
                  </span>
                ) : null}
                <p className={cn("text-note", s.tone === "brand" ? "text-muted-foreground" : "text-warning")}>
                  {s.projection}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className="text-note font-medium text-muted-foreground">Résultats des posts de l&apos;équipe</h3>
        {team === "algo" ? (
          <p className="text-note text-muted-foreground">
            Cette équipe ne publie rien : ses réglages appliqués sont listés plus bas.
          </p>
        ) : !hasResults(overview) ? (
          <p className="text-note text-muted-foreground">Aucun post publié sur les 28 derniers jours.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-note">
              <caption className="sr-only">Résultats des posts de l&apos;équipe {name} sur 7 et 28 jours</caption>
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 text-left font-normal">
                    Période
                  </th>
                  {RESULT_COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className="px-2 py-1 text-right font-normal">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["d7", "d28"] as const).map((p) => (
                  <tr key={p} className="border-t border-border">
                    <th scope="row" className="py-1 pr-2 text-left font-normal text-muted-foreground">
                      {p === "d7" ? "7 jours" : "28 jours"}
                    </th>
                    {RESULT_COLUMNS.map((c) => (
                      <td key={c.key} className="px-2 py-1 text-right tabular-nums text-foreground">
                        {c.key === "commissions"
                          ? fmtMoney(overview.results[p].commissions)
                          : fmtNum(overview.results[p][c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
