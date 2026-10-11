import { describe, expect, it, vi } from "vitest";
import { Api, helpers } from "telegram";
import {
  emojiFromDocument,
  NOT_ADMIN_MESSAGE,
  NOT_MEMBER_MESSAGE,
  postRightFromChannelEntity,
  postRightFromParticipant,
  readAccountPublishInfo,
  readInstalledEmojiPacks,
  type AccountClient,
} from "./account";
import { MtprotoAuthError, MtprotoFloodWait } from "./errors";

const big = helpers.returnBigInt;

function rpc(errorMessage: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`400: ${errorMessage}`), { errorMessage, code: 400, ...extra });
}

function channel(id: number, over: Partial<ConstructorParameters<typeof Api.Channel>[0]> = {}) {
  return new Api.Channel({
    id: big(id),
    title: `Canal ${id}`,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
    ...over,
  });
}

function user(premium: boolean) {
  return new Api.User({ id: big(99), firstName: "Mathéo", username: "matheo", premium });
}

function emojiDoc(id: string, alt: string, mimeType = "application/x-tgsticker") {
  return new Api.Document({
    id: big(id),
    accessHash: big(1),
    fileReference: Buffer.from(""),
    date: 0,
    mimeType,
    size: big(100),
    dcId: 2,
    attributes: [
      new Api.DocumentAttributeCustomEmoji({ alt, stickerset: new Api.InputStickerSetEmpty() }),
    ],
  });
}

describe("droit de publier d'après le canal", () => {
  it("canal : créateur, ou administrateur avec « Publier des messages »", () => {
    expect(postRightFromChannelEntity(channel(1, { broadcast: true, creator: true }))).toEqual({
      canPost: true,
      error: null,
    });
    expect(
      postRightFromChannelEntity(
        channel(1, {
          broadcast: true,
          adminRights: new Api.ChatAdminRights({ postMessages: true }),
        }),
      ),
    ).toEqual({ canPost: true, error: null });
    expect(
      postRightFromChannelEntity(
        channel(1, {
          broadcast: true,
          adminRights: new Api.ChatAdminRights({ pinMessages: true }),
        }),
      ),
    ).toEqual({ canPost: false, error: NOT_ADMIN_MESSAGE });
    expect(postRightFromChannelEntity(channel(1, { broadcast: true }))).toEqual({
      canPost: false,
      error: NOT_ADMIN_MESSAGE,
    });
    expect(postRightFromChannelEntity(channel(1, { broadcast: true, left: true }))).toEqual({
      canPost: false,
      error: NOT_MEMBER_MESSAGE,
    });
  });
  it("supergroupe : tout membre non restreint", () => {
    expect(postRightFromChannelEntity(channel(2, { megagroup: true }))).toEqual({
      canPost: true,
      error: null,
    });
    expect(
      postRightFromChannelEntity(
        channel(2, {
          megagroup: true,
          defaultBannedRights: new Api.ChatBannedRights({ untilDate: 0, sendMessages: true }),
        }),
      )?.canPost,
    ).toBe(false);
    expect(postRightFromChannelEntity(new Api.User({ id: big(1) }))).toBeNull();
  });
  it("fiche de participant", () => {
    expect(
      postRightFromParticipant(
        new Api.ChannelParticipantCreator({
          userId: big(1),
          adminRights: new Api.ChatAdminRights({}),
        }),
        {
          broadcast: true,
        },
      ).canPost,
    ).toBe(true);
    const admin = (postMessages: boolean) =>
      new Api.ChannelParticipantAdmin({
        userId: big(1),
        promotedBy: big(2),
        date: 0,
        adminRights: new Api.ChatAdminRights({ postMessages }),
      });
    expect(postRightFromParticipant(admin(true), { broadcast: true }).canPost).toBe(true);
    expect(postRightFromParticipant(admin(false), { broadcast: true })).toEqual({
      canPost: false,
      error: NOT_ADMIN_MESSAGE,
    });
    expect(
      postRightFromParticipant(
        new Api.ChannelParticipantSelf({ userId: big(1), inviterId: big(2), date: 0 }),
        { broadcast: true },
      ).canPost,
    ).toBe(false);
    expect(
      postRightFromParticipant(
        new Api.ChannelParticipantSelf({ userId: big(1), inviterId: big(2), date: 0 }),
        { broadcast: false },
      ).canPost,
    ).toBe(true);
  });
});

