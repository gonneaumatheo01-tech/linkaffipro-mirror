/**
 * Phase 34, lot E — cœurs de Réglages → État du système (relancer une tâche échouée, effacer les vieilles tâches
 * échouées, relancer les missions bloquées des agents) et de Réglages → Rapports automatiques (heure, activation,
 * envoi immédiat). Appelés par `app/(admin)/settings/{status,reports}/actions.ts` et par Kevin. Administrateurs seulement.
 */
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { QUEUE_NAMES, cleanFailedOlderThan, enqueue, retryFailedJob } from "@linkaffipro/queue";
import { readReportsConfig } from "@/app/(admin)/settings/reports/report-view";
import { adminOnly, fail, ok, optBool, preview, str, viaMeta, type CoreRun } from "./common";

export const FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Remet en attente une tâche échouée (bouton « Relancer »). */
export const jobRetry: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = z
    .object({ queue: z.enum(QUEUE_NAMES), jobId: z.string().min(1).max(200) })
    .safeParse({ queue: input.queue, jobId: input.jobId });
  if (!parsed.success) return fail("Cette tâche n'est pas reconnue : rechargez la page et réessayez.");
  const { queue, jobId } = parsed.data;
  if (opts.dryRun) return preview({ summary: `Je relance la tâche ${jobId} de la file ${queue}.` });
  let result: Awaited<ReturnType<typeof retryFailedJob>>;
  try {
    result = await retryFailedJob(queue, jobId);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : "erreur" };
  }
  await audit({
    userId: actor.userId,
    action: "system.job_retried",
    entityType: "Job",
    entityId: jobId,
    metadata: { queue, ok: result.ok, ...(result.ok ? {} : { error: result.error }), ...viaMeta(actor) },
  });
  if (!result.ok) return fail(`Relance impossible pour le moment : ${result.error}`, "unavailable");
  return ok(`Tâche ${jobId} relancée dans la file ${queue}.`, { queue, jobId });
};

/** Supprime, dans toutes les files, les tâches échouées de plus de 7 jours. */
export const failedJobsClean: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (opts.dryRun)
    return preview({
      summary: "J'efface les tâches échouées de plus de 7 jours dans toutes les files.",
      impact: "Elles ne pourront plus être relancées ; les plus récentes restent.",
    });
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
    userId: actor.userId,
    action: "system.failed_jobs_cleaned",
    metadata: { removed, total, ...(error ? { error } : {}), ...viaMeta(actor) },
  });
  if (error)
    return fail(
      `Effacement partiel (${total} tâche${total > 1 ? "s" : ""} supprimée${total > 1 ? "s" : ""}) : ${error}`,
      "unavailable",
    );
  return ok(
    total === 0
      ? "Aucune tâche échouée de plus de 7 jours."
      : `${total} tâche${total > 1 ? "s" : ""} échouée${total > 1 ? "s" : ""} de plus de 7 jours supprimée${total > 1 ? "s" : ""}.`,
    { total },
  );
};

/**
 * « Relancer les missions bloquées » : le même balayage que celui du Grand Chef toutes les 10 minutes
 * (`resumeMissions`). Une équipe en pause n'est pas relancée.
 */
export const agentMissionsResume: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (opts.dryRun)
    return preview({ summary: "Je relance les missions bloquées des agents (étapes en cours, validations décidées, aperçus jamais partis)." });
  const [{ resumeMissions }, { buildAgentsDeps }] = await Promise.all([import("@linkaffipro/agents"), import("@/lib/agents/deps")]);
  let r: Awaited<ReturnType<typeof resumeMissions>>;
  try {
    r = await resumeMissions(buildAgentsDeps());
  } catch (err) {
    return fail(`Relance impossible pour le moment : ${err instanceof Error ? err.message : "erreur"}`, "unavailable");
  }
  await audit({ userId: actor.userId, action: "agents.missions_resumed", metadata: { ...r, ...viaMeta(actor) } });
  const total = r.requeued + r.continued + r.revalidated;
  return ok(
    total === 0
      ? "Rien à relancer : les missions bloquées attendent un plafond plus haut, une validation ou une équipe sortie de pause."
      : `${r.requeued} étape${r.requeued > 1 ? "s" : ""} relancée${r.requeued > 1 ? "s" : ""}, ${r.continued} mission${r.continued > 1 ? "s" : ""} reprise${r.continued > 1 ? "s" : ""} après validation, ${r.revalidated} aperçu${r.revalidated > 1 ? "s" : ""} redemandé${r.revalidated > 1 ? "s" : ""}.`,
    { ...r },
  );
};

// ---------------------------------------------------------------------------------------------- rapports

/**
 * Activation et heure d'envoi des rapports (Setting `reports.config`, heure de Paris). Le formulaire du site envoie
 * tout ; Kevin peut ne donner que l'heure (« le rapport à 8 h au lieu de 9 h ») : le reste est gardé.
 */
export const reportsConfigSave: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const current =
    input.hour === undefined || input.daily === undefined || input.weekly === undefined
      ? readReportsConfig((await prisma.setting.findUnique({ where: { key: "reports.config" } }))?.value)
      : null;
  const parsed = z
    .object({ hour: z.coerce.number().int().min(0).max(23) })
    .safeParse({ hour: input.hour === undefined ? current!.hour : str(input.hour).replace(/\s*h(eures?)?\s*$/i, "") });
  if (!parsed.success) return fail("L'heure doit être un nombre entre 0 et 23.", "invalid", "hour");
  const config = {
    daily: input.daily === undefined ? current!.daily : (optBool(input.daily) ?? false),
    weekly: input.weekly === undefined ? current!.weekly : (optBool(input.weekly) ?? false),
    hour: parsed.data.hour,
  };
  const done = `Rapports enregistrés : résumé quotidien ${config.daily ? "activé" : "désactivé"}, rapport hebdomadaire ${config.weekly ? "activé" : "désactivé"}, envoi à ${config.hour} h.`;
  if (opts.dryRun)
    return preview({
      summary: `Rapports : résumé quotidien ${config.daily ? "activé" : "désactivé"}, rapport hebdomadaire ${config.weekly ? "activé" : "désactivé"}, envoi à ${config.hour} h (heure de Paris).`,
    });
  await prisma.setting.upsert({
    where: { key: "reports.config" },
    create: { key: "reports.config", value: config },
    update: { value: config },
  });
  await audit({ userId: actor.userId, action: "settings.reports_changed", metadata: { ...config, ...viaMeta(actor) } });
  return ok(done, config);
};

/** Envoie immédiatement le résumé quotidien ou le rapport hebdomadaire à l'administrateur (tâche du worker). */
export const reportSendNow: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const kind = input.kind === "weekly" ? "weekly" : "daily";
  const label = kind === "weekly" ? "Rapport hebdomadaire" : "Résumé quotidien";
  if (opts.dryRun) return preview({ summary: `${label} envoyé maintenant sur Telegram à l'administrateur.` });
  try {
    await enqueue("stats", { type: "reports", force: kind }, { jobId: `stats-reports-manual-${kind}-${Date.now()}` });
    await audit({ userId: actor.userId, action: "reports.send_requested", metadata: { kind, ...viaMeta(actor) } });
  } catch (err) {
    return fail(
      `Impossible de lancer l'envoi pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
      "unavailable",
    );
  }
  return ok(
    `${label} en cours d'envoi sur Telegram (quelques secondes). Rechargez la page pour voir le texte envoyé.`,
    { kind },
  );
};
