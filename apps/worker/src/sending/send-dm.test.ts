import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = {
    om: {} as Row,
    asset: null as Row | null,
    files: [] as Row[],
    updates: [] as Row[],
    outcomes: [] as string[],
  };
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
    mediaAssetTelegramFile: {
      upsert: vi.fn(async ({ create }: { create: Row }) => state.files.push(create)),
    },
  };
  const api = {
    sendMessage: vi.fn(async (_c: number, text: string) => ({ message_id: 10, text })),
    sendPhoto: vi.fn(async () => ({
      message_id: 11,
      photo: [{ file_id: "F1", file_unique_id: "U1" }],
    })),
    sendVideo: vi.fn(async () => ({
      message_id: 12,
      video: { file_id: "V1", file_unique_id: "UV1" },
    })),
    sendAnimation: vi.fn(async () => ({ message_id: 13 })),
    sendDocument: vi.fn(async () => ({ message_id: 14 })),
  };
  return { state, prisma, api };
});

vi.mock("@linkaffipro/db", () => ({
  prisma: db.prisma,
  recordEvent: vi.fn(async () => undefined),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@linkaffipro/queue", () => ({ getRedis: () => ({}) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./api", () => ({ apiForBot: vi.fn(async () => ({ api: db.api, username: "bot" })) }));
vi.mock("./rate-limit", () => ({
  RateLimiter: class {
    forBot = async () => undefined;
    forPrivateChat = async () => undefined;
    forChannel = async () => undefined;
  },
}));
vi.mock("../broadcasts/progress", () => ({
  recordBroadcastOutcome: vi.fn(async (_id: string | null, s: string) => db.state.outcomes.push(s)),
}));

import { GrammyError } from "grammy";
import { recordEvent } from "@linkaffipro/db";
import { sendDm } from "./send-dm";

const tgError = (code: number, description: string) =>
  new GrammyError("call failed", { ok: false, error_code: code, description }, "sendPhoto", {});

const baseOm = {
  id: "om1",
  status: "QUEUED",
  botId: "b1",
  memberId: "m1",
  broadcastId: null,
  chatId: null,
  kind: "WELCOME",
  text: "<b>Salut</b>",
  buttons: [[{ text: "Ouvrir", url: "https://x" }]],
  mediaAssetId: null,
  member: { telegramUserId: 42n },
};

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
    db.state.asset = {
      id: "a1",
      mimeType: "image/jpeg",
      filename: "p.jpg",
      bytes: Buffer.from("x"),
      telegramFiles: [],
    };
    await sendDm("om1");
    expect(db.api.sendPhoto).toHaveBeenCalledTimes(1);
    const [chat, , opts] = db.api.sendPhoto.mock.calls[0] as unknown as [number, unknown, Row];
    expect(chat).toBe(42);
    expect(opts.caption).toBe("<b>Salut</b>");
    expect(
      (opts.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard[0]![0],
    ).toMatchObject({ text: "Ouvrir", url: "https://x" });
    expect(db.api.sendMessage).not.toHaveBeenCalled();
    expect(db.state.files[0]).toMatchObject({ assetId: "a1", botId: "b1", telegramFileId: "F1" });
    expect(db.state.updates.at(-1)).toMatchObject({
      status: "SENT",
      telegramMessageId: 11,
      error: null,
    });
    expect(db.state.outcomes).toEqual(["SENT"]);
  });

  it("réutilise le file_id connu pour ce bot (pas d'upload)", async () => {
    db.state.om.mediaAssetId = "a1";
    db.state.asset = {
      id: "a1",
      mimeType: "video/mp4",
      filename: "v.mp4",
      bytes: Buffer.from("x"),
      telegramFiles: [{ telegramFileId: "KNOWN" }],
    };
    await sendDm("om1");
    expect(db.api.sendVideo).toHaveBeenCalledTimes(1);
    expect((db.api.sendVideo.mock.calls[0] as unknown[])[1]).toBe("KNOWN");
  });

  it("légende trop longue : média seul puis texte avec boutons", async () => {
    db.state.om.mediaAssetId = "a1";
    db.state.om.text = "x".repeat(1500);
    db.state.asset = {
      id: "a1",
      mimeType: "image/png",
      filename: "p.png",
      bytes: Buffer.from("x"),
      telegramFiles: [],
    };
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
    db.state.asset = {
      id: "a1",
      mimeType: "application/pdf",
      filename: "d.pdf",
      bytes: Buffer.from("x"),
      telegramFiles: [],
    };
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
    db.state.asset = {
      id: "a1",
      mimeType: "image/jpeg",
      filename: "p.jpg",
      bytes: Buffer.from("x"),
      telegramFiles: [],
    };
    db.api.sendPhoto.mockRejectedValueOnce(tgError(403, "Forbidden: bot was blocked by the user"));
    await sendDm("om1");
    expect(db.state.updates.at(-1)).toMatchObject({ status: "BLOCKED" });
    expect(db.state.outcomes).toEqual(["BLOCKED"]);
  });
});

