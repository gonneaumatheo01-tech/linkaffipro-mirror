"use client";

import { useActionState } from "react";
import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { TestEventState } from "../affiliates-actions";

type TestAction = (prev: TestEventState, formData: FormData) => Promise<TestEventState>;

const TITLES = {
  received: "Reçu",
  signature_refused: "Signature refusée",
  rejected: "Reçu mais refusé",
  unreachable: "Injoignable",
} as const;

/**
 * « Envoyer un événement de test » : appel signé immédiat vers la fonction Link Affi, résultat lisible juste dessous
 * (reçu / signature refusée / reçu mais refusé / injoignable).
 */
export function TestEventButton({ action, disabled }: { action: TestAction; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  const outcome = state?.outcome;
  return (
    <div className="space-y-3">
      <form action={formAction}>
        <Button
          type="submit"
          variant="outline"
          className="max-md:h-10"
          disabled={pending || disabled}
        >
          <Send aria-hidden />
          {pending ? "Envoi en cours…" : "Envoyer un événement de test"}
        </Button>
      </form>
      <div aria-live="polite">
        {state?.error ? (
          <Alert variant="destructive" role="status">
            <CircleAlert aria-hidden />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : outcome ? (
          <Alert
            variant={
              outcome === "received"
                ? "success"
                : outcome === "rejected"
                  ? "warning"
                  : "destructive"
            }
            role="status"
          >
            {outcome === "received" ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
            <AlertTitle>{TITLES[outcome]}</AlertTitle>
            <AlertDescription>{state?.message}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
