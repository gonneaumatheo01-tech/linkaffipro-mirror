import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { BotIdentity, ChannelDeps } from "../ports";
import type { JoinFlowDeps } from "../join-flow/deps";
import { handleChatMember, handleGateStart, handleJoinRequest } from "../join-flow/service";
import { ensureChannelKnown } from "./channels";

let defaultDeps: JoinFlowDeps | null = null;
async function getDefaultDeps(): Promise<JoinFlowDeps> {
  if (!defaultDeps) defaultDeps = (await import("../join-flow/prisma-deps")).prismaJoinFlowDeps;
  return defaultDeps;
}
async function getDefaultChannelDeps(): Promise<ChannelDeps> {
  return (await import("../prisma-deps")).prismaTelegramDeps;
}

function keyboard(rows: Array<Array<{ text: string; url: string }>>): InlineKeyboard | undefined {
  if (rows.length === 0) return undefined;
  const kb = new InlineKeyboard();
  rows.forEach((row, i) => {
    row.forEach((b) => kb.url(b.text, b.url));
    if (i < rows.length - 1) kb.row();
  });
  return kb;
}

/**
 * Chantier A : chat_join_request, /start g<code>, chat_member.
 * `channelDeps` : création d'un canal encore inconnu (droits relevés) avant un second essai ; par défaut, Prisma.
 */
export function registerJoinFlowHandlers(bot: Bot, identity: BotIdentity, deps?: JoinFlowDeps, channelDeps?: ChannelDeps): void {
  const getDeps = () => (deps ? Promise.resolve(deps) : getDefaultDeps());
  const getChannelDeps = () => (channelDeps ? Promise.resolve(channelDeps) : getDefaultChannelDeps());

  bot.on("chat_join_request", async (ctx) => {
    const d = await getDeps();
    let r = await handleJoinRequest(ctx.api, identity, d, ctx.chatJoinRequest);
    if (!r.handled && r.reason === "canal inconnu") {
      await ensureChannelKnown(ctx, await getChannelDeps(), ctx.chatJoinRequest.chat);
      r = await handleJoinRequest(ctx.api, identity, d, ctx.chatJoinRequest);
    }
    if (!r.handled && r.reason) console.warn("[join-flow] demande ignorée :", r.reason);
  });

  bot.on("chat_member", async (ctx) => {
    const d = await getDeps();
    const r = await handleChatMember(identity, d, ctx.chatMember);
    if (!r.handled && r.reason === "canal inconnu") {
      await ensureChannelKnown(ctx, await getChannelDeps(), ctx.chatMember.chat);
      await handleChatMember(identity, d, ctx.chatMember);
    }
  });

  bot.command("start", async (ctx, next) => {
    const payload = typeof ctx.match === "string" ? ctx.match : "";
    if (!ctx.from || ctx.chat?.type !== "private" || !/^g[0-9A-Za-z]{6,12}$/.test(payload)) return next();
    const d = await getDeps();
    const r = await handleGateStart(ctx.api, identity, d, ctx.from, payload.slice(1));
    await ctx.reply(r.text, { parse_mode: "HTML", reply_markup: keyboard(r.buttons), link_preview_options: { is_disabled: true } });
  });
}
