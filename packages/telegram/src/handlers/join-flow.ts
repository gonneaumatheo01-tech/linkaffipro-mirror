import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import type { User } from "grammy/types";
import type { BotIdentity, ChannelDeps } from "../ports";
import type { DmButtonRow, JoinFlowDeps } from "../join-flow/deps";
import {
  handleChatMember,
  handleGateStart,
  handleJoinRequest,
  parseGateCallbackData,
  type GateStartReply,
} from "../join-flow/service";
import { plainBotText } from "../join-flow/texts";
import { ensureChannelKnown } from "./channels";
import { sendWithEmojiFallback, type CustomEmojiFallbackInfo } from "../custom-emoji/fallback";

let defaultDeps: JoinFlowDeps | null = null;
async function getDefaultDeps(): Promise<JoinFlowDeps> {
  if (!defaultDeps) defaultDeps = (await import("../join-flow/prisma-deps")).prismaJoinFlowDeps;
  return defaultDeps;
}
async function getDefaultChannelDeps(): Promise<ChannelDeps> {
  return (await import("../prisma-deps")).prismaTelegramDeps;
}

/** Clavier d'une réponse du bot : boutons-liens et boutons à rappel (« ✅ J'ai rejoint », phase 14). */
export function keyboard(rows: DmButtonRow[]): InlineKeyboard | undefined {
  if (rows.length === 0) return undefined;
  const kb = new InlineKeyboard();
  let any = false;
  rows.forEach((row, i) => {
    for (const b of row) {
      if (b.url) kb.url(b.text, b.url);
      else if (b.callbackData) kb.text(b.text, b.callbackData);
      else continue;
      any = true;
    }
    if (i < rows.length - 1) kb.row();
  });
  return any ? kb : undefined;
}

/** Le message du bot sous lequel le bouton a été pressé porte-t-il un média (sa légende se modifie, pas son texte) ? */
function isMediaMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.caption === "string" ||
    "photo" in m ||
    "video" in m ||
    "animation" in m ||
    "document" in m
  );
}

/**
 * Réponse au bouton « ✅ J'ai rejoint » : le message du bot est modifié (texte ou légende, nouveaux boutons ; sans bouton
 * quand c'est bon). Message impossible à modifier (trop ancien, supprimé) : la réponse part en nouveau message. Même
 * texte qu'avant (bouton pressé deux fois) : rien à modifier.
 */
async function replaceGateMessage(
  ctx: Context,
  r: GateStartReply,
  onFallback: (info: CustomEmojiFallbackInfo) => Promise<void>,
): Promise<void> {
  const msg = ctx.callbackQuery?.message;
  // Sans bouton (« C'est bon ») : clavier vide, les anciens boutons disparaissent du message.
  const markup = keyboard(r.buttons) ?? { inline_keyboard: [] };
  const accessible = !!msg && msg.date !== 0;
  const reply = () =>
    sendWithEmojiFallback(
      r.text,
      (text) =>
        ctx.reply(text, {
          parse_mode: "HTML",
          reply_markup: keyboard(r.buttons),
          link_preview_options: { is_disabled: true },
        }),
      onFallback,
    );
  if (!accessible) {
    await reply();
    return;
  }
  try {
    await sendWithEmojiFallback(
      r.text,
      (text) =>
        isMediaMessage(msg)
          ? ctx.editMessageCaption({ caption: text, parse_mode: "HTML", reply_markup: markup })
          : ctx.editMessageText(text, {
              parse_mode: "HTML",
              reply_markup: markup,
              link_preview_options: { is_disabled: true },
            }),
      onFallback,
    );
  } catch (err) {
    const description = (err as { description?: unknown }).description;
    if (typeof description === "string" && /message is not modified/i.test(description)) return;
    await reply();
  }
}

/**
 * Chantier A : chat_join_request, /start g<code>, bouton à rappel « ✅ J'ai rejoint » (`g:<code>`, phase 14),
 * chat_member.
 * `channelDeps` : création d'un canal encore inconnu (droits relevés) avant un second essai ; par défaut, Prisma.
 */
