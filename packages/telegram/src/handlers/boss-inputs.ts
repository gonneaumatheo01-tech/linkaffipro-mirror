/**
 * Phase 34, chantier F — entrées Telegram reçues par Kevin en privé de l'admin (`handlers/agents-admin.ts` les appelle) :
 * - message transféré : gardé 30 min comme contenu possible (`rememberForwarded`), une DONNÉE jamais exécutée ; un album
 *   ou une rafale = un seul contenu, un seul accusé ; une phrase juste avant (commentaire du transfert) = la demande ;
 * - fichier CSV / TXT : téléchargé (`getFile` + `downloadTelegramFile`), décodé, gardé 30 min ; sa légende est la demande ;
 * - boutons `bsa:` de la reprise après une autorisation Meta / TikTok.
 * Aucun appel à l'IA ici ; le texte transféré et le contenu d'un fichier n'en partent jamais.
 */
import type { Context } from "grammy";
import type { Message } from "grammy/types";
import {
  documentMemoryLine,
  forwardedMemoryLine,
  forwardedSummaryHtml,
  handleBossInputCallback,
  peekForwarded,
  INPUTS_VARIANTS,
  PHRASE_BEFORE_INPUT_MS,
  pick,
  receiveDocument,
  rememberForwarded,
  writeBossTurn,
  type ForwardedContent,
  type RememberForwardedResult,
  type TelegramForwardMessage,
} from "@linkaffipro/agents";
import type { BotIdentity, TelegramDeps } from "../ports";
import { realBossEngine } from "../boss/engine";
import { deliverBossReply, sendBossText, type BossReplyApi } from "../boss/reply";

/** Dernière phrase (message non transféré) de l'admin par conversation, dans ce processus (même service que le webhook). */
const lastPhraseAt = new Map<string, number>();

export function noteBossPhrase(chatId: number | bigint | string, at = Date.now()): void {
  lastPhraseAt.set(String(chatId), at);
  if (lastPhraseAt.size > 500) for (const [k, v] of lastPhraseAt) if (at - v > PHRASE_BEFORE_INPUT_MS) lastPhraseAt.delete(k);
}

export function bossPhraseRecent(chatId: number | bigint | string, at = Date.now()): boolean {
  const t = lastPhraseAt.get(String(chatId));
  return t !== undefined && at - t <= PHRASE_BEFORE_INPUT_MS;
}

/** Tests : oublie les phrases notées. */
export function resetBossPhrases(): void {
  lastPhraseAt.clear();
}

