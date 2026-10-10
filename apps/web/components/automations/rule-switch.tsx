"use client";

import { FlaskConical } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/** Dessin de l'interrupteur (l'état est porté par `aria-pressed` du bouton, et écrit à côté). */
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
          "absolute size-3.5 rounded-full shadow-xs transition-transform",
          on ? "translate-x-[1.125rem] bg-night" : "translate-x-0.5 bg-muted-foreground",
        )}
      />
    </span>
  );
}

/**
 * Interrupteur « Activée / Désactivée » d'une relance : envoie `toggleRuleAction` après confirmation (« Cette
 * relance partira automatiquement vers les membres concernés »). Sans relance enregistrée (`ruleId` null),
 * l'interrupteur est grisé : la carte doit d'abord être réglée. `back="list"` : retour aux cartes.
 */
export function RuleSwitch({
  ruleId,
  active,
  title,
  action,
  back,
  className,
}: {
  ruleId: string | null;
  active: boolean;
  /** Nom de la relance (lu par les lecteurs d'écran, repris dans la confirmation). */
  title: string;
  action: (formData: FormData) => Promise<void>;
  back?: "list";
  className?: string;
}) {
  const label = (
    <>
      <Track on={active} />
      <span>{active ? "Activée" : "Désactivée"}</span>
      <span className="sr-only"> : relance « {title} »</span>
    </>
  );
  if (!ruleId)
    return (
      <Button
        type="button"
        variant="ghost"
        disabled
        aria-pressed={false}
        title="Enregistrez d'abord les réglages de cette relance."
        className={cn("max-md:h-10", className)}
      >
        {label}
      </Button>
    );
  return (
    <form action={action} className={className}>
      <input type="hidden" name="ruleId" value={ruleId} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <ConfirmDialog
        title={active ? `Désactiver « ${title} » ?` : `Activer « ${title} » ?`}
        description={
          active
            ? "Plus aucun membre ne recevra cette relance. Ceux qui attendaient la suite sont arrêtés."
            : "Cette relance partira automatiquement vers les membres concernés."
        }
        confirmLabel={active ? "Désactiver" : "Activer"}
        destructive={active}
        trigger={
          <Button type="submit" variant="ghost" aria-pressed={active} className="max-md:h-10">
            {label}
          </Button>
        }
      />
    </form>
  );
}

/**
 * « Tester sur moi » : la relance part vers le compte Telegram de l'utilisateur connecté (messages de test, aucune
 * étiquette ; un parcours à branches passe ses attentes). Grisé tant que la relance n'est pas enregistrée.
 */
export function TestOnMeButton({
  ruleId,
  action,
  back,
  disabledReason,
  size = "sm",
  className,
}: {
  ruleId: string | null;
  action: (formData: FormData) => Promise<void>;
  back?: "list";
  /** Raison affichée au survol quand le test est impossible (relance pas enregistrée, modifications en cours). */
  disabledReason?: string | null;
  size?: "sm" | "default";
  className?: string;
}) {
  const reason = !ruleId ? "Enregistrez d'abord les réglages de cette relance." : disabledReason;
  if (reason)
    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled
        title={reason}
        className={cn("max-md:h-10", className)}
      >
        <FlaskConical aria-hidden />
        Tester sur moi
      </Button>
    );
  return (
    <form action={action} className={className}>
      <input type="hidden" name="ruleId" value={ruleId ?? ""} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <Button type="submit" variant="outline" size={size} className="max-md:h-10">
        <FlaskConical aria-hidden />
        Tester sur moi
      </Button>
    </form>
  );
}
