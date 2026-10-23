import { recommendationAction } from "@/app/(admin)/agents/[equipe]/algo-actions";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import {
  ACTION_WORDS,
  actionsFor,
  canActOnRecommendation,
  evidenceLines,
  fieldLabel,
  isBigRecommendation,
  targetKindLabel,
  valueText,
  type RecommendationView,
} from "@/lib/agents/algo/recommendations";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/** Une proposition : réglage visé, avant → après, preuves, gain attendu et gestes permis. */
export function RecommendationCard({ rec, role, from }: { rec: RecommendationView; role: string; from: string }) {
  const actions = actionsFor(rec.status);
  const allowed = canActOnRecommendation(role, rec);
  const evidence = evidenceLines(rec.evidence);
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{fieldLabel(rec.field)}</span>
        <span className="text-note text-muted-foreground">
          {targetKindLabel(rec.target)} : {rec.targetLabel}
        </span>
        <StatusBadge kind="recommendation" value={rec.status} />
        {isBigRecommendation(rec) ? <StatusPill tone="neutral">Gros réglage</StatusPill> : null}
      </div>
      <p className="text-body text-foreground">
        <span className="text-muted-foreground">Avant :</span> {valueText(rec.field, rec.before)}{" "}
        <span aria-hidden>→</span>
        <span className="sr-only">, après :</span> <span className="font-medium">{valueText(rec.field, rec.after)}</span>
      </p>
      {rec.expectedGain ? <p className="text-note text-foreground">Gain attendu : {rec.expectedGain}</p> : null}
      {evidence.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-note text-muted-foreground" aria-label="Preuves">
          {evidence.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-note text-muted-foreground">
        Proposé le {fmtDate(rec.createdAt)}
        {rec.appliedAt ? ` · appliqué le ${fmtDate(rec.appliedAt)}${rec.appliedBy === "GRAND_CHEF" ? " par le Grand Chef" : ""}` : ""}
        {rec.undoneAt ? ` · annulé le ${fmtDate(rec.undoneAt)}` : ""}
        {rec.rejectedAt ? ` · refusé le ${fmtDate(rec.rejectedAt)}` : ""}
      </p>
      {actions.length > 0 ? (
        allowed ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <form key={a} action={recommendationAction}>
                <input type="hidden" name="id" value={rec.id} />
                <input type="hidden" name="action" value={a} />
                <input type="hidden" name="from" value={from} />
                <Button type="submit" size="sm" variant={a === "apply" ? "secondary" : "outline"} className="max-md:h-10">
                  {ACTION_WORDS[a].button}
                </Button>
              </form>
            ))}
          </div>
        ) : (
          <p className="text-note text-muted-foreground">Réservé aux administrateurs (réglage de persona ou quota).</p>
        )
      ) : null}
    </li>
  );
}

/** Propositions de la semaine d'abord, puis l'historique (appliqués, annulés, refusés). */
export function RecommendationsList({
  recs,
  role,
  from,
  emptyText = "L'équipe Algorithme n'a encore rien proposé : ses propositions arrivent chaque lundi, avec leurs preuves.",
}: {
  recs: RecommendationView[];
  role: string;
  from: string;
  emptyText?: string;
}) {
  if (recs.length === 0) return <EmptyState title="Aucune proposition" description={emptyText} />;
  const open = recs.filter((r) => r.status === "PROPOSED");
  const applied = recs.filter((r) => r.status === "APPLIED");
  const past = recs.filter((r) => r.status !== "PROPOSED" && r.status !== "APPLIED");
  return (
    <div className="space-y-6">
      {[
        { title: "À décider", list: open },
        { title: "Appliqués (annulables en un clic)", list: applied },
        { title: "Annulés ou refusés", list: past.slice(0, 20) },
      ]
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <div key={g.title} className="space-y-2">
            <h3 className="text-body font-semibold text-foreground">
              {g.title} <span className="font-normal text-muted-foreground">({g.list.length})</span>
            </h3>
            <ul className="space-y-3">
              {g.list.map((r) => (
                <RecommendationCard key={r.id} rec={r} role={role} from={from} />
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
