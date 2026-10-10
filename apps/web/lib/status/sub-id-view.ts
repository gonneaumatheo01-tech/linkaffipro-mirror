/**
 * Santé de l'identifiant de suivi (sub-ID) dite en français simple pour Réglages → Connexions (fonction pure, testée
 * dans sub-id-view.test.ts). Le calcul ne change pas (`evaluateSubIdHealth` dans packages/linkaffi) : seule la phrase
 * affichée est réécrite sans jargon ; le message technique d'origine reste dans le bloc « Avancé ».
 */
import type { SubIdHealth } from "@linkaffipro/linkaffi";
import type { PillTone } from "@/components/admin/status-pill";

export type SubIdHealthView = {
  tone: PillTone;
  /** Variante de l'encadré (`Alert`). */
  alert: "success" | "warning" | "destructive" | "info";
  title: string;
  sentence: string;
};

export function subIdHealthView(
  h: Pick<SubIdHealth, "status" | "postback" | "timeMatch" | "missingWithClicks">,
): SubIdHealthView {
  switch (h.status) {
    case "ok":
      return {
        tone: "success",
        alert: "success",
        title: "Tout va bien",
        sentence:
          "Les inscriptions reviennent avec leur identifiant de suivi : chaque joueur est relié à sa pub, son message et son membre.",
      };
    case "alert":
      return {
        tone: "danger",
        alert: "destructive",
        title: "À corriger",
        sentence:
          "Les joueurs reviennent sans identifiant de suivi exploitable : le casino l'abîme sans doute en route. Demandez à Link Affi un format sans point.",
      };
    case "warning":
      return {
        tone: "warning",
        alert: "warning",
        title: "À surveiller",
        sentence:
          h.postback === 0
            ? "Aucun joueur n'est encore revenu avec son identifiant de suivi : à surveiller dès les premières inscriptions."
            : "Beaucoup de joueurs reviennent sans identifiant de suivi malgré vos clics : vérifiez les liens d'offre utilisés.",
      };
    default:
      return {
        tone: "muted",
        alert: "info",
        title: "En attente de données",
        sentence: "Aucun clic sur une offre ces 7 derniers jours : rien à vérifier pour l'instant.",
      };
  }
}
