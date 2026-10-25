"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { agentMissionsResume, failedJobsClean, jobRetry } from "@/lib/site-ops/ops/lot-e/status";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin } from "@/lib/session";

/** Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/status.ts`), comme Kevin. */
function back(params: Record<string, string>): never {
  redirect(`/settings/status?${new URLSearchParams(params).toString()}`);
}

/** Remet en attente une tâche échouée (bouton « Relancer »). */
export async function retryJobAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await jobRetry({ queue: formData.get("queue"), jobId: formData.get("jobId") }, webActor(admin));
  // Tâche non reconnue : retour immédiat, sans journal (comme avant).
  if (r.ok || r.code === "unavailable") revalidatePath("/settings/status");
  back(backParams(r));
}

/** Supprime, dans toutes les files, les tâches échouées de plus de 7 jours. */
export async function cleanFailedJobsAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await failedJobsClean({}, webActor(admin));
  revalidatePath("/settings/status");
  back(backParams(r));
}

/**
 * « Relancer les missions bloquées » (carte Agents, phase 25) : le même balayage que celui du Grand Chef toutes les
 * 10 minutes (`resumeMissions`) : étape en cours ré-enfilée (étapes idempotentes, jamais de double publication),
 * validations déjà décidées reprises, aperçus jamais partis redemandés. Une équipe en pause n'est pas relancée.
 */
export async function resumeAgentMissionsAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await agentMissionsResume({}, webActor(admin));
  if (r.ok) {
    revalidatePath("/settings/status");
    revalidatePath("/agents", "layout");
  }
  back(backParams(r));
}
