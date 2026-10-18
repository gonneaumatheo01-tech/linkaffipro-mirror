import { Ban, Bot, CircleStop, Hand } from "lucide-react";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Button } from "@/components/ui/button";
import type { ConversationActions } from "@/lib/conversations/rules";
import { assistantWord, releaseLabel } from "@/lib/conversations/labels";

type FormAction = (formData: FormData) => Promise<void>;

/**
 * Boutons de reprise en main d'une conversation (fiche /conversations/[id]) : « Prendre la main », « Rendre à
 * l'assistante », « Fermer », « Bloquer » (confirmation). Jamais orange : le seul bouton orange de la fiche est
 * « Envoyer ». Seules les actions possibles sont montrées ; si aucune ne l'est, la phrase d'explication suffit.
 * Composant serveur (formulaires vers les actions serveur).
 */
export function ConversationActionButtons({
  conversationId,
  actions,
  gender,
  takeOverAction,
  releaseAction,
  closeAction,
  blockAction,
}: {
  conversationId: string;
  actions: ConversationActions;
  /** Genre de la persona (« F » : « l'assistante »). */
  gender: string | null;
  takeOverAction: FormAction;
  releaseAction: FormAction;
  closeAction: FormAction;
  blockAction: FormAction;
}) {
  const any = actions.takeOver || actions.release || actions.close || actions.block;
  if (!any) return null;
  const hidden = <input type="hidden" name="id" value={conversationId} />;
  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Qui répond dans cette conversation"
    >
      {actions.takeOver ? (
        <form action={takeOverAction}>
          {hidden}
          <Button type="submit" variant="outline" className="max-md:h-10">
            <Hand aria-hidden />
            Prendre la main
          </Button>
        </form>
      ) : null}
      {actions.release ? (
        <form action={releaseAction}>
          {hidden}
          <Button type="submit" variant="outline" className="max-md:h-10">
            <Bot aria-hidden />
            {releaseLabel(gender)}
          </Button>
        </form>
      ) : null}
      {actions.close ? (
        <form action={closeAction}>
          {hidden}
          <ConfirmSubmit
            variant="ghost"
            className="max-md:h-10"
            destructive={false}
            message="La conversation est terminée : ni réponse ni relance. Vous pourrez la rouvrir en prenant la main ou en écrivant."
          >
            <CircleStop aria-hidden />
            Fermer
          </ConfirmSubmit>
        </form>
      ) : null}
      {actions.block ? (
        <form action={blockAction}>
          {hidden}
          <ConfirmSubmit
            variant="destructive"
            className="max-md:h-10"
            message={`Plus aucun message ne partira vers cette personne, ni de ${assistantWord(gender)} ni de l'équipe, même si elle réécrit. C'est définitif.`}
            confirmTitle="Bloquer cette conversation ?"
          >
            <Ban aria-hidden />
            Bloquer
          </ConfirmSubmit>
        </form>
      ) : null}
    </div>
  );
}