/** Document qui n'est ni une image ni une vidéo (CSV, TXT, PDF…) : chemin des fichiers, pas de la médiathèque. */
export function isPlainDocument(msg: Pick<Message, "document">): boolean {
  const d = msg.document;
  return !!d && !(d.mime_type && /^(video|image)\//.test(d.mime_type));
}

function replyApiOf(ctx: Context): BossReplyApi {
  return {
    sendMessage: (chatId, text, other) => ctx.api.sendMessage(chatId, text, other),
    deleteMessage: (chatId, messageId) => ctx.api.deleteMessage(chatId, messageId),
  };
}

/** Garde le message transféré ; null si la garde a échoué (le chemin d'avant continue). Ne lève jamais. */
export async function keepForwarded(identity: BotIdentity, deps: TelegramDeps, msg: Message): Promise<RememberForwardedResult | null> {
  if (!deps.agentsDeps) return null;
  try {
    return await rememberForwarded(deps.agentsDeps(), {
      chatId: String(msg.chat.id),
      message: msg as unknown as TelegramForwardMessage,
      botId: identity.id,
      phraseRecent: bossPhraseRecent(msg.chat.id),
    });
  } catch (err) {
    console.error("[boss] message transféré non gardé", identity.username, (err as Error).message);
    return null;
  }
}

/** Attente après le dernier média d'un album transféré avant l'accusé unique (même délai que la médiathèque). */
export const FORWARD_ALBUM_ACK_DELAY_MS = 2_000;
const albumAcks = new Map<string, { timer: ReturnType<typeof setTimeout>; fire: () => void }>();

function albumKey(msg: Message): string | null {
  return msg.media_group_id ? `${msg.chat.id}:${msg.media_group_id}` : null;
}

/** Un média de plus dans un album dont l'accusé attend : l'attente repart (une seule réponse, après le dernier). */
export function bumpAlbumAck(deps: TelegramDeps, msg: Message): void {
  const key = albumKey(msg);
  const pending = key ? albumAcks.get(key) : undefined;
  if (!key || !pending) return;
  clearTimeout(pending.timer);
  pending.timer = setTimeout(pending.fire, deps.mediaAlbumReplyDelayMs ?? FORWARD_ALBUM_ACK_DELAY_MS);
}

/**
 * Accusé de réception d'un transfert sans texte (photo, vidéo, album) : « Bien reçu ce message transféré (2 photos)…
 * tu veux que j'en fasse quoi ? ». Album : une seule réponse, après le dernier média, avec le compte de tout l'album.
 * Mémoire de Kevin : le résumé, jamais le contenu. Ne lève jamais.
 */
export async function ackForwarded(ctx: Context, deps: TelegramDeps, msg: Message, kept: RememberForwardedResult): Promise<void> {
  const key = albumKey(msg);
  if (!key) return sendForwardedAck(ctx, deps, msg, kept.content);
  const fire = () => {
    albumAcks.delete(key);
    void (async () => {
      const content = (deps.agentsDeps ? await peekForwarded(deps.agentsDeps(), String(msg.chat.id)).catch(() => null) : null) ?? kept.content;
      await sendForwardedAck(ctx, deps, msg, content);
    })().catch((err) => console.error("[boss] accusé d'album transféré", (err as Error).message));
  };
  albumAcks.set(key, { timer: setTimeout(fire, deps.mediaAlbumReplyDelayMs ?? FORWARD_ALBUM_ACK_DELAY_MS), fire });
}

async function sendForwardedAck(ctx: Context, deps: TelegramDeps, msg: Message, content: ForwardedContent): Promise<void> {
  const chatId = msg.chat.id;
  const reply = pick(INPUTS_VARIANTS.forwardedAck({ summary: forwardedSummaryHtml(content) }), "inputs.forwarded.ack", chatId);
  try {
    await sendBossText(replyApiOf(ctx), chatId, reply, { replyToMessageId: msg.message_id });
  } catch (err) {
    console.error("[boss] accusé du transfert non envoyé", (err as Error).message);
  }
  await remember(deps, msg, forwardedMemoryLine(content), reply, "transfere");
}

async function remember(deps: TelegramDeps, msg: Message, adminLine: string, reply: string, actionKey: string): Promise<void> {
  if (!deps.agentsDeps) return;
  const agents = deps.agentsDeps();
  const chatId = BigInt(msg.chat.id);
  await writeBossTurn(agents, { role: "ADMIN", text: adminLine, source: "text", telegramMessageId: msg.message_id, chatId, fromTelegramId: msg.from ? BigInt(msg.from.id) : null }).catch(() => null);
  await writeBossTurn(agents, { role: "BOSS", text: reply, actionKey, status: "done", telegramMessageId: msg.message_id, chatId }).catch(() => null);
}

async function defaultDownload(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`téléchargement refusé (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Fichier envoyé à Kevin par l'admin. Rend la légende (écrite par l'admin, message non transféré) à traiter ensuite
 * comme sa demande, ou null. Sans légende : accusé « J'ai le fichier x.csv : 120 lignes… » (sauf phrase juste avant).
 */
export async function receiveBossDocument(ctx: Context, identity: BotIdentity, deps: TelegramDeps, msg: Message): Promise<{ caption: string | null }> {
  const doc = msg.document!;
  const chatId = msg.chat.id;
  const api = replyApiOf(ctx);
  const r = await receiveDocument(deps.agentsDeps!(), {
    chatId: String(chatId),
    fileName: doc.file_name ?? "fichier.txt",
    mimeType: doc.mime_type ?? null,
    sizeBytes: doc.file_size ?? null,
    download: async () => {
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) throw new Error("fichier indisponible");
      return (deps.downloadTelegramFile ?? defaultDownload)(`https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`);
    },
  });
  const caption = !msg.forward_origin && msg.caption?.trim() ? msg.caption.trim() : null;
  if (!r.ok) {
    await sendBossText(api, chatId, r.reply, { replyToMessageId: msg.message_id }).catch((err) => console.error("[boss] refus du fichier non envoyé", identity.username, (err as Error).message));
    return { caption: null };
  }
  if (caption) return { caption };
  if (bossPhraseRecent(chatId)) return { caption: null };
  await sendBossText(api, chatId, r.reply, { replyToMessageId: msg.message_id }).catch((err) => console.error("[boss] accusé du fichier non envoyé", identity.username, (err as Error).message));
  await remember(deps, msg, documentMemoryLine(r.document), r.reply, "fichier");
  return { caption: null };
}

/** Bouton `bsa:` (choix des comptes publicitaires après une autorisation). Ne lève jamais. */
export async function onBossInputCallback(ctx: Context, deps: TelegramDeps): Promise<void> {
  const cq = ctx.callbackQuery!;
  try {
    const agents = deps.agentsDeps!();
    const r = await handleBossInputCallback(agents, { data: cq.data ?? "", fromTelegramId: BigInt(cq.from.id) });
    await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
    if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    if (r.reply) {
      const chatId = cq.message?.chat.id ?? cq.from.id;
      await deliverBossReply({
        api: replyApiOf(ctx),
        chatId,
        messageId: cq.message?.message_id ?? 0,
        reply: { reply: r.reply, ...(r.buttons?.length ? { buttons: r.buttons } : {}) },
        deps: agents,
        engine: deps.bossEngine ?? realBossEngine,
      });
    }
  } catch (err) {
    console.error("[boss] bouton de choix des comptes", (err as Error).message);
    await ctx.answerCallbackQuery().catch(() => undefined);
  }
}
