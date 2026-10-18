import { Api } from "grammy";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";

const cache = new Map<string, { api: Api; tokenEncrypted: string; username: string }>();

/**
 * Instance `Api` grammY d'un bot (jeton déchiffré en mémoire, sans handlers). `mode` : bot normal, ou assistant de
 * conversation (phase 17), relu à chaque appel (jamais mis en cache) pour refuser ce qu'un assistant ne fait pas.
 */
export async function apiForBot(
  botId: string,
): Promise<{ api: Api; username: string; mode: "STANDARD" | "ASSISTANT" }> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { tokenEncrypted: true, username: true, isActive: true, mode: true },
  });
  if (!bot || !bot.isActive) throw new Error("Bot inactif ou introuvable.");
  const hit = cache.get(botId);
  if (hit && hit.tokenEncrypted === bot.tokenEncrypted)
    return { api: hit.api, username: hit.username, mode: bot.mode };
  const api = new Api(decrypt(bot.tokenEncrypted));
  cache.set(botId, { api, tokenEncrypted: bot.tokenEncrypted, username: bot.username });
  return { api, username: bot.username, mode: bot.mode };
}
