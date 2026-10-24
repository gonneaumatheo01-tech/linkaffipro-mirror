/**
 * Contrôle codé des rapports rédigés par l'IA (phases 21 et 24) : tout nombre écrit par le modèle doit venir des
 * chiffres fournis (JSON). Un nombre absent fait rejeter la rédaction (le code écrit les lignes à la place).
 */

/** Nombres d'un texte (« 1 234,5 » → « 1234.5 » : séparateurs de milliers français retirés). */
export function numbersIn(s: string): string[] {
  const joined = s.replace(/(\d)[\s\u00a0\u202f](?=\d{3}(?!\d))/g, "$1");
  return (joined.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(",", "."));
}

/** Nombres permis : ceux des chiffres fournis, arrondis comme un texte les écrirait, et les petits nombres 0 à 7. */
export function allowedNumbers(facts: unknown): Set<string> {
  const raw = numbersIn(JSON.stringify(facts));
  const allowed = new Set<string>();
  for (const n of raw) {
    const v = Number(n);
    allowed.add(n).add(String(v)).add(String(Math.round(v))).add(v.toFixed(1)).add(v.toFixed(2));
    // « 12,50 € » écrit « 12,5 » ; « 3,0 » écrit « 3 ».
    allowed.add(String(Number(v.toFixed(1)))).add(String(Number(v.toFixed(2))));
  }
  // « 7 jours », « 5 lignes » : petits nombres de contexte permis.
  for (let i = 0; i <= 7; i++) allowed.add(String(i));
  return allowed;
}

/** Nombres du texte absents des chiffres fournis (vide = texte accepté). */
export function inventedNumbers(text: string, allowed: ReadonlySet<string>): string[] {
  return numbersIn(text).filter((n) => !allowed.has(n) && !allowed.has(String(Number(n))));
}
