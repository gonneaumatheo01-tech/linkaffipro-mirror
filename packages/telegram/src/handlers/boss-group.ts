import type { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import {
  bossGroupMembership,
  bossTeamCallback,
  bossTeamIncoming,
  findTeamMember,
  readBossGroupId,
  type AgentsDeps,
  type BossTeamMessage,
  type BossTeamOutcome,
  type GroupEntity,
} from "@linkaffipro/agents";
import type { BotIdentity, TelegramDeps } from "../ports";
import { realBossEngine, type BossEngine } from "../boss/engine";
import { BOSS_QUEUE_DOWN_REPLY, deliverBossReply, sendBossText, type BossReplyApi } from "../boss/reply";
import { createAlbumCaptions, createLibraryDepositor, inboxMediaOf, type LibraryDepositor } from "./media-inbox";

/** Types de chat traités par le mode groupe du Boss (section 4 de la phase 26). */
export function isBossGroupChat(chatType: string | undefined): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function engineOf(deps: TelegramDeps): BossEngine {
  return deps.bossEngine ?? realBossEngine;
}

function replyApiOf(ctx: Context): BossReplyApi {
  return {
    sendMessage: (chatId, text, other) => ctx.api.sendMessage(chatId, text, other),
    deleteMessage: (chatId, messageId) => ctx.api.deleteMessage(chatId, messageId),
  };
}

/** Message Telegram → message vu par Kevin (texte ou légende, entités, réponse, média). */
export function teamMessageOf(msg: Message, identity: BotIdentity, chatType: "private" | "group"): BossTeamMessage {
  const entities = (msg.entities ?? msg.caption_entities ?? null) as GroupEntity[] | null;
  return {
    chat: { id: BigInt(msg.chat.id), type: chatType, title: "title" in msg.chat ? (msg.chat.title ?? null) : null },
    from: { id: BigInt(msg.from!.id), firstName: msg.from!.first_name ?? null, username: msg.from!.username ?? null },
    messageId: msg.message_id,
    text: msg.text ?? msg.caption ?? "",
    entities,
    replyTo: msg.reply_to_message ? { messageId: msg.reply_to_message.message_id, fromId: msg.reply_to_message.from ? BigInt(msg.reply_to_message.from.id) : null } : null,
    forwarded: Boolean(msg.forward_origin),
    hasMedia: inboxMediaOf(msg) !== null,
    bot: { telegramId: identity.telegramBotId, username: identity.username },
  };
}

type Tools = { deposit: LibraryDepositor; captionOf: (msg: Message, caption: string) => string };

/** Exécute la décision de Kevin pour un message (groupe, ou privé d'un membre). Ne lève jamais. */
async function act(ctx: Context, identity: BotIdentity, deps: TelegramDeps, msg: Message, out: BossTeamOutcome, tools: Tools): Promise<void> {
  const agents = deps.agentsDeps!();
  const engine = engineOf(deps);
  const chatId = msg.chat.id;
  const api = replyApiOf(ctx);
  switch (out.kind) {
    case "ignore":
      return;
    case "reply":
      await deliverBossReply({ api, chatId, messageId: msg.message_id, reply: out.reply, deps: agents, engine });
      return;
    case "secret": {
      // Supprimé aussitôt ; sans droit de suppression, Kevin demande à l'auteur de l'effacer.
      const deleted = await ctx.api
        .deleteMessage(chatId, msg.message_id)
        .then(() => true)
        .catch(() => false);
      await sendBossText(api, chatId, deleted ? out.ifDeleted : out.ifNotDeleted, { replyToMessageId: deleted ? null : msg.message_id });
      if (out.followUp) await out.followUp().catch((err) => console.error("[boss] secret redemandé en privé", (err as Error).message));
      return;
    }
    case "media": {
      const media = inboxMediaOf(msg);
      if (media) await tools.deposit(ctx, msg, media, out.caption);
      return;
    }
    case "engine": {
      const fast = await engine.fastPath(agents, out.input);
      if (fast.handled) {
        await deliverBossReply({ api, chatId, messageId: msg.message_id, reply: fast, deps: agents, engine });
        return;
      }
      await ctx.api.sendChatAction(chatId, "typing").catch(() => undefined);
      try {
        await agents.enqueue.orchestrator(
          {
            type: "boss-text",
            botId: identity.id,
            chatId,
            messageId: msg.message_id,
            text: out.input.text,
            replyToMessageId: out.input.replyToMessageId ?? null,
            source: "text",
            ...(out.input.forwarded ? { forwarded: true } : {}),
            entities: null,
            fromTelegramId: String(msg.from!.id),
            chatType: out.input.chat?.type === "group" ? "group" : "private",
            mentions: (out.input.mentions ?? []).map((m) => ({
              telegramUserId: m.telegramUserId != null ? String(m.telegramUserId) : null,
              username: m.username ?? null,
              firstName: m.firstName ?? null,
            })),
          },
          // Numéros de message propres à chaque conversation : la conversation fait partie de l'identifiant.
          { jobId: `boss-text:${identity.id}:${chatId}:${msg.message_id}` },
        );
      } catch (err) {
        console.error("[boss] message d'équipe non mis en file", identity.username, (err as Error).message);
        await sendBossText(api, chatId, BOSS_QUEUE_DOWN_REPLY, { replyToMessageId: msg.message_id }).catch(() => undefined);
      }
      return;
    }
  }
}

/** Kevin ajouté, retiré, ou ses droits changés dans un groupe. */
async function onMembership(ctx: Context, agents: AgentsDeps): Promise<void> {
  const upd = ctx.myChatMember!;
  const chat = upd.chat;
  const m = upd.new_chat_member as { status: string; can_delete_messages?: boolean };
  const out = await bossGroupMembership(agents, {
    chat: { id: BigInt(chat.id), type: chat.type as "group" | "supergroup", title: "title" in chat ? (chat.title ?? null) : null },
    from: { id: BigInt(upd.from.id), firstName: upd.from.first_name ?? null, username: upd.from.username ?? null },
    oldStatus: upd.old_chat_member.status,
    newStatus: m.status,
    canDelete: m.status === "administrator" && m.can_delete_messages === true,
  });
  if (out.reason !== "enregistré") console.info("[boss] groupe :", out.reason, chat.id);
  for (const text of out.say) await sendBossText(replyApiOf(ctx), chat.id, text).catch((err) => console.error("[boss] accueil non envoyé", (err as Error).message));
}

/** Bouton appuyé dans le groupe : confirmation du Boss (admin seul) ou validation / question (admin ou responsable). */
async function onGroupCallback(ctx: Context, deps: TelegramDeps, agents: AgentsDeps): Promise<void> {
  const cq = ctx.callbackQuery!;
  const data = cq.data ?? "";
  const chatId = cq.message?.chat.id;
  const groupId = await readBossGroupId(agents);
  if (chatId === undefined || groupId === null || BigInt(chatId) !== groupId) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }
  const engine = engineOf(deps);
  const r = engine.isCallbackData(data)
    ? await engine.callback(agents, { data, fromTelegramId: BigInt(cq.from.id), messageId: cq.message?.message_id ?? null })
    : await bossTeamCallback(agents, { data, fromTelegramId: BigInt(cq.from.id) });
  await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
  if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  if (r.reply) {
    const reply = r as { reply?: string; buttons?: never; followUp?: () => Promise<void> };
    await deliverBossReply({ api: replyApiOf(ctx), chatId, messageId: cq.message?.message_id ?? 0, reply: { ...reply, deleteMessage: false }, deps: agents, engine });
  }
}

