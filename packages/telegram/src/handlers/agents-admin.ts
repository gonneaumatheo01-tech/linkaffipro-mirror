import type { Bot, Context } from "grammy";
import { GrammyError } from "grammy";
import type { Message } from "grammy/types";
import {
  handleAdminText,
  handleAgentsCallback,
  isAgentsCallbackData,
  isSecretAdminText,
  rememberEditPrompt,
  type BossInput,
} from "@linkaffipro/agents";
import { isBossBot, type AdminDialogBot, type BotIdentity, type TelegramDeps } from "../ports";
import { htmlToPlain } from "../agents/admin-messenger";
import { secretContextOf } from "../agents/redact";
import { findChannelLinkInText } from "../channels/username";
import { realBossEngine, type BossEngine } from "../boss/engine";
import {
  BOSS_ERROR_REPLY,
  BOSS_OTHER_MESSAGE_REPLY,
  BOSS_QUEUE_DOWN_REPLY,
  BOSS_VOICE_QUEUE_DOWN_REPLY,
  BOSS_VOICE_TOO_LONG_REPLY,
  deliverBossReply,
  type BossReplyApi,
} from "../boss/reply";

/** Taille maximale d'un vocal de l'admin (la transcription refuse au-delà de 2 Mo, environ 2 minutes). */
export const ADMIN_VOICE_MAX_BYTES = 2 * 1024 * 1024;

/** Nom affiché du Boss par défaut (`Setting` `boss.name`). */
export const DEFAULT_BOSS_NAME = "Kevin";

/** `/start` de l'admin sur le bot du dialogue admin (phase 26). */
export function bossWelcomeText(name: string): string {
  return [
    `Salut, c'est ${name}, ton Boss : je pilote les agents pour toi.`,
    "Parle-moi normalement, par écrit ou en vocal : je réponds toujours, et je te demande confirmation avant tout ce qui dépense ou publie.",
    "Écris <b>commencer</b> pour qu'on démarre ensemble, ou <b>aide</b> pour voir ce que je sais faire.",
  ].join("\n");
}

/** Un bot de canal renvoie l'admin vers le bot du dialogue admin (une seule fois par bot, puis silence). */
export function bossRedirectText(username: string): string {
  return `Parle-moi sur @${username} 👉`;
}

/** Réponse en HTML, repli en texte brut si Telegram refuse le HTML. Rend l'identifiant du message envoyé. */
async function replyHtml(ctx: Context, text: string): Promise<number | null> {
  try {
    const sent = await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return sent?.message_id ?? null;
  } catch (err) {
    if (err instanceof GrammyError && /parse entities/i.test(err.description)) {
      const sent = await ctx.reply(htmlToPlain(text), { link_preview_options: { is_disabled: true } });
      return sent?.message_id ?? null;
    }
    throw err;
  }
}

/** Même règle que le masquage du journal (`redactAdminSecretUpdate`) ; ne lève jamais. */
async function looksSecret(deps: TelegramDeps, fromId: number, text: string, replyTo?: number): Promise<boolean> {
  try {
    const state = deps.agentsAdminState ? await deps.agentsAdminState(BigInt(fromId)) : null;
    return isSecretAdminText(text, state ? secretContextOf(state, replyTo) : null);
  } catch {
    return isSecretAdminText(text, null);
  }
}

/**
 * Qui traite ce message privé (phase 26) ?
 * - `dialog` : l'expéditeur est l'admin et CE bot est le bot du dialogue admin (`adminBot()` : le Boss, sinon le bot
 *   casino de repli ; aucun des deux → ce bot) ;
 * - `redirect` : l'admin écrit à un autre de nos bots → renvoi une fois vers le bot du dialogue, puis silence ;
 * - `legacy` : dépendances sans `adminDialogBot` (tests de la phase 19) → ancien dialogue ;
 * - `other` : toute autre personne → traitement habituel (bot de canal) ou silence total (Boss).
 */
