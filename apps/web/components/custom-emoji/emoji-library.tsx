"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Search, Sticker } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { EmptyState } from "@/components/admin/empty-state";
import { SidePanel, SidePanelClose } from "@/components/admin/side-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  emojiCount,
  groupByPack,
  packLabel,
  searchEmojis,
  type EmojiActionState,
} from "@/lib/custom-emoji/library";
import type { LibraryEmoji } from "@/lib/custom-emoji/queries";
import { fmtDate, fmtNum, fmtRelative } from "@/lib/format";
import { statusLabel } from "@/lib/status-badges";
import { CustomEmojiPreview } from "./custom-emoji-preview";
import { forgetMissingPreviews } from "./emoji-media";
import { invalidateCustomEmojiLibrary } from "./use-library";

type ToggleAction = (customEmojiId: string) => Promise<EmojiActionState>;
type FormAction = (prev: EmojiActionState, formData: FormData) => Promise<EmojiActionState>;

/**
 * Bibliothèque des emojis animés (Messages → Emojis animés) : recherche (emoji ou nom du pack), un bloc par pack,
 * aperçus animés chargés à la demande ; un emoji ouvre son détail (pack, qui l'a ajouté, utilisations) ; un
 * administrateur peut le retirer de la bibliothèque (ou l'y remettre depuis « Emojis retirés »).
 */
