/**
 * Campagnes Telegram des affiliés Link Affi (phase 13, contrat `docs/LINKAFFI-PARTENAIRES.md`) : règles pures
 * partagées par le site (API d'intégration, réglages), le bot (attribution, clic d'offre) et le worker (envoi des
 * événements). Aucune dépendance à la base.
 *
 * - Link Affi appelle notre API (`/api/integrations/linkaffi/v1`) avec `Authorization: Bearer <clé>` : la clé est
 *   générée ici, montrée une seule fois, stockée hachée (SHA-256).
 * - Nous envoyons les événements des membres d'affiliés à la fonction Link Affi `telegram-events`, corps JSON signé
 *   `X-Signature: sha256=<HMAC-SHA256 du corps brut>` avec le secret de signature, `X-Event-Id` = `eventId` unique.
 * - Un clic d'offre d'un membre rattaché à une campagne Telegram d'affilié ajoute `&tg=<clé de campagne>` au lien.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Adresse par défaut de la fonction Link Affi qui reçoit les événements (modifiable dans la plateforme). */
export const LINKAFFI_EVENTS_URL_DEFAULT =
  "https://api.linkaffi.me/functions/v1/telegram-events";

/** Types d'événements du contrat (§ 2). */
export const LINKAFFI_EVENT_TYPES = [
  "join_requested",
  "join_approved",
  "join_declined",
  "join_expired",
  "joined",
  "left",
  "offer_clicked",
] as const;
export type LinkaffiEventType = (typeof LINKAFFI_EVENT_TYPES)[number];

/** Corps d'un événement, exactement comme le contrat (§ 2). `telegramUserId` en chaîne (entier 64 bits). */
export type LinkaffiEventBody = {
  eventId: string;
  type: LinkaffiEventType;
  occurredAt: string;
  campaignKey: string;
  channel: { id: string; title: string };
  member: {
    telegramUserId: string;
    username: string | null;
    firstName: string | null;
    languageCode: string | null;
  };
  data: Record<string, unknown>;
};

/**
 * Identifiant unique et stable d'un événement : le même fait (une demande, un clic) donne toujours le même identifiant,
 * donc jamais deux lignes ni deux envois. `sourceId` = identifiant de la demande (Membership) ou du clic (Click).
 */
export function linkaffiEventId(type: LinkaffiEventType, sourceId: string): string {
  return `lap_${type}_${sourceId}`;
}

/** Construit le corps d'un événement, champs dans l'ordre du contrat (le corps signé est exactement celui envoyé). */
export function buildLinkaffiEvent(input: {
  type: LinkaffiEventType;
  sourceId: string;
  occurredAt: Date;
  campaignKey: string;
  channel: { id: string; title: string };
  member: {
    telegramUserId: bigint | number | string;
    username?: string | null;
    firstName?: string | null;
    languageCode?: string | null;
  };
  data?: Record<string, unknown>;
}): LinkaffiEventBody {
  return {
    eventId: linkaffiEventId(input.type, input.sourceId),
    type: input.type,
    occurredAt: input.occurredAt.toISOString(),
    campaignKey: input.campaignKey,
    channel: { id: input.channel.id, title: input.channel.title },
    member: {
      telegramUserId: String(input.member.telegramUserId),
      username: input.member.username ?? null,
      firstName: input.member.firstName ?? null,
      languageCode: input.member.languageCode ?? null,
    },
    data: input.data ?? {},
  };
}

/** Corps brut envoyé (et signé) : JSON compact du corps. */
export function serializeLinkaffiEvent(body: LinkaffiEventBody): string {
  return JSON.stringify(body);
}

/** En-tête `X-Signature` : `sha256=<HMAC-SHA256 hexadécimal du corps brut>`. */
export function signLinkaffiBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** Vérifie une signature (comparaison à temps constant) : c'est ce que fait Link Affi, et nos tests. */
export function verifyLinkaffiSignature(
  rawBody: string,
  secret: string,
  header: string | null | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(signLinkaffiBody(rawBody, secret));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length)) {
      // 248 = 62 × 4 : rejet des octets au-delà pour une répartition uniforme.
      if (b < 248 && out.length < length) out += BASE62[b % 62];
    }
  }
  return out;
}

/** Nouvelle clé d'API pour Link Affi (montrée une seule fois). */
export function generateIntegrationApiKey(): string {
  return `lap_live_${randomBase62(40)}`;
}

/** Empreinte stockée de la clé d'API (SHA-256 hexadécimal). */
export function hashIntegrationApiKey(key: string): string {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}