export type AdminRoute =
  | { kind: "dialog" }
  | { kind: "redirect"; target: AdminDialogBot }
  | { kind: "legacy" }
  | { kind: "other" };

export async function adminRouteFor(
  identity: BotIdentity,
  deps: TelegramDeps,
  fromId: number,
  chatType: string,
): Promise<AdminRoute> {
  if (chatType !== "private" || !deps.agentsDeps || !deps.isAdminDialogPartner) return { kind: "other" };
  if (!(await deps.isAdminDialogPartner(BigInt(fromId)))) return { kind: "other" };
  if (!deps.adminDialogBot) return isBossBot(identity) ? { kind: "dialog" } : { kind: "legacy" };
  const target = await deps.adminDialogBot();
  if (!target || target.id === identity.id) return { kind: "dialog" };
  return { kind: "redirect", target };
}

/** Renvoi vers le bot du dialogue admin : une fois par bot (et par bot cible), puis silence. Ne lève jamais. */
async function redirectOnce(ctx: Context, identity: BotIdentity, deps: TelegramDeps, target: AdminDialogBot): Promise<void> {
  try {
    const first = deps.claimBossRedirect ? await deps.claimBossRedirect(identity.id, target.id) : false;
    if (first) await ctx.reply(bossRedirectText(target.username));
  } catch (err) {
    console.error("[boss] renvoi vers le bot du dialogue admin", identity.username, (err as Error).message);
  }
}

function engineOf(deps: TelegramDeps): BossEngine {
  return deps.bossEngine ?? realBossEngine;
}

/** API de réponse du Boss pour la conversation en cours (même instance grammY que le webhook). */
function replyApiOf(ctx: Context): BossReplyApi {
  return {
    sendMessage: (chatId, text, other) => ctx.api.sendMessage(chatId, text, other),
    deleteMessage: (chatId, messageId) => ctx.api.deleteMessage(chatId, messageId),
  };
}

/** Texte d'une commande pour le Boss : `/aide` → « aide », `/commencer x` → « commencer x » (`@bot` retiré). */
export function commandAsText(text: string): string {
  const m = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return text;
  const cmd = m[1]!.toLowerCase();
  const rest = (m[2] ?? "").trim();
  const word = cmd === "help" ? "aide" : cmd;
  return rest ? `${word} ${rest}` : word;
}

function isForwarded(msg: Message): boolean {
  return Boolean(msg.forward_origin);
}

/**
 * Texte (ou commande) de l'admin au bot du dialogue : chemin rapide du Boss, sinon tâche `boss-text` du worker. Jamais
 * de silence : erreur → « Oups… », file indisponible → réponse de secours.
 */