/**
 * Mode groupe d'équipe du Boss (phase 26, section 4) : groupe enregistré par l'admin, membres présentés, mentions,
 * secrets jamais en groupe. Tout ce qui ne s'adresse pas à Kevin est ignoré (rien envoyé à l'IA, rien stocké en
 * texte). Sans dépendances des agents : silence. Ne lève jamais.
 */
export async function handleBossGroupUpdate(ctx: Context, identity: BotIdentity, deps: TelegramDeps, tools?: Tools): Promise<void> {
  if (!deps.agentsDeps) return;
  const agents = deps.agentsDeps();
  if (ctx.myChatMember) return onMembership(ctx, agents);
  if (ctx.callbackQuery) return onGroupCallback(ctx, deps, agents);
  const msg = ctx.message;
  if (!msg || !msg.from || msg.from.is_bot) return;
  const t = tools ?? { deposit: createLibraryDepositor(identity, deps), captionOf: createAlbumCaptions() };
  const base = teamMessageOf(msg, identity, "group");
  const caption = base.hasMedia ? t.captionOf(msg, msg.forward_origin?.type === "channel" ? "" : base.text) : base.text;
  const out = await bossTeamIncoming(agents, { ...base, text: caption });
  await act(ctx, identity, deps, msg, out, t);
}