describe("sendDm avec emojis animés (phase 12)", () => {
  const EMOJI_TEXT = 'Bienvenue <tg-emoji emoji-id="5368324170671202286">🎉</tg-emoji> <b>Léa</b>';
  const PLAIN_TEXT = "Bienvenue 🎉 <b>Léa</b>";
  const refusal = () =>
    tgError(
      400,
      'Bad Request: can\'t parse entities: Unsupported start tag "tg-emoji" at byte offset 10',
    );

  beforeEach(() => {
    vi.mocked(recordEvent).mockClear();
    db.state.om.text = EMOJI_TEXT;
  });

  const fallbackEvents = () =>
    vi
      .mocked(recordEvent)
      .mock.calls.map((c) => c[0])
      .filter((e) => e.type === "dm.custom_emoji_fallback");

  it("envoie le texte tel quel (balises comprises) quand Telegram accepte les emojis animés", async () => {
    db.api.sendMessage.mockResolvedValueOnce({
      message_id: 20,
      text: "Bienvenue 🎉 Léa",
      entities: [{ type: "custom_emoji" }, { type: "bold" }],
    } as never);
    await sendDm("om1");
    expect(db.api.sendMessage).toHaveBeenCalledTimes(1);
    expect((db.api.sendMessage.mock.calls[0] as unknown[])[1]).toBe(EMOJI_TEXT);
    expect(db.state.updates.at(-1)).toMatchObject({
      status: "SENT",
      telegramMessageId: 20,
      error: null,
    });
    expect(fallbackEvents()).toEqual([]);
  });

  it("refus de Telegram : renvoi immédiat avec les emojis de remplacement, mêmes boutons, journalisé", async () => {
    db.api.sendMessage.mockRejectedValueOnce(refusal());
    await sendDm("om1");
    const calls = db.api.sendMessage.mock.calls as unknown as Array<[number, string, Row]>;
    expect(calls.map((c) => c[1])).toEqual([EMOJI_TEXT, PLAIN_TEXT]);
    expect(calls[1]![2].reply_markup).toEqual(calls[0]![2].reply_markup);
    expect(calls[1]![2].parse_mode).toBe("HTML");
    expect(db.state.updates.at(-1)).toMatchObject({
      status: "SENT",
      telegramMessageId: 10,
      error: "Envoyé avec les emojis normaux : Telegram a refusé les emojis animés.",
    });
    expect(fallbackEvents()).toEqual([
      {
        type: "dm.custom_emoji_fallback",
        memberId: "m1",
        botId: "b1",
        payload: {
          outboundMessageId: "om1",
          botId: "b1",
          error:
            'Bad Request: can\'t parse entities: Unsupported start tag "tg-emoji" at byte offset 10',
          resent: true,
          kind: "WELCOME",
        },
      },
    ]);
    expect(db.state.outcomes).toEqual(["SENT"]);
  });

  it("légende d'une photo refusée : photo renvoyée avec la légende de remplacement, rien d'autre", async () => {
    db.state.om.mediaAssetId = "a1";
    db.state.asset = {
      id: "a1",
      mimeType: "image/jpeg",
      filename: "p.jpg",
      bytes: Buffer.from("x"),
      telegramFiles: [{ telegramFileId: "KNOWN" }],
    };
    db.api.sendPhoto.mockRejectedValueOnce(refusal());
    await sendDm("om1");
    const captions = (db.api.sendPhoto.mock.calls as unknown as Array<[number, unknown, Row]>).map(
      (c) => c[2].caption,
    );
    expect(captions).toEqual([EMOJI_TEXT, PLAIN_TEXT]);
    expect(db.api.sendMessage).not.toHaveBeenCalled();
    expect(db.state.updates.at(-1)).toMatchObject({ status: "SENT", telegramMessageId: 11 });
    expect(fallbackEvents()).toHaveLength(1);
  });

  it("emojis retirés par Telegram sans refus : pas de renvoi (pas de doublon), journalisé", async () => {
    db.api.sendMessage.mockResolvedValueOnce({
      message_id: 21,
      text: "Bienvenue 🎉 Léa",
      entities: [{ type: "bold" }],
    } as never);
    await sendDm("om1");
    expect(db.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(db.state.updates.at(-1)).toMatchObject({
      status: "SENT",
      error: "Telegram a affiché les emojis normaux à la place des emojis animés.",
    });
    expect(fallbackEvents()[0]?.payload).toMatchObject({ outboundMessageId: "om1", resent: false });
  });

  it("membre qui a bloqué le bot : BLOCKED, jamais de renvoi", async () => {
    db.api.sendMessage.mockRejectedValueOnce(
      tgError(403, "Forbidden: bot was blocked by the user"),
    );
    await sendDm("om1");
    expect(db.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(db.state.updates.at(-1)).toMatchObject({ status: "BLOCKED" });
    expect(fallbackEvents()).toEqual([]);
  });

  it("vraie erreur de mise en forme (sans rapport avec les emojis) : échec normal, sans journal de repli", async () => {
    db.api.sendMessage
      .mockRejectedValueOnce(refusal())
      .mockRejectedValueOnce(tgError(400, "Bad Request: can't parse entities: Can't find end tag"));
    await sendDm("om1");
    expect(db.api.sendMessage).toHaveBeenCalledTimes(2);
    expect(db.state.updates.at(-1)).toMatchObject({ status: "FAILED" });
    expect(fallbackEvents()).toEqual([]);
  });
});

describe("sendDm : bloqué ou injoignable (phase 14)", () => {
  const upserts = () =>
    (db.prisma.memberBotState.upsert as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { create: Row; update: Row },
    );
  const events = () =>
    vi.mocked(recordEvent).mock.calls.map((c) => c[0] as { type: string; payload: Row });
  beforeEach(() => {
    (db.prisma.memberBotState.upsert as ReturnType<typeof vi.fn>).mockClear();
    vi.mocked(recordEvent).mockClear();
  });

  it("« bot can't initiate conversation » : FAILED, personne injoignable, jamais « a bloqué le bot »", async () => {
    db.api.sendMessage.mockRejectedValueOnce(
      tgError(403, "Forbidden: bot can't initiate conversation with a user"),
    );
    await sendDm("om1");
    expect(db.state.updates.at(-1)).toEqual({
      status: "FAILED",
      error:
        "Le bot ne peut plus écrire à cette personne : elle n'a jamais appuyé sur « Démarrer » et les 5 minutes après sa demande sont passées.",
    });
    expect(db.state.outcomes).toEqual(["FAILED"]);
    expect(upserts()).toEqual([
      expect.objectContaining({
        create: { memberId: "m1", botId: "b1", canDm: false },
        update: { canDm: false },
      }),
    ]);
    expect(events().map((e) => [e.type, e.payload.telegramError])).toEqual([
      ["dm.unreachable", "403 Forbidden: bot can't initiate conversation with a user"],
    ]);
  });

  it("« bot was blocked by the user » : BLOCKED, blockedAt, événement dm.blocked avec l'erreur exacte", async () => {
    db.api.sendMessage.mockRejectedValueOnce(
      tgError(403, "Forbidden: bot was blocked by the user"),
    );
    await sendDm("om1");
    expect(db.state.updates.at(-1)).toMatchObject({
      status: "BLOCKED",
      error: "Cette personne a bloqué le bot.",
    });
    const u = upserts()[0]!;
    expect(u.update).toMatchObject({ canDm: false, blockedAt: expect.any(Date) });
    expect(events()[0]).toMatchObject({
      type: "dm.blocked",
      payload: { telegramError: "403 Forbidden: bot was blocked by the user", kind: "WELCOME" },
    });
  });

  it("message envoyé dans la fenêtre de 5 minutes : la personne ne devient pas joignable (canDm faux à la création)", async () => {
    await sendDm("om1");
    expect(db.state.updates.at(-1)).toMatchObject({ status: "SENT" });
    expect(upserts()[0]).toMatchObject({
      create: { memberId: "m1", botId: "b1", canDm: false, lastDmAt: expect.any(Date) },
      update: { lastDmAt: expect.any(Date), blockedAt: null },
    });
    expect(upserts()[0]!.update).not.toHaveProperty("canDm");
  });
});
