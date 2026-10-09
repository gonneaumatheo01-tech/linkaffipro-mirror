import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = { om: {} as Row, asset: null as Row | null, files: [] as Row[], updates: [] as Row[], outcomes: [] as string[] };
  const prisma = {
    outboundMessage: {
      findUnique: vi.fn(async () => ({ ...state.om })),
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.updates.push(data);
        return data;
      }),
    },
    memberBotState: { upsert: vi.fn(async () => undefined) },
    mediaAsset: { findUnique: vi.fn(async () => state.asset) },
    mediaAssetTelegramFile: { upsert: vi.fn(async ({ create }: { create: Row }) => state.files.push(create)) },
  };
  const api = {
    sendMessage: vi.fn(async (_c: number, text: string) => ({ message_id: 10, text })),
    sendPhoto: vi.fn(async () => ({ message_id: 11, photo: [{ file_id: "F1", file_unique_id: "U1" }] })),
    sendVideo: vi.fn(async () => ({ message_id: 12, video: { file_id: "V1", file_unique_id: "UV1" } })),
    sendAnimation: vi.fn(async () => ({ message_id: 13 })),
    sendDocument: vi.fn(async () => ({ message_id: 14 })),
  };
  return { state, prisma, api };
});

vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, recordEvent: vi.fn(async () => undefined), toJsonValue: (v: unknown) => v }));
vi.mock("@linkaffipro/queue", () => ({ getRedis: () => ({}) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./api", () => ({ apiForBot: vi.fn(async () => ({ api: db.api, username: "bot" })) }));
vi.mock("./rate-limit", () => ({ RateLimiter: class { forBot = async () => undefined; forPrivateChat = async () => undefined; forChannel = async () => undefined; } }));
vi.mock("../broadcasts/progress", () => ({ recordBroadcastOutcome: vi.fn(async (_id: string | null, s: string) => db.state.outcomes.push(s)) }));

import { GrammyError } from "grammy";
import { sendDm } from "./send-dm";

const tgError = (code: number, description: string) => new GrammyError("call failed", { ok: false, error_code: code, description }, "sendPhoto", {});

const baseOm = { id: "om1", status: "QUEUED", botId: "b1", memberId: "m1", broadcastId: null, chatId: null, kind: "WELCOME", text: "<b>Salut</b>", buttons: [[{ text: "Ouvrir", url: "https://x" }]], mediaAssetId: null, member: { telegramUserId: 42n } };

beforeEach(() => {
  db.state.om = { ...baseOm };
  db.state.asset = null;
  db.state.files = [];
  db.state.updates = [];
  db.state.outcomes = [];
  for (const f of Object.values(db.api)) (f as ReturnType<typeof vi.fn>).mockClear();
});

describe("sendDm avec média", () => {
  it("envoie une photo avec légende et clavier, mémorise le file_id", async () => {
    db.state.om.mediaAssetId = "a1";
    db.state.asset = { id: "a1", mimeType: "image/jpeg", filename: "p.jpg", bytes: Buffer.from("x"), telegramFiles: [] };
    await sendDm("om1");
    expect(db.api.sendPhoto).toHaveBeenCalledTimes(1);
    const [chat, , opts] = db.api.sendPhoto.mock.calls[0] as unknown as [number, unknown, Row];
    expect(chat).toBe(42);
    expect(opts.caption).toBe("<b>Salut</b>");
    expect((opts.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard[0]![0]).toMatchObject({ text: "Ouvrir", url: "https://x" });
    expect(db.api.sendMessage).not.toHaveBeenCalled();
    expect(db.state.files[0]).toMatchObject({ assetId: "a1", botId: "b1", telegramFileId: "F1" });
    expect(db.state.updates.at(-1)).toMatchObject({ status: "SENT", telegramMessageId: 11, error: null });
    expect(db.state.outcomes).toEqual(["SENT"]);
  });

  it("réutilise le file_id connu pour ce bot (pas d'upload)", async () => {
    db.state.om.mediaAssetId = "a1";
    db.state.asset = { id: "a1", mimeType: "video/mp4", filename: "v.mp4", bytes: Buffer.from("x"), telegramFiles: [{ telegramFileId: "KNOWN" }] };
    await sendDm("om1");
    expect(db.api.sendVideo).toHaveBeenCalledTimes(1);
    expect((db.api.sendVideo.mock.calls[0] as unknown[])[1]).toBe("KNOWN");
  });

  it("légende trop longue : média seul puis texte avec boutons", async () => {
    db.state.om.mediaAssetId = "a1";
    db.state.om.text = "x".repeat(1500);
    db.state.asset = { id: "a1", mimeType: "image/png", filename: "p.png", bytes: Buffer.from("x"), telegramFiles: [] };
    await sendDm("om1");
    const photoOpts = (db.api.sendPhoto.mock.calls[0] as unknown[])[2] as Row;
    expect(photoOpts.caption).toBeUndefined();
    expect(photoOpts.reply_markup).toBeUndefined();
    expect(db.api.sendMessage).toHaveBeenCalledTimes(1);
    expect((db.api.sendMessage.mock.calls[0] as unknown[])[1]).toBe("x".repeat(1500));
    expect(db.state.updates.at(-1)).toMatchObject({ status: "SENT", telegramMessageId: 10 });
  });

  it("repli texte seul si le média échoue (statut SENT, erreur mémorisée)", async () => {
    db.state.om.mediaAssetId = "a1";
    db.state.asset = { id: "a1", mimeType: "application/pdf", filename: "d.pdf", bytes: Buffer.from("x"), telegramFiles: [] };
    db.api.sendDocument.mockRejectedValueOnce(tgError(400, "Bad Request: wrong file identifier"));
    await sendDm("om1");
    expect(db.api.sendMessage).toHaveBeenCalledTimes(1);
    const last = db.state.updates.at(-1) as Row;
    expect(last.status).toBe("SENT");
    expect(String(last.error)).toMatch(/Média non envoyé/);
    expect(db.state.outcomes).toEqual(["SENT"]);
  });

  it("sans média : texte seul comme avant", async () => {
    await sendDm("om1");
    expect(db.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(db.api.sendPhoto).not.toHaveBeenCalled();
    expect(db.state.updates.at(-1)).toMatchObject({ status: "SENT", telegramMessageId: 10 });
  });

  it("bloqué par le membre : BLOCKED même avec média", async () => {
    db.state.om.mediaAssetId = "a1";
    db.state.asset = { id: "a1", mimeType: "image/jpeg", filename: "p.jpg", bytes: Buffer.from("x"), telegramFiles: [] };
    db.api.sendPhoto.mockRejectedValueOnce(tgError(403, "Forbidden: bot was blocked by the user"));
    await sendDm("om1");
    expect(db.state.updates.at(-1)).toMatchObject({ status: "BLOCKED" });
    expect(db.state.outcomes).toEqual(["BLOCKED"]);
  });
});
