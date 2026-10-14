/**
 * Envoi des événements des membres d'affiliés à la fonction Link Affi `telegram-events` (phase 13, contrat
 * `docs/LINKAFFI-PARTENAIRES.md` § 2) : file `linkaffi-events`.
 *
 * - `deliverLinkaffiEvent` : un événement (`LinkaffiEvent.eventId`) : POST signé (`X-Signature: sha256=<HMAC>` du corps
 *   brut avec le secret de signature déchiffré), `X-Event-Id`, en-têtes `apikey` et `Authorization: Bearer` = clé anon
 *   Link Affi (`LINKAFFI_ANON_KEY`). Réponse 2xx → SENT ; sinon nouvel essai à attente croissante, FAILED au-delà de
 *   24 h. Chaque envoi réserve d'abord la ligne (jamais deux envois simultanés du même événement).
 * - `runLinkaffiEventsTick` (chaque minute) : abandon des événements de plus de 24 h, puis envoi des événements dus
 *   (nouveaux essais, et ceux dont l'ajout à la file a échoué).
 * - Sans secret de signature (ou sans clé anon) : rien n'est envoyé ; les événements attendent, avec la raison, et
 *   passent FAILED après 24 h (Link Affi les rattrape par `GET /members`).
 * - Le membre est relu avant chaque envoi : membre supprimé (à sa demande ou par la purge) → jamais envoyé, corps
 *   effacé ; affilié retiré ou changé par un administrateur → plus envoyé à l'ancien affilié (`privacy.ts`).
 * Jamais la clé ni le secret dans un journal ou une erreur enregistrée.
 */
import {
  decrypt,
  LINKAFFI_EVENTS_URL_DEFAULT,
  serializeLinkaffiEvent,
  signLinkaffiBody,
} from "@linkaffipro/core";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { logger } from "../logger";
import {
  attemptOutcome,
  isGlobalFailure,
  isPastRetryWindow,
  linkaffiBodyFromRow,
  undeliverableReason,
  type DeliveryResponse,
} from "./body";
import { cancelLinkaffiEvent, cancelUndeliverableLinkaffiEvents } from "./privacy";

/** Ligne `IntegrationKey` de Link Affi. */
export const LINKAFFI_INTEGRATION_PROVIDER = "linkaffi";
/** Délai de réponse de Link Affi. */
export const LINKAFFI_DELIVERY_TIMEOUT_MS = 10_000;
/** Réservation d'un événement pendant son envoi (reprise si le worker s'arrête en plein envoi). */
const LEASE_MS = 2 * 60_000;
/**
 * Écart d'horloge toléré entre la base (date de l'événement) et le worker : un événement tout juste enregistré part
 * avec sa tâche `deliver`, même si l'horloge de la base avance de quelques secondes.
 */
const CLOCK_SKEW_MS = 5_000;

export type LinkaffiDeliveryConfig = { url: string; secret: string; anonKey: string };
export type LinkaffiDeliveryConfigResult =
  | { ok: true; config: LinkaffiDeliveryConfig }
  | { ok: false; reason: "no_secret" | "no_anon_key" | "secret_unreadable"; message: string };

/** Raisons lisibles (enregistrées dans `LinkaffiEvent.lastError`, affichées dans Réglages → Connexions). */
export const NOT_CONFIGURED_MESSAGES = {
  no_secret:
    "Secret de signature pas encore créé (Réglages → Connexions → Link Affi) : envoi en attente.",
  no_anon_key: "Clé d'accès Link Affi absente du service d'arrière-plan : envoi en attente.",
  secret_unreadable:
    "Secret de signature illisible (clé de chiffrement changée ?) : à régénérer dans Réglages → Connexions → Link Affi.",
} as const;

/** Adresse, secret déchiffré et clé anon. Jamais journalisés. */
export async function loadLinkaffiDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LinkaffiDeliveryConfigResult> {
  const row = await prisma.integrationKey.findUnique({
    where: { provider: LINKAFFI_INTEGRATION_PROVIDER },
    select: { webhookSecretEncrypted: true, eventsUrl: true },
  });
  if (!row?.webhookSecretEncrypted)
    return { ok: false, reason: "no_secret", message: NOT_CONFIGURED_MESSAGES.no_secret };
  const anonKey = env.LINKAFFI_ANON_KEY?.trim();
  if (!anonKey)
    return { ok: false, reason: "no_anon_key", message: NOT_CONFIGURED_MESSAGES.no_anon_key };
  let secret: string;
  try {
    secret = decrypt(row.webhookSecretEncrypted);
  } catch {
    return {
      ok: false,
      reason: "secret_unreadable",
      message: NOT_CONFIGURED_MESSAGES.secret_unreadable,
    };
  }
  return {
    ok: true,
    config: { url: row.eventsUrl?.trim() || LINKAFFI_EVENTS_URL_DEFAULT, secret, anonKey },
  };
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Texte d'erreur court et sûr (jamais d'en-tête ni de secret : seulement le statut et le début de la réponse). */
function shortText(s: string, max = 200): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** POST signé d'un corps brut vers la fonction `telegram-events`. */
export async function postLinkaffiEvent(
  config: LinkaffiDeliveryConfig,
  rawBody: string,
  eventId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<DeliveryResponse> {
  try {
    const res = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "X-Event-Id": eventId,
        "X-Signature": signLinkaffiBody(rawBody, config.secret),
      },
      body: rawBody,
      signal: AbortSignal.timeout(LINKAFFI_DELIVERY_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true, status: res.status, error: null };
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: shortText(`Réponse ${res.status} de Link Affi${text ? ` : ${text}` : ""}`),
    };
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string } };
    const reason =
      e.name === "TimeoutError" || e.name === "AbortError"
        ? `pas de réponse en ${LINKAFFI_DELIVERY_TIMEOUT_MS / 1000} s`
        : (e.cause?.code ?? e.message ?? String(err));
    return { ok: false, status: null, error: shortText(`Link Affi injoignable : ${reason}`) };
  }
}

