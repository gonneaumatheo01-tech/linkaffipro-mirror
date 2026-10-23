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
