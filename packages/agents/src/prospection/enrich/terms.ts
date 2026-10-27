/**
 * Phase 31, chantier B — recherche d'un terme de dictionnaire dans un texte, sur mot entier, sans compiler une
 * expression régulière par terme (des milliers de termes : compilation trop coûteuse). Une seule expression « lettre ou
 * chiffre » sert aux bornes.
 */
const WORD_CHAR = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;

const isWordChar = (c: string | undefined) => !!c && WORD_CHAR.test(c);

/**
 * Le terme figure-t-il dans le texte ? Mot entier, casse ignorée ; un sigle court en capitales (« OM », « PSG »)
 * respecte la casse ; un symbole (« € », « R$ ») est cherché tel quel, sans lettre collée devant.
 * `lower` : le texte déjà en minuscules (évite de le recalculer pour chaque terme).
 */
export function containsTerm(text: string, term: string, lower: string = text.toLowerCase()): boolean {
  if (!term) return false;
  const symbol = !WORD_CHAR.test(term);
  const caseSensitive = !symbol && term.length <= 4 && term === term.toUpperCase() && LETTER.test(term);
  const hay = caseSensitive || symbol ? text : lower;
  const needle = caseSensitive || symbol ? term : term.toLowerCase();
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = hay[i - 1];
    const after = hay[i + needle.length];
    if (symbol) {
      if (!(before && LETTER.test(before))) return true;
      continue;
    }
    const startOk = !isWordChar(before) || !isWordChar(needle[0]);
    const endOk = !isWordChar(after) || !isWordChar(needle[needle.length - 1]);
    if (startOk && endOk) return true;
  }
  return false;
}

/** Termes présents (ordre du dictionnaire). */
export function foundTerms(text: string, terms: string[], lower: string = text.toLowerCase()): string[] {
  return terms.filter((t) => containsTerm(text, t, lower));
}
