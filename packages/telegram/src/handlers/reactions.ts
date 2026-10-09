import type { Bot } from "grammy";
import { prisma } from "@linkaffipro/db";
import type { BotIdentity } from "../ports";

/** Résumé des réactions d'une update `message_reaction_count` : { "👍": 3, "🔥": 1 }. */
export function summarizeReactions(reactions: Array<{ type: { type: string; emoji?: string; custom_emoji_id?: string }; total_count: number }>): { reactions: Record<string, number>; total: number } {
  const out: Record<string, number> = {};
  let total = 0;
  for (const r of reactions) {
    const key = r.type.type === "emoji" ? (r.type.emoji ?? "?") : r.type.type === "custom_emoji" ? `custom:${r.type.custom_emoji_id ?? "?"}` : r.type.type;
    out[key] = (out[key] ?? 0) + r.total_count;
    total += r.total_count;
  }
  return { reactions: out, total };
}

/** `message_reaction_count` (canaux) → `PostStats.reactions` du message programmé correspondant. */
export function registerReactionHandlers(bot: Bot, _identity: BotIdentity): void {
  bot.on("message_reaction_count", async (ctx) => {
    const upd = ctx.messageReactionCount;
    const channel = await prisma.channel.findUnique({ where: { telegramChatId: BigInt(upd.chat.id) }, select: { id: true } });
    if (!channel) return;
    const post = await prisma.post.findFirst({
      where: { channelId: channel.id, status: { in: ["SENT", "DELETED"] }, telegramMessageIds: { array_contains: [upd.message_id] } },
      select: { id: true },
    });
    if (!post) return;
    const { reactions, total } = summarizeReactions(upd.reactions);
    await prisma.postStats.upsert({
      where: { postId: post.id },
      create: { postId: post.id, reactions, reactionsTotal: total },
      update: { reactions, reactionsTotal: total },
    });
  });
}
