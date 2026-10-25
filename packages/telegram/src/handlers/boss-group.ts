import type { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import {
  BOSS_MEMBER_AI_LIMIT_REPLY,
  BOSS_TEAM_ERROR_REPLY,
  bossGroupMembership,
  bossTeamCallback,
  bossTeamEditedMessage,
  bossTeamIncoming,
  claimMemberAiTurn,
  findTeamMember,
  isBossInputCallbackData,
  pick,
  readBossGroupId,
  type AgentsDeps,
  type BossTeamMessage,
  type BossTeamOutcome,
  type GroupEntity,
  type VoiceTable,
} from "@linkaffipro/agents";
import type { BotIdentity, TelegramDeps } from "../ports";
import { realBossEngine, type BossEngine } from "../boss/engine";
import { workerLooksDown } from "./agents-admin";
import { deliverBossReply, sendBossText, type BossReplyApi } from "../boss/reply";
import { createAlbumCaptions, createLibraryDepositor, inboxMediaOf, type LibraryDepositor } from "./media-inbox";
import { onBossInputCallback } from "./boss-inputs";

/**
 * Phase 33 : textes de secours de Kevin dans le groupe de l'équipe et en privé d'un membre (charte
 * `docs/KEVIN-VOIX.md` : dans le groupe, encore plus court), 2 variantes chacun, choisies par `pick`.
 */
export const BOSS_GROUP_VARIANTS = {
  /** Service d'arrière-plan muet depuis plus de 3 minutes : la tâche reste en file. */
  workerDown: [
    "Je suis en panne de mon côté, retour dans quelques minutes. Commandes simples seulement (aide), l'équipe technique est prévenue.",
    "Petite panne chez moi, l'équipe technique est prévenue. Ça repart dans quelques minutes ; en attendant, aide pour les commandes simples.",
  ],
  /** Mise en file impossible. */
  queueDown: [
    "Je suis en panne de mon côté, réessaie dans quelques minutes. Les commandes simples marchent : écris aide.",
    "Ma partie réflexion est en panne. Écris aide pour les commandes simples.",
  ],
} as const satisfies VoiceTable;

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
    // Phase 27 : message brut d'un transfert (post de canal tiers rangé comme post de référence, jamais un ordre).
    ...(msg.forward_origin ? { raw: msg } : {}),
    hasMedia: inboxMediaOf(msg) !== null,
    hasVoice: Boolean(msg.voice || msg.audio || msg.video_note),
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
      // Texte vide : effacé en silence (personne non présentée déjà prévenue aujourd'hui).
      const text = deleted ? out.ifDeleted : out.ifNotDeleted;
      if (text) await sendBossText(api, chatId, text, { replyToMessageId: deleted ? null : msg.message_id });
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
      // Coût : un membre a une limite de messages envoyés à l'IA par jour (l'admin, seulement le plafond mensuel).
      const speaker = out.input.speaker;
      if (speaker?.kind === "member" && !(await claimMemberAiTurn(agents, speaker.telegramUserId))) {
        await sendBossText(api, chatId, BOSS_MEMBER_AI_LIMIT_REPLY, { replyToMessageId: msg.message_id }).catch(() => undefined);
        return;
      }
      // Service d'arrière-plan arrêté : réponse de secours tout de suite ; la tâche reste en file (faite au redémarrage,
      // jamais deux réponses : le worker vérifie le tour déjà écrit).
      if (await workerLooksDown(deps))
        await sendBossText(api, chatId, pick(BOSS_GROUP_VARIANTS.workerDown, "boss-group.workerDown", chatId), { replyToMessageId: msg.message_id }).catch(() => undefined);
      else await ctx.api.sendChatAction(chatId, "typing").catch(() => undefined);
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
        await sendBossText(api, chatId, pick(BOSS_GROUP_VARIANTS.queueDown, "boss-group.queueDown", chatId), { replyToMessageId: msg.message_id }).catch(() => undefined);
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
  // Phase 34 : choix des comptes publicitaires après une autorisation (admin seulement, vérifié par le moteur).
  if (isBossInputCallbackData(data)) return onBossInputCallback(ctx, deps);
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
  if (ctx.editedMessage) return onEdited(ctx, identity, agents, "group");
  const msg = ctx.message;
  if (!msg || !msg.from || msg.from.is_bot) return;
  const t = tools ?? { deposit: createLibraryDepositor(identity, deps), captionOf: createAlbumCaptions() };
  const base = teamMessageOf(msg, identity, "group");
  const caption = base.hasMedia ? t.captionOf(msg, msg.forward_origin?.type === "channel" ? "" : base.text) : base.text;
  await decideAndAct(ctx, identity, deps, msg, { ...base, text: caption }, t);
}

/** Décision puis exécution ; une erreur pendant l'exécution : « Oups… » si le message venait d'une personne connue. */
async function decideAndAct(ctx: Context, identity: BotIdentity, deps: TelegramDeps, msg: Message, input: BossTeamMessage, tools: Tools): Promise<void> {
  const out = await bossTeamIncoming(deps.agentsDeps!(), input);
  try {
    await act(ctx, identity, deps, msg, out, tools);
  } catch (err) {
    console.error("[boss] message d'équipe en échec", identity.username, (err as Error).message);
    // `engine`, `reply`, `media` : décision prise pour l'admin ou un membre présenté (jamais pour un inconnu).
    if (out.kind === "engine" || out.kind === "reply" || out.kind === "media")
      await sendBossText(replyApiOf(ctx), msg.chat.id, BOSS_TEAM_ERROR_REPLY, { replyToMessageId: msg.message_id }).catch(() => undefined);
  }
}

/** Message modifié : seulement le contrôle des secrets (supprimé s'il en contient un), sans réponse. */
async function onEdited(ctx: Context, identity: BotIdentity, agents: AgentsDeps, chatType: "private" | "group"): Promise<void> {
  const msg = ctx.editedMessage!;
  if (!msg.from || msg.from.is_bot) return;
  const r = await bossTeamEditedMessage(agents, teamMessageOf(msg, identity, chatType));
  if (r.delete) await ctx.api.deleteMessage(msg.chat.id, msg.message_id).catch(() => undefined);
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
  if (ctx.editedMessage) {
    await onEdited(ctx, identity, agents, "private");
    return true;
  }
  const msg = ctx.message;
  if (!msg) return true;
  const base = teamMessageOf(msg, identity, "private");
  const caption = base.hasMedia ? tools.captionOf(msg, msg.forward_origin?.type === "channel" ? "" : base.text) : base.text;
  await decideAndAct(ctx, identity, deps, msg, { ...base, text: caption }, tools);
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
