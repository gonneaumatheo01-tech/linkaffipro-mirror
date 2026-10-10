"use server";

import { redirect } from "next/navigation";
import { audit } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { requireAdmin } from "@/lib/session";
import { invalidateDashboards } from "@/lib/dashboard/cache";
import { statsParamsFromForm } from "@/lib/dashboard/stats-pages";

/** Retour vers la page Pubs des statistiques, avec la période et les filtres du formulaire. */
function backToAds(
  formData: FormData | undefined,
  message: { ok: string } | { error: string },
): string {
  const p = new URLSearchParams(formData ? statsParamsFromForm(formData.entries()) : {});
  for (const [k, v] of Object.entries(message)) p.set(k, v);
  return `/stats/ads?${p.toString()}`;
}

/** Recalcul complet des statistiques journalières (ADMIN). Le formulaire peut porter le sélecteur des statistiques. */
export async function recomputeStatsAction(formData?: FormData): Promise<void> {
  const admin = await requireAdmin();
  try {
    await enqueue("stats", { type: "daily", full: true }, { jobId: `stats-daily-full-${Date.now()}` });
    await audit({ userId: admin.id, action: "stats.recompute_requested" });
    invalidateDashboards();
  } catch (err) {
    redirect(
      backToAds(formData, {
        error: `Impossible de lancer le recalcul : ${err instanceof Error ? err.message : "erreur"}`,
      }),
    );
  }
  redirect(
    backToAds(formData, {
      ok: "Recalcul lancé : les chiffres se mettent à jour dans une minute.",
    }),
  );
}
