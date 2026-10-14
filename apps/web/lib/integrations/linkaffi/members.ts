import type { LinkaffiEventBody } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";

/**
 * `GET /members?campaignKey=…&since=<ISO>` : rattrapage par Link Affi (contrat § 1). Deux listes :
 * - `members` : les membres rattachés à cette campagne Telegram d'affilié (`Member.linkaffiCampaignKey`), avec leur
 *   statut dans le canal de la campagne et les dates du parcours. Membres anonymisés (suppression demandée) exclus.
 *   Seulement ce que l'affilié a le droit de voir : identifiant Telegram, pseudo, prénom, langue, statut, dates ; jamais
 *   le nom de famille ni le téléphone.
 * - `events` : les événements de la campagne depuis `since` (inclus), corps exactement tels qu'envoyés, du plus ancien
 *   au plus récent, 1 000 au plus par appel : `hasMoreEvents` + `nextSince` pour la suite (Link Affi ignore les
 *   doublons par `eventId`). Seulement ce que Link Affi peut recevoir (`isEventVisibleToCampaign`) : jamais l'événement
 *   d'un membre anonymisé, ni celui qu'un changement ou un retrait d'affilié par un ADMIN a retenu.
 */

export const MAX_EVENTS_PER_CALL = 1000;
export const MAX_MEMBERS_PER_CALL = 20_000;

/** Statut d'un membre, vu par Link Affi. */
export type LinkaffiMemberStatus =
  "requested" | "approved" | "joined" | "left" | "declined" | "expired" | "unknown";

/** Statut à partir de la demande d'adhésion la plus récente dans le canal de la campagne (règle pure, testée). */
export function linkaffiMemberStatus(
  m: { status: string; joinedAt: Date | null } | null | undefined,
): LinkaffiMemberStatus {
  if (!m) return "unknown";
  switch (m.status) {
    case "REQUESTED":
    case "PENDING_GATE":
    case "SCHEDULED":
      return "requested";
    case "APPROVED":
      return m.joinedAt ? "joined" : "approved";
    case "LEFT":
    case "KICKED":
      return "left";
    case "DECLINED":
      return "declined";
    // FAILED : l'acceptation n'a pas pu se faire chez Telegram ; la personne n'est pas entrée.
    case "EXPIRED":
    case "FAILED":
      return "expired";
    default:
      return "unknown";
  }
}

export type LinkaffiMemberView = {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  languageCode: string | null;
  channel: { id: string; title: string } | null;
  inviteLinkId: string | null;
  status: LinkaffiMemberStatus;
  attributedAt: string | null;
  attributionEndsAt: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  declinedAt: string | null;
};

