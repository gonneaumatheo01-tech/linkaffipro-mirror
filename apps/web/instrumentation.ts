/**
 * Démarrage du serveur web (Next.js appelle `register()` une fois par processus, avant la première requête).
 *
 * Pages d'atterrissage (phase 15) : la mémoire des pages est créée tout de suite, abonnée aux invalidations Redis
 * (`landing:invalidate`) et remplie en arrière-plan, pour que le premier visiteur après un déploiement ou un
 * redémarrage soit servi depuis la mémoire, sans attendre la base.
 *
 * Jamais bloquant : `register()` n'attend ni la base ni Redis (lecture lancée sans être attendue, abonnement qui se
 * reconnecte tout seul) ; une base injoignable ne fait qu'écrire un avertissement (la lecture se refera à la
 * première visite). Rien pendant `next build`, dans les tests, ni avec `LANDING_PRELOAD=0`.
 */

type Env = Record<string, string | undefined>;

/** Faut-il précharger les pages dans ce processus ? (serveur Node seulement, hors build et hors tests) */
export function landingPreloadWanted(env: Env = process.env): boolean {
  return (
    env.NEXT_RUNTIME === "nodejs" &&
    !env.VITEST &&
    env.NODE_ENV !== "test" &&
    env.NEXT_PHASE !== "phase-production-build" &&
    env.LANDING_PRELOAD !== "0"
  );
}

/** Lance le préchargement sans l'attendre ; ne lève jamais. */
export function startLandingPreload(preload: () => Promise<boolean>): void {
  const startedAt = Date.now();
  void Promise.resolve()
    .then(preload)
    .then(
      (ok) => {
        if (ok) console.info("[landing] pages préchargées", { ms: Date.now() - startedAt });
      },
      (err: unknown) =>
        console.error("[landing] préchargement des pages impossible", {
          error: err instanceof Error ? err.message : String(err),
        }),
    );
}

export async function register(): Promise<void> {
  // Test littéral de `NEXT_RUNTIME` : Next retire ce bloc (Prisma, ioredis) du code d'un autre environnement.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!landingPreloadWanted()) return;
    try {
      const { preloadLandingCache } = await import("./lib/landing/cache");
      startLandingPreload(preloadLandingCache);
    } catch (err) {
      console.error("[landing] préchargement des pages impossible", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
