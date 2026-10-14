/**
 * Événements Link Affi et données personnelles (phase 13) :
 * - un événement en attente ne part jamais pour un membre supprimé (fiche membre → Supprimer, ou purge de
 *   conservation) ni vers un affilié retiré ou changé par un administrateur : il est abandonné (FAILED) avec la raison ;
 * - le corps enregistré d'un membre supprimé est effacé (`SCRUBBED_LINKAFFI_MEMBER`), quel que soit son statut ;
 * - les événements plus anciens que la durée de conservation sont supprimés (purge de nuit).
 * Requêtes SQL directes : `LinkaffiEvent.memberId` n'a pas de relation Prisma vers `Member`.
 */
import { prisma, toJsonValue } from "@linkaffipro/db";
import {
  SCRUBBED_LINKAFFI_MEMBER,
  scrubLinkaffiBody,
  UNDELIVERABLE_MESSAGES,
  type UndeliverableReason,
} from "./body";

const SCRUBBED_JSON = JSON.stringify(SCRUBBED_LINKAFFI_MEMBER);

/**
 * Abandonne un événement encore en attente qui ne doit plus partir (relu juste avant l'envoi). Membre supprimé : corps
 * effacé en même temps. Faux si l'événement n'était plus en attente.
 */
export async function cancelLinkaffiEvent(
  row: { id: string; body: unknown },
  reason: UndeliverableReason,
): Promise<boolean> {
  const r = await prisma.linkaffiEvent.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: {
      status: "FAILED",
      lastError: UNDELIVERABLE_MESSAGES[reason],
      ...(reason === "member_deleted" ? { body: toJsonValue(scrubLinkaffiBody(row.body)) } : {}),
    },
  });
  return r.count > 0;
}

/**
 * Passage périodique : abandonne d'un coup les événements en attente d'un membre supprimé (corps effacé) ou d'un membre
 * qui n'est plus rattaché à la campagne de l'événement. Tourne même sans clés configurées (rien ne doit rester prêt à
 * partir). Seulement les événements en attente (peu nombreux, index sur le statut).
 */
export async function cancelUndeliverableLinkaffiEvents(): Promise<number> {
  const deleted = await prisma.$executeRaw`
    UPDATE "LinkaffiEvent" e
    SET "status" = 'FAILED'::"LinkaffiEventStatus",
        "lastError" = ${UNDELIVERABLE_MESSAGES.member_deleted},
        "body" = CASE WHEN jsonb_typeof(e."body") = 'object'
                      THEN jsonb_set(e."body", '{member}', ${SCRUBBED_JSON}::jsonb)
                      ELSE jsonb_build_object('member', ${SCRUBBED_JSON}::jsonb) END,
        "updatedAt" = NOW()
    WHERE e."status" = 'PENDING'::"LinkaffiEventStatus"
      AND e."memberId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Member" m WHERE m."id" = e."memberId" AND m."anonymizedAt" IS NULL
      )`;
  const changed = await prisma.$executeRaw`
    UPDATE "LinkaffiEvent" e
    SET "status" = 'FAILED'::"LinkaffiEventStatus",
        "lastError" = ${UNDELIVERABLE_MESSAGES.affiliate_changed},
        "updatedAt" = NOW()
    FROM "Member" m
    WHERE e."status" = 'PENDING'::"LinkaffiEventStatus"
      AND m."id" = e."memberId"
      AND m."anonymizedAt" IS NULL
      AND m."linkaffiCampaignKey" IS DISTINCT FROM e."campaignKey"`;
  return deleted + changed;
}

/**
 * Purge de nuit : efface l'identité dans le corps de TOUS les événements des membres supprimés (envoyés, abandonnés ou
 * en attente) ; un événement encore en attente est abandonné. La date de mise à jour d'un événement déjà terminé ne
 * bouge pas (compteurs « abandonnés (7 jours) » du site). Rend le nombre d'événements effacés.
 */
export async function scrubDeletedMembersLinkaffiEvents(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "LinkaffiEvent" e
    SET "body" = CASE WHEN jsonb_typeof(e."body") = 'object'
                      THEN jsonb_set(e."body", '{member}', ${SCRUBBED_JSON}::jsonb)
                      ELSE jsonb_build_object('member', ${SCRUBBED_JSON}::jsonb) END,
        "status" = CASE WHEN e."status" = 'PENDING'::"LinkaffiEventStatus"
                        THEN 'FAILED'::"LinkaffiEventStatus" ELSE e."status" END,
        "lastError" = CASE WHEN e."status" = 'PENDING'::"LinkaffiEventStatus"
                           THEN ${UNDELIVERABLE_MESSAGES.member_deleted} ELSE e."lastError" END,
        "updatedAt" = CASE WHEN e."status" = 'PENDING'::"LinkaffiEventStatus"
                           THEN NOW() ELSE e."updatedAt" END
    WHERE e."memberId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Member" m WHERE m."id" = e."memberId" AND m."anonymizedAt" IS NULL
      )
      AND (e."body" -> 'member') IS DISTINCT FROM ${SCRUBBED_JSON}::jsonb`;
}

/** Purge de nuit : supprime les événements plus anciens que la durée de conservation (date du fait). */
export async function deleteLinkaffiEventsBefore(cutoff: Date): Promise<number> {
  const r = await prisma.linkaffiEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } });
  return r.count;
}
