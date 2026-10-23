import { BarList } from "@/components/charts/bar-list";
import { EmptyState } from "@/components/admin/empty-state";
import {
  metricLabel,
  metricValueText,
  progressText,
  sideResult,
  variantLabel,
  verdictText,
  type ExperimentView,
} from "@/lib/agents/algo/experiments";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

function ExperimentCard({ e }: { e: ExperimentView }) {
  const a = sideResult(e.result, "A");
  const b = sideResult(e.result, "B");
  const verdict = verdictText(e);
  const hasNumbers = a.value !== null || b.value !== null;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="experimentKind" value={e.kind} />
        <StatusBadge kind="experiment" value={e.status} />
        {e.targetLabel ? <span className="text-note text-muted-foreground">{e.targetLabel}</span> : null}
      </div>
      <p className="text-body text-foreground">{e.hypothesis}</p>
      <p className="text-note text-muted-foreground">
        Mesure : {metricLabel(e.metric)}
        {e.startedAt ? ` · depuis le ${fmtDate(e.startedAt)}` : ""}
        {e.endsAt && e.status === "RUNNING" ? ` · fin prévue le ${fmtDate(e.endsAt)}` : ""}
        {e.closedAt ? ` · clos le ${fmtDate(e.closedAt)}` : ""}
      </p>
      {hasNumbers ? (
        <BarList
          label={`Résultat du test : ${metricLabel(e.metric)}`}
          labelWidth="wide"
          items={(["A", "B"] as const).map((side) => {
            const r = side === "A" ? a : b;
            return {
              key: side,
              label: `${side} · ${variantLabel(e.variants, side)}`,
              value: r.value ?? 0,
              valueText: metricValueText(e.metric, r.value),
              note: r.n !== null ? `${r.n.toLocaleString("fr-FR")} cas mesurés` : undefined,
              emphasis: e.status === "CLOSED" && e.winner === side,
            };
          })}
        />
      ) : (
        <ul className="text-note text-foreground">
          <li>A · {variantLabel(e.variants, "A")}</li>
          <li>B · {variantLabel(e.variants, "B")}</li>
        </ul>
      )}
      {verdict ? (
        <p className="text-body font-medium text-foreground">{verdict}</p>
      ) : e.status === "RUNNING" ? (
        <p className="text-note text-muted-foreground">{progressText(e)}.</p>
      ) : null}
    </li>
  );
}

/** Tests en cours (et proposés), puis tests clos avec leur verdict. */
export function ExperimentsList({ experiments }: { experiments: ExperimentView[] }) {
  if (experiments.length === 0)
    return (
      <EmptyState
        title="Aucun test A/B pour l'instant"
        description="Quand un cas n'a pas assez de données pour conclure, l'équipe monte un test de deux versions (légende, heure, mélange) le lundi."
      />
    );
  const running = experiments.filter((e) => e.status === "RUNNING" || e.status === "PROPOSED");
  const closed = experiments.filter((e) => e.status === "CLOSED" || e.status === "CANCELLED");
  return (
    <div className="space-y-6">
      {[
        { title: "En cours", list: running },
        { title: "Clos", list: closed.slice(0, 20) },
      ]
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <div key={g.title} className="space-y-2">
            <h3 className="text-body font-semibold text-foreground">
              {g.title} <span className="font-normal text-muted-foreground">({g.list.length})</span>
            </h3>
            <ul className="space-y-3">
              {g.list.map((e) => (
                <ExperimentCard key={e.id} e={e} />
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
