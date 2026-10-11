import { describe, expect, it, vi } from "vitest";
import { Api, helpers } from "telegram";
import { MtprotoAuthError, MtprotoFloodWait, MtprotoRpcError } from "./errors";
import {
  AccountPostInvalid,
  deleteAccountMessages,
  deterministicRandomId,
  findPublishedStep,
  pinAccountMessage,
  planAccountPost,
  sendAccountStep,
  sentMessagesOf,
  stepMessageCount,
  stepsAlreadyDone,
  toMtprotoEntities,
  unpinAllAccountMessages,
  type AccountMedia,
  type PublishClient,
} from "./publish";
import { parseTelegramHtml } from "./html-entities";

const big = helpers.returnBigInt;
const ID = "5368324170671202286";
const PEER = new Api.InputPeerChannel({ channelId: big(1234567890), accessHash: big(42) });

/** Imitation d'une RPCError GramJS. */
function rpc(errorMessage: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`400: ${errorMessage}`), { errorMessage, code: 400, ...extra });
}

/** Réponse Telegram d'un envoi dans un canal : UpdateMessageID (random_id → id) + UpdateNewChannelMessage. */
function channelUpdates(
  items: Array<{ randomId: unknown; id: number; entities?: Api.TypeMessageEntity[] }>,
) {
  return new Api.Updates({
    updates: [
      ...items.map((i) => new Api.UpdateMessageID({ id: i.id, randomId: big(String(i.randomId)) })),
      ...items.map(
        (i) =>
          new Api.UpdateNewChannelMessage({
            message: new Api.Message({
              id: i.id,
              peerId: new Api.PeerChannel({ channelId: big(1234567890) }),
              date: 0,
              message: "",
              entities: i.entities,
            }),
            pts: 1,
            ptsCount: 1,
          }),
      ),
    ],
    users: [],
    chats: [],
    date: 0,
    seq: 0,
  });
}

/**
 * Client GramJS simulé : chaque requête est consignée ; les envois répondent comme un canal (identifiants 500, 501…) en
 * renvoyant les entités reçues (Telegram garde les emojis animés), sauf si `respond` décide autrement.
 */
function fakeClient(respond?: (req: unknown) => unknown) {
  const calls: unknown[] = [];
  let next = 500;
  const invoke = vi.fn(async (req: unknown) => {
    calls.push(req);
    const custom = respond?.(req);
    if (custom instanceof Error) throw custom;
    if (custom !== undefined) return custom;
    if (req instanceof Api.messages.SendMessage || req instanceof Api.messages.SendMedia)
      return channelUpdates([{ randomId: req.randomId, id: next++, entities: req.entities }]);
    if (req instanceof Api.messages.SendMultiMedia)
      return channelUpdates(
        req.multiMedia.map((m) => ({ randomId: m.randomId, id: next++, entities: m.entities })),
      );
    if (req instanceof Api.messages.UploadMedia)
      return req.media instanceof Api.InputMediaUploadedPhoto
        ? new Api.MessageMediaPhoto({
            photo: new Api.Photo({
              id: big(next * 10),
              accessHash: big(7),
              fileReference: Buffer.from("ref"),
              date: 0,
              sizes: [],
              dcId: 2,
            }),
          })
        : new Api.MessageMediaDocument({
            document: new Api.Document({
              id: big(next * 10 + 1),
              accessHash: big(8),
              fileReference: Buffer.from("ref"),
              date: 0,
              mimeType: "video/mp4",
              size: big(10),
              dcId: 2,
              attributes: [],
            }),
          });
    if (req instanceof Api.messages.UnpinAllMessages)
      return new Api.messages.AffectedHistory({ pts: 1, ptsCount: 1, offset: 0 });
    return new Api.Updates({ updates: [], users: [], chats: [], date: 0, seq: 0 });
  });
  const uploadFile = vi.fn(
    async (p: { file: { name: string; size: number } }) =>
      new Api.InputFile({ id: big(1), parts: 1, name: p.file.name, md5Checksum: "" }),
  );
  return { client: { invoke, uploadFile } as unknown as PublishClient, calls, invoke, uploadFile };
}

