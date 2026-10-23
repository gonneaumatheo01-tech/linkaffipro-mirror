export { registerHandlers, updateTypeOf } from "./handlers";
export {
  createBot,
  getOrCreateBot,
  evictBot,
  botInfoFromRecord,
  cachedBotMatches,
} from "./factory";
export type { BotRecordLike } from "./factory";
export { prismaTelegramDeps } from "./prisma-deps";
export { assistantTeamTelegramIds, isAssistantTeamMember } from "./assistant/team";
// Phase 17 : réception par le bot assistant de conversation (journal sans texte, /start, /stop, /reset, messages).
export { registerAssistantHandlers } from "./handlers/assistant";
export {
  assistantReplyLang,
  classifyAssistantMessage,
  cleanStartSource,
  parseAssistantCommand,
  redactAssistantUpdate,
} from "./assistant/logic";
export type { AssistantCommand, AssistantInbound } from "./assistant/logic";
export type { AssistantConversation, AssistantDeps, AssistantPersonaInfo } from "./assistant/deps";
export {
  BOT_DESCRIPTION_MAX,
  BOT_SHORT_DESCRIPTION_MAX,
  assistantProfilePlan,
  assistantProfileTextOk,
  mentionsAssistant,
  personaChatLangs,
} from "./assistant/profile";
export type { AssistantProfilePlan, ProfileEntry, ProfilePersona } from "./assistant/profile";
export type {
  TelegramDeps,
  BotIdentity,
  BotMode,
  AdminRights,
  ChannelDeps,
  OurBotAdmin,
  RecheckOutcome,
  LinkImportOutcome,
} from "./ports";
export { extractAdminRights, isAssistantBot } from "./ports";
export { MESSAGES, LANGS, DEFAULT_LANG, isLang, pickLang, t } from "./i18n";
export type { Lang, MessageKey } from "./i18n";
export {
  registerBotFromToken,
  setWebhookForBot,
  getWebhookInfoForBot,
  setAllWebhooks,
  webhookUrlFor,
  setAssistantProfile,
  ASSISTANT_PROFILE_SETTING_PREFIX,
} from "./service";
export type { AssistantProfileApi, AssistantProfileReport } from "./service";
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
export {
  offerDeepLink,
  buildOfferPayload,
  parseOfferPayload,
  offerDestination,
  isLinkaffiOfferUrl,
} from "./offers/logic";
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
// Phase 15 : pages d'atterrissage — liens d'invitation des sources (bot de l'univers du canal, repli, révocation), pub
// reliée aux sources, relecture du titre et de la photo des canaux (`getChat`).
export {
  ensureLandingLinks,
  isGoneLandingLinkError,
  isTransientLandingError,
  landingLinkCandidates,
  landingLinkErrorText,
  landingNoBotText,
  landingSourceLinkIsCurrent,
  revokeLandingLinks,
} from "./landing/links";
export type {
  EnsureLandingLinksReport,
  LandingInvalidate,
  LandingLinkApi,
  LandingLinkBot,
  LandingLinkChannel,
  LandingLinkDeps,
  LandingLinkOutcome,
  LandingLinkToRevoke,
  LandingPageLinks,
  LandingSourceLinkState,
  RevokeLandingLinksReport,
} from "./landing/links";
export {
  LANDING_CHAT_BATCH,
  LANDING_CHAT_SPACING_MS,
  LANDING_CHAT_STALE_MS,
  LANDING_PHOTO_MAX_BYTES,
  refreshLandingChat,
  refreshLandingChats,
} from "./landing/chat";
export type {
  LandingChatChannel,
  LandingChatClient,
  LandingChatDeps,
  LandingChatInfo,
  LandingChatOutcome,
  LandingChatsReport,
  LandingChatUpdate,
} from "./landing/chat";
export {
  LANDING_ORPHAN_GRACE_MS,
  LANDING_REPLACED_GRACE_MS,
  createPrismaLandingDeps,
  ensureLandingLinksWithDb,
  landingApiOf,
  pagesMissingLandingLinks,
  refreshLandingChannelWithDb,
  refreshLandingChatsWithDb,
  retryMissingLandingLinksWithDb,
  revokeDetachedLandingLinksWithDb,
  revokeLandingPageLinksWithDb,
  syncLandingAdLinksWithDb,
  webLandingApi,
} from "./landing/prisma-links";
export type {
  LandingAdSyncReport,
  LandingBotApi,
  PrismaLandingOptions,
  RetryLandingLinksReport,
} from "./landing/prisma-links";
export { createAdminMessenger } from "./agents/admin-messenger";
// Phase 19 (chantier B) : dialogue admin des agents, dépôt dans la médiathèque, masquage des secrets.
export { createAdminMessengerWith, htmlToPlain, CAPTION_MAX } from "./agents/admin-messenger";
export type { MessengerApi, MessengerPort } from "./agents/admin-messenger";
export { createBotAgentsDeps } from "./agents/deps";
export { redactAdminSecretUpdate, SECRET_REDACTED_TEXT } from "./agents/redact";
export { registerAgentsAdminHandlers } from "./handlers/agents-admin";
export { registerMediaInboxHandlers, inboxMediaOf, BOT_DOWNLOAD_MAX_BYTES } from "./handlers/media-inbox";
