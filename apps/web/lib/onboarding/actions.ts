"use server";

/**
 * Actions de la visite guidée et de la liste « À faire pour démarrer » (état par utilisateur, `onboarding.<userId>`).
 * Chaque action est journalisée (AuditLog, libellé « Réglage » dans le Journal).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { resetOnboarding, withChecklistDismissed, withTourDone } from "./state";
import { updateOnboarding } from "./store";

/** Visite terminée ou passée (« Terminer », « Passer la visite », Échap) : elle ne redémarre plus seule. */
export async function completeTourAction(how: "finished" | "skipped" = "finished"): Promise<void> {
  const user = await requireUser();
  await updateOnboarding(user.id, (s) => withTourDone(s, new Date()));
  await audit({
    userId: user.id,
    action: "settings.onboarding_tour_done",
    entityType: "user",
    entityId: user.id,
    metadata: { how: how === "skipped" ? "skipped" : "finished" },
  });
}

/** « Masquer » la liste « À faire pour démarrer » de l'accueil. */
export async function dismissChecklistAction(): Promise<void> {
  const user = await requireUser();
  await updateOnboarding(user.id, (s) => withChecklistDismissed(s, new Date()));
  await audit({
    userId: user.id,
    action: "settings.onboarding_checklist_hidden",
    entityType: "user",
    entityId: user.id,
  });
  revalidatePath("/");
}

/** « Revoir la visite » (Réglages, Mon compte) : état remis à zéro, retour à l'accueil où la visite démarre. */
export async function restartTourAction(): Promise<void> {
  const user = await requireUser();
  await updateOnboarding(user.id, () => resetOnboarding());
  await audit({
    userId: user.id,
    action: "settings.onboarding_reset",
    entityType: "user",
    entityId: user.id,
  });
  // La coque (layout) lit l'état pour lancer la visite : elle doit être rendue de nouveau, pas reprise du cache.
  revalidatePath("/", "layout");
  redirect("/");
}
