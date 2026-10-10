/**
 * Assistants de la rubrique Campagnes : règles pures d'affichage (sans base de données), testées dans
 * wizard-display.test.ts. La logique de l'assistant « Nouvelle campagne » (validation, envoi) reste dans
 * `wizard.ts` ; ici seulement ce qui décide de l'affichage (réglages « Avancé » modifiés, étapes de l'import CSV).
 */
import { toUniverse, UNIVERSES, UNIVERSE_LABELS, type Universe } from "@/lib/universe";

/** Choix d'univers de l'étape 1 (cartes à cocher), « Sans univers » en dernier. */
export const UNIVERSE_CHOICES: ReadonlyArray<{ value: Universe | ""; label: string }> = [
  ...UNIVERSES.map((u) => ({ value: u, label: UNIVERSE_LABELS[u] })),
  { value: "", label: "Sans univers" },
];

/**
 * Étape 2 : les offres de l'univers choisi à l'étape 1 passent en tête (tri d'affichage seulement, stable : l'ordre
 * d'origine est gardé dans chaque bloc). Sans univers choisi, ordre inchangé.
 */
export function offersUniverseFirst<T extends { vertical: string | null }>(
  offers: readonly T[],
  universe: string | null | undefined,
): T[] {
  const u = toUniverse(universe);
  if (!u) return [...offers];
  const same: T[] = [];
  const others: T[] = [];
  for (const o of offers) (toUniverse(o.vertical) === u ? same : others).push(o);
  return [...same, ...others];
}

function filled(v: unknown): boolean {
  return typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined;
}

/** Réglages facultatifs de l'étape 1 remplis (budget, début, fin, notes) : compteur du bloc « Avancé ». */
export function generalAdvancedCount(v: {
  budgetDaily?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  notes?: string | null;
}): number {
  return [v.budgetDaily, v.startAt, v.endAt, v.notes].filter(filled).length;
}

/** Réglages facultatifs de l'étape 4 remplis (compte pub connecté, campagne pub déjà importée). */
export function adsAdvancedCount(v: {
  connectionId?: string | null;
  importedCampaignId?: string | null;
}): number {
  return [v.connectionId, v.connectionId ? v.importedCampaignId : null].filter(filled).length;
}

// ——— Import CSV des dépenses ———

export const IMPORT_STEPS = [
  {
    key: "file",
    title: "Fichier",
    help: "Exportez de TikTok ou Meta un rapport par jour (campagne, groupe, pub, dépense), puis choisissez-le ici.",
  },
  {
    key: "check",
    title: "Vérification",
    help: "Vérifiez les colonnes reconnues et l'aperçu ; corrigez puis « Relire » si besoin.",
  },
  {
    key: "import",
    title: "Import",
    help: "Contrôlez les campagnes pub retrouvées ou à créer, puis importez : un rapport s'affiche à la fin.",
  },
] as const;

/** Étape choisie par l'utilisateur pour un aperçu donné (le même objet que l'état du formulaire). */
export type ImportView = { preview: unknown; step: number };

/**
 * Étape affichée de l'import : 0 sans aperçu ; avec un aperçu, l'étape choisie pour CET aperçu, sinon 1
 * (un nouvel aperçu, après « Lire » ou « Relire », ramène toujours à la vérification).
 */
export function importStep(preview: unknown, view: ImportView | null): number {
  if (!preview) return 0;
  if (view && view.preview === preview) return Math.min(Math.max(0, view.step), 2);
  return 1;
}
