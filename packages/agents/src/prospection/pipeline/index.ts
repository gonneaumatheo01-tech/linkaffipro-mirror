/**
 * Phase 31, chantier C — Pipeline : statuts, Top du jour, boutons, rappels, rapport de la semaine, chiffres et filtres.
 * Exports nommés ; le rapport de la semaine sort sous `buildProspectionWeeklyReport` / `sendProspectionWeeklyReport`
 * (l'équipe Analystes exporte déjà un `buildWeeklyReport` à la racine du paquet).
 */
export { STATUS_TRANSITIONS, canTransition, transitionProspect, snoozeProspect, addProspectNote, returnSkippedProspects, type TransitionActor, type TransitionOptions, type TransitionResult } from "./status";
export {
  PROSPECT_BUTTONS,
  prospectCallback,
  parseProspectCallback,
  prospectCardButtons,
  dealButtons,
  contactedReminderButtons,
  negotiationReminderButtons,
  renderProspectCard,
  dealText,
  audienceText,
} from "./cards";
export { buildDailyTop, sendDailyTop, presentable, mixTop, sortForTop, DAILY_TOP_VARIANTS, type DailyTop, type DailyTopItem, type DailyTopScope } from "./daily-top";
export {
  handleProspectCallback,
  answerPendingDeal,
  parseDealAmount,
  canActOnProspects,
  PROSPECT_CALLBACK_VARIANTS,
  PENDING_DEAL_PREFIX,
  PENDING_DEAL_TTL_MS,
  type ProspectCallbackDeps,
  type ProspectCallbackReply,
} from "./callbacks";
export { runReminders, REMINDERS_VARIANTS, type ReminderKind } from "./reminders";
export {
  buildWeeklyReport as buildProspectionWeeklyReport,
  sendWeeklyReport,
  sendWeeklyReport as sendProspectionWeeklyReport,
  weeklyReportData as prospectionWeeklyReportData,
  WEEKLY_REPORT_VARIANTS as PROSPECTION_WEEKLY_VARIANTS,
  type WeeklyReportData as ProspectionWeeklyReportData,
} from "./weekly-report";
export {
  prospectStats,
  filterProspects,
  formatProspectLine,
  formatProspectDetail,
  scoreBreakdownText,
  visibleProspects,
  PIPELINE_STATUSES,
  rateText as prospectRateText,
  type ProspectStats,
  type ProspectFilters,
} from "./stats";
