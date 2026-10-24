import type { Api, Bot } from "grammy";
import {
  CUSTOM_EMOJI_ADD_FAILED_REPLY,
  customEmojiAddedReply,
  customEmojiChannelSkippedNote,
  customEmojisOfMessage,
} from "../custom-emoji/extract";
import type { BotIdentity, TelegramDeps } from "../ports";
import { isAdminStatus } from "./channels";
import { albumKey, FORWARD_DEDUP_MS, forwardedChannelOf, RecentKeys } from "./forward";

/**
 * Le canal d'où vient un message transféré est-il l'un des nôtres ? Oui s'il est déjà sur la plateforme, ou si l'un de
 * nos bots en est administrateur : liste lue par le bot courant (`return_bots` : nos autres bots y figurent), sinon par
 * nos autres bots avec leurs propres jetons (`isOurBotAdminOf`). Lecture seule, jamais d'exception : faux sur un doute.
 * Le canal de quelqu'un d'autre (transféré pour récupérer ses emojis) n'est ainsi jamais ajouté à la plateforme.
 */
export async function forwardedChannelIsOurs(
  api: Pick<Api, "getChatAdministrators">,
  deps: Pick<TelegramDeps, "findChannelId" | "listOurBotTelegramIds" | "isOurBotAdminOf">,
  chatId: number,
  botTelegramId: bigint,
): Promise<boolean> {
  try {
    if (await deps.findChannelId(chatId)) return true;
  } catch (err) {
    console.warn("[custom-emoji] canal d'origine non vérifié", chatId, (err as Error).message);
    return false;
  }
  try {
    const admins = await api.getChatAdministrators(chatId, { return_bots: true });
    const ours = new Set((await deps.listOurBotTelegramIds()).map(String));
    // Liste lue : elle est complète, la réponse est sûre.
    return admins.some((a) => a.user.is_bot && ours.has(String(a.user.id)) && isAdminStatus(a));
  } catch {
    /* ce bot n'a pas accès à la liste : un autre de nos bots est peut-être administrateur */
  }
  if (!deps.isOurBotAdminOf) return false;
  try {
    return await deps.isOurBotAdminOf(chatId, botTelegramId);
  } catch (err) {
    console.warn("[custom-emoji] droits de nos bots non vérifiés", chatId, (err as Error).message);
    return false;
  }
}

/**
 * Phase 12 : ajout d'emojis animés à la bibliothèque de l'équipe par un simple message au bot.
 * Un message (transféré ou non) envoyé en privé à l'un de nos bots par un utilisateur de la plateforme
 * (`User.telegramUserId`, compte actif) ou par l'admin (`Setting admin.telegramUserId`), avec des emojis animés dans son
 * texte ou sa légende : chaque emoji est enregistré (sans doublon) et le bot répond « 6 emojis animés ajoutés ✅ ».
 * - transfert depuis l'un de nos canaux (déjà sur la plateforme, ou dont l'un de nos bots est administrateur) : le
 *   canal est AUSSI ajouté ou mis à jour ensuite (`next()` → handlers/forward.ts, phase 8) ;
 * - transfert depuis le canal de quelqu'un d'autre : seuls les emojis sont ajoutés, jamais le canal (la réponse le dit) ;
 *   les autres photos du même album sont ignorées par handlers/forward.ts (mémoire `memory` partagée, clé d'album) ;
 * - sinon : rien d'autre (pas d'aide « Pour ajouter un canal ») ;
 * - expéditeur inconnu, commande, message sans emoji animé : traitement habituel (`next()`), rien n'est enregistré.
 * Enregistré avant les handlers de transfert (core.ts), avec la même mémoire courte qu'eux.
 */
export function registerCustomEmojiHandlers(
  bot: Bot,
  identity: BotIdentity,
  deps: TelegramDeps,
  memory: RecentKeys = new RecentKeys(),
  opts: {
    /**
     * Phase 26 : le Boss (Kevin) range aussi les emojis animés que l'admin lui envoie, mais n'ajoute jamais de canal
     * (ni handler de transfert après lui) et n'écoute que l'admin (`isAdminDialogPartner`).
     */
    boss?: boolean;
  } = {},
): void {
  bot.on("message", async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot || ctx.chat.type !== "private" || !deps.addCustomEmojis) return next();
    const msg = ctx.message;
    if (!msg.forward_origin && (msg.text ?? "").startsWith("/")) return next();
    const emojis = customEmojisOfMessage(msg);
    if (emojis.length === 0) return next();
    const allowed = opts.boss
      ? Boolean(await deps.isAdminDialogPartner?.(BigInt(from.id)))
      : await deps.isPlatformUser(BigInt(from.id));
    if (!allowed) return next();

    let reply: string | null;
    try {
      const outcome = await deps.addCustomEmojis({
        emojis,
        telegramUserId: BigInt(from.id),
        botId: identity.id,
      });
      reply = customEmojiAddedReply(outcome);
    } catch (err) {
      console.error("[custom-emoji] ajout impossible", identity.username, (err as Error).message);
      reply = CUSTOM_EMOJI_ADD_FAILED_REPLY;
    }

    const origin = forwardedChannelOf(msg);
    const addChannel = origin && !opts.boss
      ? await forwardedChannelIsOurs(ctx.api, deps, origin.id, identity.telegramBotId)
      : false;
    if (origin && !addChannel && !opts.boss) {
      // Album : ses autres photos (sans emoji) ne doivent pas ajouter le canal par handlers/forward.ts.
      if (msg.media_group_id)
        memory.hit(albumKey(identity.id, msg.media_group_id), FORWARD_DEDUP_MS);
      if (reply) reply = `${reply}\n\n${customEmojiChannelSkippedNote(identity.username)}`;
    }

    if (reply)
      await ctx.reply(reply, {
        link_preview_options: { is_disabled: true },
        reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
      });
    if (addChannel) return next();
  });
}
