"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, CheckCheck, RefreshCw, X } from "lucide-react";
import type { MembershipStatus } from "@linkaffipro/db";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { FilterChips } from "@/components/admin/filter-chips";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  REQUEST_FILTERS,
  approveAllConfirm,
  parseRequestFilter,
  requestsCountLabel,
  requestsFilterHref,
  visibleRequests,
  type RequestFilter,
} from "@/lib/channels/requests";
import { StatusBadge } from "@/lib/status-badges";

export type RequestCardData = {
  id: string;
  name: string;
  /** « @nom », ou rien sans nom d'utilisateur ou quand le nom affiché est déjà le @nom (`memberHandle`). */
  handle: string | null;
  /** Identifiant Telegram : au survol seulement (jamais en surface). */
  telegramUserId: string;
  status: MembershipStatus;
  /** Ce qui va se passer (« Acceptée dans 10 min », « À valider à la main »…). */
  next: string;
  /** En petit sous la suite (« ou dès qu'elle appuie sur « ✅ J'ai rejoint » »), ou null. */
  nextNote?: string | null;
  /** D'où vient la personne : « Venu de « Tir Cadré » (canal obligatoire) » (phase 11). */
  provenance: string;
  /** Règle appliquée : « règle : 1 jour », « règle par défaut : 5 minutes » ; null si inconnue. */
  rule: string | null;
  /** « acceptation prévue le 12 oct. à 10 h 14 » (demande programmée), sinon null. */
  acceptance: string | null;
  requestedAt: string;
  lastError: string | null;
};

type FormAction = (formData: FormData) => Promise<void>;

/**
 * Une demande d'adhésion en carte (pensée d'abord pour le téléphone) : qui, où en est la demande, puis d'où elle vient
 * avec la règle appliquée et la date d'acceptation prévue (« Venu de « Tir Cadré » (canal obligatoire) · règle :
 * 1 jour · acceptation prévue le 12 oct. à 10 h 14 »), puis « Accepter » et « Refuser » en boutons de 40 px. Mêmes
 * actions serveur qu'avant.
 */
export function RequestCard({
  request: r,
  channelId,
  approveAction,
  declineAction,
}: {
  request: RequestCardData;
  channelId: string;
  approveAction: FormAction;
  declineAction: FormAction;
}) {
  return (
    <li className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0" title={`Identifiant Telegram ${r.telegramUserId}`}>
          <p className="truncate text-body font-semibold text-foreground">{r.name}</p>
          {r.handle ? <p className="truncate text-note text-muted-foreground">{r.handle}</p> : null}
        </div>
        <StatusBadge kind="membership" value={r.status} />
      </div>
      <p className="mt-3 text-body text-foreground">{r.next}</p>
      {r.nextNote ? <p className="text-note text-muted-foreground">{r.nextNote}</p> : null}
      <p className="mt-1 text-note break-words text-muted-foreground">
        <span className="sr-only">Origine : </span>
        <span className="text-foreground">{r.provenance}</span>
        {[r.rule, r.acceptance]
          .filter((x): x is string => Boolean(x))
          .map((x) => ` · ${x}`)
          .join("")}
      </p>
      <dl className="mt-1 space-y-0.5 text-note text-muted-foreground">
        <div className="flex gap-1">
          <dt className="shrink-0">Demandé le</dt>
          <dd>{r.requestedAt}</dd>
        </div>
      </dl>
      {r.lastError ? (
        <p className="mt-2 line-clamp-2 text-note text-danger" title={r.lastError}>
          {r.lastError}
        </p>
      ) : null}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <form action={approveAction}>
          <input type="hidden" name="membershipId" value={r.id} />
          <input type="hidden" name="channelId" value={channelId} />
          <Button type="submit" variant="outline" size="lg" className="w-full">
            <Check aria-hidden className="text-success" />
            Accepter
            <span className="sr-only"> la demande de {r.name}</span>
          </Button>
        </form>
        <form action={declineAction}>
          <input type="hidden" name="membershipId" value={r.id} />
          <input type="hidden" name="channelId" value={channelId} />
          <ConfirmSubmit
            variant="outline"
            size="lg"
            className="w-full"
            confirmTitle={`Refuser la demande de ${r.name} ?`}
            confirmLabel="Refuser"
            destructive
            message="La personne ne pourra pas entrer dans le canal et devra refaire une demande."
          >
            <X aria-hidden className="text-danger" />
            Refuser
            <span className="sr-only"> la demande de {r.name}</span>
          </ConfirmSubmit>
        </form>
      </div>
    </li>
  );
}

