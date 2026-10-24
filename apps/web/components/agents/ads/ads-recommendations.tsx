import Link from "next/link";
import { markAdsRecommendationAction } from "@/app/(admin)/agents/ads/actions";
import { EmptyState } from "@/components/admin/empty-state";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ADS_ACTION_HOWTO,
  COMMENT_MAX,
  MARK_WORDS,
  adsEvidenceLines,
  adsTargetLabel,
  canMarkRecommendation,
  parseAdsAction,
  sortRecommendations,
  type AdsRecommendationView,
} from "@/lib/agents/ads/display";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

/** Une recommandation : action conseillée, cible, preuves, ce qu'il faut faire soi-même, puis « Fait » / « Refuser ». */
export function AdsRecommendationCard({ rec, from }: { rec: AdsRecommendationView; from: string }) {
  const action = parseAdsAction(rec.action);
  const evidence = adsEvidenceLines(rec.evidence);
  const commentId = `ads-rec-comment-${rec.id}`;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {action ? <StatusBadge kind="adsAction" value={action} /> : null}
        <span className="font-medium text-foreground">{rec.targetLabel}</span>
        <span className="text-note text-muted-foreground">{adsTargetLabel(rec.target)}</span>
        {rec.vertical ? <UniverseDot universe={rec.vertical} withLabel /> : null}
        {rec.status !== "PROPOSED" ? <StatusBadge kind="recommendation" value={rec.status} /> : null}
      </div>
      {evidence.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-note text-foreground" aria-label="Preuves">
          {evidence.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      {rec.expectedGain ? <p className="text-note text-foreground">Gain attendu : {rec.expectedGain}</p> : null}
      {action && rec.status === "PROPOSED" ? (
        <p className="text-note text-muted-foreground">À faire vous-même : {ADS_ACTION_HOWTO[action]}</p>
      ) : null}
      <p className="text-note text-muted-foreground">
        Proposée le {fmtDate(rec.createdAt)}
        {rec.doneAt ? ` · faite le ${fmtDate(rec.doneAt)}` : ""}
        {rec.rejectedAt ? ` · refusée le ${fmtDate(rec.rejectedAt)}` : ""}
        {rec.campaignId ? (
          <>
            {" · "}
            <Link href={`/campaigns/${rec.campaignId}?tab=ads`} className="underline underline-offset-4 hover:text-foreground">
              Voir la campagne
            </Link>
          </>
        ) : null}
      </p>
      {rec.comment ? <p className="text-note text-foreground">Votre commentaire : {rec.comment}</p> : null}
      {canMarkRecommendation(rec.status) ? (
        <form action={markAdsRecommendationAction} className="space-y-2">
          <input type="hidden" name="id" value={rec.id} />
          <input type="hidden" name="from" value={from} />
          <div className="space-y-1">
            <Label htmlFor={commentId}>Commentaire (facultatif)</Label>
            <Textarea
              id={commentId}
              name="comment"
              rows={2}
              maxLength={COMMENT_MAX}
              placeholder="Ex. : budget monté de 20 € à 25 € par jour"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="status" value="DONE" size="sm" variant="secondary" className="max-md:h-10">
              {MARK_WORDS.DONE.button}
            </Button>
            <Button type="submit" name="status" value="REJECTED" size="sm" variant="outline" className="max-md:h-10">
              {MARK_WORDS.REJECTED.button}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** À décider d'abord (à arrêter, à augmenter, à tester, à surveiller), puis l'historique (faites ou refusées). */
export function AdsRecommendationsList({ recs, from }: { recs: AdsRecommendationView[]; from: string }) {
  if (recs.length === 0)
    return (
      <EmptyState
        title="Aucune recommandation pour l'instant"
        description="L'Agent Ads passe chaque jour sur vos pubs. Il ne conseille rien tant qu'une pub n'a pas assez de jours et de dépense (voir les seuils plus bas)."
      />
    );
  const open = sortRecommendations(recs.filter((r) => r.status === "PROPOSED"));
  const past = recs.filter((r) => r.status !== "PROPOSED").slice(0, 30);
  return (
    <div className="space-y-6">
      {[
        { title: "À décider", list: open },
        { title: "Faites ou refusées", list: past },
      ]
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <div key={g.title} className="space-y-2">
            <h3 className="text-body font-semibold text-foreground">
              {g.title} <span className="font-normal text-muted-foreground">({g.list.length})</span>
            </h3>
            <ul className="space-y-3">
              {g.list.map((r) => (
                <AdsRecommendationCard key={r.id} rec={r} from={from} />
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
