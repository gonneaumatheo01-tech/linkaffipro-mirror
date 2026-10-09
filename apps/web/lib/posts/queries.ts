import { prisma, type PostStatus } from "@linkaffipro/db";

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: "Brouillon",
  SCHEDULED: "Programmé",
  SENDING: "Envoi en cours",
  SENT: "Envoyé",
  FAILED: "Échec",
  DELETED: "Supprimé",
  CANCELLED: "Annulé",
};

export const POST_STATUS_VARIANT: Record<PostStatus, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline",
  SCHEDULED: "default",
  SENDING: "default",
  SENT: "secondary",
  FAILED: "destructive",
  DELETED: "outline",
  CANCELLED: "outline",
};

/** Bot qui publie dans un canal : bot principal, sinon premier bot administrateur actif. */
export async function publishingBotFor(channelId: string): Promise<{ id: string; username: string } | null> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, include: { primaryBot: true, botAdmins: { where: { revokedAt: null }, include: { bot: true } } } });
  if (!channel) return null;
  if (channel.primaryBot?.isActive) return { id: channel.primaryBot.id, username: channel.primaryBot.username };
  const admin = channel.botAdmins.find((a) => a.bot.isActive);
  return admin ? { id: admin.bot.id, username: admin.bot.username } : null;
}
