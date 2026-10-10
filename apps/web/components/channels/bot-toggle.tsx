import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/** Dessin de l'interrupteur (le bouton porte l'état pour les lecteurs d'écran avec `aria-pressed`). */
function Track({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        on ? "border-brand bg-brand" : "border-muted-foreground/75 bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute size-3.5 rounded-full bg-surface shadow-xs transition-transform",
          on ? "translate-x-[1.125rem] bg-night" : "translate-x-0.5 bg-muted-foreground",
        )}
      />
    </span>
  );
}

/**
 * Interrupteur « Activé » d'un message du bot : bouton bascule (`aria-pressed`) qui envoie `toggleSequenceAction`.
 * Désactiver demande confirmation (le bot reprend son texte intégré). `view` : la carte reste en aperçu ensuite.
 */
export function BotToggle({
  active,
  title,
  channelId,
  trigger,
  view,
  action,
}: {
  active: boolean;
  title: string;
  channelId: string;
  trigger: string;
  view: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const label = (
    <>
      <Track on={active} />
      <span>{active ? "Activé" : "Désactivé"}</span>
      <span className="sr-only"> : message « {title} »</span>
    </>
  );
  return (
    <form action={action}>
      <input type="hidden" name="channelId" value={channelId} />
      <input type="hidden" name="trigger" value={trigger} />
      {view ? <input type="hidden" name="mode" value="view" /> : null}
      {active ? (
        <ConfirmSubmit
          variant="ghost"
          className="max-md:h-10"
          aria-pressed
          confirmTitle={`Désactiver le message « ${title} » ?`}
          confirmLabel="Désactiver"
          message="Le bot utilisera son texte intégré par défaut à la place du vôtre. Votre texte est conservé et vous pourrez le réactiver."
        >
          {label}
        </ConfirmSubmit>
      ) : (
        <Button type="submit" variant="ghost" className="max-md:h-10" aria-pressed={false}>
          {label}
        </Button>
      )}
    </form>
  );
}