async function handleDialogText(ctx: Context, identity: BotIdentity, deps: TelegramDeps, msg: Message & { text: string }): Promise<void> {
  const chatId = ctx.chat!.id;
  const fromId = ctx.from!.id;
  const forwarded = isForwarded(msg);
  let text = msg.text;
  if (!forwarded && text.startsWith("/")) {
    const m = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?/.exec(text);
    if (m) {
      const payload = m[1];
      // Lien du compte du site (« Mon compte » → Lier Telegram) : inchangé.
      if (payload?.startsWith("admin_")) {
        const linked = await deps.linkAdminAccount(payload.slice("admin_".length), BigInt(fromId));
        await ctx.reply(linked ? `Compte lié : ${linked.name}.` : "Ce lien n'est plus valable : recréez-le dans « Mon compte ».");
        return;
      }
      const name = deps.bossName ? await deps.bossName().catch(() => DEFAULT_BOSS_NAME) : DEFAULT_BOSS_NAME;
      await replyHtml(ctx, bossWelcomeText(name));
      return;
    }
    text = commandAsText(text);
  }
  const agents = deps.agentsDeps!();
  const engine = engineOf(deps);
  const input: BossInput = {
    text,
    messageId: msg.message_id,
    replyToMessageId: msg.reply_to_message?.message_id ?? null,
    source: "text",
    entities: msg.entities ?? null,
    ...(forwarded ? { forwarded: true } : {}),
  };
  let fast: Awaited<ReturnType<BossEngine["fastPath"]>>;
  try {
    fast = await engine.fastPath(agents, input);
  } catch (err) {
    console.error("[boss] chemin rapide", identity.username, (err as Error).message);
    // Un message qui contenait un secret ne reste jamais dans la conversation, même si le traitement a échoué.
    if (!forwarded && (await looksSecret(deps, fromId, msg.text, msg.reply_to_message?.message_id)))
      await ctx.api.deleteMessage(chatId, msg.message_id).catch(() => undefined);
    await ctx.reply(BOSS_ERROR_REPLY).catch(() => undefined);
    return;
  }
  if (fast.handled) {
    try {
      await deliverBossReply({ api: replyApiOf(ctx), chatId, messageId: msg.message_id, reply: fast, deps: agents, engine });
    } catch (err) {
      console.error("[boss] réponse non envoyée", identity.username, (err as Error).message);
    }
    return;
  }
  // Interprète IA : le worker répond dans quelques secondes (« écrit… » en attendant).
  await ctx.api.sendChatAction(chatId, "typing").catch(() => undefined);
  try {
    await agents.enqueue.orchestrator(
      {
        type: "boss-text",
        botId: identity.id,
        chatId,
        messageId: msg.message_id,
        text,
        replyToMessageId: msg.reply_to_message?.message_id ?? null,
        source: "text",
        ...(forwarded ? { forwarded: true } : {}),
        entities: msg.entities ? msg.entities.map((e) => ({ ...e })) : null,
      },
      // Idempotent : un webhook rejoué n'interprète pas deux fois le même message.
      { jobId: `boss-text:${identity.id}:${msg.message_id}` },
    );
  } catch (err) {
    console.error("[boss] message de l'admin non mis en file", identity.username, (err as Error).message);
    await ctx.reply(BOSS_QUEUE_DOWN_REPLY).catch(() => undefined);
  }
}

/**
 * Dialogue admin (phases 19 et 26). Seul le bot du dialogue admin (`adminBot()`) traite les messages privés de l'admin
 * (`Setting` `admin.telegramUserId`) : boutons des aperçus (`agv:`), des questions (`agh:`) et des confirmations du
 * Boss (`bsc:`), vocaux (tâche `admin-voice`), textes Y COMPRIS ceux qui commencent par « / » (`/start` → accueil,
 * `/aide` → aide) et messages transférés (des données, jamais des ordres). Chaque message de l'admin reçoit une
 * réponse. Un autre de nos bots renvoie l'admin vers lui une seule fois puis se tait ; sur un bot de canal, les
 * messages transférés, les commandes et les liens de canal de l'admin gardent leur traitement habituel (ajout d'un
 * canal, emojis animés). Toute autre personne : traitement habituel (`next()`) ; sur le Boss, rien ne suit (silence).
 */
