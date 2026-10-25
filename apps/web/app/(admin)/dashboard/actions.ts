"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { statsParamsFromForm } from "@/lib/dashboard/stats-pages";
import { webActorOf } from "@/lib/site-ops/ops/lot-c/common";
import { recomputeStats } from "@/lib/site-ops/ops/lot-c/dashboard";

/** Retour vers la page Pubs des statistiques, avec la période et les filtres du formulaire. */
function backToAds(
  formData: FormData | undefined,
  message: { ok: string } | { error: string },
): string {
  const p = new URLSearchParams(formData ? statsParamsFromForm(formData.entries()) : {});
  for (const [k, v] of Object.entries(message)) p.set(k, v);
  return `/stats/ads?${p.toString()}`;
}

/**
 * Recalcul complet des statistiques journalières (ADMIN). Le formulaire peut porter le sélecteur des statistiques.
 * Règle dans le cœur de la phase 34 (`lib/site-ops/ops/lot-c/dashboard.ts`), aussi utilisé par Kevin.
 */
export async function recomputeStatsAction(formData?: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await recomputeStats({}, { ...webActorOf(admin), role: "ADMIN" });
  redirect(backToAds(formData, r.ok ? { ok: r.message } : { error: r.error }));
}
