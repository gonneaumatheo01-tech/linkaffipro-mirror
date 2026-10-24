"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@linkaffipro/db";
import { QUEUE_NAMES, cleanFailedOlderThan, retryFailedJob } from "@linkaffipro/queue";
import { resumeMissions } from "@linkaffipro/agents";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { requireAdmin } from "@/lib/session";

const FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function back(params: Record<string, string>): never {
  redirect(`/settings/status?${new URLSearchParams(params).toString()}`);
}

/** Remet en attente une tâche échouée (bouton « Relancer »). */
export async function retryJobAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ queue: z.enum(QUEUE_NAMES), jobId: z.string().min(1).max(200) })
    .safeParse({ queue: formData.get("queue"), jobId: formData.get("jobId") });
  if (!parsed.success)
    back({ error: "Cette tâche n'est pas reconnue : rechargez la page et réessayez." });
  const { queue, jobId } = parsed.data;
  let result: Awaited<ReturnType<typeof retryFailedJob>>;
  try {
    result = await retryFailedJob(queue, jobId);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : "erreur" };
  }
  await audit({
    userId: admin.id,
    action: "system.job_retried",
    entityType: "Job",
    entityId: jobId,
    metadata: { queue, ok: result.ok, ...(result.ok ? {} : { error: result.error }) },
  });
  revalidatePath("/settings/status");
  if (!result.ok) back({ error: `Relance impossible pour le moment : ${result.error}` });
  back({ ok: `Tâche ${jobId} relancée dans la file ${queue}.` });
}

/** Supprime, dans toutes les files, les tâches échouées de plus de 7 jours. */
export async function cleanFailedJobsAction(): Promise<void> {
  const admin = await requireAdmin();
  const removed: Record<string, number> = {};
  let error: string | undefined;
  for (const name of QUEUE_NAMES) {
    try {
      removed[name] = await cleanFailedOlderThan(name, FAILED_RETENTION_MS);
    } catch (err) {
      error = err instanceof Error ? err.message : "erreur";
      removed[name] = 0;
    }
  }
  const total = Object.values(removed).reduce((a, b) => a + b, 0);
  await audit({
    userId: admin.id,
    action: "system.failed_jobs_cleaned",
    metadata: { removed, total, ...(error ? { error } : {}) },
  });
  revalidatePath("/settings/status");
  if (error)
    back({
      error: `Effacement partiel (${total} tâche${total > 1 ? "s" : ""} supprimée${total > 1 ? "s" : ""}) : ${error}`,
    });
  back({
    ok:
      total === 0
        ? "Aucune tâche échouée de plus de 7 jours."
        : `${total} tâche${total > 1 ? "s" : ""} échouée${total > 1 ? "s" : ""} de plus de 7 jours supprimée${total > 1 ? "s" : ""}.`,
  });
}

/**
 * « Relancer les missions bloquées » (carte Agents, phase 25) : le même balayage que celui du Grand Chef toutes les
 * 10 minutes (`resumeMissions`) : étape en cours ré-enfilée (étapes idempotentes, jamais de double publication),
 * validations déjà décidées reprises, aperçus jamais partis redemandés. Une équipe en pause n'est pas relancée.
 */
export async function resumeAgentMissionsAction(): Promise<void> {
  const admin = await requireAdmin();
  let r: Awaited<ReturnType<typeof resumeMissions>>;
  try {
    r = await resumeMissions(buildAgentsDeps());
  } catch (err) {
    back({ error: `Relance impossible pour le moment : ${err instanceof Error ? err.message : "erreur"}` });
  }
  await audit({ userId: admin.id, action: "agents.missions_resumed", metadata: r });
  revalidatePath("/settings/status");
  revalidatePath("/agents", "layout");
  const total = r.requeued + r.continued + r.revalidated;
  back({
    ok:
      total === 0
        ? "Rien à relancer : les missions bloquées attendent un plafond plus haut, une validation ou une équipe sortie de pause."
        : `${r.requeued} étape${r.requeued > 1 ? "s" : ""} relancée${r.requeued > 1 ? "s" : ""}, ${r.continued} mission${r.continued > 1 ? "s" : ""} reprise${r.continued > 1 ? "s" : ""} après validation, ${r.revalidated} aperçu${r.revalidated > 1 ? "s" : ""} redemandé${r.revalidated > 1 ? "s" : ""}.`,
  });
}
