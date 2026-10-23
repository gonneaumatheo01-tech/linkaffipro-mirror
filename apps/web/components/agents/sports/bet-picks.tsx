import { AgentMediaPreview } from "@/components/agents/agent-media-preview";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createTestBetAction } from "@/app/(admin)/agents/[equipe]/sports-actions";
import {
  bookmakerLabel,
  fmtOdds,
  fmtSignedPct,
  leagueLabel,
  oddsDrift,
  reasoningSentences,
  resultScore,
  skipReasonText,
} from "@/lib/agents/sports";
import type { BetCategoryView, BettingPickView } from "@/lib/agents/sports-queries";
import { fmtDateShort } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";

function PickCard({ pick, now }: { pick: BettingPickView; now: Date }) {
  const sentences = reasoningSentences(pick.reasoning, pick);
  const drift = oddsDrift(pick.odds, pick.oddsAtSend);
  const score = resultScore(pick.result);
  const reason = skipReasonText(pick.skipReason);
  const fallback = pick.screenshot?.origin === "TEMPLATE";
  return (
    <li className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-2">
        <p className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="bettingPick" value={pick.status} />
          <span className="font-medium text-foreground">
            {pick.homeTeam} – {pick.awayTeam}
          </span>
          <span className="text-note text-muted-foreground">
            {leagueLabel(pick.league)} · coup d&apos;envoi {fmtDateShort(pick.kickoffAt, now)}
          </span>
        </p>
        <p className="text-body text-foreground">
          {pick.categoryName} : {pick.marketLabel}, <span className="font-medium">{pick.selectionLabel}</span>
          {pick.line !== null ? ` (${String(pick.line).replace(".", ",")})` : ""} · cote{" "}
          <span className="font-semibold tabular-nums">{fmtOdds(pick.odds)}</span> chez {bookmakerLabel(pick.bookmaker)}
        </p>
        {pick.oddsAtSend !== null ? (
          <p className="text-note text-muted-foreground">
            Cote revérifiée juste avant l&apos;envoi : {fmtOdds(pick.oddsAtSend)}
            {drift !== null ? ` (${fmtSignedPct(drift)})` : ""}.
          </p>
        ) : null}
        {sentences.length ? (
          <div className="space-y-1">
            <p className="text-note font-medium text-foreground">Pourquoi ce pari</p>
            <ul className="list-disc space-y-0.5 pl-5 text-note text-foreground">
              {sentences.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-note text-muted-foreground">Raisonnement pas encore enregistré.</p>
        )}
        {pick.status === "SKIPPED" && reason ? <p className="text-note text-danger">Écarté : {reason}.</p> : null}
        {score ? <p className="text-note text-foreground">Score final : {score}.</p> : null}
      </div>
      <div className="space-y-1">
        {pick.screenshot ? (
          <>
            <AgentMediaPreview
              id={pick.screenshot.id}
              mimeType={pick.screenshot.mimeType}
              label={`Capture du pari ${pick.homeTeam} – ${pick.awayTeam} chez ${bookmakerLabel(pick.bookmaker)}`}
              className="aspect-auto max-h-72 object-contain"
            />
            {fallback ? (
              <StatusPill tone="warning" title="Capture impossible : image fabriquée, toujours soumise à votre validation">
                Image de repli
              </StatusPill>
            ) : null}
          </>
        ) : (
          <p className="text-note text-muted-foreground">Pas encore de capture.</p>
        )}
      </div>
    </li>
  );
}

/** Paris du jour (capture, raisonnement en phrases, état et motif) et « Produire un pari de test ». */
export function BetPicks({
  picks,
  categories,
  simulation,
  now,
}: {
  picks: BettingPickView[];
  categories: BetCategoryView[];
  simulation: boolean;
  now: Date;
}) {
  return (
    <FormSection
      id="paris"
      title="Paris du jour"
      description="Chaque pari retenu aujourd'hui : match, marché, cote constatée chez le bookmaker, capture, raisonnement et état. Une cote qui a bougé au-delà de l'écart toléré fait écarter le pari, jamais publier."
      className="scroll-mt-24"
    >
      <form
        action={createTestBetAction}
        className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-end"
      >
        <div className="space-y-1.5">
          <Label htmlFor="sports-test-category">Catégorie</Label>
          <NativeSelect id="sports-test-category" name="categoryId" defaultValue="" wrapperClassName="w-full sm:w-64">
            <option value="">Catégorie de test (par défaut)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active ? "" : " (inactive)"}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="max-md:h-10">
          Produire un pari de test
        </Button>
        <p className="text-note text-muted-foreground sm:flex-1">
          Cotes d&apos;essai et page d&apos;essai, en simulation : le post part sur le canal Test
          {simulation ? "" : " (même si l'équipe publie sur les vrais canaux)"}. Aucune mise, jamais.
        </p>
      </form>
      {picks.length === 0 ? (
        <EmptyState
          title="Aucun pari aujourd'hui"
          description="L'équipe passe aux heures réglées plus bas. Pour voir le résultat tout de suite, cliquez sur « Produire un pari de test »."
        />
      ) : (
        <ul className="space-y-3">
          {picks.map((p) => (
            <PickCard key={p.id} pick={p} now={now} />
          ))}
        </ul>
      )}
    </FormSection>
  );
}
