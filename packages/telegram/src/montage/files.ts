/**
 * Phase 28, chantier D — fichiers du montage par le bot de Kevin (bot du dialogue admin, `adminBot()`) :
 * - `createBotFileDownloader` : téléchargement d'un fichier (API Bot `getFile`, 20 Mo au plus) écrit en continu sur le
 *   disque (`<dest>.part` puis renommé) ;
 * - `createKevinVideoSender` : envoi d'une vidéo depuis le disque (short rangé dans le canal « Médiathèque », aperçu),
 *   rend l'identifiant du message et du fichier ;
 * - `kevinBotIdResolver` : identifiant du bot de Kevin (pour `MediaAssetTelegramFile`).
 * Les erreurs ne contiennent jamais l'adresse de téléchargement (elle porte le jeton du bot). Tout est injectable :
 * aucune vraie requête en test.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Api, InputFile } from "grammy";
import type { MontageDeps } from "@linkaffipro/agents";
import { decrypt } from "@linkaffipro/core";
import { adminBot, type AdminBotChoice, type AdminBotDb } from "../admin-bot";

export const BOT_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** Erreur « trop lourd pour le bot » : le compte connecté doit prendre le relais. */
export class BotFileTooBig extends Error {
  readonly code = "too_big";
  constructor() {
    super("fichier trop lourd pour le bot (plus de 20 Mo)");
    this.name = "BotFileTooBig";
  }
}

export type KevinBotOptions = {
  prisma?: AdminBotDb;
  /** Bot de Kevin (par défaut `adminBot()`). */
  pickBot?: () => Promise<AdminBotChoice | null>;
};

async function pick(opts: KevinBotOptions): Promise<AdminBotChoice> {
  const bot = await (opts.pickBot ?? (() => adminBot(opts.prisma)))();
  if (!bot) throw new Error("aucun bot du dialogue admin (Kevin)");
  return bot;
}

export function kevinBotIdResolver(opts: KevinBotOptions = {}): () => Promise<string | null> {
  return async () => (await (opts.pickBot ?? (() => adminBot(opts.prisma)))().catch(() => null))?.id ?? null;
}

export type BotFileDownloaderOptions = KevinBotOptions & {
  /** `getFile` + jeton (par défaut l'API grammY avec le jeton déchiffré). */
  botFiles?: (bot: AdminBotChoice) => { token: string; getFile(fileId: string): Promise<{ file_path?: string; file_size?: number }> };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function hideUrl(s: string): string {
  return s.replace(/https?:\/\/\S+/g, "[adresse]");
}

export function createBotFileDownloader(opts: BotFileDownloaderOptions = {}): (fileId: string, dest: string) => Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const botFiles =
    opts.botFiles ??
    ((bot: AdminBotChoice) => {
      const token = decrypt(bot.tokenEncrypted);
      const api = new Api(token);
      return { token, getFile: (id: string) => api.getFile(id) };
    });
  return async (fileId, dest) => {
    const bot = await pick(opts);
    const files = botFiles(bot);
    let file: { file_path?: string; file_size?: number };
    try {
      file = await files.getFile(fileId);
    } catch (err) {
      if (/file is too big/i.test(String((err as { description?: string })?.description ?? (err as Error)?.message))) throw new BotFileTooBig();
      throw new Error(`Telegram refuse le fichier : ${hideUrl(String((err as Error)?.message ?? "erreur")).slice(0, 160)}`);
    }
    if (typeof file.file_size === "number" && file.file_size > BOT_DOWNLOAD_MAX_BYTES) throw new BotFileTooBig();
    if (!file.file_path) throw new Error("Telegram n'a pas donné le chemin du fichier");
    let res: Response;
    try {
      res = await fetchImpl(`https://api.telegram.org/file/bot${files.token}/${file.file_path}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 5 * 60_000) });
    } catch {
      throw new Error("téléchargement impossible (réseau ou délai dépassé)");
    }
    if (!res.ok || !res.body) throw new Error(`téléchargement refusé par Telegram (${res.status})`);
    if (Number(res.headers.get("content-length") ?? 0) > BOT_DOWNLOAD_MAX_BYTES) throw new BotFileTooBig();
    await mkdir(dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    let seen = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        seen += chunk.length;
        if (seen > BOT_DOWNLOAD_MAX_BYTES) cb(new BotFileTooBig());
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), limit, createWriteStream(part));
      await rename(part, dest);
    } catch (err) {
      await rm(part, { force: true }).catch(() => undefined);
      if (err instanceof BotFileTooBig) throw err;
      throw new Error(`téléchargement interrompu : ${hideUrl(String((err as Error)?.message ?? "erreur")).slice(0, 160)}`);
    }
  };
}

/** Sous-ensemble de l'API grammY utilisé pour l'envoi (faux en test). */
export type VideoSendApi = {
  sendVideo(
    chatId: number | string,
    video: InputFile,
    other?: { caption?: string; supports_streaming?: boolean; reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } },
  ): Promise<{ message_id: number; video?: { file_id: string; file_unique_id: string }; document?: { file_id: string; file_unique_id: string } }>;
};

export type KevinVideoSenderOptions = KevinBotOptions & { api?: (bot: AdminBotChoice) => VideoSendApi };

export function createKevinVideoSender(opts: KevinVideoSenderOptions = {}): NonNullable<MontageDeps["sendVideo"]> {
  const apiOf = opts.api ?? ((bot: AdminBotChoice) => new Api(decrypt(bot.tokenEncrypted)) as unknown as VideoSendApi);
  return async (req) => {
    const bot = await pick(opts);
    const api = apiOf(bot);
    const chatId = /^-?\d+$/.test(req.chatId) ? Number(req.chatId) : req.chatId;
    const msg = await api.sendVideo(chatId, new InputFile(req.path), {
      caption: req.caption.slice(0, 1024),
      supports_streaming: true,
      ...(req.buttons?.length
        ? { reply_markup: { inline_keyboard: req.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.callbackData }))) } }
        : {}),
    });
    const file = msg.video ?? msg.document;
    if (!file) throw new Error("Telegram n'a pas rendu la vidéo envoyée");
    return { messageId: msg.message_id, fileId: file.file_id, fileUniqueId: file.file_unique_id };
  };
}
