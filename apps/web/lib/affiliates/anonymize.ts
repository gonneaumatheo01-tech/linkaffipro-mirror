import { prisma, type Prisma } from "@linkaffipro/db";

/**
 * Suppression d'un membre sur demande (fiche membre → Supprimer, anonymisation) : ses événements destinés à Link Affi
 * (`LinkaffiEvent`, phase 13) gardent dans leur corps le prénom, le pseudo, la langue et l'identifiant Telegram du
 * membre (corps exact du contrat, § 2). À faire dans la MÊME transaction que l'anonymisation du membre :
 * - les événements encore en attente sont supprimés (plus rien ne part vers Link Affi pour ce membre) ;
 * - les autres (envoyés, abandonnés) perdent l'identité du membre : `member` = `{ telegramUserId: "0", username: null,
 *   firstName: null, languageCode: null }` ; le reste (type, campagne, canal, dates, identifiant de suivi) est gardé,
 *   pour que les chiffres de l'affilié restent justes.
 */
export const ANONYMOUS_LINKAFFI_MEMBER = {
  telegramUserId: "0",
  username: null,
  firstName: null,
  languageCode: null,
} as const;

export function scrubLinkaffiEventsOps(memberId: string): Prisma.PrismaPromise<unknown>[] {
  const anonymous = JSON.stringify(ANONYMOUS_LINKAFFI_MEMBER);
  return [
    prisma.linkaffiEvent.deleteMany({ where: { memberId, status: "PENDING" } }),
    prisma.$executeRaw`
      UPDATE "LinkaffiEvent"
      SET "body" = jsonb_set("body", '{member}', ${anonymous}::jsonb, true), "updatedAt" = NOW()
      WHERE "memberId" = ${memberId} AND jsonb_typeof("body") = 'object'`,
  ];
}
