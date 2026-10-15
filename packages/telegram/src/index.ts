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
// Phase 14 : validation automatique des canaux obligatoires, filet du worker, rattrapage, joignabilité (le bot peut-il
// encore écrire à la personne ?).
export {
  apiCheckIntervalMs,
  autoSatisfyGate,
  botOfMembership,
  evaluateMembershipGates,
  reachableFor,
  recheckPendingGates,
  sendGateSatisfiedIfReachable,
  sourceAfterGateSatisfied,
  sweepPendingGates,
} from "./join-flow/auto-gate";
export type {
  AutoGateTrigger,
  GateSatisfiedMessage,
  GateSweepDeps,
  GateSweepOptions,
  GateSweepReport,
  MembershipGateEvaluation,
  PendingGateRow,
} from "./join-flow/auto-gate";
export { hasStartedBot, inJoinWindow, reachability } from "./join-flow/reachability";
export type { BotStateLike, JoinWindowRequest, Reachability } from "./join-flow/reachability";
export { createPrismaJoinFlowDeps } from "./join-flow/prisma-deps";
export {
  GATE_BACKFILL_KEY,
  memberReachabilityWithDb,
  membershipGatesStatusWithDb,
  repairBotStatesForPhase14,
  runGateBackfillOnce,
  runGateSweepWithDb,
} from "./join-flow/prisma-auto-gate";
export type {
  BotStateRepair,
  GateBackfillResult,
  MembershipGatesStatus,
  PrismaAutoGateOptions,
} from "./join-flow/prisma-auto-gate";
export {
  PHASE13_JOIN_REQUEST_TEXTS,
  PHASE14_TEXTS_ACTION,
  rewriteDefaultJoinRequestTexts,
  rewrittenJoinRequestTexts,
} from "./sequences/phase14-texts";
export type { Phase14TextsReport } from "./sequences/phase14-texts";
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
export {
  customEmojisOfMessage,
  messageHasCustomEmoji,
  customEmojiAddedReply,
  customEmojiChannelSkippedNote,
  CUSTOM_EMOJI_ADD_FAILED_REPLY,
  MAX_CUSTOM_EMOJIS_PER_MESSAGE,
} from "./custom-emoji/extract";
export type { ExtractedCustomEmoji, CustomEmojiAddOutcome } from "./custom-emoji/extract";
export {
  isCustomEmojiRefusal,
  customEmojiTagCount,
  customEmojisDropped,
  sendWithEmojiFallback,
  CUSTOM_EMOJIS_DROPPED_ERROR,
} from "./custom-emoji/fallback";
export type { CustomEmojiFallbackInfo } from "./custom-emoji/fallback";
export { addCustomEmojisToLibrary } from "./custom-emoji/library";
export type { AddCustomEmojisInput } from "./custom-emoji/library";