export function EmojiLibrary({
  emojis,
  isAdmin,
  showHidden,
  hiddenCount,
  missingPreviews,
  hide,
  restore,
  retryPreviews,
}: {
  emojis: LibraryEmoji[];
  isAdmin: boolean;
  showHidden: boolean;
  hiddenCount: number;
  missingPreviews: number;
  hide: ToggleAction;
  restore: ToggleAction;
  retryPreviews: FormAction;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LibraryEmoji | null>(null);
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<EmojiActionState>(null);
  const [pending, startTransition] = useTransition();
  const [retryState, retryAction, retryPending] = useActionState(retryPreviews, null);
  const shown = useMemo(() => searchEmojis(emojis, query), [emojis, query]);
  const groups = useMemo(() => groupByPack(shown), [shown]);
  const packCount = useMemo(() => groupByPack(emojis).length, [emojis]);

  const toggle = (e: LibraryEmoji) =>
    startTransition(async () => {
      const res = await (e.hidden ? restore : hide)(e.id);
      setFeedback(res);
      if (res?.ok) {
        setOpen(false);
        invalidateCustomEmojiLibrary();
        router.refresh();
      }
    });

  if (emojis.length === 0)
    return (
      <EmptyState
        icon={<Sticker />}
        title={showHidden ? "Aucun emoji animé retiré" : "Aucun emoji animé pour l'instant"}
        description={
          showHidden
            ? "Les emojis retirés de la bibliothèque apparaissent ici : vous pouvez les y remettre."
            : "Transférez au bot un message qui contient vos emojis animés : ils arrivent ici tout seuls. Ou collez le lien d'un pack avec « Ajouter des emojis animés »."
        }
      >
        {showHidden ? (
          <Link href="/messages/emojis" className={buttonVariants({ variant: "outline" })}>
            Revenir à la bibliothèque
          </Link>
        ) : isAdmin && hiddenCount > 0 ? (
          // Tous les emojis ont été retirés : ils restent atteignables (pour les remettre).
          <Link
            href="/messages/emojis?vue=retires"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            Emojis retirés ({fmtNum(hiddenCount)})
          </Link>
        ) : null}
      </EmptyState>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full sm:w-80">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher un emoji animé (emoji ou nom du pack)"
            placeholder="Emoji ou nom du pack"
            autoComplete="off"
            className="pl-8"
          />
        </div>
        <p className="text-note text-muted-foreground" aria-live="polite">
          {query.trim()
            ? `${emojiCount(shown.length)} sur ${fmtNum(emojis.length)}`
            : `${emojiCount(emojis.length)} · ${packCount > 1 ? `${packCount} packs` : "1 pack"}`}
        </p>
        {isAdmin ? (
          <Link
            href={showHidden ? "/messages/emojis" : "/messages/emojis?vue=retires"}
            className="rounded-sm text-note font-medium text-brand-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:inline-flex max-md:min-h-10 max-md:items-center sm:ml-auto"
          >
            {showHidden ? "Revenir à la bibliothèque" : `Emojis retirés (${fmtNum(hiddenCount)})`}
          </Link>
        ) : null}
      </div>

      {showHidden ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-body text-muted-foreground">
          Emojis retirés de la bibliothèque : ils ne sont plus proposés dans l&apos;éditeur, mais
          les messages qui les utilisent les gardent. Ouvrez-en un pour le remettre.
        </p>
      ) : null}

      {!showHidden && missingPreviews > 0 ? (
        <form
          action={(fd) => {
            forgetMissingPreviews();
            retryAction(fd);
          }}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2"
        >
          <p className="text-body text-muted-foreground">
            {missingPreviews > 1
              ? `${fmtNum(missingPreviews)} aperçus pas encore récupérés : l'emoji normal s'affiche à leur place.`
              : "1 aperçu pas encore récupéré : l'emoji normal s'affiche à sa place."}
          </p>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={retryPending}
            className="max-md:h-10"
          >
            Réessayer
          </Button>
          {retryState ? (
            <p
              role={retryState.error ? "alert" : "status"}
              className={cn("w-full text-note", retryState.error ? "text-danger" : "text-success")}
            >
              {retryState.error ?? retryState.ok}
            </p>
          ) : null}
        </form>
      ) : null}

      {feedback?.ok && !open ? (
        <p role="status" className="text-note text-success">
          {feedback.ok}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="py-6 text-center text-body text-muted-foreground" role="status">
          Aucun emoji animé pour « {query.trim()} ».
        </p>
      ) : (
        groups.map((g) => (
          <section
            key={g.key || "_none"}
            aria-labelledby={`pack-${g.key || "none"}`}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2
                id={`pack-${g.key || "none"}`}
                className="text-body font-semibold text-foreground"
              >
                {g.label}
              </h2>
              <span className="text-note text-muted-foreground">{emojiCount(g.items.length)}</span>
              {g.setName ? (
                <a
                  href={`https://t.me/addemoji/${encodeURIComponent(g.setName)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 rounded-sm text-note font-medium text-brand-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:min-h-10 [&_svg]:size-3.5"
                  aria-label={`Voir le pack « ${g.label} » dans Telegram (nouvel onglet)`}
                >
                  Voir dans Telegram
                  <ExternalLink aria-hidden />
                </a>
              ) : null}
            </div>
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1"
              aria-label={`Emojis du pack ${g.label}`}
            >
              {g.items.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(e);
                      setFeedback(null);
                      setOpen(true);
                    }}
                    aria-label={`Emoji animé ${e.fallback} (${packLabel(e)}) : voir le détail`}
                    title={`${e.fallback} ${packLabel(e)}`}
                    className="flex size-12 items-center justify-center rounded-lg transition-colors outline-none hover:bg-muted focus-visible:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
                  >
                    <CustomEmojiPreview
                      id={e.id}
                      fallback={e.fallback}
                      hasPreview={e.hasPreview}
                      size="tile"
                      className={cn(e.hidden && "opacity-60")}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <SidePanel
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={selected ? `Emoji animé ${selected.fallback}` : "Emoji animé"}
        description={selected ? packLabel(selected) : undefined}
        footer={
          selected ? (
            <>
              <SidePanelClose />
              {isAdmin ? (
                selected.hidden ? (
                  <Button
                    onClick={() => toggle(selected)}
                    disabled={pending}
                    className="max-md:h-10"
                  >
                    Remettre dans la bibliothèque
                  </Button>
                ) : (
                  <ConfirmDialog
                    trigger={
                      <Button variant="destructive" disabled={pending} className="max-md:h-10">
                        Retirer de la bibliothèque
                      </Button>
                    }
                    title="Retirer cet emoji animé ?"
                    description="Il ne sera plus proposé dans l'éditeur. Les messages qui l'utilisent déjà le gardent ; vous pourrez le remettre depuis « Emojis retirés »."
                    confirmLabel="Retirer"
                    destructive
                    onConfirm={() => toggle(selected)}
                  />
                )
              ) : null}
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex justify-center rounded-xl bg-muted py-6">
              <CustomEmojiPreview
                id={selected.id}
                fallback={selected.fallback}
                hasPreview={selected.hasPreview}
                size="lg"
              />
            </div>
            <DetailList>
              <DetailRow label="Emoji normal">{selected.fallback}</DetailRow>
              <DetailRow label="Pack">{packLabel(selected)}</DetailRow>
              <DetailRow label="Ajouté">
                {fmtDate(new Date(selected.createdAt))}
                {selected.addedByName ? ` par ${selected.addedByName}` : ""}
              </DetailRow>
              <DetailRow label="Comment">
                {statusLabel("customEmojiSource", selected.source)}
              </DetailRow>
              <DetailRow label="Utilisé dans les messages">
                {selected.useCount > 0
                  ? `${fmtNum(selected.useCount)} fois · dernière fois ${fmtRelative(new Date(selected.lastUsedAt!))}`
                  : "Pas encore"}
              </DetailRow>
              {!selected.hasPreview ? (
                <DetailRow label="Aperçu">
                  {selected.previewError
                    ? "Pas encore récupéré (nouvel essai automatique)."
                    : "Bientôt là : récupéré par le service d'arrière-plan."}
                </DetailRow>
              ) : null}
            </DetailList>
            <p className="text-note text-muted-foreground">
              Pour l&apos;insérer : bouton « Emoji animé » dans la barre de l&apos;éditeur de
              message.
            </p>
            {!isAdmin ? (
              <p className="text-note text-muted-foreground">
                Seul un administrateur peut retirer un emoji de la bibliothèque.
              </p>
            ) : null}
            {feedback?.error ? (
              <p role="alert" className="text-note text-danger">
                {feedback.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