export function registerAgentsAdminHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    const engine = engineOf(deps);
    const isBoss = engine.isCallbackData(data);
    if (!isBoss && !isAgentsCallbackData(data)) return next();
    if (!deps.agentsDeps) return next();
    const chatType = ctx.callbackQuery.message?.chat.type ?? "private";
    const route = await adminRouteFor(identity, deps, ctx.from.id, chatType);
    if (route.kind === "other") {
      // Boss : silence total. Ailleurs, un bouton de confirmation du Boss n'est jamais pris d'une autre personne ; les
      // boutons des agents vérifient eux-mêmes l'expéditeur (chemin d'avant la phase 26, réponse « réservé »).
      if (isBossBot(identity)) return;
      if (isBoss) {
        await ctx.answerCallbackQuery().catch(() => undefined);
        return;
      }
    }
    if (route.kind === "redirect") {
      await ctx.answerCallbackQuery({ text: bossRedirectText(route.target.username) }).catch(() => undefined);
      await redirectOnce(ctx, identity, deps, route.target);
      return;
    }
    const agents = deps.agentsDeps();
    if (isBoss) {
      try {
        const r = await engine.callback(agents, {
          data,
          fromTelegramId: BigInt(ctx.from.id),
          messageId: ctx.callbackQuery.message?.message_id ?? null,
        });
        await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
        if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        const chatId = ctx.callbackQuery.message?.chat.id ?? ctx.from.id;
        const messageId = ctx.callbackQuery.message?.message_id;
        if (r.reply || r.followUp) {
          await deliverBossReply({
            api: replyApiOf(ctx),
            chatId,
            messageId: messageId ?? 0,
            reply: { ...r, deleteMessage: false },
            deps: agents,
            engine,
          });
        }
      } catch (err) {
        console.error("[boss] bouton de confirmation", identity.username, (err as Error).message);
        await ctx.answerCallbackQuery({ text: "Erreur : réessaie dans un instant." }).catch(() => undefined);
      }
      return;
    }
    try {
      const r = await handleAgentsCallback(agents, { data, fromTelegramId: BigInt(ctx.from.id) });
      await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
      if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      if (r.reply) {
        const messageId = await replyHtml(ctx, r.reply);
        // « ✏️ Corriger » : une réponse à CE message sera le nouveau texte du post.
        if (r.editPromptFor && messageId) await rememberEditPrompt(agents, r.editPromptFor, messageId);
      }
    } catch (err) {
      console.error("[agents] bouton de validation", identity.username, (err as Error).message);
      await ctx.answerCallbackQuery({ text: "Erreur : réessaie dans un instant." }).catch(() => undefined);
    }
  });

  // Phase 20 : vocal (ou message audio) de l'admin → tâche `admin-voice` du worker (téléchargement, transcription,
  // puis même chemin qu'un texte). Aucun appel à un fournisseur externe dans le webhook.
  bot.on(["message:voice", "message:audio"], async (ctx, next) => {
    const from = ctx.from;
    if (from.is_bot) return next();
    const msg = ctx.message;
    const route = await adminRouteFor(identity, deps, from.id, ctx.chat.type);
    if (route.kind === "other") return next();
    if (route.kind === "redirect") {
      if (msg.forward_origin) return next();
      return redirectOnce(ctx, identity, deps, route.target);
    }
    // Ancien dialogue (phase 19) : un vocal transféré n'est pas un ordre.
    if (route.kind === "legacy" && msg.forward_origin) return next();
    const audio = msg.voice ?? msg.audio;
    if (!audio) return next();
    const replyLine = (text: string) =>
      ctx.reply(text, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } });
    if (msg.forward_origin) {
      // Boss : un vocal transféré est une donnée, jamais un ordre ; il reçoit quand même une réponse.
      await replyLine("C'est un vocal transféré : je ne suis que les vocaux que tu enregistres toi-même.").catch(() => undefined);
      return;
    }
    if (audio.file_size && audio.file_size > ADMIN_VOICE_MAX_BYTES) {
      await replyLine(BOSS_VOICE_TOO_LONG_REPLY);
      return;
    }
    if (route.kind === "dialog") await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => undefined);
    try {
      await deps.agentsDeps!().enqueue.orchestrator(
        {
          type: "admin-voice",
          botId: identity.id,
          fileId: audio.file_id,
          messageId: msg.message_id,
          chatId: ctx.chat.id,
          replyToMessageId: msg.reply_to_message?.message_id ?? null,
          mimeType: audio.mime_type ?? "audio/ogg",
        },
        // Idempotent : un webhook rejoué ne transcrit pas deux fois le même vocal.
        { jobId: `admin-voice:${identity.id}:${msg.message_id}` },
      );
    } catch (err) {
      console.error("[agents] vocal de l'admin non mis en file", identity.username, (err as Error).message);
      await replyLine(BOSS_VOICE_QUEUE_DOWN_REPLY);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const from = ctx.from;
    if (from.is_bot) return next();
    const msg = ctx.message;
    const route = await adminRouteFor(identity, deps, from.id, ctx.chat.type);
    if (route.kind === "other") return next();
    if (route.kind === "redirect") {
      // Bot de canal : commandes, transferts (ajout d'un canal, emojis animés) et liens de canal gardent leur chemin.
      if (msg.text.startsWith("/") || msg.forward_origin || findChannelLinkInText(msg.text)) return next();
      return redirectOnce(ctx, identity, deps, route.target);
    }
    if (route.kind === "legacy") return legacyAdminText(ctx, identity, deps, msg, next);
    // Bot de canal qui fait office de Boss : un transfert de canal ou un lien de canal sert toujours à ajouter le canal.
    if (!isBossBot(identity) && (msg.forward_origin?.type === "channel" || (!msg.forward_origin && findChannelLinkInText(msg.text))))
      return next();
    // `/start` d'un membre (lien d'offre, canal à rejoindre…) sur le bot de repli : chemin habituel.
    if (!isBossBot(identity) && /^\/start\s+[go][A-Za-z0-9_-]/.test(msg.text)) return next();
    await handleDialogText(ctx, identity, deps, msg);
  });
}

