import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Cache des tableaux de bord (accueil, pubs) : 60 secondes par clé (période + filtres).
 *
 * Pourquoi un TTL court plutôt qu'une invalidation depuis le worker : le cache de données Next vit dans le
 * processus `web` ; le worker (processus séparé) ne peut pas appeler `revalidateTag`. Les statistiques
 * journalières étant recalculées toutes les heures, un délai d'une minute est sans conséquence.
 * `invalidateDashboards()` reste disponible pour les actions serveur du site (recalcul demandé, import de coûts…).
 */
export const DASHBOARD_TAG = "dashboards";
export const DASHBOARD_TTL_SECONDS = 60;

/** Enveloppe une fonction de chargement : résultat mis en cache 60 s par arguments (sérialisés en JSON). */
export function cachedDashboard<A extends unknown[], R>(name: string, loader: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return unstable_cache(loader, ["dashboard", name], { revalidate: DASHBOARD_TTL_SECONDS, tags: [DASHBOARD_TAG] });
}

/** Vide le cache de tous les tableaux de bord (à appeler depuis une action serveur du site uniquement). */
export function invalidateDashboards(): void {
  revalidateTag(DASHBOARD_TAG, "max");
}
