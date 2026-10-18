import { Clock, CornerDownRight, Link2, Play, TriangleAlert } from "lucide-react";
import { StatusPill } from "@/components/admin/status-pill";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { INTERRUPTED_TEXT, type OfferState, type ThreadMessage } from "@/lib/conversations/thread";

/** Classes d'une bulle selon qui parle : la personne à gauche, l'assistante et l'équipe à droite. */
const BUBBLE = {
  MEMBER: "border border-border bg-card rounded-bl-sm",
  ASSISTANT: "bg-brand-soft rounded-br-sm",
  TEAM: "border border-info/30 bg-info-soft rounded-br-sm",
  SYSTEM: "bg-muted",
} as const;

function When({ at }: { at: string }) {
  return (
    <time dateTime={at} suppressHydrationWarning className="text-note text-muted-foreground">
      {fmtDate(new Date(at))}
    </time>
  );
}

/** Le bouton de l'offre joint au message, tel que la personne l'a reçu, avec ouvert / pas encore ouvert. */
function OfferChip({ offer }: { offer: OfferState | undefined }) {
  const opened = offer?.openedAt ?? null;
  return (
    <span className="mt-2 flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-note font-medium text-foreground">
        <Link2 aria-hidden className="size-3.5" />
        Lien de l&apos;offre envoyé
      </span>
      {opened ? (
        <StatusPill
          tone="success"
          title={offer && offer.opens > 1 ? `${offer.opens} ouvertures` : undefined}
        >
          Ouvert le{" "}
          <time dateTime={opened} suppressHydrationWarning>
            {fmtDate(new Date(opened))}
          </time>
        </StatusPill>
      ) : (
        <StatusPill tone="muted">Pas encore ouvert</StatusPill>
      )}
    </span>
  );
}

/**
 * État de l'envoi sous un message sortant : en cours, interrompu (peut-être parti, peut-être pas), ou raté avec sa
 * raison. Rien une fois parti.
 */
function Delivery({ m }: { m: ThreadMessage }) {
  if (m.interrupted)
    return (
      <span className="inline-flex items-start gap-1 text-note text-warning">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {INTERRUPTED_TEXT}
      </span>
    );
  if (m.delivery === "QUEUED")
    return (
      <span className="inline-flex items-center gap-1 text-note text-muted-foreground">
        <Clock aria-hidden className="size-3.5" />
        Envoi en cours…
      </span>
    );
  if (m.delivery === "FAILED" || m.delivery === "BLOCKED")
    return (
      <span className="inline-flex items-start gap-1 text-note text-danger">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Non envoyé{m.deliveryError ? ` : ${m.deliveryError}` : "."}
      </span>
    );
  return null;
}

/**
 * Une ligne du fil d'une conversation : bulle de la personne (à gauche), de l'assistante ou de l'équipe (à droite,
 * avec le prénom du membre de l'équipe), ligne centrée pour un message automatique ou l'appui sur Démarrer. Médias
 * décrits (« [photo] »), bouton de l'offre « Lien de l'offre envoyé » (ouvert / pas encore ouvert), relance, message
 * d'attente, état de l'envoi. Composant sans état (rendu par le fil en direct, composant client).
 */
export function MessageBubble({
  message: m,
  offer,
}: {
  message: ThreadMessage;
  offer?: OfferState;
}) {
  if (m.start)
    return (
      <li className="flex justify-center">
        <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full bg-muted px-3 py-1 text-center text-note text-muted-foreground">
          <Play aria-hidden className="size-3.5" />
          La personne a appuyé sur Démarrer
          {m.start.source ? ` · source « ${m.start.source} »` : ""}
          <span aria-hidden>·</span>
          <When at={m.at} />
        </span>
      </li>
    );
  if (m.side === "system")
    return (
      <li className="flex justify-center">
        <span className="max-w-[min(36rem,90%)] rounded-xl bg-muted px-3 py-2 text-center text-note text-muted-foreground">
          <span className="block font-medium text-foreground">{m.authorLabel}</span>
          <span className="block whitespace-pre-wrap break-words">{m.text}</span>
          <When at={m.at} />
        </span>
      </li>
    );
  const out = m.side === "out";
  return (
    <li className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[min(36rem,88%)] flex-col gap-1",
          out ? "items-end" : "items-start",
        )}
      >
        <span className="text-note font-medium text-muted-foreground">{m.authorLabel}</span>
        <div
          className={cn("rounded-2xl px-3.5 py-2.5 text-body text-foreground", BUBBLE[m.author])}
        >
          <p className="whitespace-pre-wrap break-words">
            {m.text || <span className="text-muted-foreground">(message vide)</span>}
          </p>
          {m.offerSubId ? <OfferChip offer={offer} /> : null}
        </div>
        <span className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", out && "justify-end")}>
          {m.followUp ? (
            <span className="inline-flex items-center gap-1 text-note text-muted-foreground">
              <CornerDownRight aria-hidden className="size-3.5" />
              Relance après un silence
            </span>
          ) : null}
          {m.neutral ? (
            <span className="text-note text-muted-foreground">
              Message d&apos;attente : l&apos;IA n&apos;a pas pu répondre
            </span>
          ) : null}
          <When at={m.at} />
          <Delivery m={m} />
        </span>
      </div>
    </li>
  );
}
