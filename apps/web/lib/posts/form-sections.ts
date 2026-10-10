/**
 * Formulaire de message en trois niveaux (docs/REFONTE-UX.md « Formulaires en trois niveaux ») : ce qui est ouvert
 * au départ, réglages avancés modifiés, phrase de récapitulatif. Fonctions pures, testées dans form-sections.test.ts.
 * Niveau 1 (visible) : canaux, texte (aperçu), date et heure, catégorie.
 * Niveau 2 (un clic) : médias, boutons, test A/B.
 * Niveau 3 (« Avancé », replié) : épingler, désépingler, supprimer après, silencieux, contenu protégé, sans aperçu de
 * lien, langue, écart entre les versions A et B.
 */
import { momentLabel } from "./calendar";

export type AdvancedValues = {
  pinAfterSend: boolean;
  unpinPrevious: boolean;
  /** Minutes, texte du champ ("" = jamais). */
  deleteAfterMinutes: string;
  disableNotification: boolean;
  protectContent: boolean;
  disableLinkPreview: boolean;
  language: string;
  /** Écart A → B en minutes (test A/B dans le même canal), texte du champ. */
  abDelayMinutes?: string;
};

/** Valeurs par défaut d'un nouveau message (celles du schéma `postFormSchema`). */
export const ADVANCED_DEFAULTS: Required<AdvancedValues> = {
  pinAfterSend: false,
  unpinPrevious: false,
  deleteAfterMinutes: "",
  disableNotification: false,
  protectContent: false,
  disableLinkPreview: true,
  language: "fr",
  abDelayMinutes: "30",
};

/** Nombre de réglages avancés qui s'écartent des valeurs par défaut (affiché sur le bloc replié). */
export function advancedModifiedCount(
  v: AdvancedValues,
  defaults: Required<AdvancedValues> = ADVANCED_DEFAULTS,
): number {
  let n = 0;
  if (v.pinAfterSend !== defaults.pinAfterSend) n++;
  if (v.unpinPrevious !== defaults.unpinPrevious) n++;
  if (v.deleteAfterMinutes.trim() !== defaults.deleteAfterMinutes) n++;
  if (v.disableNotification !== defaults.disableNotification) n++;
  if (v.protectContent !== defaults.protectContent) n++;
  if (v.disableLinkPreview !== defaults.disableLinkPreview) n++;
  if ((v.language.trim().toLowerCase() || defaults.language) !== defaults.language) n++;
  if (v.abDelayMinutes !== undefined && v.abDelayMinutes.trim() !== defaults.abDelayMinutes) n++;
  return n;
}

/** Sections du niveau 2 ouvertes d'office : celles qui ont déjà un contenu (message modifié ou dupliqué). */
export function initialSections(initial: { mediaCount: number; buttonRows: number }): {
  media: boolean;
  buttons: boolean;
} {
  return { media: initial.mediaCount > 0, buttons: initial.buttonRows > 0 };
}

/**
 * Récapitulatif sous les boutons : « Partira le mardi 6 octobre à 14:30 dans 2 canaux. » ; test A/B : « … version B
 * 30 minutes plus tard ». Sans date ou sans canal : ce qu'il manque.
 */
export function scheduleSummary(input: {
  scheduledAt: string;
  channelCount: number;
  ab?: { mode: "same-channel" | "other-channel"; delayMinutes: string } | null;
}): string {
  if (input.channelCount === 0) return "Choisissez au moins un canal.";
  if (!input.scheduledAt) return "Choisissez une date et une heure pour programmer l'envoi.";
  const where = input.channelCount > 1 ? ` dans ${input.channelCount} canaux` : "";
  const ab = input.ab
    ? input.ab.mode === "same-channel"
      ? `, version B ${input.ab.delayMinutes.trim() || ADVANCED_DEFAULTS.abDelayMinutes} minutes plus tard`
      : ", version B à la même heure dans l'autre canal"
    : "";
  return `Partira le ${momentLabel(input.scheduledAt.slice(0, 16))}${where}${ab}.`;
}
