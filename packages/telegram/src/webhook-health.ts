/**
 * Phase 26 : santé de la connexion Telegram (webhook) d'un bot — règles PURES, testées, partagées par `pnpm tg:diag`,
 * la réparation automatique du worker (`webhook-repair.ts`) et l'État du système.
 *
 * Cause du 21 octobre : un script local a reposé le webhook de production avec le secret de la base LOCALE ; Telegram
 * recevait 403 de notre route et le Boss ne répondait plus. D'où deux garde-fous : (1) jamais de pose de webhook depuis
 * une base locale vers une adresse publique (`webhookTargetRefusal`), (2) le worker de production contrôle et repose
 * les webhooks toutes les 10 minutes, avec le secret de SA base.
 */

/** Champs lus de `getWebhookInfo`. */
export type WebhookInfoLike = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

export type WebhookProblem = "no_url" | "url_mismatch" | "forbidden" | "missing_updates";

/** Un 403 plus vieux qu'une heure n'est plus une raison de réparer (Telegram garde la dernière erreur longtemps). */
export const WEBHOOK_FORBIDDEN_RECENT_MS = 60 * 60_000;

/** Types d'update indispensables au dialogue admin. */
export const REQUIRED_UPDATES = ["message", "callback_query"] as const;

export function isForbiddenError(message: string | undefined | null): boolean {
  return !!message && /\b403\b|forbidden/i.test(message);
}

/** Problèmes du webhook d'un bot (vide = tout va bien). */
export function webhookProblems(info: WebhookInfoLike, expectedUrl: string, now: Date): WebhookProblem[] {
  const out: WebhookProblem[] = [];
  if (!info.url) out.push("no_url");
  else if (info.url !== expectedUrl) out.push("url_mismatch");
  if (
    isForbiddenError(info.last_error_message) &&
    info.last_error_date &&
    now.getTime() - info.last_error_date * 1000 < WEBHOOK_FORBIDDEN_RECENT_MS
  )
    out.push("forbidden");
  // Liste vide = types par défaut de Telegram (messages et boutons compris).
  const allowed = info.allowed_updates ?? [];
  if (allowed.length > 0 && REQUIRED_UPDATES.some((u) => !allowed.includes(u))) out.push("missing_updates");
  return out;
}

/** Cause probable et remède, en français simple. */
export function webhookProblemText(p: WebhookProblem): string {
  switch (p) {
    case "no_url":
      return "aucune adresse de réception : relancer pnpm telegram:webhooks";
    case "url_mismatch":
      return "adresse de réception différente de la nôtre : relancer pnpm telegram:webhooks";
    case "forbidden":
      return "secret du webhook différent : relancer pnpm telegram:webhooks";
    case "missing_updates":
      return "messages ou boutons non transmis par Telegram : relancer pnpm telegram:webhooks";
  }
}

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalHost(host: string | null): boolean {
  return !!host && (host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host) || host.endsWith(".local"));
}

/**
 * Pose d'un webhook refusée ? Une base locale (DATABASE_URL sur localhost) ne pose jamais un webhook vers une adresse
 * publique : son secret n'est pas celui de la production. Dérogation explicite : `ALLOW_REMOTE_WEBHOOK=1`.
 */
export function webhookTargetRefusal(
  url: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (env.ALLOW_REMOTE_WEBHOOK === "1") return null;
  const dbHost = hostOf(env.DATABASE_URL);
  const target = hostOf(url);
  if (isLocalHost(dbHost) && target && !isLocalHost(target))
    return `Base locale : je ne pose pas la connexion Telegram vers ${target} (le secret de la base locale casserait celle de la production). Lancez la commande en production : railway ssh --service web -- pnpm telegram:webhooks.`;
  return null;
}

/**
 * Réparation automatique permise ? Seulement en production : adresse publique en https et base distante. Un worker de
 * développement (APP_BASE_URL sur localhost) ne doit jamais « réparer » les bots de production vers sa machine.
 */
export function webhookRepairRefusal(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const base = env.APP_BASE_URL;
  if (!base) return "APP_BASE_URL manquante";
  if (!/^https:\/\//i.test(base)) return "adresse du site non publique (pas en https)";
  if (isLocalHost(hostOf(base))) return "adresse du site locale";
  if (isLocalHost(hostOf(env.DATABASE_URL))) return "base locale";
  return null;
}

/** Bot fantôme d'un compte réel (phase 18 : faux jeton, aucune connexion Telegram à contrôler). */
export function isGhostBotUsername(username: string): boolean {
  return username.startsWith("userbot_");
}
