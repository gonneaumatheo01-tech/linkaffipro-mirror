import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChainKit } from "./chain-kit.test-util";
import { MONTAGE_LIMITS } from "./contract";
import { MontageRefused, type MontagePipelineDeps } from "./runtime";
import { createLongVideoAsset, createTelegramDownloader, downloadSource, longVideoSha256, sourceRefusal } from "./source";
import { resolveAssetBytes, storeShort } from "./storage";

type Kit = Awaited<ReturnType<typeof createChainKit>>;
let kits: Kit[] = [];
async function kitOf(opts: Parameters<typeof createChainKit>[0] = {}): Promise<Kit> {
  const k = await createChainKit(opts);
  kits.push(k);
  return k;
}
afterEach(async () => {
  for (const k of kits) await k.dispose();
  kits = [];
});

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("vidéo longue (source)", () => {
  it("rangée sans octets en base, empreinte stable : le même fichier renvoyé ne crée pas de doublon", async () => {
    const k = await kitOf();
    const input = { chatId: 4242n, messageId: 10, fileId: "f1", fileUniqueId: "U1", sizeBytes: 300 * MB, durationSec: 2700, mimeType: "video/mp4", fileName: "live.mp4" };
    const a = await createLongVideoAsset(k.deps, input);
    expect(a).toMatchObject({ ok: true, created: true });
    const row = k.tables("mediaAsset")[0]!;
    expect(row).toMatchObject({ kind: "LONG_VIDEO", storage: "telegram", sha256: longVideoSha256("U1"), size: 300 * MB, duration: 2700, teamKey: "montage", origin: "HUMAN" });
    expect((row.bytes as Buffer).byteLength).toBe(0);
    expect(row.telegramRef).toMatchObject({ chatId: "4242", messageId: 10, fileId: "f1", via: "kevin" });
    const b = await createLongVideoAsset(k.deps, { ...input, messageId: 55, fileId: "f2" });
    expect(b).toMatchObject({ ok: true, created: false });
    expect(k.tables("mediaAsset")).toHaveLength(1);
    expect(row.telegramRef).toMatchObject({ messageId: 55, fileId: "f2" });
  });

  it("plus de 2 Go ou plus de 3 h : refus clair, rien n'est rangé", async () => {
    const k = await kitOf();
    const big = await createLongVideoAsset(k.deps, { chatId: "1", messageId: 1, fileId: "f", fileUniqueId: "u", sizeBytes: 2.5 * GB });
    expect(big).toMatchObject({ ok: false });
    expect(big.ok ? "" : big.reason).toMatch(/2 Go au plus/);
    const long = await createLongVideoAsset(k.deps, { chatId: "1", messageId: 1, fileId: "f", fileUniqueId: "u", durationSec: 4 * 3600 });
    expect(long.ok ? "" : long.reason).toMatch(/3 h au plus/);
    expect(k.tables("mediaAsset")).toHaveLength(0);
    expect(sourceRefusal({ sizeBytes: MONTAGE_LIMITS.maxSourceBytes })).toBeNull();
    expect(sourceRefusal({ sizeBytes: MONTAGE_LIMITS.maxSourceBytes + 1 })).toMatch(/Go/);
    await expect(
      downloadSource(k.deps, { id: "x", size: 0, storage: "telegram", telegramRef: { chatId: "1", messageId: 2, sizeBytes: 3 * GB } }, join(k.workDir, "s.mp4")),
    ).rejects.toBeInstanceOf(MontageRefused);
    expect(k.downloads).toHaveLength(0);
  });

  it("copie de travail : téléchargée une fois, poids vérifié", async () => {
    const k = await kitOf();
    const dest = join(k.workDir, "job", "source.mp4");
    const asset = { id: "a", size: 2048, storage: "telegram", telegramRef: { chatId: "4242", messageId: 7, fileId: "f", sizeBytes: 2048 } };
    expect(await downloadSource(k.deps, asset, dest)).toMatchObject({ downloaded: true, sizeBytes: 2048 });
    expect(await downloadSource(k.deps, asset, dest)).toMatchObject({ downloaded: false });
    expect(k.downloads).toHaveLength(1);
    const short = { ...asset, size: 4096, telegramRef: { ...asset.telegramRef, sizeBytes: 4096 } };
    await expect(downloadSource(k.deps, short, join(k.workDir, "job2", "source.mp4"))).rejects.toThrow(/incomplet/);
  });
});

