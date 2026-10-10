import { Check, X } from "lucide-react";
import type { MembershipStatus } from "@linkaffipro/db";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Button } from "@/components/ui/button";
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
  source: string;
  requestedAt: string;
  lastError: string | null;
};

/**
 * Une demande d'adhésion en carte (pensée d'abord pour le téléphone) : qui, où en est la demande, d'où elle vient,
 * puis « Accepter » et « Refuser » en boutons de 40 px. Mêmes actions serveur qu'avant.
 */
export function RequestCard({
  request: r,
  channelId,
  approveAction,
  declineAction,
}: {
  request: RequestCardData;
  channelId: string;
  approveAction: (formData: FormData) => Promise<void>;
  declineAction: (formData: FormData) => Promise<void>;
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
      <dl className="mt-1 space-y-0.5 text-note text-muted-foreground">
        <div className="flex gap-1">
          <dt className="shrink-0">Origine :</dt>
          <dd className="min-w-0 truncate" title={r.source}>
            {r.source}
          </dd>
        </div>
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