const photo = (name = "a.jpg"): AccountMedia => ({
  kind: "photo",
  bytes: new Uint8Array([1, 2, 3]),
  filename: name,
  mimeType: "image/jpeg",
});
const video: AccountMedia = {
  kind: "video",
  bytes: new Uint8Array([4, 5]),
  filename: "v.mp4",
  mimeType: "video/mp4",
  width: 640,
  height: 360,
  duration: 12,
};

describe("planAccountPost : quel envoi pour quel message", () => {
  it("texte seul → un message texte, aperçu de lien selon le message", () => {
    const steps = planAccountPost({
      html: "<b>Salut</b>",
      mediaCount: 0,
      disableLinkPreview: false,
    });
    expect(steps).toEqual([
      {
        kind: "text",
        text: { text: "Salut", entities: [{ type: "bold", offset: 0, length: 5 }] },
        noWebpage: false,
      },
    ]);
  });
  it("un média, légende courte → média avec légende", () => {
    const steps = planAccountPost({ html: "Légende", mediaCount: 1, disableLinkPreview: true });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "media", mediaIndex: 0, caption: { text: "Légende" } });
  });
  it("légende de plus de 1024 caractères → média sans légende puis texte (sans aperçu)", () => {
    const long = "x".repeat(1025);
    const steps = planAccountPost({ html: long, mediaCount: 1, disableLinkPreview: false });
    expect(steps.map((s) => s.kind)).toEqual(["media", "text"]);
    expect(steps[0]).toMatchObject({ caption: null });
    expect(steps[1]).toMatchObject({ noWebpage: true });
  });
  it("une légende de 1024 caractères avec un emoji animé tient (l'emoji compte comme son remplacement)", () => {
    const html = `${"x".repeat(1022)}<tg-emoji emoji-id="${ID}">🎁</tg-emoji>`;
    expect(planAccountPost({ html, mediaCount: 1, disableLinkPreview: true })).toHaveLength(1);
  });
  it("plusieurs médias → un album (10 au plus), légende sur le premier ; sans texte, pas de message texte", () => {
    const steps = planAccountPost({ html: "", mediaCount: 12, disableLinkPreview: true });
    expect(steps).toEqual([
      { kind: "album", mediaIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], caption: null },
    ]);
    expect(stepMessageCount(steps[0]!)).toBe(10);
  });
  it("texte vide sans média, ou texte de plus de 4096 caractères : refus en français", () => {
    expect(() => planAccountPost({ html: "  ", mediaCount: 0, disableLinkPreview: true })).toThrow(
      AccountPostInvalid,
    );
    expect(() =>
      planAccountPost({ html: "y".repeat(4097), mediaCount: 0, disableLinkPreview: true }),
    ).toThrow(/Texte trop long/);
  });
});

describe("stepsAlreadyDone : reprise sans doublon", () => {
  const steps = planAccountPost({
    html: "z".repeat(2000),
    mediaCount: 3,
    disableLinkPreview: true,
  });
  it("album de 3 puis texte : 0, 3 et 4 messages déjà publiés", () => {
    expect(steps.map(stepMessageCount)).toEqual([3, 1]);
    expect(stepsAlreadyDone(steps, 0)).toBe(0);
    expect(stepsAlreadyDone(steps, 3)).toBe(1);
    expect(stepsAlreadyDone(steps, 4)).toBe(2);
  });
  it("nombre incohérent (message modifié entre-temps) → -1", () => {
    expect(stepsAlreadyDone(steps, 2)).toBe(-1);
    expect(stepsAlreadyDone(steps, 5)).toBe(-1);
  });
});

