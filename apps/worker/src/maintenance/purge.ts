import { randomBytes } from "node:crypto";
import { prisma, audit, recordEvent } from "@linkaffipro/db";
import { logger } from "../logger";
import {
  deleteLinkaffiEventsBefore,
  scrubDeletedMembersLinkaffiEvents,
} from "../linkaffi-events/privacy";
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
};

/**
 * Purge de rétention : anonymise les membres inactifs depuis N mois (même règle que la suppression manuelle)
 * et supprime les événements plus anciens que N mois, sauf les événements joueurs (`player.*`).
 * Événements des membres d'affiliés pour Link Affi (phase 13) : identité effacée pour tout membre supprimé (à sa
 * demande ou ici), envoi en attente abandonné ; événements de plus de N mois supprimés.
 */
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
  const result: PurgeResult = {
    months,
    cutoff,
    membersAnonymized,
    eventsDeleted: deleted.count,
    linkaffiEventsScrubbed,
    linkaffiEventsDeleted,
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
    },
  });
  logger.info(result, "purge de rétention effectuée");
  return result;
}