describe("readAccountPublishInfo : client GramJS simulé", () => {
  function client(opts: {
    premium: boolean;
    dialogs: unknown[];
    invoke?: (req: unknown) => unknown;
    inputEntity?: (id: number) => unknown;
  }) {
    return {
      getMe: vi.fn(async () => user(opts.premium)),
      getDialogs: vi.fn(async () => opts.dialogs.map((entity) => ({ entity }))),
      getInputEntity: vi.fn(async (id: number) => {
        const r = opts.inputEntity?.(id);
        if (r instanceof Error) throw r;
        return r ?? new Api.InputPeerChannel({ channelId: big(Math.abs(id)), accessHash: big(1) });
      }),
      invoke: vi.fn(async (req: unknown) => {
        const r = opts.invoke?.(req);
        if (r instanceof Error) throw r;
        return r;
      }),
    } as unknown as AccountClient;
  }

  it("Premium et droits lus dans les dialogues du compte en un passage", async () => {
    const c = client({
      premium: true,
      dialogs: [
        channel(111, { broadcast: true, creator: true }),
        channel(222, {
          broadcast: true,
          adminRights: new Api.ChatAdminRights({ editMessages: true }),
        }),
      ],
    });
    const info = await readAccountPublishInfo(c, ["-100111", "-100222"]);
    expect(info.premium).toBe(true);
    expect(info.user).toEqual({ id: "99", firstName: "Mathéo", username: "matheo", phone: null });
    expect(info.channels).toEqual({
      "-100111": { canPost: true, error: null },
      "-100222": { canPost: false, error: NOT_ADMIN_MESSAGE },
    });
    expect(c.invoke).not.toHaveBeenCalled();
  });

  it("canal absent des dialogues : channels.getParticipant sur soi-même ; pas membre → raison en français", async () => {
    const c = client({
      premium: false,
      dialogs: [],
      invoke: (req) => {
        if (!(req instanceof Api.channels.GetParticipant)) return undefined;
        expect(req.participant).toBeInstanceOf(Api.InputPeerSelf);
        const id = (req.channel as Api.InputPeerChannel).channelId.toString();
        if (id === "100333")
          return new Api.channels.ChannelParticipant({
            participant: new Api.ChannelParticipantCreator({
              userId: big(99),
              adminRights: new Api.ChatAdminRights({}),
            }),
            chats: [channel(333, { broadcast: true })],
            users: [],
          });
        return rpc("USER_NOT_PARTICIPANT");
      },
    });
    const info = await readAccountPublishInfo(c, ["-100333", "-100444"]);
    expect(info.premium).toBe(false);
    expect(info.channels["-100333"]).toEqual({ canPost: true, error: null });
    expect(info.channels["-100444"]).toEqual({ canPost: false, error: NOT_MEMBER_MESSAGE });
  });

  it("canal inconnu de GramJS : « pas dans ce canal » ; FLOOD_WAIT et session expirée arrêtent la lecture", async () => {
    const unknown = client({
      premium: true,
      dialogs: [],
      inputEntity: () => new Error("Could not find the input entity"),
    });
    expect((await readAccountPublishInfo(unknown, ["-100555"])).channels["-100555"]).toEqual({
      canPost: false,
      error: NOT_MEMBER_MESSAGE,
    });
    const flood = client({
      premium: true,
      dialogs: [],
      invoke: () => rpc("FLOOD_WAIT", { seconds: 60 }),
    });
    await expect(readAccountPublishInfo(flood, ["-100555"])).rejects.toBeInstanceOf(
      MtprotoFloodWait,
    );
    const expired = {
      getMe: async () => {
        throw rpc("AUTH_KEY_UNREGISTERED", { code: 401 });
      },
    } as unknown as AccountClient;
    await expect(readAccountPublishInfo(expired, [])).rejects.toBeInstanceOf(MtprotoAuthError);
  });
});

