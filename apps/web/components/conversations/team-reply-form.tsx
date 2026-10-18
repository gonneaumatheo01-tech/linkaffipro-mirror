"use client";

import { useActionState, useId, useState } from "react";
import { CircleAlert, CircleCheck, Lock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TEAM_MESSAGE_MAX } from "@/lib/conversations/rules";
import type { TeamReplyState } from "@/app/(admin)/conversations/[id]/actions";
import { requestThreadRefresh } from "./conversation-thread";

/**
 * Zone « Écrire à cette personne » sous le fil : texte brut (4 000 caractères au plus) et « Envoyer », le seul bouton
 * orange de la fiche. Si l'assistante avait la main, l'envoi la donne à l'équipe (dit sous le champ). Envoi impossible
 * (/stop, mineur, conversation bloquée, bot bloqué) : la raison remplace le formulaire. Le texte est vidé après un
 * envoi réussi (gardé après un refus) et le fil se relit tout de suite.
 */
export function TeamReplyForm({
  conversationId,
  action,
  lockMessage,
  willTakeOver,
  assistant,
}: {
  conversationId: string;
  action: (prev: TeamReplyState, formData: FormData) => Promise<TeamReplyState>;
  /** Pourquoi rien ne peut partir (null : l'envoi est permis). */
  lockMessage: string | null;
  /** L'équipe n'a pas encore la main : l'envoi la prend. */
  willTakeOver: boolean;
  /** « l'assistante » / « l'assistant ». */
  assistant: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  // Texte vidé seulement après un envoi réussi (gardé en cas de refus), puis le fil se relit tout de suite.
  const [state, formAction, pending] = useActionState(
    async (prev: TeamReplyState, fd: FormData): Promise<TeamReplyState> => {
      const next = await action(prev, fd);
      if (next.status === "sent") {
        setText("");
        requestThreadRefresh();
      }
      return next;
    },
    { status: "idle" },
  );
  const length = [...text].length;
  const tooLong = length > TEAM_MESSAGE_MAX;

  if (lockMessage)
    return (
      <div
        role="note"
        className="flex items-start gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-body text-foreground"
      >
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>{lockMessage}</p>
      </div>
    );

  const helpId = `${id}-help`;
  const countId = `${id}-count`;
  return (
    <form
      action={formAction}
      className="space-y-2 rounded-xl border border-border bg-card p-3 md:p-4"
      aria-labelledby={`${id}-label`}
    >
      <input type="hidden" name="id" value={conversationId} />
      <Label id={`${id}-label`} htmlFor={`${id}-text`}>
        Écrire à cette personne
      </Label>
      <Textarea
        id={`${id}-text`}
        name="text"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
        aria-invalid={tooLong || undefined}
        aria-describedby={`${helpId} ${countId}`}
        placeholder="Votre message, tel que la personne le lira"
        className="resize-y"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={helpId} className="text-note text-muted-foreground">
          {willTakeOver
            ? `En envoyant, vous prenez la main : ${assistant} ne répond plus dans cette conversation.`
            : `Vous avez la main : ${assistant} ne répond pas tant que vous ne lui rendez pas la conversation.`}
        </p>
        <div className="flex items-center gap-3">
          <span
            id={countId}
            className={cn(
              "text-note tabular-nums",
              tooLong ? "font-medium text-danger" : "text-muted-foreground",
            )}
          >
            {length.toLocaleString("fr-FR")} / {TEAM_MESSAGE_MAX.toLocaleString("fr-FR")}
          </span>
          <Button
            type="submit"
            disabled={pending || tooLong || length === 0}
            className="max-md:h-10"
          >
            <Send aria-hidden />
            {pending ? "Envoi…" : "Envoyer"}
          </Button>
        </div>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="flex items-start gap-2 text-note text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      {state.status === "sent" ? (
        <p role="status" className="flex items-start gap-2 text-note text-success">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
