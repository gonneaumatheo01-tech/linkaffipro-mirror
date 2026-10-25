/**
 * Phase 34 — médias d'un message transféré à Kevin rangés dans la médiathèque : téléchargement simulé (aucun réseau),
 * idempotence (même `fileId` → même asset, aucun second téléchargement), limite de 20 Mo, erreurs sans le jeton.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AgentsDeps, ForwardedContent } from "@linkaffipro/agents";
import type { AdminBotChoice } from "../admin-bot";
import { BOSS_MEDIA_MAX_BYTES, createBossMediaIngest, forwardedMimeOf, type BotFileApi } from "./media-ingest";

type Asset = { id: string; sha256: string; mimeType: string; filename: string; size: number; tags: unknown; kind: unknown; origin: unknown };
type TgFile = { assetId: string; botId: string; telegramFileId: string; fileUniqueId: string };

function fakeDeps() {
  const assets: Asset[] = [];
  const files: TgFile[] = [];
  const events: unknown[] = [];
  const prisma = {
    mediaAsset: {
      findUnique: async ({ where }: { where: { sha256: string } }) => assets.find((a) => a.sha256 === where.sha256) ?? null,
      create: async ({ data }: { data: Omit<Asset, "id"> }) => {
        const a = { ...data, id: `asset${assets.length + 1}` };
        assets.push(a);
        return { id: a.id };
      },
    },
    mediaAssetTelegramFile: {
      findFirst: async ({ where }: { where: { botId: string; telegramFileId: string } }) =>
        files.find((f) => f.botId === where.botId && f.telegramFileId === where.telegramFileId) ?? null,
      upsert: async ({ where, create, update }: { where: { assetId_botId: { assetId: string; botId: string } }; create: TgFile; update: Partial<TgFile> }) => {
        const hit = files.find((f) => f.assetId === where.assetId_botId.assetId && f.botId === where.assetId_botId.botId);
        if (hit) Object.assign(hit, update);
        else files.push({ ...create });
        return hit ?? create;
      },
    },
    event: { create: async (a: unknown) => (events.push(a), {}) },
  };
  const deps = { prisma, enqueue: {}, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as AgentsDeps;
  return { deps, assets, files, events };
}

const BOT = { id: "kevin", username: "kevcanauxbot", tokenEncrypted: "x", isBoss: true } as unknown as AdminBotChoice;

function content(media: ForwardedContent["media"]): ForwardedContent {
  return { html: "Salut", media, from: "@canal", receivedAt: "2026-10-25T10:00:00Z" };
}

function fakeTelegram(sizes: Record<string, number> = {}) {
  const getFile = vi.fn(async (fileId: string) => ({ file_path: `photos/${fileId}.jpg`, ...(sizes[fileId] ? { file_size: sizes[fileId] } : {}) }));
  const api: BotFileApi = { token: "123:SECRET", getFile };
  const download = vi.fn(async (url: string) => new TextEncoder().encode(`octets de ${url.split("/").pop()}`));
  return { api, getFile, download };
}

describe("ingestion des médias d'un message transféré", () => {
  it("photo : getFile + téléchargement par le bot de Kevin, rangée (JPEG, sans classement), identifiant du bot mémorisé", async () => {
    const { deps, assets, files } = fakeDeps();
    const tg = fakeTelegram();
    const ingest = createBossMediaIngest({ pickBot: async () => BOT, botFiles: () => tg.api, download: tg.download });
    const r = await ingest(deps, content([{ kind: "photo", fileId: "AgAD1" }]));
    expect(r).toEqual({ assetIds: ["asset1"] });
    expect(tg.getFile).toHaveBeenCalledWith("AgAD1");
    expect(tg.download).toHaveBeenCalledWith("https://api.telegram.org/file/bot123:SECRET/photos/AgAD1.jpg", BOSS_MEDIA_MAX_BYTES);
    expect(assets[0]).toMatchObject({ mimeType: "image/jpeg", kind: "PHOTO", origin: "HUMAN", tags: ["transfert-kevin"] });
    expect(assets[0]!.sha256).toBe(createHash("sha256").update(new TextEncoder().encode("octets de AgAD1.jpg")).digest("hex"));
    expect(files).toEqual([{ assetId: "asset1", botId: "kevin", telegramFileId: "AgAD1", fileUniqueId: "AgAD1" }]);
  });

  it("idempotent : même fileId → même asset, aucun second téléchargement ; album dans l'ordre", async () => {
    const { deps, assets } = fakeDeps();
    const tg = fakeTelegram();
    const ingest = createBossMediaIngest({ pickBot: async () => BOT, botFiles: () => tg.api, download: tg.download });
    const album = content([
      { kind: "photo", fileId: "A" },
      { kind: "video", fileId: "B" },
    ]);
    const first = await ingest(deps, album);
    const again = await ingest(deps, album);
    expect(first).toEqual({ assetIds: ["asset1", "asset2"] });
    expect(again).toEqual(first);
    expect(tg.download).toHaveBeenCalledTimes(2);
    expect(assets.map((a) => a.mimeType)).toEqual(["image/jpeg", "video/mp4"]);
  });

  it("mêmes octets sous un autre fileId : le même asset (empreinte)", async () => {
    const { deps, assets } = fakeDeps();
    const download = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const ingest = createBossMediaIngest({ pickBot: async () => BOT, botFiles: () => fakeTelegram().api, download });
    await ingest(deps, content([{ kind: "photo", fileId: "X1" }]));
    const r = await ingest(deps, content([{ kind: "photo", fileId: "X2" }]));
    expect(r).toEqual({ assetIds: ["asset1"] });
    expect(assets).toHaveLength(1);
  });

  it("plus de 20 Mo (taille annoncée, octets reçus ou refus de Telegram) : erreur claire, rien de rangé", async () => {
    const { deps, assets } = fakeDeps();
    const tg = fakeTelegram({ BIG: BOSS_MEDIA_MAX_BYTES + 1 });
    const ingest = createBossMediaIngest({ pickBot: async () => BOT, botFiles: () => tg.api, download: tg.download });
    expect(await ingest(deps, content([{ kind: "video", fileId: "BIG" }]))).toEqual({ error: "vidéo de plus de 20 Mo", code: "too_big" });
    expect(tg.download).not.toHaveBeenCalled();
    const huge = createBossMediaIngest({
      pickBot: async () => BOT,
      botFiles: () => tg.api,
      download: async () => new Uint8Array(BOSS_MEDIA_MAX_BYTES + 1),
    });
    expect(await huge(deps, content([{ kind: "photo", fileId: "P" }]))).toMatchObject({ code: "too_big" });
    const refused = createBossMediaIngest({
      pickBot: async () => BOT,
      botFiles: () => ({ token: "t", getFile: async () => Promise.reject(Object.assign(new Error("Bad Request"), { description: "Bad Request: file is too big" })) }),
      download: tg.download,
    });
    expect(await refused(deps, content([{ kind: "video", fileId: "V" }]))).toMatchObject({ code: "too_big" });
    expect(assets).toHaveLength(0);
  });

  it("échec du téléchargement : erreur sans l'adresse (le jeton n'apparaît jamais)", async () => {
    const { deps } = fakeDeps();
    const tg = fakeTelegram();
    const ingest = createBossMediaIngest({
      pickBot: async () => BOT,
      botFiles: () => tg.api,
      download: async (url) => {
        throw new Error(`refus pour ${url}`);
      },
    });
    const r = await ingest(deps, content([{ kind: "photo", fileId: "P" }]));
    expect(r).toMatchObject({ code: "failed" });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("aucun bot du dialogue admin : erreur no_bot ; aucun média : rien à faire", async () => {
    const { deps } = fakeDeps();
    const tg = fakeTelegram();
    const none = createBossMediaIngest({ pickBot: async () => null, botFiles: () => tg.api, download: tg.download });
    expect(await none(deps, content([{ kind: "photo", fileId: "P" }]))).toMatchObject({ code: "no_bot" });
    expect(await none(deps, content([]))).toEqual({ assetIds: [] });
  });

  it("type de fichier selon la nature, l'extension pour un fichier", () => {
    expect(forwardedMimeOf("photo", "photos/a.jpg")).toEqual({ mimeType: "image/jpeg", ext: "jpg" });
    expect(forwardedMimeOf("animation", "animations/a.mp4")).toEqual({ mimeType: "video/mp4", ext: "mp4" });
    expect(forwardedMimeOf("document", "documents/a.png")).toEqual({ mimeType: "image/png", ext: "png" });
    expect(forwardedMimeOf("document", "documents/a")).toEqual({ mimeType: "application/octet-stream", ext: "bin" });
  });
});
