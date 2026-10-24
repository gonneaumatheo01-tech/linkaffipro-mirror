/**
 * Envoi des DM de bienvenue depuis un compte REEL (voir apps/worker/src/approvals/welcome-dm.ts, qui les met en
 * file). Boucle toutes les 15 s : un compte non connecte n'est pas perdu, on repasse plus tard.
 */
import { prisma } from "@linkaffipro/db";
import type { LiveAccount } from "./client";
import { logger } from "./logger";
import type { TransportPeer } from "./transport";

const INTERVAL_MS = 15_000;
const BATCH = 10;
const MAX_ATTEMPTS = 3;

export const ANONYMIZED_ERROR = "Non envoye : membre supprime a sa demande.";

/**
 * Destinataire encore permis (regle pure sur les lignes lues) : un identifiant negatif est celui d'un membre anonymise ;
 * le membre de l'identifiant (ou de l'adhesion) ne doit pas etre anonymise.
 */
export function recipientAllowedFrom(
  telegramUserId: bigint,
  member: { anonymizedAt: Date | null } | null,
  membershipMember: { anonymizedAt: Date | null } | null,
): boolean {
  if (telegramUserId <= 0n) return false;
  if (membershipMember?.anonymizedAt) return false;
  // Plus aucun membre avec cet identifiant : il a ete remplace par l'anonymisation.
  if (!member) return membershipMember !== null;
  return !member.anonymizedAt;
}

async function recipientAllowed(dm: { telegramUserId: bigint; membershipId: string | null }): Promise<boolean> {
  const [member, membership] = await Promise.all([
    prisma.member.findUnique({ where: { telegramUserId: dm.telegramUserId }, select: { anonymizedAt: true } }),
    dm.membershipId
      ? prisma.membership.findUnique({ where: { id: dm.membershipId }, select: { member: { select: { anonymizedAt: true } } } })
      : Promise.resolve(null),
  ]);
  return recipientAllowedFrom(dm.telegramUserId, member, membership?.member ?? null);
}

/** Demarre la boucle ; rend une fonction d'arret. `accounts` est relu a chaque tour (comptes connectes). */
export function startWelcomeDmLoop(accounts: () => Map<string, LiveAccount>): () => void {
  let busy = false;

  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const dus = await prisma.accountDm.findMany({
        where: { status: "PENDING", dueAt: { lte: new Date() } },
        orderBy: { dueAt: "asc" },
        take: BATCH,
        select: { id: true, accountId: true, telegramUserId: true, membershipId: true, text: true, attempts: true },
      });
      for (const dm of dus) {
        const live = accounts().get(dm.accountId);
        if (!live) continue;
        // Membre supprime a sa demande (ou anonymise par la purge) : rien ne part, le texte est efface.
        if (!(await recipientAllowed(dm))) {
          await prisma.accountDm.updateMany({
            where: { id: dm.id, status: "PENDING" },
            data: { status: "CANCELLED", text: "", lastError: ANONYMIZED_ERROR },
          });
          logger.info({ dm: dm.id }, "DM de bienvenue annule : membre supprime");
          continue;
        }
        try {
          // Les identifiants Telegram tiennent dans un number ; GramJS resout ensuite le destinataire.
          const peer = await live.client.getInputEntity(
            Number(dm.telegramUserId) as unknown as TransportPeer,
          );
          await live.client.sendMessage(peer, { message: dm.text, linkPreview: false });
          await prisma.accountDm.update({
            where: { id: dm.id },
            data: { status: "SENT", sentAt: new Date(), lastError: null },
          });
          // Jamais l'identifiant Telegram de la personne dans les journaux.
          logger.info({ dm: dm.id }, "DM de bienvenue envoye");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const attempts = dm.attempts + 1;
          await prisma.accountDm.update({
            where: { id: dm.id },
            data: {
              attempts,
              lastError: message.slice(0, 200),
              status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
              dueAt: new Date(Date.now() + attempts * 60_000),
            },
          });
          logger.warn({ dm: dm.id, err: message, essai: attempts }, "DM de bienvenue en echec");
        }
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "boucle DM de bienvenue",
      );
    } finally {
      busy = false;
    }
  };

  const handle = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  return () => clearInterval(handle);
}
