import { Clapperboard } from "lucide-react";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { StatusPill } from "@/components/admin/status-pill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MODIFY_MAX,
  TOO_BIG_TEXT,
  canApproveClip,
  canModifyClip,
  canRejectClip,
  fmtClock,
  fmtDuration,
  fmtResolution,
  fmtSize,
  formatLabel,
  pipLabel,
  playableInBrowser,
  qcView,
  shortPlayerSrc,
  telegramMessageLink,
} from "@/lib/agents/montage";
import type { ShortClipView } from "@/lib/agents/montage-queries";
import { StatusBadge } from "@/lib/status-badges";

type Action = (fd: FormData) => Promise<void>;

/**
 * Un short d'un montage (phase 28) : miniature ou lecture dans le navigateur (route protégée, chargée seulement au
 * clic), statut, retour du client, compressé ou non, contrôle qualité en clair ; Valider / Modifier / Refuser pour un
 * administrateur (mêmes effets que les boutons de l'aperçu chez Kevin). Rien n'est publié par ces boutons.
 */
export function ShortCard({
  clip,
  jobId,
  jobStatus,
  isAdmin,
  libraryUsername,
  actions,
}: {
  clip: ShortClipView;
  jobId: string;
  jobStatus: string;
  isAdmin: boolean;
  libraryUsername: string | null;
  actions: { approve: Action; reject: Action; modify: Action };
}) {
  const qc = qcView(clip.qc);
  const playable = playableInBrowser(clip.asset);
  const tgLink = clip.asset ? telegramMessageLink(clip.asset.telegramRef, libraryUsername) : null;
  const approvable = isAdmin && canApproveClip(clip.status, jobStatus);
  const rejectable = isAdmin && canRejectClip(clip.status, jobStatus);
  const modifiable = isAdmin && canModifyClip(clip.status, jobStatus);
  const label = `Short ${clip.index}`;
  const changeId = `change-${clip.id}`;
  const reasonId = `reason-${clip.id}`;
  return (
    <li id={`short-${clip.id}`} className="scroll-mt-24 space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-semibold text-foreground">{label}</h3>
        <StatusBadge kind="shortClip" value={clip.status} />
        {clip.compressed ? <StatusPill tone="warning">Compressé pour Telegram</StatusPill> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
        <div>
          {clip.asset && playable ? (
            <video
              src={shortPlayerSrc(clip.id)}
              controls
              playsInline
              preload="none"
              poster={clip.thumbId ? `/api/agents/media/${clip.thumbId}` : undefined}
              aria-label={`${label}, ${fmtDuration(clip.durationMs)}`}
              className="aspect-[9/16] w-full rounded-lg border border-border bg-muted object-contain"
            >
              <track kind="captions" />
            </video>
          ) : clip.thumbId ? (
            // Notre propre route protégée : pas d'optimisation next/image nécessaire.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/agents/media/${clip.thumbId}`} alt={`Miniature du ${label.toLowerCase()}`} loading="lazy" className="aspect-[9/16] w-full rounded-lg border border-border bg-muted object-cover" />
          ) : (
            <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
              <Clapperboard aria-hidden="true" className="size-8" />
            </div>
          )}
          {clip.asset && !playable ? (
            <p className="mt-2 text-note text-muted-foreground">
              {TOO_BIG_TEXT}{" "}
              {tgLink ? (
                <a href={tgLink} target="_blank" rel="noreferrer" className="text-info underline">
                  Ouvrir dans Telegram
                </a>
              ) : (
                "Il est dans votre conversation avec Kevin et dans la médiathèque."
              )}
            </p>
          ) : !clip.asset ? (
            <p className="mt-2 text-note text-muted-foreground">Pas encore fabriqué.</p>
          ) : tgLink ? (
            <p className="mt-2 text-note">
              <a href={tgLink} target="_blank" rel="noreferrer" className="text-info underline">
                Voir dans la médiathèque Telegram
              </a>
            </p>
          ) : null}
        </div>
        <div className="space-y-2 text-body">
          <p className="text-foreground">
            <span className="tabular-nums">
              {fmtClock(clip.startMs)} à {fmtClock(clip.endMs)}
            </span>
            <span className="text-muted-foreground"> · {fmtDuration(clip.durationMs)}</span>
            {clip.score != null ? <span className="text-muted-foreground"> · intérêt {clip.score}/10</span> : null}
          </p>
          {clip.description ? <p className="text-muted-foreground">{clip.description}</p> : null}
          <p className="text-note text-muted-foreground">
            {[
              formatLabel(clip.format),
              pipLabel(clip.pipPosition),
              clip.subtitles ? "avec sous-titres" : "sans sous-titres",
              clip.overlayText ? `texte « ${clip.overlayText} »` : null,
              clip.asset ? `${fmtResolution(clip.asset.width, clip.asset.height)}, ${fmtSize(clip.asset.size)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className={qc.state === "failed" ? "text-danger" : "text-muted-foreground"}>
            <p className="text-note">{qc.summary}</p>
            {qc.problems.length ? (
              <ul className="list-disc pl-5 text-note">
                {qc.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {clip.clientFeedback ? (
            <p className="text-note text-foreground">
              <span className="font-medium">Votre retour :</span> « {clip.clientFeedback} »
            </p>
          ) : null}
          {clip.redoCount > 0 ? (
            <p className="text-note text-muted-foreground">
              Refait {clip.redoCount} fois.
            </p>
          ) : null}
          {approvable || rejectable || modifiable ? (
            <div className="flex flex-wrap items-start gap-2 pt-1">
              {approvable ? (
                <form action={actions.approve}>
                  <input type="hidden" name="jobId" value={jobId} />
                  <input type="hidden" name="clipId" value={clip.id} />
                  <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                    Valider
                  </Button>
                </form>
              ) : null}
              {rejectable ? (
                <form action={actions.reject} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="jobId" value={jobId} />
                  <input type="hidden" name="clipId" value={clip.id} />
                  <label htmlFor={reasonId} className="sr-only">
                    Raison du refus du {label.toLowerCase()} (facultatif)
                  </label>
                  <input
                    id={reasonId}
                    name="reason"
                    maxLength={300}
                    placeholder="Raison (facultatif)"
                    className="h-8 w-44 rounded-md border border-border bg-background px-2 text-note max-md:h-10"
                  />
                  <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
                    Refuser
                  </Button>
                </form>
              ) : null}
              {modifiable ? (
                <details className="w-full rounded-lg border border-border px-3 py-2">
                  <summary className="cursor-pointer text-note font-medium text-foreground">Modifier</summary>
                  <form action={actions.modify} className="mt-2 space-y-2">
                    <input type="hidden" name="jobId" value={jobId} />
                    <input type="hidden" name="clipId" value={clip.id} />
                    <Label htmlFor={changeId}>Ce qu&apos;il faut changer</Label>
                    <Textarea
                      id={changeId}
                      name="change"
                      required
                      minLength={3}
                      maxLength={MODIFY_MAX}
                      rows={2}
                      placeholder="Raccourcis de 2 secondes, mets la caméra en bas à gauche…"
                    />
                    <ConfirmSubmit
                      variant="outline"
                      size="sm"
                      className="max-md:h-10"
                      confirmTitle={`Refaire le ${label.toLowerCase()} ?`}
                      message="Le short est refait avec votre modification, depuis la vidéo d'origine (aucune perte de qualité). Kevin vous envoie le nouvel aperçu à valider."
                    >
                      Refaire le short
                    </ConfirmSubmit>
                  </form>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