export function registerJoinFlowHandlers(
  bot: Bot,
  identity: BotIdentity,
  deps?: JoinFlowDeps,
  channelDeps?: ChannelDeps,
): void {
  const getDeps = () => (deps ? Promise.resolve(deps) : getDefaultDeps());
  const getChannelDeps = () =>
    channelDeps ? Promise.resolve(channelDeps) : getDefaultChannelDeps();

  bot.on("chat_join_request", async (ctx) => {
    const d = await getDeps();
    let r = await handleJoinRequest(ctx.api, identity, d, ctx.chatJoinRequest);
    if (!r.handled && r.reason === "canal inconnu") {
      await ensureChannelKnown(ctx, await getChannelDeps(), ctx.chatJoinRequest.chat);
      r = await handleJoinRequest(ctx.api, identity, d, ctx.chatJoinRequest);
    } else if (!r.handled && r.reason === "aucun bot administrateur") {
      // Telegram n'envoie une demande d'adhésion qu'à un bot administrateur du canal : nos droits enregistrés sont en
      // retard (ex. lien du bouton « canal à rejoindre » créé par ce bot, avec demande d'adhésion depuis la phase 11).
      // Droits relevés, puis second essai : la demande n'est jamais perdue.
      await ensureChannelKnown(ctx, await getChannelDeps(), ctx.chatJoinRequest.chat, {
        refreshRights: true,
      });
      r = await handleJoinRequest(ctx.api, identity, d, ctx.chatJoinRequest);
    }
    if (!r.handled && r.reason) console.warn("[join-flow] demande ignorée :", r.reason);
  });

  bot.on("chat_member", async (ctx) => {
    const d = await getDeps();
    const r = await handleChatMember(identity, d, ctx.chatMember, ctx.api);
    if (!r.handled && r.reason === "canal inconnu") {
      await ensureChannelKnown(ctx, await getChannelDeps(), ctx.chatMember.chat);
      await handleChatMember(identity, d, ctx.chatMember, ctx.api);
    }
  });

  // Bouton à rappel « ✅ J'ai rejoint » (phase 14) : marche sans « Démarrer » ; réponse courte (answerCallbackQuery)
  // puis message du bot modifié (« C'est bon… » ou « Il te manque encore… » avec les boutons manquants). Demande déjà
  // programmée ou acceptée : réponse en fenêtre et boutons retirés, sans nouveau texte. Seule la personne de la demande
  // peut l'utiliser. Le lien /start g… des anciens messages reste valable (plus bas).
  bot.on("callback_query:data", async (ctx, next) => {
    const code = parseGateCallbackData(ctx.callbackQuery.data);
    if (!code) return next();
    const from: User = ctx.from;
    let answer: { text?: string; show_alert?: boolean } = {};
    try {
      const d = await getDeps();
      const r = await handleGateStart(ctx.api, identity, d, from, code);
      answer = { text: plainBotText(r.text), show_alert: r.outcome === "unknown" };
      // Demande déjà programmée ou acceptée (validation automatique passée avant ou pendant l'appui) : la réponse
      // s'affiche dans une fenêtre, les boutons devenus inutiles disparaissent du message ; aucun second « C'est bon »
      // dans la conversation (le bot a pu l'envoyer à la validation automatique).
      if (r.outcome === "scheduled" || r.outcome === "approved") {
        await ctx
          .answerCallbackQuery({ text: plainBotText(r.text), show_alert: true })
          .catch(() => undefined);
        const msg = ctx.callbackQuery.message;
        if (msg && msg.date !== 0)
          await ctx
            .editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } })
            .catch(() => undefined);
        return;
      }
      // Demande inconnue ou d'une autre personne : seulement la réponse courte, le message n'est pas touché.
      if (r.outcome !== "unknown") {
        // La réponse courte d'abord (fin de l'attente sur le bouton), puis le message modifié.
        await ctx.answerCallbackQuery(answer).catch(() => undefined);
        answer = {};
        await replaceGateMessage(ctx, r, async (info) => {
          const member = await d.upsertMember(from).catch(() => null);
          await d.recordEvent({
            type: "dm.custom_emoji_fallback",
            memberId: member?.memberId ?? null,
            botId: identity.id,
            payload: {
              outboundMessageId: null,
              botId: identity.id,
              error: info.error,
              resent: info.resent,
              via: "gate_callback",
            },
          });
        });
        return;
      }
    } catch (err) {
      console.error("[join-flow] bouton « J'ai rejoint » impossible à traiter", err);
    }
    await ctx.answerCallbackQuery(answer).catch(() => undefined);
  });

  bot.command("start", async (ctx, next) => {
    const payload = typeof ctx.match === "string" ? ctx.match : "";
    if (!ctx.from || ctx.chat?.type !== "private" || !/^g[0-9A-Za-z]{6,12}$/.test(payload))
      return next();
    const d = await getDeps();
    const from = ctx.from;
    const r = await handleGateStart(ctx.api, identity, d, from, payload.slice(1));
    // Réponse « ✅ J'ai rejoint » (texte de l'équipe possible) : emojis animés refusés par Telegram → même réponse
    // aussitôt renvoyée avec les emojis de remplacement, et journalisée (phase 12).
    await sendWithEmojiFallback(
      r.text,
      (text) =>
        ctx.reply(text, {
          parse_mode: "HTML",
          reply_markup: keyboard(r.buttons),
          link_preview_options: { is_disabled: true },
        }),
      async (info) => {
        const member = await d.upsertMember(from).catch(() => null);
        await d.recordEvent({
          type: "dm.custom_emoji_fallback",
          memberId: member?.memberId ?? null,
          botId: identity.id,
          payload: {
            outboundMessageId: null,
            botId: identity.id,
            error: info.error,
            resent: info.resent,
            via: "gate_start",
          },
        });
      },
    );
  });
}