describe("aiguillage du téléchargement (bot ≤ 20 Mo, compte connecté au-delà)", () => {
  it("≤ 20 Mo → bot de Kevin ; au-delà → compte connecté ; bot « trop lourd » → compte", async () => {
    const bot = vi.fn(async () => undefined);
    const account = vi.fn(async () => undefined);
    const dl = createTelegramDownloader({ bot, account });
    await dl({ chatId: "4242", messageId: 1, fileId: "f", sizeBytes: 10 * MB }, "/tmp/x");
    expect(bot).toHaveBeenCalledWith("f", "/tmp/x");
    expect(account).not.toHaveBeenCalled();
    await dl({ chatId: "4242", messageId: 2, fileId: "f", sizeBytes: 25 * MB }, "/tmp/y");
    expect(account).toHaveBeenCalledWith({ chatId: "4242", messageId: 2, sizeBytes: 25 * MB }, "/tmp/y");
    expect(bot).toHaveBeenCalledTimes(1);
    bot.mockRejectedValueOnce(Object.assign(new Error("Bad Request: file is too big"), { description: "Bad Request: file is too big" }));
    await dl({ chatId: "4242", messageId: 3, fileId: "f", sizeBytes: 19 * MB }, "/tmp/z");
    expect(account).toHaveBeenCalledTimes(2);
  });

  it("sans compte connecté, plus de 20 Mo : erreur claire « too_big »", async () => {
    const dl = createTelegramDownloader({ bot: vi.fn(async () => undefined) });
    await expect(dl({ chatId: "1", messageId: 1, fileId: "f", sizeBytes: 30 * MB }, "/tmp/x")).rejects.toMatchObject({ code: "too_big" });
  });
});

describe("shorts gardés dans Telegram", () => {
  async function shortFile(k: Kit, name: string, content: string) {
    const path = join(k.workDir, name);
    await mkdir(k.workDir, { recursive: true });
    await writeFile(path, content);
    return path;
  }
  const probe = { durationMs: 15_000, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", fps: 30, fpsRaw: "30/1", sizeBytes: 0, hasAudio: true };

  it("sans canal « Médiathèque » : envoi à l'admin, message supprimé si le bot peut relire le fichier (≤ 20 Mo)", async () => {
    const k = await kitOf({ library: false });
    const job = { id: "job12345678", sourceAssetId: "src", createdById: null, instructions: { theme: "Roulette" } } as never;
    const clip = { id: "c1", index: 4, redoCount: 0, format: "VERTICAL_9_16", compressed: false } as never;
    await k.prisma.shortClip.create({ data: { id: "c1", montageJobId: "job12345678", index: 4 } as never });
    const path = await shortFile(k, "render.mp4", "contenu du short");
    const stored = await storeShort(k.deps, { path, clip, probe, job });
    expect(k.sentVideos[0]).toMatchObject({ chatId: "4242" });
    expect(k.admin.deleteMessage).toHaveBeenCalledWith(stored.messageId);
    const row = k.tables("mediaAsset").find((a) => a.id === stored.assetId)!;
    expect(row).toMatchObject({ kind: "SHORT", storage: "telegram", libraryMessageId: null, theme: "roulette", size: (await stat(path)).size });
    expect(row.telegramRef).toMatchObject({ via: "admin", fileId: stored.fileId });
    expect(k.tables("shortClip")[0]!.assetId).toBe(stored.assetId);
    // Rejoué (plantage après l'envoi) : même asset, aucun second envoi.
    const again = await storeShort(k.deps, { path, clip, probe, job });
    expect(again).toMatchObject({ assetId: stored.assetId, created: false });
    expect(k.sentVideos).toHaveLength(1);
  });

  it("octets d'un média : en base → colonne ; dans Telegram ≤ 20 Mo → bot de Kevin ; au-delà → compte connecté", async () => {
    const k = await kitOf();
    const dbAsset = await k.prisma.mediaAsset.create({ data: { filename: "p.jpg", mimeType: "image/jpeg", size: 3, sha256: "s1", bytes: Buffer.from([1, 2, 3]), storage: "db" } as never });
    expect(Array.from(await resolveAssetBytes(k.deps, dbAsset.id))).toEqual([1, 2, 3]);
    expect(k.downloads).toHaveLength(0);

    const routes: string[] = [];
    const deps: MontagePipelineDeps = {
      ...k.deps,
      downloadTelegramFile: createTelegramDownloader({
        bot: async (fileId, dest) => {
          routes.push(`bot:${fileId}`);
          await writeFile(dest, "petit short");
        },
        account: async (ref, dest) => {
          routes.push(`compte:${ref.chatId}:${ref.messageId}`);
          await writeFile(dest, "gros short");
        },
      }),
    };
    const small = await k.prisma.mediaAsset.create({
      data: { filename: "s.mp4", mimeType: "video/mp4", size: 8 * MB, sha256: "s2", bytes: Buffer.alloc(0), storage: "telegram", kind: "SHORT", telegramRef: { chatId: "-1009999", messageId: 31, fileId: "kevin-31", via: "library", sizeBytes: 8 * MB } } as never,
    });
    expect(Buffer.from(await resolveAssetBytes(deps, small)).toString()).toBe("petit short");
    const big = await k.prisma.mediaAsset.create({
      data: { filename: "b.mp4", mimeType: "video/mp4", size: 45 * MB, sha256: "s3", bytes: Buffer.alloc(0), storage: "telegram", kind: "SHORT", telegramRef: { chatId: "-1009999", messageId: 32, fileId: "kevin-32", via: "library", sizeBytes: 45 * MB } } as never,
    });
    expect(Buffer.from(await resolveAssetBytes(deps, big.id)).toString()).toBe("gros short");
    expect(routes).toEqual(["bot:kevin-31", "compte:-1009999:32"]);
    // Aucun fichier temporaire laissé.
    expect((await k.filesIn()).filter((f) => f.startsWith("_resolve/"))).toEqual([]);
    expect(await readFile(join(k.workDir, "x")).catch(() => null)).toBeNull();
  });
});
