import { prisma } from "@linkaffipro/db";

/**
 * Compte Telegram de l'équipe (phase 17, activation « Seulement l'équipe (essai) » de l'assistant de conversation) :
 * compte lié à un utilisateur actif de la plateforme, ou l'admin du dialogue (`Setting` `admin.telegramUserId`).
 * Même règle que `isPlatformUser` des handlers ; partagée par le site (webhook) et le worker (tour de l'assistant).
 */
export async function isAssistantTeamMember(telegramUserId: bigint): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { telegramUserId, isActive: true },
    select: { id: true },
  });
  if (user) return true;
  const setting = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  return !!setting && typeof setting.value === "string" && setting.value === telegramUserId.toString();
}
