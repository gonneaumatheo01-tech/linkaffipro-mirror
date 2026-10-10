/**
 * Après une modification du périmètre d'une campagne (offres, canaux, liens, pubs, rattachement d'une campagne pub,
 * suppression) : les listes et tableaux de bord doivent refléter le changement tout de suite, et les statistiques
 * journalières (`DailyStat`) doivent être recalculées depuis le début (les joueurs d'une offre ajoutée peuvent dater
 * de plusieurs mois).
 *
 * - Cache : `updateTag` (Next 16, actions serveur : expiration immédiate, la page suivante relit la base) ; hors action
 *   serveur, repli sur `invalidateDashboards()`.
 * - Recalcul : une tâche `stats` `{type:"daily", full:true}` d'identifiant `stats-daily-full-campaign`, retardée de
 *   30 s pour regrouper plusieurs modifications successives (assistant, onglets) ; retirée de Redis une fois finie.
 *   Si cette tâche est DÉJÀ EN COURS (elle a lu les périmètres avant la modification), une seconde est programmée
 *   sous l'identifiant `stats-daily-full-campaign-next` (regroupée de la même façon) : aucune modification n'est
 *   perdue. Voir `pickRecomputeJob`.
 * - Une file indisponible ne bloque jamais l'action : la connexion Redis attend sans fin sa reconnexion
 *   (`maxRetriesPerRequest: null`), l'attente est donc bornée à 2,5 s, puis l'action continue (erreur journalisée ;
 *   la demande part d'elle-même si Redis revient).
 */
import { updateTag } from "next/cache";
import { enqueue, getQueue } from "@linkaffipro/queue";
import { DASHBOARD_TAG, invalidateDashboards } from "@/lib/dashboard/cache";

export const CAMPAIGN_STATS_JOB_ID = "stats-daily-full-campaign";
export const CAMPAIGN_STATS_NEXT_JOB_ID = `${CAMPAIGN_STATS_JOB_ID}-next`;
export const CAMPAIGN_STATS_DELAY_MS = 30_000;
/** Attente maximale de la file (Redis) par une action. */
export const CAMPAIGN_STATS_TIMEOUT_MS = 2_500;

/** Vide le cache des tableaux de bord (lecture immédiate de ses propres écritures dans une action serveur). */
export function invalidateCampaignCaches(): void {
  try {
    updateTag(DASHBOARD_TAG);
  } catch {
    invalidateDashboards();
  }
}

/** États d'une tâche finie restée dans Redis : à retirer, sinon BullMQ ignorerait l'ajout du même identifiant. */
const FINISHED = new Set(["completed", "failed"]);

/**
 * Identifiant de la tâche de recalcul à programmer (règle pure), selon l'état des deux tâches possibles
 * (`unknown` = absente). Une tâche en attente est réutilisée ; une tâche en cours ne l'est jamais (elle a déjà lu
 * les périmètres) ; si les deux sont en cours, un identifiant unique.
 */
export function pickRecomputeJob(
  states: { main: string; next: string },
  now: number = Date.now(),
): { jobId: string; removeFirst: boolean } {
  for (const [jobId, state] of [
    [CAMPAIGN_STATS_JOB_ID, states.main],
    [CAMPAIGN_STATS_NEXT_JOB_ID, states.next],
  ] as const)
    if (state !== "active") return { jobId, removeFirst: FINISHED.has(state) };
  return { jobId: `${CAMPAIGN_STATS_JOB_ID}-${now}`, removeFirst: false };
}

/** Programme le recalcul complet (sans borne de temps : voir `refreshCampaignStats`). */
async function scheduleFullRecompute(): Promise<void> {
  const q = getQueue("stats");
  const [main, next] = await Promise.all([
    q.getJobState(CAMPAIGN_STATS_JOB_ID),
    q.getJobState(CAMPAIGN_STATS_NEXT_JOB_ID),
  ]);
  const pick = pickRecomputeJob({ main: String(main), next: String(next) });
  if (pick.removeFirst) await q.remove(pick.jobId);
  // Tâche choisie déjà en attente : BullMQ ignore l'ajout (même identifiant), elle verra la modification.
  await enqueue(
    "stats",
    { type: "daily", full: true },
    {
      jobId: pick.jobId,
      delay: CAMPAIGN_STATS_DELAY_MS,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

/** Vide le cache et demande un recalcul complet des statistiques journalières (voir l'en-tête). */
export async function refreshCampaignStats(): Promise<void> {
  invalidateCampaignCaches();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), CAMPAIGN_STATS_TIMEOUT_MS);
  });
  const work = scheduleFullRecompute().then(
    () => "ok" as const,
    (err: unknown) => {
      console.error("recalcul des statistiques non programmé", err);
      return "error" as const;
    },
  );
  const outcome = await Promise.race([work, timeout]);
  clearTimeout(timer);
  if (outcome === "timeout")
    console.error(
      `recalcul des statistiques : file Redis sans réponse après ${CAMPAIGN_STATS_TIMEOUT_MS} ms, l'action continue (la demande partira si Redis revient)`,
    );
}
