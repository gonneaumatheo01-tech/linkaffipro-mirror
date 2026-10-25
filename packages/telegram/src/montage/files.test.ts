import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBotChoice } from "../admin-bot";
import { BotFileTooBig, createBotFileDownloader, createKevinVideoSender, kevinBotIdResolver } from "./files";

const BOT = { id: "bot-kevin", tokenEncrypted: "x", isBoss: true } as unknown as AdminBotChoice;
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lap-tg-files-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function files(size?: number) {
  return () => ({ token: "SECRET", getFile: vi.fn(async () => ({ file_path: "videos/a.mp4", file_size: size })) });
}

describe("fichiers du montage par le bot de Kevin", () => {
  it("téléchargement en continu vers le disque, sans fichier partiel laissé", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.telegram.org/file/botSECRET/videos/a.mp4");
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }) as unknown as typeof fetch;
    const dl = createBotFileDownloader({ pickBot: async () => BOT, botFiles: files(4), fetchImpl });
    await dl("file-1", join(dir, "sub", "source.mp4"));
    expect(Array.from(await readFile(join(dir, "sub", "source.mp4")))).toEqual([1, 2, 3, 4]);
    expect(await readdir(join(dir, "sub"))).toEqual(["source.mp4"]);
  });

  it("plus de 20 Mo : « trop lourd » (le compte connecté prend le relais), jamais l'adresse dans l'erreur", async () => {
    const dl = createBotFileDownloader({ pickBot: async () => BOT, botFiles: files(25 * 1024 * 1024), fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(dl("f", join(dir, "x.mp4"))).rejects.toBeInstanceOf(BotFileTooBig);
    const refused = createBotFileDownloader({
      pickBot: async () => BOT,
      botFiles: () => ({ token: "SECRET", getFile: async () => Promise.reject(Object.assign(new Error("Bad Request: file is too big"), { description: "Bad Request: file is too big" })) }),
    });
    await expect(refused("f", join(dir, "y.mp4"))).rejects.toMatchObject({ code: "too_big" });
    const broken = createBotFileDownloader({
      pickBot: async () => BOT,
      botFiles: files(10),
      fetchImpl: (async () => new Response("non", { status: 404 })) as unknown as typeof fetch,
    });
    const err = await broken("f", join(dir, "z.mp4")).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("SECRET");
  });

  it("téléchargement coupé : fichier partiel effacé, erreur claire", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.error(new Error("socket hang up https://api.telegram.org/file/botSECRET/x"));
      },
    });
    const dl = createBotFileDownloader({ pickBot: async () => BOT, botFiles: files(4), fetchImpl: (async () => new Response(body)) as unknown as typeof fetch });
    const err = (await dl("f", join(dir, "c.mp4")).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/interrompu/);
    expect(err.message).not.toContain("SECRET");
    expect(await readdir(dir)).toEqual([]);
  });

  it("envoi d'une vidéo depuis le disque : identifiants du message et du fichier", async () => {
    await writeFile(join(dir, "short.mp4"), "vidéo");
    const sendVideo = vi.fn(async () => ({ message_id: 321, video: { file_id: "FID", file_unique_id: "UID" } }));
    const send = createKevinVideoSender({ pickBot: async () => BOT, api: () => ({ sendVideo }) });
    const r = await send({ chatId: "-1009999", path: join(dir, "short.mp4"), caption: "Montage · short 1", buttons: [[{ text: "✅", callbackData: "msh:c1:ok" }]] });
    expect(r).toEqual({ messageId: 321, fileId: "FID", fileUniqueId: "UID" });
    const [chatId, , other] = sendVideo.mock.calls[0] as unknown as [number, unknown, { caption: string; reply_markup: unknown }];
    expect(chatId).toBe(-1009999);
    expect(other.caption).toBe("Montage · short 1");
    expect(other.reply_markup).toEqual({ inline_keyboard: [[{ text: "✅", callback_data: "msh:c1:ok" }]] });
    expect(await kevinBotIdResolver({ pickBot: async () => BOT })()).toBe("bot-kevin");
    expect(await kevinBotIdResolver({ pickBot: async () => null })()).toBeNull();
  });
});