/** Ancien dialogue (phase 19, dépendances sans `adminDialogBot`) : non reconnu → `next()`. */
async function legacyAdminText(
  ctx: Context,
  identity: BotIdentity,
  deps: TelegramDeps,
  msg: Message & { text: string },
  next: () => Promise<void>,
): Promise<void> {
  if (msg.text.startsWith("/") || msg.forward_origin) return next();
  const agents = deps.agentsDeps!();
  const chatId = ctx.chat!.id;
  let r: Awaited<ReturnType<typeof handleAdminText>>;
  try {
    r = await handleAdminText(agents, {
      text: msg.text,
      messageId: msg.message_id,
      replyToMessageId: msg.reply_to_message?.message_id ?? null,
      // Mises en forme (gras, liens, emojis animés) : gardées dans un texte corrigé (« ✏️ Corriger »).
      entities: msg.entities ?? null,
    });
  } catch (err) {
    console.error("[agents] dialogue admin", identity.username, (err as Error).message);
    if (await looksSecret(deps, ctx.from!.id, msg.text, msg.reply_to_message?.message_id))
      await ctx.api.deleteMessage(chatId, msg.message_id).catch(() => undefined);
    await ctx.reply("Oups, je n'ai pas pu traiter ce message. Réessaie dans un instant.");
    return;
  }
  if (!r.handled) return next();
  if (r.deleteMessage) await ctx.api.deleteMessage(chatId, msg.message_id).catch(() => undefined);
  if (r.reply) await replyHtml(ctx, r.reply);
  if (r.followUp) await r.followUp().catch((err) => console.error("[agents] question suivante", (err as Error).message));
}

/**
 * Dernier filet du dialogue admin (enregistré APRÈS tous les handlers) : un message privé de l'admin au bot du dialogue
 * que personne n'a pris (photo sans mot-clé, autocollant, document…) reçoit quand même une réponse. Sur un bot de
 * canal, l'admin renvoyé vers le Boss l'est ici aussi (une fois), sauf transferts.
 */
export function registerAdminDialogFallback(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  bot.on("message", async (ctx, next) => {
    if (ctx.from.is_bot) return next();
    const route = await adminRouteFor(identity, deps, ctx.from.id, ctx.chat.type);
    if (route.kind === "dialog") {
      await ctx
        .reply(BOSS_OTHER_MESSAGE_REPLY, {
          reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
        })
        .catch(() => undefined);
      return;
    }
    if (route.kind === "redirect" && !ctx.message.forward_origin) return redirectOnce(ctx, identity, deps, route.target);
    return next();
  });
}