describe("packs d'emojis installés", () => {
  it("emoji d'un document : identifiant = document.id, remplacement = alt, format d'après le type", () => {
    expect(emojiFromDocument(emojiDoc("5368324170671202286", "🎁"))).toEqual({
      customEmojiId: "5368324170671202286",
      fallback: "🎁",
      format: "tgs",
    });
    expect(emojiFromDocument(emojiDoc("1", "😀", "video/webm"))?.format).toBe("webm");
    expect(emojiFromDocument(emojiDoc("2", "", "image/webp"))).toMatchObject({
      fallback: "⭐",
      format: "webp",
    });
    expect(emojiFromDocument(new Api.DocumentEmpty({ id: big(3) }))).toBeNull();
  });

  function packsClient(over: (req: unknown, n: number) => unknown) {
    let n = 0;
    return {
      invoke: vi.fn(async (req: unknown) => {
        const r = over(req, n++);
        if (r instanceof Error) throw r;
        return r;
      }),
    };
  }
  const set = (id: number, shortName: string) =>
    new Api.StickerSet({
      id: big(id),
      accessHash: big(id),
      title: `Pack ${shortName}`,
      shortName,
      count: 1,
      hash: 0,
      emojis: true,
    });
  const all = new Api.messages.AllStickers({
    hash: big(0),
    sets: [set(1, "Fire"), set(2, "Gone"), set(3, "Hearts")],
  });
  const full = (s: Api.StickerSet, docs: Api.Document[]) =>
    new Api.messages.StickerSet({ set: s, packs: [], keywords: [], documents: docs });

  it("lit chaque pack (messages.getStickerSet), saute un pack introuvable", async () => {
    const c = packsClient((req) => {
      if (req instanceof Api.messages.GetEmojiStickers) return all;
      const id = (
        (req as Api.messages.GetStickerSet).stickerset as Api.InputStickerSetID
      ).id.toString();
      if (id === "1")
        return full(set(1, "Fire"), [emojiDoc("11", "🔥"), emojiDoc("12", "💥", "video/webm")]);
      if (id === "2") return rpc("STICKERSET_INVALID");
      return full(set(3, "Hearts"), [emojiDoc("31", "❤️")]);
    });
    const r = await readInstalledEmojiPacks(c);
    expect(r.total).toBe(3);
    expect(r.floodWaitSeconds).toBeNull();
    expect(r.packs).toEqual([
      {
        shortName: "Fire",
        title: "Pack Fire",
        emojis: [
          { customEmojiId: "11", fallback: "🔥", format: "tgs" },
          { customEmojiId: "12", fallback: "💥", format: "webm" },
        ],
      },
      {
        shortName: "Hearts",
        title: "Pack Hearts",
        emojis: [{ customEmojiId: "31", fallback: "❤️", format: "tgs" }],
      },
    ]);
  });

  it("attente courte respectée sur place ; attente longue : lecture arrêtée avec ce qui a été lu", async () => {
    const sleep = vi.fn(async () => undefined);
    let floods = 0;
    const short = packsClient((req) => {
      if (req instanceof Api.messages.GetEmojiStickers) return all;
      if (floods++ === 0) return rpc("FLOOD_WAIT", { seconds: 3 });
      return full(set(1, "Fire"), [emojiDoc("11", "🔥")]);
    });
    const r1 = await readInstalledEmojiPacks(short, { sleep });
    expect(sleep).toHaveBeenCalledWith(3500);
    expect(r1.packs).toHaveLength(3);

    const long = packsClient((req, n) => {
      if (req instanceof Api.messages.GetEmojiStickers) return all;
      if (n === 1) return full(set(1, "Fire"), [emojiDoc("11", "🔥")]);
      return rpc("FLOOD_WAIT", { seconds: 600 });
    });
    const r2 = await readInstalledEmojiPacks(long, { sleep });
    expect(r2).toMatchObject({ total: 3, floodWaitSeconds: 600 });
    expect(r2.packs.map((p) => p.shortName)).toEqual(["Fire"]);
  });

  it("reprise : les packs déjà complets dans la bibliothèque sont sautés sans appel à Telegram", async () => {
    const asked: string[] = [];
    const c = packsClient((req) => {
      if (req instanceof Api.messages.GetEmojiStickers) return all;
      const id = (
        (req as Api.messages.GetStickerSet).stickerset as Api.InputStickerSetID
      ).id.toString();
      asked.push(id);
      return full(set(3, "Hearts"), [emojiDoc("31", "❤️")]);
    });
    const seen: Array<{ shortName: string; count: number }> = [];
    const r = await readInstalledEmojiPacks(c, {
      skipPack: (p) => {
        seen.push(p);
        return p.shortName !== "Hearts";
      },
    });
    // Seul le pack incomplet est relu : la limite de Telegram ne bloque plus toujours au même endroit.
    expect(asked).toEqual(["3"]);
    expect(seen).toEqual([
      { shortName: "Fire", count: 1 },
      { shortName: "Gone", count: 1 },
      { shortName: "Hearts", count: 1 },
    ]);
    expect(r).toMatchObject({ total: 3, skippedPacks: 2, floodWaitSeconds: null });
    expect(r.packs.map((p) => p.shortName)).toEqual(["Hearts"]);
  });
});
