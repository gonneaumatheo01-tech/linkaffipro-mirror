/**
 * Assistants de la rubrique Campagnes : règles pures d'affichage (sans base de données), testées dans
 * wizard-display.test.ts. La logique de l'assistant « Nouvelle campagne » (validation, envoi) reste dans
 * `wizard.ts` ; ici seulement ce qui décide de l'affichage (réglages « Avancé » modifiés, étapes de l'import CSV).
 */
import { toUniverse, UNIVERSES, UNIVERSE_LABELS, type Universe } from "@/lib/universe";
import type { WizardField, WizardStepKey } from "./wizard";

/** Choix d'univers de l'étape 1 (cartes à cocher), « Sans univers » en dernier. */
export const UNIVERSE_CHOICES: ReadonlyArray<{ value: Universe | ""; label: string }> = [
  ...UNIVERSES.map((u) => ({ value: u, label: UNIVERSE_LABELS[u] })),
  { value: "", label: "Sans univers" },
];

/**
 * Étapes 2 et 3 : les offres et les canaux de l'univers choisi à l'étape 1 passent en tête (tri d'affichage
 * seulement, stable : l'ordre d'origine est gardé dans chaque bloc ; rien n'est coché d'office). Sans univers choisi,
 * ordre inchangé.
 */
export function universeFirst<T extends { vertical: string | null }>(
  items: readonly T[],
  universe: string | null | undefined,
): T[] {
  const u = toUniverse(universe);
  if (!u) return [...items];
  const same: T[] = [];
  const others: T[] = [];
  for (const o of items) (toUniverse(o.vertical) === u ? same : others).push(o);
  return [...same, ...others];
}

/** Étape 2 (offres) : même règle que `universeFirst`. */
export const offersUniverseFirst = universeFirst;

/** « 1 masquée », « 3 masquées » (offres des autres affiliés cachées à l'étape 2). */
export function hiddenOffersLabel(n: number): string {
  return `${n.toLocaleString("fr-FR")} masquée${n > 1 ? "s" : ""}`;
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Étiquette d'une offre choisie : son nom, précédé du programme seulement si le nom ne commence pas déjà par lui
 * (les offres Link Affi s'appellent souvent « <programme> — <offre> » : « Démo · Casino Royal — Bienvenue 200 % »).
 */
export function offerChipLabel(o: { name: string; programName: string }): string {
  const program = o.programName.trim();
  if (!program || fold(o.name).startsWith(fold(program))) return o.name;
  return `${program} · ${o.name}`;
}

/**
 * Champ de l'étape affichée qui porte une erreur de l'assistant (identifiant du champ ou du groupe de cases), ou null
 * s'il n'est pas sur cette étape : le message s'affiche alors en haut, avec un bouton pour aller à la bonne étape.
 */
const FIELD_IDS: Partial<Record<WizardStepKey, Partial<Record<WizardField, string>>>> = {
  general: {
    name: "wz-name",
    startAt: "wz-start",
    endAt: "wz-end",
    budgetDaily: "wz-budget",
    notes: "wz-notes",
  },
  channels: { channelIds: "wz-channels" },
  ads: {
    adPlatform: "wz-platform",
    adCount: "wz-count",
    entryChannelId: "wz-entry-channel",
    name: "wz-name-final",
  },
};

export function fieldIdOnStep(field: WizardField, step: WizardStepKey): string | null {
  return FIELD_IDS[step]?.[field] ?? null;
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
