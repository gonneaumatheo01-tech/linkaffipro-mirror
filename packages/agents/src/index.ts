/**
 * @linkaffipro/agents (phase 19) : Grand Chef, Chefs d'équipe, agents, règles pures, demandes au client.
 * Sans Next.js ni grammY ; tout fournisseur externe est injecté.
 */
export * from "./types";
export * from "./missions/lifecycle";
export * from "./validation/requests";
export * from "./human/requests";
export * from "./admin/team";
export * from "./human/secrets";
export * from "./human/site";
// Chantier B : validation humaine, demandes au client, dialogue admin Telegram, dépôt dans la médiathèque.
export * from "./validation/sweep";
export * from "./human/answer";
export * from "./human/respond";
export * from "./admin/commands";
export * from "./admin/handle";
export * from "./admin/callbacks";
export { adminTelegramId, telegramActorUserId } from "./admin/journal";
export * from "./library/tags";
export * from "./library/store";
// Chantier A : moteur (règles, fournisseurs, agents, Chefs, Grand Chef).
export * from "./rules/content";
export * from "./rules/similarity";
export * from "./rules/slots";
export * from "./rules/time";
export * from "./providers/llm";
export * from "./providers/fake";
export type * from "./providers/video";
export type * from "./providers/image";
export * from "./providers/costs";
export { ProviderError } from "./providers/http";
export { createFalClient, createFalImageProvider, createFalVideoProvider, FAL_IMAGE_MODEL, FAL_VIDEO_MODEL } from "./providers/fal";
export { createMagicHourVideoProvider } from "./providers/magichour";
export {
  MAGICHOUR_SECRET_KEY,
  VIDEO_RESOLUTIONS,
  DEFAULT_VIDEO_RESOLUTION,
  DEFAULT_MAX_VIDEO_SECONDS,
  mediaSettings,
  resolveMediaProviders,
  pickVideoProviderName,
  type MediaSettings,
  type MediaProviders,
} from "./providers/registry";
export * from "./providers/verifiers";
export { DATING_DEFAULT_MIX } from "./chiefs/dating-format";
export { DATING_DEFAULT_BUDGET_CENTS } from "./missions/settings";
export { LOW_SOURCE_STOCK, unusedSourceCount } from "./agents/mediatheque/stock";
export type * from "./providers/odds";
export type * from "./providers/screenshot";
export * from "./missions/settings";
export * from "./missions/usage";
export * from "./missions/mission";
export { buildContext, resolveProviders, type EngineDeps } from "./missions/context";
export { AGENT_REGISTRY, PAID_PROVIDERS, agentFor } from "./agents/registry";
export { CHAINS, chainOf } from "./chiefs/index";
export type { Chain } from "./chiefs/chain";
export { runNextStep, type StepOutcome } from "./chiefs/engine";
export * from "./orchestrator/autonomy";
export * from "./orchestrator/budgets";
export * from "./orchestrator/collisions";
export * from "./orchestrator/pause";
export * from "./orchestrator/plan-day";
export * from "./orchestrator/reports";
export * from "./orchestrator/resume";
export * from "./orchestrator/cycle";
export { simulationHeader, withSimulationHeader } from "./agents/publication/header";
export * from "./missions/test-post";
export * from "./orchestrator/bench";
export * from "./human/dating-setup";
// Chantier B (phase 20) : vocaux de l'admin, plafond par poste.
export * from "./admin/voice";
export * from "./admin/budget";

// Vérificateurs des clés fal.ai et Magic Hour (bouton « Vérifier », réponse au bot) : enregistrés au chargement.
import { registerMediaKeyVerifiers } from "./providers/verifiers";
registerMediaKeyVerifiers();
export * from "./algo/contracts";
export * from "./algo/conversations-contract";
