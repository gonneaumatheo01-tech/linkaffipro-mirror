import { StatusPill } from "@/components/admin/status-pill";
import { botStatusLabel, NOBODY_REPLIES_LABEL } from "@/lib/conversations/labels";
import { entryTone, StatusBadge, statusEntry } from "@/lib/status-badges";

/**
 * Pastille « Qui répond » d'une conversation (boîte de réception, fiche) : « L'assistante répond » accordé à la persona
 * (« L'assistant répond » pour une persona masculine), et « Personne ne répond » (ambre, raison au survol) quand la
 * conversation est laissée à l'assistante mais qu'elle ne répondra pas (`replyBlock` de `lib/conversations/reply-state`).
 * Les autres statuts : `StatusBadge` (même libellé et même couleur partout). Composant serveur.
 */
export function ConversationStatusBadge({
  status,
  gender,
  nobodyReason,
  className,
}: {
  status: string;
  gender: string | null | undefined;
  /** Raison pour laquelle personne ne répondra (phrase), ou null / absent si l'assistante répond. */
  nobodyReason?: string | null;
  className?: string;
}) {
  if (status !== "BOT")
    return <StatusBadge kind="conversationStatus" value={status} className={className} />;
  if (nobodyReason)
    return (
      <StatusPill tone="warning" title={nobodyReason} className={className}>
        {NOBODY_REPLIES_LABEL}
      </StatusPill>
    );
  return (
    <StatusPill tone={entryTone(statusEntry("conversationStatus", "BOT"))} className={className}>
      {botStatusLabel(gender)}
    </StatusPill>
  );
}