describe("toMtprotoEntities", () => {
  it("chaque mise en forme devient l'entité MTProto correspondante, emoji animé avec son document_id", () => {
    const parsed = parseTelegramHtml(
      `<b>a</b><i>b</i><u>c</u><s>d</s><tg-spoiler>e</tg-spoiler><code>f</code><pre language="js">g</pre>` +
        `<a href="https://x.y">h</a><blockquote expandable>i</blockquote><tg-emoji emoji-id="${ID}">🎁</tg-emoji>`,
    );
    const out = toMtprotoEntities(parsed.entities);
    expect(out.map((e) => e.className)).toEqual([
      "MessageEntityBold",
      "MessageEntityItalic",
      "MessageEntityUnderline",
      "MessageEntityStrike",
      "MessageEntitySpoiler",
      "MessageEntityCode",
      "MessageEntityPre",
      "MessageEntityTextUrl",
      "MessageEntityBlockquote",
      "MessageEntityCustomEmoji",
    ]);
    const emoji = out[9] as Api.MessageEntityCustomEmoji;
    expect(emoji.documentId.toString()).toBe(ID);
    expect([emoji.offset, emoji.length]).toEqual([9, 2]);
    expect((out[6] as Api.MessageEntityPre).language).toBe("js");
    expect((out[7] as Api.MessageEntityTextUrl).url).toBe("https://x.y");
    expect((out[8] as Api.MessageEntityBlockquote).collapsed).toBe(true);
  });
});

