import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Film } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { MontageTimeline } from "@/components/agents/montage/montage-timeline";
import { ShortCard } from "@/components/agents/montage/short-card";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import {
  MONTAGE_PATH,
  canCancelJob,
  canManageMontage,
  clipCounts,
  clipCountsText,
  fmtDuration,
  fmtResolution,
  fmtSize,
  instructionLines,
  safeMontageId,
  sourceInfo,
  telegramMessageLink,
} from "@/lib/agents/montage";
import { loadLibraryChannelUsername, loadMontageDetail } from "@/lib/agents/montage-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtDate } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { approveShortAction, cancelMontageAction, modifyShortAction, rejectShortAction } from "../actions";

export const metadata: Metadata = { title: "Agents · Montage" };
export const dynamic = "force-dynamic";

/**
 * Fiche d'un travail de montage (phase 28) : la vidéo source (durée, résolution, poids), les consignes comprises par
 * Kevin, le plan de coupe en frise (moments placés sur la durée, score, description) et les shorts (lecture dans le
 * navigateur, statut, retour, compressé ou non, contrôle qualité). Valider / Modifier / Refuser et Annuler le montage :
 * administrateurs ; les responsables lisent.
 */
export default async function MontageJobPage({ params, searchParams }: PageProps<"/agents/montage/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const isAdmin = canManageMontage(user.role);
  const safe = safeMontageId(id);
  if (!safe) notFound();
  const [job, pending, libraryUsername] = await Promise.all([loadMontageDetail(safe), loadPendingCounts(), loadLibraryChannelUsername()]);
  if (!job) notFound();
  const info = sourceInfo(job.sourceMeta, job.source);
  const { rawText, lines } = instructionLines(job.instructions);
  const counts = clipCounts(job.shorts.map((s) => s.status));
  const cancellable = isAdmin && canCancelJob(job.status);
  const sourceLink = telegramMessageLink(job.source.telegramRef);
  const shorts = job.shorts.filter((s) => s.status !== "CANCELLED" || job.status === "CANCELLED");

  return (
    <>
      <AgentsNav current="montage" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title={job.source.filename}
        backHref={MONTAGE_PATH}
        backLabel="Tous les montages"
        meta={<StatusBadge kind="montageJob" value={job.status} />}
        description={`Reçue le ${fmtDate(job.createdAt)}${job.createdByName ? ` de ${job.createdByName}` : ""} · ${clipCountsText(counts)}${counts.toReview ? ` · ${counts.toReview} à valider` : ""}`}
        secondaryActions={
          cancellable ? (
            <form action={cancelMontageAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <ConfirmSubmit
                variant="outline"
                size="sm"
                destructive
                className="max-md:h-10"
                confirmTitle="Annuler le montage ?"
                message="Les shorts pas encore faits sont abandonnés. Les shorts déjà validés restent dans la médiathèque. Continuer ?"
              >
                Annuler le montage
              </ConfirmSubmit>
            </form>
          ) : undefined
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      {!isAdmin ? (
        <p className="mb-6 text-note text-muted-foreground">
          Seuls les administrateurs peuvent valider, modifier ou refuser un short, ou annuler un montage (ou dites-le à Kevin).
        </p>
      ) : null}
      {job.status === "FAILED" && job.error ? (
        <p role="alert" className="mb-6 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-body text-danger">
          Le montage s&apos;est arrêté : {job.error}
        </p>
      ) : null}

      <div className="space-y-10">
        <FormSection title="La vidéo source" description="Gardée dans Telegram, dans votre conversation avec Kevin : elle n'est jamais copiée sur le site.">
          <DetailList>
            <DetailRow label="Durée">{fmtDuration(info.durationMs)}</DetailRow>
            <DetailRow label="Résolution">{fmtResolution(info.width, info.height)}</DetailRow>
            <DetailRow label="Poids">{fmtSize(info.sizeBytes)}</DetailRow>
            {info.fps ? <DetailRow label="Images par seconde">{info.fps.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</DetailRow> : null}
            {sourceLink ? (
              <DetailRow label="Dans Telegram">
                <a href={sourceLink} target="_blank" rel="noreferrer" className="text-info underline">
                  Ouvrir le message
                </a>
              </DetailRow>
            ) : null}
          </DetailList>
          <div className="space-y-1">
            <p className="text-body font-medium text-foreground">Vos consignes</p>
            {rawText ? (
              <blockquote className="rounded-xl border border-border bg-card px-4 py-3 text-body text-foreground">« {rawText} »</blockquote>
            ) : null}
            <ul className="space-y-0.5 text-note text-muted-foreground">
              {lines.map((l) => (
                <li key={l.label}>
                  <span className="text-foreground">{l.label}</span> : {l.value}
                </li>
              ))}
            </ul>
          </div>
        </FormSection>

        <FormSection
          title="Plan de coupe"
          description={
            job.planApprovedAt
              ? `Les moments retenus par l'équipe, placés sur la durée de la vidéo. Plan validé le ${fmtDate(job.planApprovedAt)}.`
              : "Les moments retenus par l'équipe, placés sur la durée de la vidéo. Kevin vous l'a envoyé : répondez-lui « ok », « enlève le 3 » ou « le 2, commence 2 secondes plus tôt »."
          }
        >
          {job.shorts.length === 0 ? (
            <EmptyState
              icon={<Film />}
              title="Pas encore de plan"
              description="L'équipe regarde la vidéo et choisit les meilleurs moments. Kevin vous envoie le plan dès qu'il est prêt."
            />
          ) : (
            <MontageTimeline clips={shorts} durationMs={info.durationMs} />
          )}
        </FormSection>

        <FormSection
          title="Shorts"
          description="Chaque short est vérifié (durée, qualité, écran noir, son, sous-titres lisibles) puis envoyé par Kevin en aperçu. Valider le garde dans la médiathèque : rien n'est publié sans votre ordre."
        >
          {shorts.length === 0 ? (
            <EmptyState title="Aucun short pour l'instant" description="Les shorts arrivent un par un après votre accord sur le plan de coupe." />
          ) : (
            <ul className="space-y-4">
              {shorts.map((c) => (
                <ShortCard
                  key={c.id}
                  clip={c}
                  jobId={job.id}
                  jobStatus={job.status}
                  isAdmin={isAdmin}
                  libraryUsername={libraryUsername}
                  actions={{ approve: approveShortAction, reject: rejectShortAction, modify: modifyShortAction }}
                />
              ))}
            </ul>
          )}
        </FormSection>
      </div>
    </>
  );
}
