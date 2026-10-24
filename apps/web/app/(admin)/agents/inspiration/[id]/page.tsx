import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentsNav } from "@/components/agents/agents-nav";
import { ComparisonBlock } from "@/components/agents/inspiration/comparison-block";
import { HistoryList } from "@/components/agents/inspiration/history-list";
import { InspirationRecs } from "@/components/agents/inspiration/inspiration-recs";
import { StyleProfileBlock } from "@/components/agents/inspiration/style-profile";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { buildAgentsDeps } from "@/lib/agents/deps";
import {
  INSPIRATION_PATH,
  canManageInspiration,
  inspirationHistory,
  nextReadText,
  referenceName,
  referenceState,
  referenceSubtitle,
  referenceTelegramLink,
  universeName,
} from "@/lib/agents/inspiration";
import { loadInspirationEngine } from "@/lib/agents/inspiration-engine";
import { loadInspirationDetail, resolveComparison } from "@/lib/agents/inspiration-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { removeReferenceAction, undoInspirationAction } from "../actions";

export const metadata: Metadata = { title: "Agents · Canal d'inspiration" };
export const dynamic = "force-dynamic";

/**
 * Fiche d'un canal d'inspiration (phase 27) : la référence (état, voie de lecture, posts lus, cibles, lectures), son
 * profil de style, la comparaison « eux / nous », les propositions (Annuler pour une appliquée), l'historique, et
 * « Retirer » (efface posts et profil). Annuler et Retirer : administrateurs ; les responsables lisent.
 */
export default async function InspirationReferencePage({ params, searchParams }: PageProps<"/agents/inspiration/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const now = new Date();
  const isAdmin = canManageInspiration(user.role);
  const [detail, pending] = await Promise.all([loadInspirationDetail(id), loadPendingCounts()]);
  if (!detail) notFound();
  const { ref, profile } = detail;
  const engine = await loadInspirationEngine().catch(() => ({}));
  const block = await resolveComparison({
    referenceId: ref.id,
    universe: ref.universe,
    stats: detail.profileStats,
    targets: ref.targets,
    rawPosts: detail.rawPosts,
    engine,
    deps: buildAgentsDeps,
  });
  const name = referenceName(ref);
  const state = referenceState(ref.status, ref.unavailableReason);
  const link = referenceTelegramLink(ref.username);
  const sub = referenceSubtitle(ref);
  const appliedCount = detail.recs.filter((r) => r.status === "APPLIED").length;
  const history = inspirationHistory({
    createdAt: ref.createdAt,
    lastReadAt: ref.lastReadAt,
    postCount: ref.postCount,
    recs: detail.recs,
    experiments: detail.experiments,
  });

  return (
    <>
      <AgentsNav current="inspiration" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        backHref={INSPIRATION_PATH}
        backLabel="Inspiration"
        title={name}
        description={`${sub ? `${sub} · ` : ""}Univers ${universeName(ref.universe)}. Kevin s'inspire de sa méthode, jamais de son contenu : aucun texte ni aucune image n'est repris, aucun membre n'est lu.`}
        meta={
          <>
            <StatusBadge kind="referenceStatus" value={ref.status} />
            <StatusBadge kind="referenceVia" value={ref.via} />
          </>
        }
        secondaryActions={
          isAdmin ? (
            <form action={removeReferenceAction}>
              <input type="hidden" name="referenceId" value={ref.id} />
              <ConfirmSubmit
                variant="outline"
                size="sm"
                destructive
                className="max-md:h-10"
                confirmTitle={`Retirer ${name} ?`}
                message="Ses posts lus et son profil de style sont effacés ; la Rédaction ne le lit plus. Continuer ?"
              >
                Retirer
              </ConfirmSubmit>
            </form>
          ) : undefined
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <FormSection title="La référence" description="Comment Kevin lit ce canal et pour lesquels de vos canaux.">
          <DetailList>
            <DetailRow label="État">
              {state.label}
              {state.detail ? <span className="block text-note text-danger">{state.detail}</span> : null}
            </DetailRow>
            <DetailRow label="Lu par">
              {ref.via === "ACCOUNT" && detail.ref.accountLabel ? `compte réel « ${detail.ref.accountLabel} »` : null}
              {ref.via === "ACCOUNT" && !detail.ref.accountLabel ? "compte réel déjà membre" : null}
              {ref.via === "WEB" ? "aperçu public du canal (sans compte)" : null}
              {ref.via === "FORWARDED" ? "posts transférés à Kevin" : null}
            </DetailRow>
            {link ? (
              <DetailRow label="Sur Telegram">
                <a href={link} target="_blank" rel="noopener noreferrer" className="text-info underline">
                  {link.replace("https://", "")}
                </a>
              </DetailRow>
            ) : null}
            <DetailRow label="Posts lus">{fmtNum(ref.postCount)}</DetailRow>
            <DetailRow label="Pour vos canaux">
              {ref.targets.length ? (
                ref.targets.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 ? ", " : null}
                    <Link href={`/channels/${t.id}`} className="text-info underline">
                      {t.title}
                    </Link>
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">aucun : dites à Kevin « c&apos;est pour le canal … »</span>
              )}
            </DetailRow>
            <DetailRow label="Dernière lecture">{fmtDate(ref.lastReadAt)}</DetailRow>
            <DetailRow label="Prochaine relecture">{nextReadText(ref.status, ref.nextReadAt, fmtDate)}</DetailRow>
          </DetailList>
          <p className="text-note text-muted-foreground">
            Le texte des posts lus est effacé au bout de 30 jours ; seuls restent leurs chiffres (heure, longueur, type de média, vues).
          </p>
        </FormSection>

        <FormSection id="eux-nous" title="Eux / nous" description="Chiffres calculés sur leurs posts et sur vos posts des 28 derniers jours. Un écart qui compte peut devenir une proposition.">
          <ComparisonBlock block={block} />
        </FormSection>

        <FormSection id="profil" title="Profil de style" description="La méthode résumée pour la Rédaction : ton, structure d'un post type, façon de pousser l'offre.">
          <StyleProfileBlock profile={profile} usedBy={detail.usedBy} />
        </FormSection>

        <FormSection
          id="propositions"
          title="Propositions"
          description="Chaque proposition dit ce qui change et pourquoi (leurs chiffres et les vôtres). Elle s'applique quand vous répondez à Kevin, dans les bornes de l'équipe Algorithme, et s'annule pendant 30 jours."
          actions={
            isAdmin && appliedCount > 1 ? (
              <form action={undoInspirationAction}>
                <input type="hidden" name="referenceId" value={ref.id} />
                <ConfirmSubmit
                  variant="outline"
                  size="sm"
                  className="max-md:h-10"
                  message={`Les ${appliedCount} réglages appliqués depuis ce canal reprennent leur valeur d'avant. Continuer ?`}
                >
                  Tout annuler
                </ConfirmSubmit>
              </form>
            ) : undefined
          }
        >
          <InspirationRecs recs={detail.recs} referenceId={ref.id} isAdmin={isAdmin} now={now} profileVersions={detail.profileVersions} />
        </FormSection>

        <FormSection id="historique" title="Historique" description="Lectures, réglages appliqués ou annulés, tests A/B et leurs bilans (aussi dans « Ce qui marche »).">
          <HistoryList entries={history} />
        </FormSection>
      </div>
    </>
  );
}
