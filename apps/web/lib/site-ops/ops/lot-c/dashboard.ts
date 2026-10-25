/**
 * Phase 34, lot C : cœur du « Recalculer les statistiques » de Statistiques → Pubs (`app/(admin)/dashboard/actions.ts`).
 * ADMIN seulement ; le site revient sur la page Pubs avec la période et les filtres du formulaire.
 */
import { audit } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { invalidateDashboards } from "@/lib/dashboard/cache";
import { ADMIN_ONLY, done, fail, forbidden, preview, withVia, type Core } from "./common";

export const RECOMPUTE_OK = "Recalcul lancé : les chiffres se mettent à jour dans une minute.";

/** Recalcul complet des statistiques journalières (ADMIN). */
export const recomputeStats: Core = async (_input, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY);
  if (opts.dryRun)
    return preview("Recalcul complet des statistiques journalières (toutes les dates), en arrière-plan.");
  try {
    await enqueue("stats", { type: "daily", full: true }, { jobId: `stats-daily-full-${Date.now()}` });
    await audit({ userId: actor.userId, action: "stats.recompute_requested", metadata: withVia(actor) });
    invalidateDashboards();
  } catch (err) {
    return fail(`Impossible de lancer le recalcul : ${err instanceof Error ? err.message : "erreur"}`, null, {
      code: "unavailable",
    });
  }
  return done(RECOMPUTE_OK);
};
