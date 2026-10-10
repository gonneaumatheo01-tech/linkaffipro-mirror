import { cn } from "@/components/ui/cn";
import { progressSentence } from "@/lib/broadcasts/display";

/**
 * Barre d'avancement d'un envoi (messages traités sur destinataires), en orange de marque, avec la phrase
 * « 980 traités sur 1 240 (79 %) ». Composant serveur.
 */
export function BroadcastProgress({
  b,
  label = "Avancement de l'envoi",
  className,
}: {
  b: { targeted: number; sent: number; failed: number; blocked: number };
  label?: string;
  className?: string;
}) {
  const p = progressSentence(b);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.pct}
        aria-label={label}
        aria-valuetext={p.sentence}
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${p.pct}%` }} />
      </div>
      <p className="text-note text-muted-foreground tabular-nums">{p.sentence}</p>
    </div>
  );
}
