import { Lightbulb } from "lucide-react";
import { decideMarketRecommendationAction } from "@/app/(admin)/agents/analyses/actions";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REC_COMMENT_MAX, REC_DECISIONS, canDecideRecommendation, countriesText, type MarketRecView } from "@/lib/agents/analyses";
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";
import { EvidenceList } from "./evidence-list";

function RecItem({ rec, n }: { rec: MarketRecView; n: number | null }) {
  const commentId = `market-rec-comment-${rec.id}`;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">
          {n ? `${n}. ` : ""}
          {rec.title}
        </span>
        {rec.market ? <StatusBadge kind="vertical" value={rec.market} /> : null}
        {rec.risk ? <StatusBadge kind="riskLevel" value={rec.risk} /> : null}
        {rec.platform ? <StatusBadge kind="compliancePlatform" value={rec.platform} /> : null}
        {!rec.verified ? (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-note text-muted-foreground" title="Une seule source, pas encore recoupée">
            Non vérifiée
          </span>
        ) : null}
        {rec.status !== "PROPOSED" ? <StatusBadge kind="marketRecommendation" value={rec.status} /> : null}
      </div>
      {rec.description ? <p className="text-body text-foreground">{rec.description}</p> : null}
      <p className="text-note text-muted-foreground">
        {[...rec.details, countriesText(rec.countries), rec.priority ? `priorité ${rec.priority}` : null].filter(Boolean).join(" · ")}
      </p>
      <EvidenceList items={rec.evidence} />
      <p className="text-note text-muted-foreground">
        Proposée le {fmtDate(rec.createdAt)}
        {rec.acceptedAt ? ` · acceptée le ${fmtDate(rec.acceptedAt)}` : ""}
        {rec.rejectedAt ? ` · refusée le ${fmtDate(rec.rejectedAt)}` : ""}
      </p>
      {rec.comment ? <p className="text-note text-foreground">Votre commentaire : {rec.comment}</p> : null}
      {canDecideRecommendation(rec.status) ? (
        <form action={decideMarketRecommendationAction} className="space-y-2">
          <input type="hidden" name="id" value={rec.id} />
          <div className="space-y-1">
            <Label htmlFor={commentId}>Commentaire (facultatif)</Label>
            <Textarea id={commentId} name="comment" rows={2} maxLength={REC_COMMENT_MAX} placeholder="Ex. : on teste deux vidéos la semaine prochaine" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="status" value="APPLIED" size="sm" variant="secondary" className="max-md:h-10">
              {REC_DECISIONS.APPLIED.button}
            </Button>
            <Button type="submit" name="status" value="REJECTED" size="sm" variant="outline" className="max-md:h-10">
              {REC_DECISIONS.REJECTED.button}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/**
 * Vue « Recommandations » : ce que l'équipe conseille (type de pub, angle, format, pays), avec ses preuves. Accepter
 * note seulement votre décision : l'équipe ne change rien chez Meta, TikTok, sur les canaux ni les budgets.
 */
export function RecommendationsView({ recs }: { recs: MarketRecView[] }) {
  const open = recs.filter((r) => r.status === "PROPOSED");
  const past = recs.filter((r) => r.status !== "PROPOSED").slice(0, 30);
  return (
    <FormSection
      id="recommandations"
      title="Recommandations"
      description="Accepter note votre décision : à vous de la mettre en place. L'équipe ne change rien chez Meta, TikTok, sur les canaux ni les budgets."
    >
      {recs.length === 0 ? (
        <EmptyState
          icon={<Lightbulb />}
          title="Aucune recommandation pour l'instant"
          description="L'équipe en propose chaque semaine avec le rapport du lundi, ou quand vous demandez à Kevin « quel type de pub je devrais faire pour les rencontres en Espagne ? »."
        />
      ) : (
        <div className="space-y-6">
          {[
            { title: "À décider", list: open, numbered: true },
            { title: "Acceptées ou refusées", list: past, numbered: false },
          ]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <div key={g.title} className="space-y-2">
                <h3 className="text-body font-semibold text-foreground">
                  {g.title} <span className="font-normal text-muted-foreground">({fmtNum(g.list.length)})</span>
                </h3>
                <ul className="space-y-3">
                  {g.list.map((r, i) => (
                    <RecItem key={r.id} rec={r} n={g.numbered ? i + 1 : null} />
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </FormSection>
  );
}
