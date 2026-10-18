// Outils de texte internes au moteur (non exportés par index.ts) : comparaisons sans accents ni casse, 6 langues.

/** Minuscules, sans accents (« Léa » → « lea », « ß » → « ss »). Garde la ponctuation. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Forme « mots » d'un texte : minuscules sans accents, tout ce qui n'est ni lettre latine ni chiffre devient une
 * espace (apostrophes et traits d'union compris : « t'es » → « t es », « dix-sept » → « dix sept »).
 */
export function wordsForm(text: string): string {
  return foldText(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Longueur visible d'un texte (un emoji compte pour un caractère, comme pour la personne qui lit). */
export function visibleLength(text: string): number {
  return Array.from(text).length;
}

/** Coupe un texte à `max` caractères visibles. */
export function truncateVisible(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("").trimEnd();
}

/** Échappe une chaîne pour l'insérer dans une expression régulière. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Vrai si l'une des expressions trouve une correspondance. */
export function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}
