import { randomBytes } from "node:crypto";
import { prisma, audit, recordEvent } from "@linkaffipro/db";
import { logger } from "../logger";
import {
  deleteLinkaffiEventsBefore,
  scrubDeletedMembersLinkaffiEvents,
} from "../linkaffi-events/privacy";
import { deleteLandingEventsBefore } from "./landing";
import { isPurgeable, parseRetentionMonths, retentionCutoff } from "./retention";

export type PurgeResult = {
  months: number;
  cutoff: Date;
  membersAnonymized: number;
  eventsDeleted: number;
  /** Événements Link Affi dont l'identité du membre (supprimé) a été effacée. */
  linkaffiEventsScrubbed: number;
  /** Événements Link Affi plus anciens que la durée de conservation, supprimés. */
  linkaffiEventsDeleted: number;
  /** Visites, clics et ouvertures des pages d'atterrissage plus anciens que la durée de conservation (phase 15). */
  landingEventsDeleted: number;
  /** Conversations de l'assistant des membres anonymisés (supprimées avec leurs messages et événements, phase 17). */
  conversationsDeleted: number;
  /** Messages de conversation de l'assistant plus anciens que la durée de conservation (phase 17). */
  conversationMessagesDeleted: number;
  /**
   * Copies des messages de l'assistant gardées par l'envoi (`OutboundMessage` ASSISTANT) vidées de leur texte : membres
   * anonymisés, ou plus anciennes que la durée de conservation (phase 17).
   */
  assistantTextsCleared: number;
  /** Missions d'agents terminées plus anciennes que la durée de conservation (passages et validations avec, phase 19). */
  agentMissionsDeleted: number;
  /** Passages d'agents plus anciens que la durée de conservation (missions encore gardées, phase 19). */
  agentRunsDeleted: number;
};

/**
 * Purge de rétention : anonymise les membres inactifs depuis N mois (même règle que la suppression manuelle)
 * et supprime les événements plus anciens que N mois, sauf les événements joueurs (`player.*`).
 * Événements des membres d'affiliés pour Link Affi (phase 13) : identité effacée pour tout membre supprimé (à sa
 * demande ou ici), envoi en attente abandonné ; événements de plus de N mois supprimés.
 * Visites et clics des pages d'atterrissage (phase 15, empreinte de l'adresse IP, agent utilisateur, identifiants de
 * clic des pubs) : supprimés après N mois.
 * Assistant de conversation (phase 17) : les conversations des membres anonymisés (ici ou à leur demande) sont
 * supprimées (messages et événements avec) ; les messages de conversation de plus de N mois sont supprimés ; la copie
 * du texte gardée par l'envoi (`OutboundMessage` ASSISTANT, qui reprend souvent le prénom ou la ville de la personne) est
 * vidée pour les membres anonymisés et au-delà de N mois (l'envoi lui-même reste, pour les chiffres).
 */
/** Message de conversation resté « en file » plus de 10 minutes : envoi interrompu (jamais un envoi en cours). */
const STALE_QUEUED_MS = 10 * 60_000;
const PURGED_QUEUED_ERROR =
  "Non envoyé : resté en file (envoi interrompu ou personne supprimée), texte effacé par la purge.";