export type LinkaffiMembersPayload = {
  campaignKey: string;
  since: string | null;
  generatedAt: string;
  members: LinkaffiMemberView[];
  membersTruncated: boolean;
  events: LinkaffiEventBody[];
  hasMoreEvents: boolean;
  /** À passer en `since` pour lire la suite (null : tout est là). */
  nextSince: string | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Un événement enregistré peut-il être rendu à Link Affi pour cette campagne (règle pure, testée) ? Même règle que le
 * worker avant chaque envoi (`undeliverableReason`, apps/worker/src/linkaffi-events/body.ts), pour que le rattrapage ne
 * livre jamais ce que l'envoi a retenu :
 * - membre anonymisé (suppression demandée, purge de conservation) ou introuvable : jamais ;
 * - déjà envoyé (`SENT`) : oui, Link Affi l'a reçu et ignore les doublons ;
 * - pas encore envoyé (en attente, ou abandonné après 24 h, rattrapable ici) : seulement si le membre est encore
 *   rattaché à cette campagne. Un ADMIN qui change ou retire l'affilié retient donc tout ce qui n'était pas parti,
 *   même si le worker n'est pas encore passé l'annuler.
 * Sans membre sur la ligne : rien à relire, rendu.
 */
export function isEventVisibleToCampaign(
  event: { memberId: string | null; status: string },
  member: { anonymizedAt: Date | null; linkaffiCampaignKey: string | null } | null | undefined,
  campaignKey: string,
): boolean {
  if (!event.memberId) return true;
  if (!member || member.anonymizedAt) return false;
  if (event.status === "SENT") return true;
  return member.linkaffiCampaignKey === campaignKey;
}

/** Membres et événements d'une campagne, ou null si aucune campagne n'a cette clé chez nous. */
export async function loadLinkaffiCampaignMembers(
  campaignKey: string,
  since: Date | null,
  now = new Date(),
): Promise<LinkaffiMembersPayload | null> {
  const links = await prisma.inviteLink.findMany({
    where: { kind: "LINKAFFI", linkaffiCampaignKey: campaignKey },
    select: { id: true, channelId: true, channel: { select: { id: true, title: true } } },
  });
  if (links.length === 0) return null;

  const members = await prisma.member.findMany({
    where: { linkaffiCampaignKey: campaignKey, anonymizedAt: null },
    orderBy: [{ affiliateAttributedAt: "asc" }, { id: "asc" }],
    take: MAX_MEMBERS_PER_CALL + 1,
    select: {
      id: true,
      telegramUserId: true,
      username: true,
      firstName: true,
      languageCode: true,
      affiliateAttributedAt: true,
      affiliateAttributionEndsAt: true,
      affiliateInviteLinkId: true,
      affiliateInviteLink: {
        select: { channelId: true, channel: { select: { id: true, title: true } } },
      },
    },
  });
  const membersTruncated = members.length > MAX_MEMBERS_PER_CALL;
  const kept = members.slice(0, MAX_MEMBERS_PER_CALL);
  const fallbackChannel = links.length === 1 ? links[0]!.channel : null;
  const channelIds = [
    ...new Set(
      kept
        .map((m) => m.affiliateInviteLink?.channelId ?? fallbackChannel?.id)
        .filter((x): x is string => !!x),
    ),
  ];
  const memberships = kept.length
    ? await prisma.membership.findMany({
        where: { memberId: { in: kept.map((m) => m.id) }, channelId: { in: channelIds } },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        select: {
          memberId: true,
          channelId: true,
          status: true,
          requestedAt: true,
          approvedAt: true,
          joinedAt: true,
          leftAt: true,
          declinedAt: true,
        },
      })
    : [];
  const latest = new Map<string, (typeof memberships)[number]>();
  for (const ms of memberships) {
    const k = `${ms.memberId}:${ms.channelId}`;
    if (!latest.has(k)) latest.set(k, ms);
  }

  const events = await prisma.linkaffiEvent.findMany({
    where: { campaignKey, ...(since ? { occurredAt: { gte: since } } : {}) },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: MAX_EVENTS_PER_CALL + 1,
    select: { body: true, occurredAt: true, memberId: true, status: true },
  });
  const hasMoreEvents = events.length > MAX_EVENTS_PER_CALL;
  const page = events.slice(0, MAX_EVENTS_PER_CALL);
  // Membres relus maintenant (pas au moment de l'événement) : suppression, changement ou retrait d'affilié.
  const eventMemberIds = [...new Set(page.map((e) => e.memberId).filter((x): x is string => !!x))];
  const eventMembers = new Map(
    eventMemberIds.length
      ? (
          await prisma.member.findMany({
            where: { id: { in: eventMemberIds } },
            select: { id: true, anonymizedAt: true, linkaffiCampaignKey: true },
          })
        ).map((m) => [m.id, m] as const)
      : [],
  );

  return {
    campaignKey,
    since: iso(since),
    generatedAt: now.toISOString(),
    members: kept.map((m) => {
      const channel = m.affiliateInviteLink?.channel ?? fallbackChannel;
      const ms = channel ? latest.get(`${m.id}:${channel.id}`) : undefined;
      return {
        telegramUserId: String(m.telegramUserId),
        username: m.username,
        firstName: m.firstName,
        languageCode: m.languageCode,
        channel: channel ? { id: channel.id, title: channel.title } : null,
        inviteLinkId: m.affiliateInviteLinkId,
        status: linkaffiMemberStatus(ms),
        attributedAt: iso(m.affiliateAttributedAt),
        attributionEndsAt: iso(m.affiliateAttributionEndsAt),
        requestedAt: iso(ms?.requestedAt),
        approvedAt: iso(ms?.approvedAt),
        joinedAt: iso(ms?.joinedAt),
        leftAt: iso(ms?.leftAt),
        declinedAt: iso(ms?.declinedAt),
      };
    }),
    membersTruncated,
    events: page
      .filter((e) =>
        isEventVisibleToCampaign(e, e.memberId ? eventMembers.get(e.memberId) : null, campaignKey),
      )
      .map((e) => e.body as unknown as LinkaffiEventBody),
    hasMoreEvents,
    nextSince: hasMoreEvents ? iso(page[page.length - 1]!.occurredAt) : null,
  };
}
