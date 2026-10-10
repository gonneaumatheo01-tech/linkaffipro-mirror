/**
 * Erreurs JavaScript vues pendant une capture (exceptions et console.error) : le bruit propre au serveur de
 * développement est retiré, le reste est compté et résumé (fonctions pures, testées dans console-errors.test.ts).
 */

/** Messages qui n'existent qu'en développement (jamais en production) : non comptés. */
const DEV_ONLY = [
  // React en mode développement veut eval() ; la CSP du site (proxy.ts) ne l'autorise pas, et c'est voulu.
  /eval\(\) is not supported in this environment/i,
  /Download the React DevTools/i,
];

export function isDevOnlyNoise(message: string): boolean {
  return DEV_ONLY.some((re) => re.test(message));
}

/** Nombre d'erreurs réelles et 3 exemples distincts (première ligne, 200 caractères au plus). */
export function summarizeErrors(messages: readonly string[]): { count: number; samples: string[] } {
  const real = messages.filter((m) => !isDevOnlyNoise(m));
  const samples: string[] = [];
  for (const m of real) {
    const line = (m.split("\n")[0] ?? "").trim().slice(0, 200);
    if (line && !samples.includes(line) && samples.length < 3) samples.push(line);
  }
  return { count: real.length, samples };
}
