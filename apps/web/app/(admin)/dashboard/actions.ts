"use server";

import { redirect } from "next/navigation";
import { audit } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin } from "@/lib/session";
import { invalidateDashboards } from "@/lib/dashboard/cache";

/** Recalcul complet des statistiques journalières (ADMIN). */
export async function recomputeStatsAction(): Promise<void> {
  const admin = await requireAdmin();
  try {
    await enqueue("stats", { type: "daily", full: true }, { jobId: `stats-daily-full-${Date.now()}` });
    await audit({ userId: admin.id, action: "stats.recompute_requested" });
    invalidateDashboards();
  } catch (err) {
    redirect(`/?tab=ads&error=${encodeURIComponent(`Impossible de lancer le recalcul : ${err instanceof Error ? err.message : "erreur"}`)}`);
  }
  redirect(`/?tab=ads&ok=${encodeURIComponent("Recalcul lancé : les chiffres se mettent à jour dans une minute.")}`);
}