export async function runPurge(now = new Date()): Promise<PurgeResult> {
  const setting = await prisma.setting.findUnique({ where: { key: "retention.months" } });
  const months = parseRetentionMonths(setting?.value);
  const cutoff = retentionCutoff(months, now);

  // Candidats : membres non anonymisés vus avant le seuil (les autres sont actifs par définition).
  const candidates = await prisma.member.findMany({
    where: { anonymizedAt: null, lastSeenAt: { lt: cutoff } },
    select: { id: true, lastSeenAt: true, anonymizedAt: true },
    take: 5000,
  });
  let membersAnonymized = 0;
  for (const m of candidates) {
    const [membership, click, outbound] = await Promise.all([
      prisma.membership.findFirst({
        where: { memberId: m.id },
        orderBy: { requestedAt: "desc" },
        select: { requestedAt: true, joinedAt: true, approvedAt: true, leftAt: true },
      }),
      prisma.click.findFirst({
        where: { memberId: m.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.outboundMessage.findFirst({
        where: { memberId: m.id },
        orderBy: { queuedAt: "desc" },
        select: { queuedAt: true },
      }),
    ]);
    const lastMembershipAt = membership
      ? new Date(
          Math.max(
            ...[
              membership.requestedAt,
              membership.joinedAt,
              membership.approvedAt,
              membership.leftAt,
            ]
              .filter((d): d is Date => d instanceof Date)
              .map((d) => d.getTime()),
          ),
        )
      : null;
    if (
      !isPurgeable(
        {
          lastSeenAt: m.lastSeenAt,
          lastMembershipAt,
          lastClickAt: click?.createdAt ?? null,
          lastOutboundAt: outbound?.queuedAt ?? null,
          anonymizedAt: m.anonymizedAt,
        },
        cutoff,
      )
    )
      continue;
    const fake = -BigInt(`0x${randomBytes(6).toString("hex")}`);
    await prisma.$transaction([
      prisma.memberNote.deleteMany({ where: { memberId: m.id } }),
      prisma.memberBotState.updateMany({
        where: { memberId: m.id },
        data: { canDm: false, blockedAt: now },
      }),
      prisma.member.update({
        where: { id: m.id },
        data: {
          firstName: null,
          lastName: null,
          username: null,
          languageCode: null,
          isPremium: false,
          telegramUserId: fake,
          anonymizedAt: now,
          tags: [],
        },
      }),
    ]);
    await recordEvent({
      type: "member.anonymized",
      memberId: m.id,
      payload: { by: "maintenance.purge", months },
    });
    membersAnonymized++;
  }

  const deleted = await prisma.event.deleteMany({
    where: { occurredAt: { lt: cutoff }, NOT: { type: { startsWith: "player." } } },
  });
  const linkaffiEventsScrubbed = await scrubDeletedMembersLinkaffiEvents();
  const linkaffiEventsDeleted = await deleteLinkaffiEventsBefore(cutoff);
  const landingEventsDeleted = await deleteLandingEventsBefore(cutoff);
  const conversations = await prisma.conversation.deleteMany({
    where: { member: { anonymizedAt: { not: null } } },
  });
  const conversationMessages = await prisma.conversationMessage.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  // Un message encore en file garde son texte jusqu'à son envoi ; resté « en file » plus de 10 minutes (envoi
  // interrompu, membre anonymisé dont l'envoi est refusé de toute façon), il est passé en échec et vidé lui aussi.
  const purgeScope = {
    kind: "ASSISTANT" as const,
    text: { not: "" },
    OR: [{ queuedAt: { lt: cutoff } }, { member: { anonymizedAt: { not: null } } }],
  };
  const sentTexts = await prisma.outboundMessage.updateMany({
    where: { ...purgeScope, status: { not: "QUEUED" } },
    data: { text: "", buttons: [] },
  });
  const staleQueued = await prisma.outboundMessage.updateMany({
    where: { kind: "ASSISTANT", text: { not: "" }, status: "QUEUED", queuedAt: { lt: cutoff } },
    data: { status: "FAILED", error: PURGED_QUEUED_ERROR, text: "", buttons: [] },
  });
  const staleQueuedAnonymized = await prisma.outboundMessage.updateMany({
    where: {
      kind: "ASSISTANT",
      text: { not: "" },
      status: "QUEUED",
      member: { anonymizedAt: { not: null } },
      queuedAt: { lt: new Date(now.getTime() - STALE_QUEUED_MS) },
    },
    data: { status: "FAILED", error: PURGED_QUEUED_ERROR, text: "", buttons: [] },
  });
  const assistantTexts = {
    count: sentTexts.count + staleQueued.count + staleQueuedAnonymized.count,
  };
  // Agents (phase 19) : missions terminées de plus de N mois (passages et validations supprimés en cascade), puis
  // passages restants de plus de N mois.
  const agentMissions = await prisma.agentMission.deleteMany({
    where: { createdAt: { lt: cutoff }, status: { in: ["DONE", "FAILED", "CANCELLED", "BLOCKED_BUDGET"] } },
  });
  const agentRuns = await prisma.agentRun.deleteMany({ where: { startedAt: { lt: cutoff } } });
  const result: PurgeResult = {
    months,
    cutoff,
    membersAnonymized,
    eventsDeleted: deleted.count,
    linkaffiEventsScrubbed,
    linkaffiEventsDeleted,
    landingEventsDeleted,
    conversationsDeleted: conversations.count,
    conversationMessagesDeleted: conversationMessages.count,
    assistantTextsCleared: assistantTexts.count,
    agentMissionsDeleted: agentMissions.count,
    agentRunsDeleted: agentRuns.count,
  };
  await audit({
    action: "maintenance.purge",
    metadata: {
      months,
      cutoff: cutoff.toISOString(),
      membersAnonymized,
      eventsDeleted: deleted.count,
      linkaffiEventsScrubbed,
      linkaffiEventsDeleted,
      landingEventsDeleted,
      conversationsDeleted: conversations.count,
      conversationMessagesDeleted: conversationMessages.count,
      assistantTextsCleared: assistantTexts.count,
      agentMissionsDeleted: agentMissions.count,
      agentRunsDeleted: agentRuns.count,
    },
  });
  logger.info(result, "purge de rétention effectuée");
  return result;
}
