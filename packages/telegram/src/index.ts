export { registerHandlers, updateTypeOf } from "./handlers.js";
export { createBot, getOrCreateBot, evictBot, botInfoFromRecord } from "./factory.js";
export type { BotRecordLike } from "./factory.js";
export { prismaTelegramDeps } from "./prisma-deps.js";
export type { TelegramDeps, BotIdentity, AdminRights } from "./ports.js";
export { extractAdminRights } from "./ports.js";
export { MESSAGES, pickLang, t } from "./i18n.js";
export type { Lang } from "./i18n.js";
export { registerBotFromToken, setWebhookForBot, getWebhookInfoForBot, setAllWebhooks, webhookUrlFor } from "./service.js";