export type DeliverOutcome =
  | "sent"
  | "retry"
  | "failed"
  /** Membre supprimé, ou affilié retiré / changé : jamais envoyé. */
  | "cancelled"
  | "not_configured"
  | "not_due"
  | "already"
  | "missing";

type EventRow = {
  id: string;
  eventId: string;
  type: string;
  occurredAt: Date;
  campaignKey: string;
  memberId: string | null;
  channelId: string | null;
  body: unknown;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  lastStatus: number | null;
  createdAt: Date;
};

/** Abandon d'un événement (plus de 24 h) : FAILED et journal `linkaffi_event.failed` (une fois par événement). */
async function abandon(row: EventRow, now: Date, lastError: string | null): Promise<boolean> {
  const r = await prisma.linkaffiEvent.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "FAILED", lastError: lastError ?? row.lastError },
  });
  if (r.count === 0) return false;
  await recordEvent({
    type: "linkaffi_event.failed",
    memberId: row.memberId,
    channelId: row.channelId,
    payload: toJsonValue({
      eventId: row.eventId,
      type: row.type,
      campaignKey: row.campaignKey,
      attempts: row.attempts,
      lastStatus: row.lastStatus,
      lastError: lastError ?? row.lastError,
      abandonedAt: now.toISOString(),
    }),
  }).catch((err: Error) => logger.warn({ err: err.message }, "journal linkaffi_event.failed"));
  logger.warn(
    { eventId: row.eventId, attempts: row.attempts, lastStatus: row.lastStatus },
    "événement Link Affi abandonné après 24 h",
  );
  return true;
}

/** Mémorise la raison de l'attente (sans écraser la même raison). */
async function noteWaiting(rowId: string, message: string): Promise<void> {
  await prisma.linkaffiEvent.updateMany({
    where: {
      id: rowId,
      status: "PENDING",
      OR: [{ lastError: null }, { lastError: { not: message } }],
    },
    data: { lastError: message },
  });
}

/**
 * Envoie un événement s'il est dû (réservé d'abord : un envoi à la fois par événement, jamais de doublon), puis
 * enregistre le résultat : SENT, nouvel essai, ou abandon après 24 h.
 */
