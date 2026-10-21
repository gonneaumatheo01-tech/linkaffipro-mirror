/**
 * DM de bienvenue envoye depuis un compte Telegram REEL (userbot). On ne fait qu'ecrire la ligne : apps/userbot
 * envoie. Independant du message d'accueil du bot (`ApprovalRule.sendWelcome`), qui reste inchange.
 */
import { prisma } from "@linkaffipro/db";
import { logger } from "../logger";

/** Texte par defaut si le canal n'en a pas. `{prenom}` est remplace. */
const DEFAULT_TEXT = "Salut{prenom} ! J'ai vu que t'avais rejoint mon canal";

/** Met en file le DM de bienvenue si le canal en a un. Ne jette jamais. */
export async function enqueueWelcomeDm(input: {
  membershipId: string;
  channelId: string;
  memberId: string;
}): Promise<void> {
  const channel = await prisma.channel.findUnique({
    where: { id: input.channelId },
    select: {
      welcomeDmEnabled: true,
      welcomeDmAccountId: true,
      welcomeDmDelayMinutes: true,
      welcomeDmText: true,
    },
  });
  if (!channel?.welcomeDmEnabled || !channel.welcomeDmAccountId) return;
  const account = await prisma.telegramUserAccount.findUnique({
    where: { id: channel.welcomeDmAccountId },
    select: { id: true, status: true },
  });
  if (!account || account.status !== "ACTIVE") return;
  const deja = await prisma.accountDm.findFirst({
    where: { membershipId: input.membershipId, status: "PENDING" },
    select: { id: true },
  });
  if (deja) return;
  const member = await prisma.member.findUnique({
    where: { id: input.memberId },
    select: { telegramUserId: true, firstName: true },
  });
  if (!member) return;
  const prenom = member.firstName ? ` ${member.firstName}` : "";
  const texte = (channel.welcomeDmText ?? DEFAULT_TEXT).replace("{prenom}", prenom);
  await prisma.accountDm.create({
    data: {
      accountId: account.id,
      channelId: input.channelId,
      membershipId: input.membershipId,
      telegramUserId: member.telegramUserId,
      text: texte,
      dueAt: new Date(Date.now() + Math.max(0, channel.welcomeDmDelayMinutes) * 60_000),
    },
  });
  logger.info({ canal: input.channelId, compte: account.id }, "DM de bienvenue mis en file");
}
