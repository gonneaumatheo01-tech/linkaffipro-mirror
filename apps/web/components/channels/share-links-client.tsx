"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Link2, Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { CopyField } from "@/components/admin/copy-field";
import { EmptyState } from "@/components/admin/empty-state";
import { SidePanel, SidePanelClose } from "@/components/admin/side-panel";
import { StatusPill } from "@/components/admin/status-pill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  ShareLinkActionResult,
  ShareLinkFormResult,
} from "@/app/(admin)/channels/[id]/share-links-actions";
import type { ShareLinkView, ShareLinksData } from "@/lib/channels/share-links";

type CreateAction = (prev: ShareLinkFormResult, formData: FormData) => Promise<ShareLinkFormResult>;
type DisableAction = (formData: FormData) => Promise<ShareLinkActionResult>;

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;
}

/**
 * Section « Liens de partage » de la fiche canal (phase 11) : un lien nommé à poster où l'on veut (« Post Tir
 * Cadré »), avec demande d'adhésion. Chaque lien : où le poster, le lien à copier, ses demandes et acceptations, la
 * règle qui s'applique, « Désactiver » (avec confirmation). « Créer un lien de partage » ouvre un volet (nom, « À poster
 * dans » facultatif). Pas de bouton orange ici : celui de l'onglet est « Enregistrer » de la règle.
 */
export function ShareLinksManager({
  channelId,
  data,
  nameMax,
  createAction,
  disableAction,
}: {
  channelId: string;
  data: ShareLinksData;
  /** Longueur maximale du nom (`SHARE_NAME_MAX`, passée par le serveur : le module des liens reste côté serveur). */
  nameMax: number;
  createAction: CreateAction;
  disableAction: DisableAction;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const [live, setLive] = useState<{ text: string; error: boolean } | null>(null);
  const active = data.links.filter((l) => l.isActive).length;

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={`${id}-title`} className="text-title text-foreground">
            Liens de partage
          </h2>
          <p className="mt-0.5 text-note text-muted-foreground">
            Un lien à poster où vous voulez (un post, une story, un autre canal) : chaque lien a ses
            chiffres, et peut avoir sa propre exception plus haut.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="max-md:h-10"
          onClick={() => {
            setPanelKey((k) => k + 1);
            setOpen(true);
          }}
        >
          <Plus aria-hidden />
          Créer un lien de partage
        </Button>
      </div>

      <p
        role="status"
        className={cn(
          "text-note",
          live ? (live.error ? "text-danger" : "text-success") : "sr-only",
        )}
      >
        {live?.text ?? ""}
      </p>

      {data.links.length === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title="Aucun lien de partage"
          description="Créez un lien pour savoir combien de personnes arrivent d'un post, d'une story ou d'un autre canal."
        />
      ) : (
        <ul
          className="space-y-3"
          aria-label={`Liens de partage : ${plural(active, "actif", "actifs")}`}
        >
          {data.links.map((l) => (
            <ShareLinkItem
              key={l.id}
              link={l}
              channelId={channelId}
              disableAction={disableAction}
              onResult={setLive}
            />
          ))}
        </ul>
      )}

      <ShareLinkPanel
        key={panelKey}
        open={open}
        onOpenChange={setOpen}
        channelId={channelId}
        data={data}
        nameMax={nameMax}
        action={createAction}
      />
    </section>
  );
}

