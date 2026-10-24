import { undoInspirationAction } from "@/app/(admin)/agents/inspiration/actions";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import type { RecommendationView } from "@/lib/agents/algo/recommendations";
import { evidenceLines, targetKindLabel } from "@/lib/agents/algo/recommendations";
import {
  UNDO_WINDOW_DAYS,
  canUndo,
  inspirationFieldLabel,
  inspirationValueText,
} from "@/lib/agents/inspiration";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

function RecCard({
  rec,
  referenceId,
  isAdmin,
  now,
  profileVersions,
}: {
  rec: RecommendationView;
  referenceId: string;
  isAdmin: boolean;
  now: Date;
  profileVersions: ReadonlyMap<string, number>;
}) {
  const evidence = evidenceLines(rec.evidence);
  const undoable = canUndo(rec, now);
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{inspirationFieldLabel(rec.field)}</span>
        <span className="text-note text-muted-foreground">
          {targetKindLabel(rec.target)} : {rec.targetLabel}
        </span>
        <StatusBadge kind="recommendation" value={rec.status} />
      </div>
      <p className="text-body text-foreground">
        <span className="text-muted-foreground">Ce que ça change :</span> {inspirationValueText(rec.field, rec.before, profileVersions)}{" "}
        <span aria-hidden>→</span>
        <span className="sr-only">, devient :</span>{" "}
        <span className="font-medium">{inspirationValueText(rec.field, rec.after, profileVersions)}</span>
      </p>
      {rec.expectedGain ? <p className="text-note text-foreground">Gain attendu : {rec.expectedGain}</p> : null}
      {evidence.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-note text-muted-foreground" aria-label="Preuves">
          {evidence.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-note text-muted-foreground">
        Proposé le {fmtDate(rec.createdAt)}
        {rec.appliedAt ? ` · appliqué le ${fmtDate(rec.appliedAt)}` : ""}
        {rec.undoneAt ? ` · annulé le ${fmtDate(rec.undoneAt)}` : ""}
        {rec.rejectedAt ? ` · refusé le ${fmtDate(rec.rejectedAt)}` : ""}
      </p>
      {rec.status === "PROPOSED" ? (
        <p className="text-note text-muted-foreground">Pour l&apos;appliquer, répondez à Kevin par son numéro (« applique 1 et 3 »).</p>
      ) : null}
      {rec.status === "APPLIED" ? (
        undoable ? (
          isAdmin ? (
            <form action={undoInspirationAction}>
              <input type="hidden" name="referenceId" value={referenceId} />
              <input type="hidden" name="recommendationId" value={rec.id} />
              <ConfirmSubmit
                size="sm"
                variant="outline"
                className="max-md:h-10"
                message="La valeur d'avant est remise tout de suite et le test A/B lié s'arrête. Continuer ?"
              >
                Annuler
              </ConfirmSubmit>
            </form>
          ) : (
            <p className="text-note text-muted-foreground">Seuls les administrateurs peuvent annuler.</p>
          )
        ) : (
          <p className="text-note text-muted-foreground">
            Appliqué depuis plus de {UNDO_WINDOW_DAYS} jours : demandez à Kevin de remettre l&apos;ancienne valeur.
          </p>
        )
      ) : null}
    </li>
  );
}

/** Propositions venues de cette référence : à décider (par Kevin), appliquées (annulables), terminées. */
export function InspirationRecs({
  recs,
  referenceId,
  isAdmin,
  now,
  profileVersions,
}: {
  recs: RecommendationView[];
  referenceId: string;
  isAdmin: boolean;
  now: Date;
  profileVersions: ReadonlyMap<string, number>;
}) {
  if (recs.length === 0)
    return (
      <EmptyState
        title="Aucune proposition pour l'instant"
        description="Après sa lecture, Kevin vous résume la méthode du canal puis propose 3 à 6 réglages numérotés (heures, posts par jour, mélange, longueur, profil de style). Rien ne change sans votre réponse."
      />
    );
  const groups = [
    { title: "À décider (répondez à Kevin)", list: recs.filter((r) => r.status === "PROPOSED") },
    { title: "Appliquées (annulables)", list: recs.filter((r) => r.status === "APPLIED") },
    { title: "Annulées ou refusées", list: recs.filter((r) => r.status !== "PROPOSED" && r.status !== "APPLIED").slice(0, 20) },
  ].filter((g) => g.list.length > 0);
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.title} className="space-y-2">
          <h3 className="text-body font-semibold text-foreground">
            {g.title} <span className="font-normal text-muted-foreground">({g.list.length})</span>
          </h3>
          <ul className="space-y-3">
            {g.list.map((r) => (
              <RecCard key={r.id} rec={r} referenceId={referenceId} isAdmin={isAdmin} now={now} profileVersions={profileVersions} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
