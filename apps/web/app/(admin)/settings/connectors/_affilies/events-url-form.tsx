"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/components/ui/cn";
import type { EventsUrlState } from "../affiliates-actions";
import { eventsUrlField } from "./events-url-field";

type SaveAction = (prev: EventsUrlState, formData: FormData) => Promise<EventsUrlState>;

/**
 * Adresse de la fonction Link Affi qui reçoit les événements des membres (pré-remplie avec l'adresse d'origine,
 * modifiable). Vide = adresse d'origine. Retour en ligne sous le champ ; une saisie refusée reste dans le champ.
 */
export function EventsUrlForm({
  url,
  isDefault,
  defaultUrl,
  action,
}: {
  url: string;
  isDefault: boolean;
  defaultUrl: string;
  action: SaveAction;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const id = useId();
  const helpId = `${id}-help`;
  const resultId = `${id}-result`;
  const field = eventsUrlField(url, state);
  return (
    <form action={formAction} className="space-y-2">
      <Label htmlFor={id}>Adresse où envoyer les événements des membres</Label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          // Champ non contrôlé : repart de l'adresse enregistrée, ou de la saisie refusée après une erreur.
          key={field.key}
          id={id}
          name="eventsUrl"
          type="url"
          inputMode="url"
          defaultValue={field.defaultValue}
          placeholder={defaultUrl}
          autoComplete="off"
          spellCheck={false}
          className="font-mono md:text-note"
          aria-describedby={`${helpId}${state ? ` ${resultId}` : ""}`}
          aria-invalid={state?.error ? true : undefined}
        />
        <Button type="submit" variant="outline" className="shrink-0 max-md:h-10" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer l'adresse"}
        </Button>
      </div>
      <p id={helpId} className="text-note text-muted-foreground">
        {isDefault
          ? "C'est l'adresse d'origine de Link Affi : ne la changez que si Link Affi vous en donne une autre."
          : "Adresse modifiée. Videz le champ et enregistrez pour revenir à l'adresse d'origine de Link Affi."}
      </p>
      {state ? (
        <p
          id={resultId}
          role={state.error ? "alert" : "status"}
          className={cn("text-note", state.error ? "text-danger" : "text-success")}
        >
          {state.error ?? state.ok}
        </p>
      ) : null}
    </form>
  );
}
