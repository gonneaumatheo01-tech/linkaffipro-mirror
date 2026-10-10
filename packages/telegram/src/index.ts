export { registerHandlers, updateTypeOf } from "./handlers";
export { createBot, getOrCreateBot, evictBot, botInfoFromRecord } from "./factory";
export type { BotRecordLike } from "./factory";
export { prismaTelegramDeps } from "./prisma-deps";
export type {
  TelegramDeps,
  BotIdentity,
  AdminRights,
  ChannelDeps,
  OurBotAdmin,
  RecheckOutcome,
  LinkImportOutcome,
} from "./ports";
export { extractAdminRights } from "./ports";
export { MESSAGES, LANGS, DEFAULT_LANG, isLang, pickLang, t } from "./i18n";
export type { Lang, MessageKey } from "./i18n";
export {
  registerBotFromToken,
  setWebhookForBot,
  getWebhookInfoForBot,
  setAllWebhooks,
  webhookUrlFor,
} from "./service";
export {
  readOurAdminsForChat,
  recheckChannelRights,
  recheckAllChannelRights,
  importChannelByUsername,
  importChannelByChatId,
  importChannelFromChat,
  importedChannelMessage,
  rightsUnverified,
  listActiveBots,
  mapWithLimit,
  ChannelImportError,
} from "./service";
export type {
  ChannelBotRight,
  ReadAdminsResult,
  RecheckResult,
  ImportedChannel,
  ActiveBot,
  ChannelImportErrorCode,
} from "./service";
export { parseChannelLink, findChannelLinkInText } from "./channels/username";
export type { ParsedChannelLink } from "./channels/username";
export { choosePrimaryBot, sameRights } from "./channels/primary-bot";
export {
  ensureChannelKnown,
  syncChannelRights,
  mayCreateChannelFrom,
  botPresence,
} from "./handlers/channels";
export { forwardReplyText, forwardedChannelOf, chatFromFullInfo } from "./handlers/forward";
export {
  splitMessage,
  chooseAdminTelegramId,
  inboxMessageFromPayload,
  formatInboxLine,
} from "./admin-chat";
export * from "./join-flow/rules";
export * from "./join-flow/texts";
export * from "./join-flow/service";
export { offerDeepLink, buildOfferPayload, parseOfferPayload } from "./offers/logic";
export {
  SEQUENCE_TRIGGERS,
  TRIGGER_LABELS,
  TRIGGER_HELP,
  PLACEHOLDERS,
  defaultSequenceText,
  defaultSequenceName,
  previewText,
  ensureDefaultSequences,
  backfillDefaultSequences,
} from "./sequences/index";
export type { SequenceTriggerKey } from "./sequences/index";
export { notifyAdmin } from "./admin-notify";