/** Privé d'un membre présenté (pas l'admin) : rend vrai si Kevin s'en est occupé (sinon chemin habituel, silence). */
async function handleMemberPrivate(ctx: Context, identity: BotIdentity, deps: TelegramDeps, tools: Tools): Promise<boolean> {
  const from = ctx.from;
  if (!from || from.is_bot || !deps.agentsDeps) return false;
  if (deps.isAdminDialogPartner && (await deps.isAdminDialogPartner(BigInt(from.id)))) return false;
  const agents = deps.agentsDeps();
  const member = await findTeamMember(agents, BigInt(from.id)).catch(() => null);
  if (!member) return false;
  if (ctx.callbackQuery) {
    // Boutons envoyés en privé à un membre : mêmes règles que dans le groupe (seulement ce qui lui est adressé).
    const r = await bossTeamCallback(agents, { data: ctx.callbackQuery.data ?? "", fromTelegramId: BigInt(from.id) });
    await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
    if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    if (r.reply) await sendBossText(replyApiOf(ctx), from.id, r.reply).catch(() => undefined);
    return true;
  }
  const msg = ctx.message;
  if (!msg) return true;
  const base = teamMessageOf(msg, identity, "private");
  const caption = base.hasMedia ? tools.captionOf(msg, msg.forward_origin?.type === "channel" ? "" : base.text) : base.text;
  const out = await bossTeamIncoming(agents, { ...base, text: caption });
  await act(ctx, identity, deps, msg, out, tools);
  return true;
}

/**
 * Sur le Boss, toute update d'un groupe (messages, boutons, ajout ou retrait du bot) passe par
 * `handleBossGroupUpdate` et s'arrête là : aucun autre handler du Boss ne voit un groupe. Les canaux : silence. En
 * privé, un membre présenté est pris ici (l'admin et toute autre personne continuent vers le dialogue habituel).
 * Enregistré en premier parmi les handlers du Boss.
 */
export function registerBossGroupHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  const tools: Tools = { deposit: createLibraryDepositor(identity, deps), captionOf: createAlbumCaptions() };
  bot.use(async (ctx, next) => {
    const type = ctx.chat?.type ?? ctx.callbackQuery?.message?.chat.type;
    if (type === "channel") return;
    if (isBossGroupChat(type)) {
      try {
        await handleBossGroupUpdate(ctx, identity, deps, tools);
      } catch (err) {
        console.error("[boss] groupe", identity.username, (err as Error).message);
      }
      return;
    }
    if (type === "private") {
      let handled = false;
      try {
        handled = await handleMemberPrivate(ctx, identity, deps, tools);
      } catch (err) {
        console.error("[boss] membre en privé", identity.username, (err as Error).message);
      }
      if (handled) return;
    }
    return next();
  });
}