function ShareLinkItem({
  link: l,
  channelId,
  disableAction,
  onResult,
}: {
  link: ShareLinkView;
  channelId: string;
  disableAction: DisableAction;
  onResult: (r: { text: string; error: boolean }) => void;
}) {
  const [pending, setPending] = useState(false);
  const copyId = useId();
  return (
    <li
      className={cn(
        "space-y-3 rounded-xl border border-border bg-surface p-3 md:p-4",
        !l.isActive && "bg-muted/30",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold break-words text-foreground">{l.name}</p>
          <p className="text-note text-muted-foreground">
            {l.postedIn ? `À poster dans « ${l.postedIn} »` : "À poster où vous voulez"} · créé le{" "}
            {l.createdAt}
          </p>
        </div>
        <StatusPill tone={l.isActive ? "success" : "muted"}>
          {l.isActive ? "Actif" : "Désactivé"}
        </StatusPill>
      </div>
      {l.isActive ? (
        <div className="space-y-1.5">
          <Label htmlFor={copyId} className="sr-only">
            Lien « {l.name} »
          </Label>
          <CopyField id={copyId} value={l.url} />
        </div>
      ) : null}
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Demandes</dt>
          <dd className="font-semibold text-foreground tabular-nums">
            {l.requests.toLocaleString("fr-FR")}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Acceptées</dt>
          <dd className="font-semibold text-foreground tabular-nums">
            {l.accepted.toLocaleString("fr-FR")}
          </dd>
        </div>
      </dl>
      <p className="text-note text-muted-foreground">{l.rule}</p>
      {l.isActive ? (
        <ConfirmDialog
          title={`Désactiver le lien « ${l.name} » ?`}
          description="Il ne fonctionnera plus dans Telegram : les personnes qui cliquent dessus ne pourront plus demander à entrer. Les demandes déjà reçues et les chiffres restent."
          confirmLabel="Désactiver"
          destructive
          onConfirm={async () => {
            const fd = new FormData();
            fd.append("channelId", channelId);
            fd.append("linkId", l.id);
            setPending(true);
            try {
              const r = await disableAction(fd);
              onResult(
                r.error ? { text: r.error, error: true } : { text: r.ok ?? "", error: false },
              );
            } catch {
              onResult({ text: "La désactivation n'a pas abouti : réessayez.", error: true });
            } finally {
              setPending(false);
            }
          }}
          trigger={
            <Button type="button" variant="outline" className="max-md:h-10" disabled={pending}>
              {pending ? "Désactivation…" : "Désactiver"}
              <span className="sr-only"> le lien « {l.name} »</span>
            </Button>
          }
        />
      ) : null}
    </li>
  );
}

/** Volet « Nouveau lien de partage » : nom, « À poster dans » (facultatif), puis le lien créé à copier. */
function ShareLinkPanel({
  open,
  onOpenChange,
  channelId,
  data,
  nameMax,
  action,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  data: ShareLinksData;
  nameMax: number;
  action: CreateAction;
}) {
  const id = useId();
  const formId = `${id}-form`;
  const [result, dispatch, pending] = useActionState(action, null);
  // Envoi sans la remise à zéro automatique des formulaires d'action (React 19) : après un refus, la saisie (nom et
  // « À poster dans ») reste en place.
  const [name, setName] = useState("");
  const [sourceChannelId, setSourceChannelId] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const created = result?.created ?? null;

  useEffect(() => {
    if (result?.error) errorRef.current?.focus();
    if (result?.created) doneRef.current?.focus();
  }, [result]);

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={created ? "Lien de partage créé" : "Nouveau lien de partage"}
      description={data.channelTitle}
      footer={
        created ? (
          <SidePanelClose />
        ) : (
          <>
            <SidePanelClose>Annuler</SidePanelClose>
            <Button type="submit" form={formId} className="max-md:h-10" disabled={pending}>
              {pending ? "Création…" : "Créer le lien"}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4">
          <p
            ref={doneRef}
            tabIndex={-1}
            role="status"
            className="flex items-start gap-2 text-body text-success outline-none"
          >
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            Lien « {created.name} » créé, avec demande d&apos;adhésion.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-url`}>Lien à poster</Label>
            <CopyField id={`${id}-url`} value={created.url} />
          </div>
          <p className="text-note text-muted-foreground">
            Les personnes qui cliquent demandent à entrer : la règle de ce canal s&apos;applique (ou
            l&apos;exception de ce lien, à ajouter dans « Exceptions selon la provenance »). Ses
            chiffres apparaissent dans la liste des liens.
          </p>
        </div>
      ) : (
        <form
          id={formId}
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => dispatch(fd));
          }}
        >
          <input type="hidden" name="channelId" value={channelId} />
          {data.bot ? null : (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>
                Aucun de nos bots n&apos;est administrateur de « {data.channelTitle} » : ajoutez-en
                un avec le droit « Inviter via un lien », puis « Re-vérifier les droits des bots ».
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Nom du lien</Label>
            <Input
              id={`${id}-name`}
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={nameMax}
              autoComplete="off"
              placeholder="Post Tir Cadré"
              aria-describedby={`${id}-name-help`}
            />
            <p id={`${id}-name-help`} className="text-note text-muted-foreground">
              Pour le reconnaître dans les demandes et les chiffres.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-source`}>À poster dans (facultatif)</Label>
            <NativeSelect
              id={`${id}-source`}
              name="sourceChannelId"
              value={sourceChannelId}
              onChange={(e) => setSourceChannelId(e.target.value)}
              wrapperClassName="w-full"
              aria-describedby={`${id}-source-help`}
            >
              <option value="">Où vous voulez (aucun de nos canaux)</option>
              {data.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
            <p id={`${id}-source-help`} className="text-note text-muted-foreground">
              Si vous le postez dans un de nos canaux : les personnes venues par ce lien comptent
              comme venues de ce canal (exception « venu de … »).
            </p>
          </div>
          <p className="text-note text-muted-foreground">
            {data.bot
              ? `Le lien est créé par @${data.bot}, avec demande d'adhésion : la règle de ce canal s'applique.`
              : "Le lien est créé avec demande d'adhésion : la règle de ce canal s'applique."}
          </p>
          {result?.error ? (
            <p
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="flex items-start gap-2 text-body text-danger outline-none"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {result.error}
            </p>
          ) : null}
        </form>
      )}
    </SidePanel>
  );
}
