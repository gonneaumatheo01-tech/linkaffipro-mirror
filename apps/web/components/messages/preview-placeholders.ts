/**
 * Repères {prenom}, {offre}, {canal}… dans un aperçu de message (galerie de modèles) : mis en évidence avec le style
 * « à compléter » de l'éditeur (fond jaune d'attention), sans toucher aux balises ni aux adresses des liens.
 * Un message de canal ne remplace aucun repère : ils partiraient tels quels, il faut écrire les vrais mots.
 */
import { KNOWN_PLACEHOLDERS, unresolvedPlaceholders } from "@/components/editor/editor-logic";
import { markPlaceholders } from "@/components/editor/telegram-format";

/** Classes du repère à compléter (mêmes couleurs que `.lap-ph-warn` de l'éditeur). */
export const PLACEHOLDER_MARK_CLASS = "rounded-sm bg-warning-soft px-0.5 text-warning";

/** HTML d'aperçu (déjà validé) avec chaque repère connu entouré d'un `<mark>` stylé. */
export function markTemplatePlaceholders(html: string): string {
  return markPlaceholders(html, KNOWN_PLACEHOLDERS).replace(
    /<span class="lap-ph">([^<]*)<\/span>/g,
    `<mark class="${PLACEHOLDER_MARK_CLASS}">$1</mark>`,
  );
}

/** Repères à compléter d'un texte de message, uniques, dans l'ordre d'apparition (« offre », « canal »…). */
export function placeholdersToComplete(html: string): string[] {
  return unresolvedPlaceholders(html, []);
}
