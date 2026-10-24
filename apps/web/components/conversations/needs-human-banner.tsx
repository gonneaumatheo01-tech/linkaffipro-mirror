import { CircleAlert, Check } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NEEDS_HUMAN_LABEL, needsHumanReasonLabel } from "@/lib/conversations/labels";
import { fmtDate, fmtRelative } from "@/lib/format";

const capitalized = (s: string) => `${s.charAt(0).toLocaleUpperCase("fr")}${s.slice(1)}`;

type FormAction = (formData: FormData) => Promise<void>;

/**
 * Bandeau « À traiter : <motif> » de la fiche d'une conversation (phase 25) : l'assistante a passé la main à l'équipe
 * (question hors de la fiche d'informations, réclamation, demande d'argent, mineur possible, insulte). Depuis quand,
 * ce qui efface le repère (prendre la main, écrire), et le bouton « Marquer comme traitée » (jamais orange : le seul
 * bouton orange de la fiche reste « Envoyer »). Rien quand la conversation n'est pas à traiter. Composant serveur.
 */
export function NeedsHumanBanner({
  conversationId,
  since,
  reason,
  canWrite,
  assistant,
  now = new Date(),
  action,
}: {
  conversationId: string;
  since: Date | null;
  reason: string | null;
  /** L'équipe peut encore écrire à cette personne (sinon : /stop, mineur, bloquée). */
  canWrite: boolean;
  /** « l'assistante » / « l'assistant ». */
  assistant: string;
  now?: Date;
  action: FormAction;
}) {
  if (!since) return null;
  return (
    <Alert variant="warning" role="status">
      <CircleAlert aria-hidden />
      <AlertTitle>
        {NEEDS_HUMAN_LABEL} : {needsHumanReasonLabel(reason)}
      </AlertTitle>
      <AlertDescription>
        <p>
          {`Depuis le ${fmtDate(since)} (${fmtRelative(since, now)}). ${capitalized(assistant)} a passé la main à l'équipe. `}
          {canWrite
            ? "Prenez la main ou écrivez à cette personne : le repère s'efface tout seul."
            : "Plus aucun message ne peut être envoyé à cette personne : marquez la conversation comme traitée une fois vérifiée."}
        </p>
        <form action={action} className="mt-2">
          <input type="hidden" name="id" value={conversationId} />
          <Button type="submit" variant="outline" className="max-md:h-10">
            <Check aria-hidden />
            Marquer comme traitée
          </Button>
        </form>
      </AlertDescription>
    </Alert>
  );
}
