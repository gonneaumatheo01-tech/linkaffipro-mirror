/**
 * Paris par capture (28 octobre 2026) : pendant qu'une question « capture et cote » d'un pari est posée (Kevin), la
 * photo envoyée par l'admin (ou par la personne qui a reçu la question dans le groupe de l'équipe) est la capture du
 * pari : téléchargée (20 Mo au plus), rangée et lue avec sa légende (la cote, « pas dispo ») par
 * `receiveHumanOddsInput` (`@linkaffipro/agents`). Toute autre photo, un message transféré ou une légende à mots-clés de
 * la médiathèque continuent leur chemin habituel (`next()`). Aucune lecture du site du bookmaker : l'équipe le regarde.
 */
import type { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import { currentHumanOddsRequest, hasLibraryKeyword, receiveHumanOddsInput, sendNextHumanRequest } from "@linkaffipro/agents";
import type { BotIdentity, TelegramDeps } from "../ports";
import { adminRouteFor } from "./agents-admin";
import { BOT_DOWNLOAD_MAX_BYTES, inboxMediaOf } from "./media-inbox";

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`téléchargement refusé (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Photo (ou image envoyée comme fichier) non transférée : la capture possible d'un pari. */
export function humanOddsImageOf(msg: Message): { fileId: string; mimeType: string; size?: number; width?: number; height?: number } | null {
  if (msg.forward_origin) return null;
  const media = inboxMediaOf(msg);
  if (!media || !/^image\//.test(media.mimeType)) return null;
  return { fileId: media.fileId, mimeType: media.mimeType, size: media.size, width: media.width, height: media.height };
}

export function registerHumanOddsHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  bot.on("message", async (ctx: Context, next) => {
    const msg = ctx.message;
    const from = ctx.from;
    if (!msg || !from || from.is_bot || !deps.agentsDeps || !ctx.chat) return next();
    const image = humanOddsImageOf(msg);
    if (!image || hasLibraryKeyword(msg.caption ?? "")) return next();
    const agents = deps.agentsDeps();
    const req = (await currentHumanOddsRequest(agents)) as ({ chatId?: bigint | null; assigneeTelegramId?: bigint | null } & object) | null;
    if (!req) return next();
    // Privé : seulement l'admin, au bot du dialogue, pour une question posée en privé. Groupe : la question y a été posée
    // et la photo vient de la personne qui l'a reçue.
    if (ctx.chat.type === "private") {
      if (req.chatId != null) return next();
      const route = await adminRouteFor(identity, deps, from.id, "private");
      if (route.kind !== "dialog") return next();
    } else {
      if (req.chatId == null || String(req.chatId) !== String(ctx.chat.id)) return next();
      if (req.assigneeTelegramId != null && String(req.assigneeTelegramId) !== String(from.id)) return next();
    }
    const reply = (text: string) =>
      ctx.api.sendMessage(ctx.chat!.id, text, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } }).catch(() => undefined);
    if (image.size && image.size > BOT_DOWNLOAD_MAX_BYTES) {
      await reply("Image trop lourde pour le bot (20 Mo au plus) : envoie une capture plus légère.");
      return;
    }
    let bytes: Uint8Array;
    try {
      const file = await ctx.api.getFile(image.fileId);
      if (!file.file_path) throw new Error("fichier indisponible");
      bytes = await (deps.downloadTelegramFile ?? download)(`https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`);
    } catch (err) {
      console.error("[agents] capture d'un pari non téléchargée", identity.username, (err as Error).message);
      await reply("Je n'ai pas pu récupérer cette capture. Renvoie-la dans un instant.");
      return;
    }
    const res = await receiveHumanOddsInput(agents, {
      text: msg.caption ?? null,
      image: { bytes, mimeType: image.mimeType, width: image.width ?? null, height: image.height ?? null },
      actor: { userId: null, via: "TELEGRAM" },
    }).catch((err: unknown) => {
      console.error("[agents] capture d'un pari non rangée", identity.username, (err as Error).message);
      return { handled: true, reply: "Je n'ai pas pu ranger cette capture. Renvoie-la dans un instant." } as const;
    });
    if (!res.handled) return next();
    if (res.reply) await reply(res.reply);
    if ("closed" in res && res.closed) await sendNextHumanRequest(agents).catch(() => null);
  });
}