describe("sendAccountStep : client GramJS simulé", () => {
  it("texte avec emoji animé : messages.sendMessage avec entités, silencieux, sans aperçu, random_id déterministe", async () => {
    const { client, calls } = fakeClient();
    const [step] = planAccountPost({
      html: `<b>Bonus</b> <tg-emoji emoji-id="${ID}">🎁</tg-emoji>`,
      mediaCount: 0,
      disableLinkPreview: true,
    });
    const r = await sendAccountStep(client, PEER, step!, [], {
      silent: true,
      randomSeed: "post:p1:0:0",
    });
    expect(r).toEqual({ ids: [500], customEmojiSent: 1, customEmojiKept: 1 });
    const req = calls[0] as Api.messages.SendMessage;
    expect(req).toBeInstanceOf(Api.messages.SendMessage);
    expect(req.peer).toBe(PEER);
    expect(req.message).toBe("Bonus 🎁");
    expect(req.silent).toBe(true);
    expect(req.noWebpage).toBe(true);
    // Contenu protégé : réservé aux bots par Telegram, jamais envoyé par le compte.
    expect(req.noforwards).toBeUndefined();
    expect(req.entities?.map((e) => [e.className, e.offset, e.length])).toEqual([
      ["MessageEntityBold", 0, 5],
      ["MessageEntityCustomEmoji", 6, 2],
    ]);
    expect(String(req.randomId)).toBe(deterministicRandomId("post:p1:0:0:0").toString());
  });

  it("Telegram retire l'emoji animé (compte sans Premium) : customEmojiKept = 0", async () => {
    const { client } = fakeClient((req) =>
      req instanceof Api.messages.SendMessage
        ? channelUpdates([{ randomId: req.randomId, id: 9, entities: [] }])
        : undefined,
    );
    const [step] = planAccountPost({
      html: `<tg-emoji emoji-id="${ID}">🎁</tg-emoji>`,
      mediaCount: 0,
      disableLinkPreview: true,
    });
    expect(
      await sendAccountStep(client, PEER, step!, [], { silent: false, randomSeed: "s" }),
    ).toEqual({
      ids: [9],
      customEmojiSent: 1,
      customEmojiKept: 0,
    });
  });

  it("une photo avec légende : envoi du fichier puis messages.sendMedia avec la légende et ses entités", async () => {
    const { client, calls, uploadFile } = fakeClient();
    const [step] = planAccountPost({
      html: `Photo <tg-emoji emoji-id="${ID}">🔥</tg-emoji>`,
      mediaCount: 1,
      disableLinkPreview: true,
    });
    const r = await sendAccountStep(client, PEER, step!, [photo()], {
      silent: false,
      randomSeed: "m",
    });
    expect(r.ids).toEqual([500]);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    const req = calls[0] as Api.messages.SendMedia;
    expect(req).toBeInstanceOf(Api.messages.SendMedia);
    expect(req.media).toBeInstanceOf(Api.InputMediaUploadedPhoto);
    expect(req.message).toBe("Photo 🔥");
    expect(req.entities?.[0]).toBeInstanceOf(Api.MessageEntityCustomEmoji);
    expect(req.silent).toBeUndefined();
  });

  it("une vidéo : document avec ses dimensions et sa durée", async () => {
    const { client, calls } = fakeClient();
    const [step] = planAccountPost({ html: "Vidéo", mediaCount: 1, disableLinkPreview: true });
    await sendAccountStep(client, PEER, step!, [video], { silent: false, randomSeed: "v" });
    const media = (calls[0] as Api.messages.SendMedia).media as Api.InputMediaUploadedDocument;
    expect(media).toBeInstanceOf(Api.InputMediaUploadedDocument);
    expect(media.mimeType).toBe("video/mp4");
    const attr = media.attributes.find(
      (a) => a instanceof Api.DocumentAttributeVideo,
    ) as Api.DocumentAttributeVideo;
    expect([attr.w, attr.h, attr.duration, attr.supportsStreaming]).toEqual([640, 360, 12, true]);
  });

  it("un album : chaque média passe par messages.uploadMedia, puis messages.sendMultiMedia avec la légende sur le premier", async () => {
    const { client, calls } = fakeClient();
    const [step] = planAccountPost({
      html: `Album <tg-emoji emoji-id="${ID}">🎁</tg-emoji>`,
      mediaCount: 2,
      disableLinkPreview: true,
    });
    const r = await sendAccountStep(client, PEER, step!, [photo(), video], {
      silent: true,
      randomSeed: "alb",
    });
    expect(calls.filter((c) => c instanceof Api.messages.UploadMedia)).toHaveLength(2);
    const req = calls.find(
      (c) => c instanceof Api.messages.SendMultiMedia,
    ) as Api.messages.SendMultiMedia;
    expect(req.silent).toBe(true);
    expect(req.multiMedia.map((m) => m.media.className)).toEqual([
      "InputMediaPhoto",
      "InputMediaDocument",
    ]);
    expect(req.multiMedia.map((m) => m.message)).toEqual(["Album 🎁", ""]);
    expect(req.multiMedia[0]!.entities?.[0]).toBeInstanceOf(Api.MessageEntityCustomEmoji);
    expect(req.multiMedia[1]!.entities).toBeUndefined();
    expect(new Set(req.multiMedia.map((m) => String(m.randomId))).size).toBe(2);
    expect(r).toEqual({ ids: [500, 501], customEmojiSent: 1, customEmojiKept: 1 });
  });

  it("FLOOD_WAIT, session révoquée, droit manquant : erreurs typées", async () => {
    const [step] = planAccountPost({ html: "x", mediaCount: 0, disableLinkPreview: true });
    const flood = fakeClient(() => rpc("FLOOD_WAIT", { seconds: 33 })).client;
    await expect(
      sendAccountStep(flood, PEER, step!, [], { silent: false, randomSeed: "f" }),
    ).rejects.toMatchObject({
      name: "MtprotoFloodWait",
      seconds: 33,
    });
    const revoked = fakeClient(() => rpc("SESSION_REVOKED", { code: 401 })).client;
    await expect(
      sendAccountStep(revoked, PEER, step!, [], { silent: false, randomSeed: "r" }),
    ).rejects.toBeInstanceOf(MtprotoAuthError);
    const forbidden = fakeClient(() => rpc("CHAT_WRITE_FORBIDDEN", { code: 403 })).client;
    const err = await sendAccountStep(forbidden, PEER, step!, [], {
      silent: false,
      randomSeed: "w",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MtprotoRpcError);
    expect((err as Error).message).toMatch(/n'a pas le droit de publier/);
    const slow = fakeClient(() => rpc("SLOWMODE_WAIT_12")).client;
    await expect(
      sendAccountStep(slow, PEER, step!, [], { silent: false, randomSeed: "s" }),
    ).rejects.toBeInstanceOf(MtprotoFloodWait);
  });
});

describe("sentMessagesOf", () => {
  it("ordre des random_id envoyés, même si Telegram répond dans un autre ordre", () => {
    const res = channelUpdates([
      { randomId: 22, id: 8 },
      { randomId: 11, id: 7 },
    ]);
    expect(sentMessagesOf(res, ["11", "22"]).ids).toEqual([7, 8]);
  });
  it("réponse courte (UpdateShortSentMessage) et réponse sans identifiant", () => {
    const short = new Api.UpdateShortSentMessage({ id: 77, pts: 1, ptsCount: 1, date: 0 });
    expect(sentMessagesOf(short, ["1"])).toEqual({ ids: [77], entities: null });
    expect(
      sentMessagesOf(new Api.Updates({ updates: [], users: [], chats: [], date: 0, seq: 0 }), [
        "1",
      ]),
    ).toEqual({
      ids: [],
      entities: null,
    });
  });
});

describe("épingler, désépingler, supprimer", () => {
  it("épinglage silencieux du message", async () => {
    const { client, calls } = fakeClient();
    await pinAccountMessage(client, PEER, 500);
    const req = calls[0] as Api.messages.UpdatePinnedMessage;
    expect(req).toBeInstanceOf(Api.messages.UpdatePinnedMessage);
    expect([req.id, req.silent, req.unpin]).toEqual([500, true, undefined]);
  });
  it("désépingler tout : rappelé tant que Telegram n'a pas fini ; rien d'épinglé n'est pas une erreur", async () => {
    let n = 0;
    const { client, calls } = fakeClient((req) =>
      req instanceof Api.messages.UnpinAllMessages
        ? new Api.messages.AffectedHistory({ pts: 1, ptsCount: 1, offset: n++ === 0 ? 5 : 0 })
        : undefined,
    );
    await unpinAllAccountMessages(client, PEER);
    expect(calls).toHaveLength(2);
    const none = fakeClient(() => rpc("CHAT_NOT_MODIFIED")).client;
    await expect(unpinAllAccountMessages(none, PEER)).resolves.toBeUndefined();
  });
  it("suppression par channels.deleteMessages (lots de 100, sans doublon)", async () => {
    const { client, calls } = fakeClient();
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    await deleteAccountMessages(client, PEER, [...ids, 1, -3]);
    const reqs = calls as Api.channels.DeleteMessages[];
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toBeInstanceOf(Api.channels.DeleteMessages);
    expect((reqs[0]!.channel as Api.InputChannel).channelId.toString()).toBe("1234567890");
    expect(reqs.map((r) => r.id.length)).toEqual([100, 50]);
    await deleteAccountMessages(client, PEER, []);
    expect(calls).toHaveLength(2);
  });
});

describe("findPublishedStep : étape déjà publiée (Telegram répond RANDOM_ID_DUPLICATE)", () => {
  const T0 = 1_760_000_000; // secondes
  const notBefore = new Date(T0 * 1000);
  const msg = (
    id: number,
    date: number,
    message: string,
    over: Partial<ConstructorParameters<typeof Api.Message>[0]> = {},
  ) =>
    new Api.Message({
      id,
      peerId: new Api.PeerChannel({ channelId: big(1234567890) }),
      date,
      message,
      ...over,
    });
  const history = (messages: Api.TypeMessage[]) =>
    new Api.messages.ChannelMessages({
      pts: 1,
      count: messages.length,
      messages,
      topics: [],
      chats: [],
      users: [],
    });
  const photoMedia = () =>
    new Api.MessageMediaPhoto({
      photo: new Api.Photo({
        id: big(1),
        accessHash: big(1),
        fileReference: Buffer.from("r"),
        date: 0,
        sizes: [],
        dcId: 2,
      }),
    });
  const emojiEntity = (offset: number) =>
    new Api.MessageEntityCustomEmoji({ offset, length: 2, documentId: big(ID) });

  it("texte : le message identique publié depuis l'heure prévue, le plus récent, avec ses emojis gardés", async () => {
    const [step] = planAccountPost({
      html: `<b>Bonus</b> <tg-emoji emoji-id="${ID}">🎁</tg-emoji>`,
      mediaCount: 0,
      disableLinkPreview: true,
    });
    const { client, calls } = fakeClient((req) =>
      req instanceof Api.messages.GetHistory
        ? history([
            msg(52, T0 + 70, "Autre chose", { out: true }),
            msg(51, T0 + 60, "Bonus 🎁", { out: true, entities: [emojiEntity(6)] }),
            // Même texte, mais publié avant l'heure prévue : un ancien message, jamais pris.
            msg(10, T0 - 3600, "Bonus 🎁", { out: true }),
          ])
        : undefined,
    );
    const r = await findPublishedStep(client, PEER, step!, { notBefore });
    expect(r).toEqual({ ids: [51], customEmojiSent: 1, customEmojiKept: 1 });
    const req = calls[0] as Api.messages.GetHistory;
    expect(req).toBeInstanceOf(Api.messages.GetHistory);
    expect(req.peer).toBe(PEER);
    expect(req.limit).toBeGreaterThanOrEqual(20);
  });

  it("texte avec aperçu de lien : retrouvé ; un média avec la même légende n'est pas pris pour le texte", async () => {
    const [step] = planAccountPost({
      html: "Lien https://example.org",
      mediaCount: 0,
      disableLinkPreview: false,
    });
    const { client } = fakeClient((req) =>
      req instanceof Api.messages.GetHistory
        ? history([
            msg(61, T0 + 10, "Lien https://example.org", { media: photoMedia() }),
            msg(60, T0 + 5, "Lien https://example.org", {
              media: new Api.MessageMediaWebPage({ webpage: new Api.WebPageEmpty({ id: big(1) }) }),
            }),
          ])
        : undefined,
    );
    expect((await findPublishedStep(client, PEER, step!, { notBefore }))?.ids).toEqual([60]);
  });

  it("média avec légende et album : retrouvés d'après la légende (album complet, dans l'ordre)", async () => {
    const [media] = planAccountPost({
      html: "Photo du jour",
      mediaCount: 1,
      disableLinkPreview: true,
    });
    const [album] = planAccountPost({ html: "Album", mediaCount: 2, disableLinkPreview: true });
    const { client } = fakeClient((req) =>
      req instanceof Api.messages.GetHistory
        ? history([
            msg(73, T0 + 30, "", { media: photoMedia(), groupedId: big(9) }),
            msg(72, T0 + 30, "Album", { media: photoMedia(), groupedId: big(9) }),
            msg(71, T0 + 20, "Photo du jour", { media: photoMedia() }),
            // Album incomplet (un seul message du groupe) : pas celui de cette étape.
            msg(70, T0 + 10, "Album", { media: photoMedia(), groupedId: big(8) }),
          ])
        : undefined,
    );
    expect((await findPublishedStep(client, PEER, media!, { notBefore }))?.ids).toEqual([71]);
    expect(await findPublishedStep(client, PEER, album!, { notBefore })).toEqual({
      ids: [72, 73],
      customEmojiSent: 0,
      customEmojiKept: 0,
    });
  });

  it("introuvable ou déjà enregistré : null ; attente imposée : erreur typée", async () => {
    const [step] = planAccountPost({ html: "Bonus", mediaCount: 0, disableLinkPreview: true });
    const { client } = fakeClient((req) =>
      req instanceof Api.messages.GetHistory ? history([msg(80, T0 + 5, "Bonus")]) : undefined,
    );
    expect(await findPublishedStep(client, PEER, step!, { notBefore, exclude: [80] })).toBeNull();
    const empty = fakeClient((req) =>
      req instanceof Api.messages.GetHistory ? history([]) : undefined,
    ).client;
    expect(await findPublishedStep(empty, PEER, step!, { notBefore })).toBeNull();
    const flood = fakeClient(() => rpc("FLOOD_WAIT", { seconds: 12 })).client;
    await expect(findPublishedStep(flood, PEER, step!, { notBefore })).rejects.toBeInstanceOf(
      MtprotoFloodWait,
    );
  });
});