/** Début de la clé, pour la reconnaître à l'écran sans la révéler. */
export function integrationApiKeyPrefix(key: string): string {
  return `${key.slice(0, 13)}…`;
}

/** Nouveau secret de signature des événements (montré une seule fois, stocké chiffré). */
export function generateWebhookSecret(): string {
  return `lap_whsec_${randomBase62(40)}`;
}

/** Clé de campagne Link Affi valide (celle de `linkaffi.me/go/<clé>`). */
export function isLinkaffiCampaignKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(key);
}

/**
 * Lien d'offre d'un membre rattaché à une campagne Telegram d'affilié : ajoute (ou remplace) `tg=<clé>` sans toucher
 * au reste (`sub_id` part comme avant). Une adresse illisible reçoit le paramètre en fin de chaîne.
 */
export function withTelegramCampaignParam(url: string, telegramCampaignKey: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("tg", telegramCampaignKey);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}tg=${encodeURIComponent(telegramCampaignKey)}`;
  }
}

/** Fin de l'attribution d'une campagne à durée limitée (null = à vie). */
export function affiliateAttributionEndsAt(
  attributedAt: Date,
  days: number | null | undefined,
): Date | null {
  if (!days || days <= 0) return null;
  return new Date(attributedAt.getTime() + days * 86_400_000);
}

/** Le membre est-il rattaché à une campagne Telegram d'affilié en cours (paramètre `tg`, événements) ? */
export function isAffiliateAttributionActive(
  member: { linkaffiCampaignKey: string | null; affiliateAttributionEndsAt: Date | null },
  now: Date,
): boolean {
  if (!member.linkaffiCampaignKey) return false;
  return (
    !member.affiliateAttributionEndsAt ||
    member.affiliateAttributionEndsAt.getTime() > now.getTime()
  );
}

export type AffiliateAttributionDecision =
  | { attribute: true }
  | { attribute: false; reason: "already_attributed" | "already_member" | "not_affiliate_link" };

/**
 * Règles d'attribution du contrat : premier affilié gagne (un membre déjà rattaché ne change jamais d'affilié tout
 * seul) ; une personne déjà membre du canal avant de cliquer le lien n'est pas attribuée.
 */
export function affiliateAttributionDecision(input: {
  isAffiliateLink: boolean;
  memberAffiliateId: string | null;
  alreadyInChannel: boolean;
}): AffiliateAttributionDecision {
  if (!input.isAffiliateLink) return { attribute: false, reason: "not_affiliate_link" };
  if (input.memberAffiliateId) return { attribute: false, reason: "already_attributed" };
  if (input.alreadyInChannel) return { attribute: false, reason: "already_member" };
  return { attribute: true };
}

/**
 * Nom du lien Telegram d'une campagne : 32 caractères au plus au sens de Telegram (unités UTF-16 : un emoji en compte
 * deux), sans jamais couper un emoji en deux.
 */
export function linkaffiInviteLinkName(campaignName: string): string {
  let out = "";
  for (const ch of Array.from(campaignName.trim() || "Campagne Link Affi")) {
    if (out.length + ch.length > 32) break;
    out += ch;
  }
  return out;
}

/** Attentes entre deux tentatives d'envoi d'un événement (puis 2 h jusqu'à 24 h). */
export const LINKAFFI_RETRY_DELAYS_MS = [
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
] as const;
/** Durée totale des nouvelles tentatives (contrat : 24 h). */
export const LINKAFFI_RETRY_WINDOW_MS = 24 * 3_600_000;

/**
 * Prochaine tentative après `attempts` échecs (attente croissante, puis toutes les 2 h), ou null : l'événement a plus
 * de 24 h et est abandonné (Link Affi peut le rattraper par `GET /members`).
 */
export function nextLinkaffiAttemptAt(attempts: number, createdAt: Date, now: Date): Date | null {
  const delay = LINKAFFI_RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? 2 * 3_600_000;
  const at = new Date(now.getTime() + delay);
  if (at.getTime() - createdAt.getTime() > LINKAFFI_RETRY_WINDOW_MS) return null;
  return at;
}

/** File d'envoi bloquée : un événement attend depuis plus d'une heure (alerte Telegram). */
export function isLinkaffiQueueStuck(oldestPendingCreatedAt: Date | null, now: Date): boolean {
  return !!oldestPendingCreatedAt && now.getTime() - oldestPendingCreatedAt.getTime() > 3_600_000;
}
