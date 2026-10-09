/**
 * Définition des files BullMQ et des charges utiles des tâches.
 * Partagé entre le site (producteur) et le worker (consommateur).
 */
export const QUEUE_PREFIX = "lap";

export const QUEUE_NAMES = ["scheduler", "telegram-send", "approvals", "sync-linkaffi", "stats"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** Tâches de la file `telegram-send` (tout envoi vers Telegram passe ici, avec les limites de débit). */
export type TelegramSendJob =
  | { type: "dm"; outboundMessageId: string }
  | { type: "post"; postId: string }
  | { type: "delete-post"; postId: string }
  | { type: "approve"; membershipId: string }
  | { type: "decline"; membershipId: string };

/** Tâches de la file `approvals` (balayages périodiques). */
export type ApprovalsJob = { type: "tick" } | { type: "reminders" } | { type: "expirations" };

/** Tâches de la file `scheduler` (balayage des messages échus). */
export type SchedulerJob = { type: "tick" };

/** Tâches de la file `sync-linkaffi`. */
export type SyncLinkAffiJob = { type: "tick"; full?: boolean; tables?: string[] };

/** Tâches de la file `stats` (recalculs). */
export type StatsJob = { type: "post-stats"; postId: string } | { type: "tick" };

export type JobOf<Q extends QueueName> = Q extends "telegram-send"
  ? TelegramSendJob
  : Q extends "approvals"
    ? ApprovalsJob
    : Q extends "scheduler"
      ? SchedulerJob
      : Q extends "sync-linkaffi"
        ? SyncLinkAffiJob
        : StatsJob;
