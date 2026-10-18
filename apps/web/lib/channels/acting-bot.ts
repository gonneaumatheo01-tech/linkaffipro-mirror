import { prisma } from "@linkaffipro/db";

/**
 * Bot qui agit pour un canal dans les écrans des canaux (liens des canaux à rejoindre, liens de partage) : le bot
 * principal s'il est administrateur, sinon le premier administrateur — jamais un bot en mode assistant de conversation
 * (phase 17 : il ne s'occupe que de ses conversations privées). Même règle que `actingBotIdFor` du webhook.
 */
export async function actingStandardBotFor(channelId: string) {
  const [channel, admins] = await Promise.all([
    prisma.channel.findUnique({ where: { id: channelId }, select: { primaryBotId: true } }),
    prisma.channelBotAdmin.findMany({
      where: { channelId, revokedAt: null, bot: { isActive: true, mode: "STANDARD" } },
      // Même ordre que le webhook (`actingBotIdFor`) : à date égale, le même bot est choisi partout.
      orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
      include: { bot: true },
    }),
  ]);
  if (admins.length === 0) return null;
  const primary = channel?.primaryBotId
    ? admins.find((a) => a.botId === channel.primaryBotId)
    : undefined;
  return (primary ?? admins[0]!).bot;
}
