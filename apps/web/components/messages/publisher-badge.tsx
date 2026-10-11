import { Sparkles } from "lucide-react";
import { StatusPill } from "@/components/admin/status-pill";
import { cn } from "@/components/ui/cn";
import { statusLabel } from "@/lib/status-badges";

/** « Publié par votre compte · emojis animés » (libellé du dictionnaire des statuts, `postPublisher`). */
export const ACCOUNT_PUBLISHER_LABEL = `${statusLabel("postPublisher", "ACCOUNT")} · emojis animés`;
/** Version courte (cartes du calendrier) ; le libellé complet reste au survol et pour les lecteurs d'écran. */
export const ACCOUNT_PUBLISHER_SHORT = "Votre compte";

/**
 * Badge d'un message de canal publié par le compte Telegram connecté (emojis animés, sans boutons), phase 12. Rien pour
 * un message publié par le bot (le cas habituel). `compact` : carte du calendrier (« ✦ Votre compte »).
 */
export function PublisherBadge({
  publisher,
  compact = false,
  className,
}: {
  publisher: string | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  if (publisher !== "ACCOUNT") return null;
  if (compact)
    return (
      <StatusPill
        tone="brand"
        dot={false}
        title={ACCOUNT_PUBLISHER_LABEL}
        className={cn("h-5 gap-1 px-1.5", className)}
      >
        <Sparkles aria-hidden className="size-3" />
        <span aria-hidden>{ACCOUNT_PUBLISHER_SHORT}</span>
        <span className="sr-only">{ACCOUNT_PUBLISHER_LABEL}</span>
      </StatusPill>
    );
  return (
    <StatusPill tone="brand" dot={false} className={className}>
      <Sparkles aria-hidden className="size-3.5" />
      {ACCOUNT_PUBLISHER_LABEL}
    </StatusPill>
  );
}