/**
 * Liste des demandes en cours de l'onglet « Demandes » (phase 14) : filtre par statut (« Toutes », « Attend les
 * canaux », « Acceptation programmée », « À valider à la main », gardé dans l'adresse `?status=`), nombre exact de
 * chaque filtre (toute la liste, pas seulement les cartes montrées), « Tout accepter » sur la liste filtrée avec une
 * fenêtre de confirmation, puis les cartes. Les cartes viennent du serveur (les plus récentes de chaque filtre,
 * `loadOpenRequests`) ; le filtre les trie ici, 200 au plus.
 */
export function RequestsBoard({
  channelId,
  items,
  counts,
  asOf,
  approveAction,
  declineAction,
  approveAllAction,
}: {
  channelId: string;
  /** Demandes en cours (les plus récentes de chaque filtre), de la plus récente à la plus ancienne. */
  items: RequestCardData[];
  /** Nombre exact de demandes de chaque filtre. */
  counts: Record<RequestFilter, number>;
  /**
   * Moment de l'affichage (ISO) : « Tout accepter » n'accepte que les demandes faites avant, et jamais plus que le
   * nombre annoncé dans la fenêtre de confirmation.
   */
  asOf: string;
  approveAction: FormAction;
  declineAction: FormAction;
  /** « Tout accepter » (champs `channelId`, `filter`, `asOf`, `expected`). */
  approveAllAction: FormAction;
}) {
  const params = useSearchParams();
  const filter = parseRequestFilter(params.get("status"));
  const visible = visibleRequests(items, filter);
  const count = counts[filter];
  const confirm = approveAllConfirm(filter, count);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterChips
          label="Statut"
          chips={REQUEST_FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            href: requestsFilterHref(channelId, f.key),
            count: counts[f.key],
            selected: f.key === filter,
          }))}
        />
        {/* Téléphone : passé à la ligne, le bouton discret est aligné sur la marge (sans son retrait intérieur). */}
        <Link
          href={requestsFilterHref(channelId, filter)}
          className={cn(buttonVariants({ variant: "ghost" }), "max-md:-ml-3.5 max-md:h-10")}
        >
          <RefreshCw aria-hidden />
          Actualiser
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted-foreground" aria-live="polite">
          <span className="font-semibold text-foreground">{requestsCountLabel(count, filter)}</span>
          {visible.length < count ? ` (les ${visible.length} plus récentes)` : ""}. Les demandes
          programmées sont acceptées toutes seules à l&apos;heure prévue.
        </p>
        {count > 0 ? (
          <form action={approveAllAction}>
            <input type="hidden" name="channelId" value={channelId} />
            <input type="hidden" name="filter" value={filter} />
            <input type="hidden" name="asOf" value={asOf} />
            <input type="hidden" name="expected" value={count} />
            <ConfirmDialog
              title={confirm.title}
              description={confirm.description}
              confirmLabel={confirm.confirmLabel}
              trigger={
                <Button type="submit" variant="outline" className="max-md:h-10">
                  <CheckCheck aria-hidden className="text-success" />
                  Tout accepter
                  <span className="sr-only">
                    {" "}
                    : {count} demande{count > 1 ? "s" : ""}
                  </span>
                </Button>
              }
            />
          </form>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-body text-muted-foreground">
          Aucune demande dans ce filtre pour le moment.
        </p>
      ) : (
        <ul
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Demandes en cours"
        >
          {visible.map((r) => (
            <RequestCard
              key={r.id}
              channelId={channelId}
              approveAction={approveAction}
              declineAction={declineAction}
              request={r}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
