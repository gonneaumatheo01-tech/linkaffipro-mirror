/**
 * Corps exact d'un événement Link Affi (contrat `docs/LINKAFFI-PARTENAIRES.md` § 2), relu depuis la ligne
 * `LinkaffiEvent` : PostgreSQL (jsonb) ne garde pas l'ordre des champs, le corps est donc reconstruit dans l'ordre du
 * contrat avant d'être signé et envoyé. Règles pures, sans base.
 */
import {
  LINKAFFI_EVENT_TYPES,
  LINKAFFI_RETRY_WINDOW_MS,
  nextLinkaffiAttemptAt,
  type LinkaffiEventBody,
  type LinkaffiEventType,
} from "@linkaffipro/core";

type Row = {
  eventId: string;
  type: string;
  occurredAt: Date;
  campaignKey: string;
  body: unknown;
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Corps d'un événement dans l'ordre du contrat : `eventId`, `type`, `occurredAt` et `campaignKey` viennent de la ligne
 * (la source sûre), `channel`, `member` et `data` du corps enregistré. Pour `offer_clicked`, `data` commence par
 * `subId` puis `offerCampaignKey`.
 */
export function linkaffiBodyFromRow(row: Row): LinkaffiEventBody {
  const b = obj(row.body);
  const channel = obj(b.channel);
  const member = obj(b.member);
  const rawData = obj(b.data);
  const type = (LINKAFFI_EVENT_TYPES as readonly string[]).includes(row.type)
    ? (row.type as LinkaffiEventType)
    : (b.type as LinkaffiEventType);
  const data: Record<string, unknown> =
    type === "offer_clicked"
      ? {
          subId: rawData.subId ?? null,
          offerCampaignKey: rawData.offerCampaignKey ?? null,
          ...rawData,
        }
      : rawData;
  return {
    eventId: row.eventId,
    type,
    occurredAt: typeof b.occurredAt === "string" ? b.occurredAt : row.occurredAt.toISOString(),
    campaignKey: row.campaignKey,
    channel: { id: String(channel.id ?? ""), title: String(channel.title ?? "") },
    member: {
      telegramUserId: String(member.telegramUserId ?? ""),
      username: strOrNull(member.username),
      firstName: strOrNull(member.firstName),
      languageCode: strOrNull(member.languageCode),
    },
    data,
  };
}

/** Réponse de Link Affi à un envoi (statut HTTP, ou null : injoignable). */
export type DeliveryResponse = { ok: boolean; status: number | null; error: string | null };

/** Ce que devient l'événement après un essai. */
export type AttemptOutcome =
  { status: "SENT" } | { status: "PENDING"; nextAttemptAt: Date } | { status: "FAILED" };

/**
 * Après un essai : envoyé (réponse 2xx), sinon nouvel essai à l'attente croissante, ou abandon quand le prochain essai
 * tomberait au-delà des 24 h (Link Affi peut rattraper l'événement par `GET /members`).
 */
export function attemptOutcome(
  res: DeliveryResponse,
  attempts: number,
  createdAt: Date,
  now: Date,
): AttemptOutcome {
  if (res.ok) return { status: "SENT" };
  const next = nextLinkaffiAttemptAt(attempts, createdAt, now);
  return next ? { status: "PENDING", nextAttemptAt: next } : { status: "FAILED" };
}

/**
 * Échec qui touche tous les événements (Link Affi injoignable, en panne, adresse ou clés refusées, trop de requêtes) :
 * le passage périodique s'arrête là au lieu d'attendre la même erreur pour chaque événement. Un refus propre à un
 * événement (400, 409, 422…) n'arrête rien.
 */
export function isGlobalFailure(status: number | null): boolean {
  return status === null || status >= 500 || [401, 403, 404, 405, 408, 429].includes(status);
}

/** Événement à abandonner sans essai : plus de 24 h d'attente. */
export function isPastRetryWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > LINKAFFI_RETRY_WINDOW_MS;
}

/**
 * Membre effacé dans le corps d'un événement : suppression sur demande (fiche membre → Supprimer) ou purge de
 * conservation. Le corps garde le reste (type, campagne, canal, date) pour le suivi, sans aucune donnée personnelle.
 */
export const SCRUBBED_LINKAFFI_MEMBER = {
  telegramUserId: "0",
  username: null,
  firstName: null,
  languageCode: null,
} as const;

/** Corps enregistré sans les données personnelles du membre. */
export function scrubLinkaffiBody(body: unknown): Record<string, unknown> {
  return { ...obj(body), member: { ...SCRUBBED_LINKAFFI_MEMBER } };
}

/** Pourquoi un événement en attente ne doit plus partir. */
export type UndeliverableReason = "member_deleted" | "affiliate_changed";

/** Raisons lisibles (enregistrées dans `LinkaffiEvent.lastError`). */
export const UNDELIVERABLE_MESSAGES: Record<UndeliverableReason, string> = {
  member_deleted:
    "Membre supprimé (à sa demande ou après la durée de conservation) : événement jamais envoyé à Link Affi.",
  affiliate_changed:
    "Affilié retiré ou changé par un administrateur : événement plus envoyé à Link Affi.",
};

/**
 * Relu juste avant l'envoi : un événement en attente ne part plus si le membre a été supprimé (ou est introuvable), ou
 * s'il n'est plus rattaché à la campagne de l'événement (affilié retiré ou changé). Une attribution simplement arrivée
 * à son terme n'empêche rien : l'événement a été émis pendant l'attribution. Sans membre sur la ligne : rien à relire.
 */
export function undeliverableReason(
  memberId: string | null,
  member: { anonymizedAt: Date | null; linkaffiCampaignKey: string | null } | null,
  campaignKey: string,
): UndeliverableReason | null {
  if (!memberId) return null;
  if (!member || member.anonymizedAt) return "member_deleted";
  if (member.linkaffiCampaignKey !== campaignKey) return "affiliate_changed";
  return null;
}
