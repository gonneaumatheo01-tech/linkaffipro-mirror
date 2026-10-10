/**
 * Règles pures du Stepper (assistants en étapes), sans React : testées à part.
 * Les étapes sont numérotées à partir de 0 dans le code, à partir de 1 à l'écran.
 */

export type StepState = "done" | "current" | "upcoming";

/** État d'une étape par rapport à l'étape courante. */
export function stepState(index: number, current: number): StepState {
  if (index < current) return "done";
  if (index === current) return "current";
  return "upcoming";
}

/** Étape courante ramenée dans les bornes (entier entre 0 et count - 1). */
export function clampStep(current: number, count: number): number {
  if (count <= 0 || !Number.isFinite(current)) return 0;
  return Math.min(Math.max(0, Math.floor(current)), count - 1);
}

/** Résumé compact pour le téléphone : « Étape 2 sur 4 · Offres ». */
export function stepSummary(steps: ReadonlyArray<{ title: string }>, current: number): string {
  if (steps.length === 0) return "";
  const i = clampStep(current, steps.length);
  return `Étape ${i + 1} sur ${steps.length} · ${steps[i]!.title}`;
}

/** Avancement en % (étape courante comprise), pour la barre de progression. */
export function stepProgress(current: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round(((clampStep(current, count) + 1) / count) * 100);
}
