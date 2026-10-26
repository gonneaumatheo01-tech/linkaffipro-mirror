/**
 * Droits sur les demandes au client (règle PURE, partagée par le moteur et le site). Les demandes qui touchent aux
 * réglages, aux jetons ou à l'argent sont réservées aux ADMIN (règle de CLAUDE.md : MANAGER = tout sauf réglages,
 * utilisateurs, jetons). Sur Telegram, seul l'admin (`Setting` `admin.telegramUserId`) répond : toujours permis.
 */
import { onAnswerOf } from "./requests";

/** Actions `onAnswer` réservées aux ADMIN, quelle que soit la réponse. */
// Phase 30 : « Publier quand même » après 3 refus du QA Global (accord du client lié à une empreinte exacte) : admin seulement.
const ADMIN_ONLY_ACTIONS = new Set(["algo-level", "dating-video-budget", "dating-bench", "inspiration-keep", "qa-decision"]);
/** Préfixes d'actions réservées (seuils de l'Agent Ads : `ads-cpr`, `ads-roas`…). */
const ADMIN_ONLY_PREFIXES = ["ads-"];

/** La demande est-elle réservée aux ADMIN (clé, passage en vrai, niveau 2, réglages d'équipe, budget, banc d'essai) ? */
export function adminOnlyRequest(request: { kind: string; onAnswer?: unknown }): boolean {
  if (request.kind === "SECRET") return true;
  const onAnswer = onAnswerOf(request.onAnswer);
  const action = typeof onAnswer.action === "string" ? onAnswer.action : "";
  if (!action) return false;
  if (action === "set-simulation") return onAnswer.simulation !== true;
  if (action === "set-autonomy") return onAnswer.level === 2;
  if (ADMIN_ONLY_ACTIONS.has(action)) return true;
  return ADMIN_ONLY_PREFIXES.some((p) => action.startsWith(p));
}

export const ADMIN_ONLY_REQUEST_MESSAGE = "Cette demande est réservée aux administrateurs.";
