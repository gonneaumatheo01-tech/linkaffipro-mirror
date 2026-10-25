"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { reportSendNow, reportsConfigSave } from "@/lib/site-ops/ops/lot-e/status";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin } from "@/lib/session";

/** Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/status.ts`), comme Kevin. */
function back(params: Record<string, string>): never {
  redirect(`/settings/reports?${new URLSearchParams(params).toString()}`);
}

/** Enregistre l'activation et l'heure d'envoi des rapports (Setting `reports.config`). */
export async function saveReportsConfigAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await reportsConfigSave(
    { hour: formData.get("hour"), daily: formData.get("daily") === "on", weekly: formData.get("weekly") === "on" },
    webActor(admin),
  );
  if (r.ok) revalidatePath("/settings/reports");
  back(backParams(r));
}

/** Envoie immédiatement le brief ou le rapport (tâche du worker). */
export async function sendReportNowAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await reportSendNow({ kind: formData.get("kind") === "weekly" ? "weekly" : "daily" }, webActor(admin));
  if (r.ok) revalidatePath("/settings/reports");
  back(backParams(r));
}
