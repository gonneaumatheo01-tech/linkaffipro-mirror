import { describe, expect, it, vi } from "vitest";
import { createTelegramDownloader, type MontagePipelineDeps } from "@linkaffipro/agents";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ assets: [] as Row[], clips: [] as Row[], files: [] as Row[] }));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    mediaAsset: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: { telegramFiles?: { where: { botId: string } } } }) => {
        const a = db.assets.find((x) => x.id === where.id);
        if (!a) return null;
        const botId = include?.telegramFiles?.where.botId;
        return { ...a, telegramFiles: db.files.filter((f) => f.assetId === a.id && (!botId || f.botId === botId)) };
      },
    },
    shortClip: {
      findFirst: async ({ where }: { where: { assetId: string; status: string } }) => db.clips.find((c) => c.assetId === where.assetId && c.status === where.status) ?? null,
    },
  },
}));
vi.mock("./deps", () => ({ workerMontageDeps: () => ({}) }));

const { loadMedia } = await import("../sending/media");
const { ShortNotApproved, sendableBytes, setSendableBytesDeps } = await import("./media-bytes");
const { prisma } = await import("@linkaffipro/db");

const routes: string[] = [];
setSendableBytesDeps(
  () =>
    ({
      prisma,
      downloadTelegramFile: createTelegramDownloader({
        bot: async (fileId, dest) => {
          routes.push(`bot:${fileId}`);
          const { writeFile } = await import("node:fs/promises");
          await writeFile(dest, "octets du short");
        },
        account: async (ref, dest) => {
          routes.push(`compte:${ref.messageId}`);
          const { writeFile } = await import("node:fs/promises");
          await writeFile(dest, "gros short");
        },
      }),
      montage: { workDir: `${process.env.TMPDIR ?? "/tmp"}/lap-montage-worker-test` },
    }) as unknown as MontagePipelineDeps,
);

const short = (id: string, size: number) => ({
  id,
  filename: `${id}.mp4`,
  mimeType: "video/mp4",
  kind: "SHORT",
  storage: "telegram",
  size,
  bytes: new Uint8Array(),
  telegramRef: { chatId: "-1009999", messageId: 40, fileId: `kevin-${id}`, via: "library", sizeBytes: size },
});

describe("envoi d'un short du montage par un bot de canal", () => {
  it("short validé : octets retrouvés dans Telegram (le fichier de Kevin ne vaut pas pour un autre bot)", async () => {
    db.assets.push(short("s1", 8 * 1024 * 1024));
    db.clips.push({ assetId: "s1", status: "APPROVED" });
    db.files.push({ assetId: "s1", botId: "bot-kevin", telegramFileId: "kevin-s1" });
    const m = await loadMedia("s1", "bot-roulette");
    expect(m?.kind).toBe("video");
    expect(typeof m?.media).not.toBe("string");
    expect(routes).toEqual(["bot:kevin-s1"]);
    // Kevin lui-même réutilise son identifiant de fichier (aucun téléchargement).
    const own = await loadMedia("s1", "bot-kevin");
    expect(own?.media).toBe("kevin-s1");
    expect(routes).toHaveLength(1);
  });

  it("short de plus de 20 Mo : relu par le compte connecté", async () => {
    db.assets.push(short("s2", 45 * 1024 * 1024));
    db.clips.push({ assetId: "s2", status: "APPROVED" });
    expect(Buffer.from(await sendableBytes(db.assets.at(-1) as never)).toString()).toBe("gros short");
    expect(routes.at(-1)).toBe("compte:40");
  });

  it("short pas encore validé : ne part jamais, même par un bot qui le connaît", async () => {
    db.assets.push(short("s3", 1000));
    db.clips.push({ assetId: "s3", status: "PREVIEW_SENT" });
    db.files.push({ assetId: "s3", botId: "bot-kevin", telegramFileId: "kevin-s3" });
    await expect(loadMedia("s3", "bot-roulette")).rejects.toBeInstanceOf(ShortNotApproved);
    await expect(loadMedia("s3", "bot-kevin")).rejects.toBeInstanceOf(ShortNotApproved);
  });

  it("média en base : inchangé", async () => {
    db.assets.push({ id: "p1", filename: "p.jpg", mimeType: "image/jpeg", kind: "PHOTO", storage: "db", bytes: new Uint8Array([9, 9]) });
    const m = await loadMedia("p1", "bot-roulette");
    expect(m?.kind).toBe("photo");
    expect(Array.from(await sendableBytes(db.assets.at(-1) as never))).toEqual([9, 9]);
  });
});