export async function deliverLinkaffiEvent(
  eventId: string,
  opts: {
    now?: Date;
    fetchImpl?: FetchLike;
    config?: LinkaffiDeliveryConfigResult;
  } = {},
): Promise<{ outcome: DeliverOutcome; status?: number | null }> {
  const now = opts.now ?? new Date();
  const row = (await prisma.linkaffiEvent.findUnique({ where: { eventId } })) as EventRow | null;
  if (!row) return { outcome: "missing" };
  if (row.status !== "PENDING") return { outcome: "already" };
  // Membre relu avant tout envoi : supprimé entre-temps, ou plus rattaché à cette campagne → jamais envoyé.
  const member = row.memberId
    ? await prisma.member.findUnique({
        where: { id: row.memberId },
        select: { anonymizedAt: true, linkaffiCampaignKey: true },
      })
    : null;
  const blocked = undeliverableReason(row.memberId, member, row.campaignKey);
  if (blocked) {
    await cancelLinkaffiEvent(row, blocked);
    logger.info({ eventId: row.eventId, reason: blocked }, "événement Link Affi annulé");
    return { outcome: "cancelled" };
  }
  if (isPastRetryWindow(row.createdAt, now)) {
    await abandon(row, now, row.lastError);
    return { outcome: "failed" };
  }
  const config = opts.config ?? (await loadLinkaffiDeliveryConfig());
  if (!config.ok) {
    await noteWaiting(row.id, config.message);
    return { outcome: "not_configured" };
  }
  const dueBefore = new Date(now.getTime() + CLOCK_SKEW_MS);
  if (row.nextAttemptAt.getTime() > dueBefore.getTime()) return { outcome: "not_due" };

  // Réservation : seulement si personne ne l'a prise depuis la lecture (même statut, même nombre d'essais).
  const claimed = await prisma.linkaffiEvent.updateMany({
    where: {
      id: row.id,
      status: "PENDING",
      attempts: row.attempts,
      nextAttemptAt: { lte: dueBefore },
    },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) return { outcome: "not_due" };

  const raw = serializeLinkaffiEvent(linkaffiBodyFromRow(row));
  const res = await postLinkaffiEvent(config.config, raw, row.eventId, opts.fetchImpl);
  const attempts = row.attempts + 1;
  const outcome = attemptOutcome(res, attempts, row.createdAt, now);
  if (outcome.status === "SENT") {
    await prisma.linkaffiEvent.update({
      where: { id: row.id },
      data: {
        status: "SENT",
        sentAt: now,
        attempts,
        lastStatus: res.status,
        lastError: null,
      },
    });
    await prisma.integrationKey
      .updateMany({
        where: { provider: LINKAFFI_INTEGRATION_PROVIDER },
        data: { lastEventSentAt: now },
      })
      .catch(() => undefined);
    return { outcome: "sent", status: res.status };
  }
  if (outcome.status === "FAILED") {
    await prisma.linkaffiEvent.update({
      where: { id: row.id },
      data: { attempts, lastStatus: res.status },
    });
    await abandon({ ...row, attempts, lastStatus: res.status }, now, res.error);
    return { outcome: "failed", status: res.status };
  }
  await prisma.linkaffiEvent.update({
    where: { id: row.id },
    data: {
      attempts,
      lastStatus: res.status,
      lastError: res.error,
      nextAttemptAt: outcome.nextAttemptAt,
    },
  });
  logger.warn(
    { eventId: row.eventId, attempts, status: res.status, next: outcome.nextAttemptAt },
    "événement Link Affi non reçu, nouvel essai prévu",
  );
  return { outcome: "retry", status: res.status };
}

export type LinkaffiTickResult = {
  /** Événements annulés (membre supprimé, affilié retiré ou changé). */
  cancelled: number;
  abandoned: number;
  due: number;
  sent: number;
  retried: number;
  failed: number;
  notConfigured: boolean;
  /** Arrêt du passage après un échec qui touche tous les événements (Link Affi injoignable, clés refusées…). */
  stoppedEarly: boolean;
};

/**
 * Passage périodique (chaque minute) : abandon des événements de plus de 24 h, puis envoi des événements dus, du plus
 * ancien au plus récent (ordre des faits d'un membre gardé).
 */
export async function runLinkaffiEventsTick(
  opts: {
    now?: Date;
    fetchImpl?: FetchLike;
    limit?: number;
    config?: LinkaffiDeliveryConfigResult;
  } = {},
): Promise<LinkaffiTickResult> {
  const now = opts.now ?? new Date();
  const result: LinkaffiTickResult = {
    cancelled: 0,
    abandoned: 0,
    due: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    notConfigured: false,
    stoppedEarly: false,
  };
  // D'abord ce qui ne doit plus jamais partir (même sans clés configurées) : membre supprimé, affilié retiré.
  result.cancelled = await cancelUndeliverableLinkaffiEvents();
  const stale = (await prisma.linkaffiEvent.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  })) as EventRow[];
  for (const row of stale) {
    if (!isPastRetryWindow(row.createdAt, now)) continue;
    if (await abandon(row, now, row.lastError)) result.abandoned++;
  }

  const config = opts.config ?? (await loadLinkaffiDeliveryConfig());
  if (!config.ok) {
    result.notConfigured = true;
    await prisma.linkaffiEvent.updateMany({
      where: {
        status: "PENDING",
        OR: [{ lastError: null }, { lastError: { not: config.message } }],
      },
      data: { lastError: config.message },
    });
    if (result.cancelled || result.abandoned) logger.info(result, "événements Link Affi traités");
    return result;
  }

  // Dans l'ordre des faits (rattrapage après une panne) : « acceptée » avant « entrée », même si l'entrée a été
  // enregistrée la première (mise à jour Telegram traitée avant la fin de l'acceptation).
  const due = await prisma.linkaffiEvent.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: opts.limit ?? 100,
    select: { eventId: true },
  });
  result.due = due.length;
  for (const { eventId } of due) {
    const r = await deliverLinkaffiEvent(eventId, { now, fetchImpl: opts.fetchImpl, config });
    if (r.outcome === "sent") result.sent++;
    else if (r.outcome === "cancelled") result.cancelled++;
    else if (r.outcome === "retry") result.retried++;
    else if (r.outcome === "failed") result.failed++;
    if ((r.outcome === "retry" || r.outcome === "failed") && isGlobalFailure(r.status ?? null)) {
      result.stoppedEarly = true;
      break;
    }
  }
  if (result.cancelled || result.abandoned || result.sent || result.retried || result.failed)
    logger.info(result, "événements Link Affi traités");
  return result;
}
