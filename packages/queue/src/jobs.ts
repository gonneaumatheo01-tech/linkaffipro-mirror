/**
 * Définition des files BullMQ et des charges utiles des tâches.
 * Partagé entre le site (producteur) et le worker (consommateur).
 */
export const QUEUE_PREFIX = "lap";

export const QUEUE_NAMES = [
  "scheduler",
  "telegram-send",
  "approvals",
  "sync-linkaffi",
  "stats",
  "maintenance",
  "automations",
  "sync-ads",
  "sync-views",
] as const;
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

/** Tâches de la file `scheduler` (balayage des messages échus, expansion des envois groupés). */
export type SchedulerJob = { type: "tick" } | { type: "broadcast"; broadcastId: string };

/** Tâches de la file `sync-linkaffi`. */
export type SyncLinkAffiJob = { type: "tick"; full?: boolean; tables?: string[] };

/** Tâches de la file `stats` (recalculs). */
export type StatsJob =
  | { type: "post-stats"; postId: string }
  | { type: "tick" }
  | { type: "daily"; days?: number; full?: boolean }
  | { type: "reports"; force?: "daily" | "weekly" }
  | { type: "best-hours" };

/** Tâches de la file `automations` : événement métier à évaluer, ou reprise des étapes différées. */
export type AutomationsJob =
  | {
      type: "event";
      trigger:
        | "JOINED"
        | "OFFER_CLICKED"
        | "REGISTERED"
        | "DEPOSITED"
        | "LEFT"
        | "SPEND_LEVEL_REACHED"
        | "INACTIVE";
      memberId: string;
      context?: Record<string, unknown>;
    }
  | { type: "test"; ruleId: string; memberId: string }
  | { type: "tick" };

/**
 * Tâches de la file `maintenance` (purge 24 mois, alertes, purge des tâches échouées, sauvegardes, révocation des
 * anciens liens des canaux à rejoindre à entrée directe, phase 11).
 */
export type MaintenanceJob =
  | { type: "purge" }
  | { type: "alerts" }
  | { type: "clean-failed" }
  | { type: "backup" }
  | { type: "legacy-gate-links" }
  | { type: "tick" };

/**
 * Reprise sur erreur par file (options par défaut des tâches ajoutées, et des tâches périodiques du worker).
 * - `telegram-send` : 3 tentatives, attente exponentielle (2 s, 4 s, 8 s). Les messages privés vérifient le statut
 *   `QUEUED` avant d'envoyer, donc une reprise après plantage ne renvoie jamais deux fois. ATTENTION : les messages
 *   de canal (`post`) sont enfilés avec `attempts: 1` explicitement (`sending/claim.ts`) : un plantage entre l'envoi
 *   Telegram et l'écriture en base ferait un doublon visible dans le canal.
 * - `sync-linkaffi` : 3 tentatives (30 s, 60 s, 120 s) ; chaque table a son curseur et un verrou `isRunning`.
 * - `stats` : 3 tentatives (10 s, 20 s, 40 s) ; recalculs idempotents, rapports marqués « envoyés » avant l'envoi.
 * - autres files : 1 tentative (balayages périodiques relancés de toute façon au prochain passage).
 */
export const JOB_RETRY_OPTIONS: Record<
  QueueName,
  { attempts: number; backoff?: { type: "exponential"; delay: number } }
> = {
  "telegram-send": { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
  "sync-linkaffi": { attempts: 3, backoff: { type: "exponential", delay: 30_000 } },
  stats: { attempts: 3, backoff: { type: "exponential", delay: 10_000 } },
  scheduler: { attempts: 1 },
  approvals: { attempts: 1 },
  maintenance: { attempts: 1 },
  automations: { attempts: 1 },
  // Synchros externes : reprise avec attente longue (quotas Meta / TikTok, FLOOD_WAIT Telegram).
  "sync-ads": { attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
  "sync-views": { attempts: 2, backoff: { type: "exponential", delay: 60_000 } },
};

/** File `sync-ads` (phase 7) : dépenses des comptes publicitaires connectés (Meta, TikTok). */
export type SyncAdsJob =
  | { type: "tick" }
  | { type: "connection"; connectionId: string; mode: "recent" | "full" | "backfill" }
  | { type: "rates" };

/** File `sync-views` (phase 7) : vues et transferts des messages de canal via le compte Telegram connecté. */
export type SyncViewsJob = { type: "tick" } | { type: "post"; postId: string };

export type JobOf<Q extends QueueName> = Q extends "telegram-send"
  ? TelegramSendJob
  : Q extends "approvals"
    ? ApprovalsJob
    : Q extends "scheduler"
      ? SchedulerJob
      : Q extends "sync-linkaffi"
        ? SyncLinkAffiJob
        : Q extends "maintenance"
          ? MaintenanceJob
          : Q extends "automations"
            ? AutomationsJob
            : Q extends "sync-ads"
              ? SyncAdsJob
              : Q extends "sync-views"
                ? SyncViewsJob
                : StatsJob;
