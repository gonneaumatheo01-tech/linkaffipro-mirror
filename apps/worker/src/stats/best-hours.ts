/**
 * Meilleurs horaires de publication : depuis la phase 21, l'agent Horaires de l'équipe Algorithme
 * (`@linkaffipro/agents`, `agents/horaires`) en est la seule source. Le format de `Setting` `besthours.<channelId>`
 * est inchangé (le site le lit dans `apps/web/lib/besthours/`) ; les fonctions pures sont réexportées d'ici pour les
 * anciens appels et tests. La tâche `stats` `best-hours` (24 h, ou à la demande depuis la fiche canal) délègue à
 * l'agent.
 */
import { runHorairesAgent } from "@linkaffipro/agents";
import { workerAgentsDeps } from "../agents/deps";
import { logger } from "../logger";

export {
  ALL_CATEGORIES,
  BEST_HOURS_MIN_POSTS,
  BEST_HOURS_WEEKS,
  buildBestHours,
  buildCells,
  parisDayHour,
  recommend,
  type BestHoursCell,
  type BestHoursPost,
  type BestHoursRecommendation,
  type CategoryBestHours,
  type ChannelBestHours,
} from "@linkaffipro/agents";

export async function recomputeBestHours(): Promise<{ channels: number; posts: number; plans: number }> {
  const r = await runHorairesAgent(workerAgentsDeps());
  logger.info({ channels: r.channels, posts: r.posts, plans: r.plans }, "meilleurs horaires recalculés (agent Horaires)");
  return { channels: r.channels, posts: r.posts, plans: r.plans };
}
