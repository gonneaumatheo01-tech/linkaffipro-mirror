/**
 * Publication d'un message de canal par le compte Telegram connecté (phase 12) : Telegram interdit les emojis animés
 * aux bots dans les canaux, un message qui en contient est donc publié par le compte (MTProto, GramJS), sans boutons.
 *
 * - texte seul → `messages.sendMessage` (texte + entités, aperçu de lien selon le message) ;
 * - un média → `messages.sendMedia` avec la légende (≤ 1024) ; légende trop longue : média seul puis texte ;
 * - plusieurs médias → `messages.uploadMedia` pour chacun puis `messages.sendMultiMedia` (album de 10 au plus, légende
 *   sur le premier) ; légende trop longue : album sans légende puis texte ;
 * - toujours silencieux si demandé ; épingler, désépingler les précédents et supprimer par la même session.
 *
 * Le « contenu protégé » d'un message n'existe que pour les bots (`noforwards` : « Only for bots ») : il n'est pas
 * envoyé par le compte (la protection du canal entier se règle dans Telegram).
 * Chaque envoi porte un `random_id` déterministe (message, tentative, étape, élément) : Telegram refuse un second envoi
 * identique (RANDOM_ID_DUPLICATE) au lieu de publier un doublon ; `findPublishedStep` retrouve alors les messages déjà
 * publiés de cette étape dans le canal.
 */
import { createHash } from "node:crypto";
import { Api, helpers, type TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import { channelIdToNumber } from "./batches";
import { createClient, resolveChannelPeer, type MtprotoCredentials } from "./client";
import { classifyError, MtprotoRpcError } from "./errors";
import { parseTelegramHtml, type ParsedTelegramText, type TextEntitySpec } from "./html-entities";

/** Longueur maximale d'un texte et d'une légende (unités UTF-16, comme Telegram). */
export const ACCOUNT_TEXT_MAX = 4096;
export const ACCOUNT_CAPTION_MAX = 1024;
/** Médias par album (limite Telegram). */
export const ACCOUNT_ALBUM_MAX = 10;
/** `channels.deleteMessages` : identifiants par appel. */
const DELETE_BATCH = 100;

export type AccountMediaKind = "photo" | "video" | "animation" | "document";

/** Média à publier (octets en mémoire, comme `MediaAsset`). */
export type AccountMedia = {
  kind: AccountMediaKind;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
};

/** Étape d'une publication : chaque étape est un appel Telegram (un message, ou un album). */
export type AccountPostStep =
  | { kind: "text"; text: ParsedTelegramText; noWebpage: boolean }
  | { kind: "media"; mediaIndex: number; caption: ParsedTelegramText | null }
  | { kind: "album"; mediaIndexes: number[]; caption: ParsedTelegramText | null };

/** Message impossible à publier tel quel (texte vide ou trop long) : erreur définitive, message en français. */
export class AccountPostInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountPostInvalid";
  }
}

/**
 * Plan d'envoi d'un message de canal par le compte (fonction pure). Même découpage que l'envoi par le bot, sans boutons :
 * légende sur le média si elle tient (≤ 1024), sinon média(s) puis texte.
 */
export function planAccountPost(input: {
  html: string;
  mediaCount: number;
  disableLinkPreview: boolean;
}): AccountPostStep[] {
  const parsed = parseTelegramHtml(input.html);
  const len = parsed.text.length;
  const mediaCount = Math.max(0, Math.floor(input.mediaCount));
  if (len > ACCOUNT_TEXT_MAX)
    throw new AccountPostInvalid(
      `Texte trop long pour Telegram : ${len} caractères, maximum ${ACCOUNT_TEXT_MAX}.`,
    );
  if (mediaCount === 0) {
    if (len === 0) throw new AccountPostInvalid("Message vide : ajoutez un texte ou un média.");
    return [{ kind: "text", text: parsed, noWebpage: input.disableLinkPreview }];
  }
  const fits = len <= ACCOUNT_CAPTION_MAX;
  const caption = len > 0 && fits ? parsed : null;
  const tail: AccountPostStep[] =
    len > 0 && !fits ? [{ kind: "text", text: parsed, noWebpage: true }] : [];
  if (mediaCount === 1) return [{ kind: "media", mediaIndex: 0, caption }, ...tail];
  const indexes = Array.from({ length: Math.min(mediaCount, ACCOUNT_ALBUM_MAX) }, (_, i) => i);
  return [{ kind: "album", mediaIndexes: indexes, caption }, ...tail];
}

/** Nombre de messages Telegram produits par une étape (un album = un message par média). */
export function stepMessageCount(step: AccountPostStep): number {
  return step.kind === "album" ? step.mediaIndexes.length : 1;
}

/**
 * Étapes déjà faites d'après les messages déjà publiés (reprise après une attente imposée par Telegram) : on saute les
 * étapes dont tous les messages sont déjà là. -1 si le compte ne correspond à aucune frontière d'étape (incohérent).
 */
export function stepsAlreadyDone(steps: readonly AccountPostStep[], alreadySent: number): number {
  if (alreadySent <= 0) return 0;
  let total = 0;
  for (let i = 0; i < steps.length; i++) {
    total += stepMessageCount(steps[i]!);
    if (total === alreadySent) return i + 1;
    if (total > alreadySent) return -1;
  }
  return -1;
}

/** Identifiant d'envoi déterministe (entier 64 bits signé, jamais 0) à partir d'une graine. */
export function deterministicRandomId(seed: string): bigint {
  const v = createHash("sha256").update(seed).digest().readBigInt64BE(0);
  return v === 0n ? 1n : v;
}

/** Entités du paquet → entités GramJS (MTProto). */
export function toMtprotoEntities(entities: readonly TextEntitySpec[]): Api.TypeMessageEntity[] {
  const out: Api.TypeMessageEntity[] = [];
  for (const e of entities) {
    const pos = { offset: e.offset, length: e.length };
    switch (e.type) {
      case "bold":
        out.push(new Api.MessageEntityBold(pos));
        break;
      case "italic":
        out.push(new Api.MessageEntityItalic(pos));
        break;
      case "underline":
        out.push(new Api.MessageEntityUnderline(pos));
        break;
      case "strikethrough":
        out.push(new Api.MessageEntityStrike(pos));
        break;
      case "spoiler":
        out.push(new Api.MessageEntitySpoiler(pos));
        break;
      case "code":
        out.push(new Api.MessageEntityCode(pos));
        break;
      case "pre":
        out.push(new Api.MessageEntityPre({ ...pos, language: e.language ?? "" }));
        break;
      case "text_link":
        if (e.url) out.push(new Api.MessageEntityTextUrl({ ...pos, url: e.url }));
        break;
      case "blockquote":
        out.push(
          new Api.MessageEntityBlockquote({ ...pos, ...(e.collapsed ? { collapsed: true } : {}) }),
        );
        break;
      case "custom_emoji":
        if (e.customEmojiId)
          out.push(
            new Api.MessageEntityCustomEmoji({
              ...pos,
              documentId: helpers.returnBigInt(e.customEmojiId),
            }),
          );
        break;
    }
  }
  return out;
}

/** Client GramJS minimal pour publier (simulé dans les tests). */
export type PublishClient = Pick<TelegramClient, "invoke" | "uploadFile">;

/** Résultat d'une étape : identifiants des messages publiés, emojis animés envoyés et gardés par Telegram. */
export type AccountStepResult = {
  ids: number[];
  /** Emojis animés envoyés dans cette étape. */
  customEmojiSent: number;
  /** Emojis animés présents dans le message publié (null si Telegram ne l'a pas renvoyé). */
  customEmojiKept: number | null;
};

/**
 * Identifiants des messages publiés, dans l'ordre des `randomIds` envoyés, et messages renvoyés par Telegram (pour
 * vérifier les emojis animés). Réponse d'un canal : `Updates` avec `UpdateMessageID` (random_id → id) et
 * `UpdateNewChannelMessage` ; réponse courte : `UpdateShortSentMessage`.
 */
export function sentMessagesOf(
  result: unknown,
  randomIds: readonly string[],
): { ids: number[]; entities: Api.TypeMessageEntity[][] | null } {
  if (result instanceof Api.UpdateShortSentMessage)
    return { ids: [result.id], entities: result.entities ? [result.entities] : null };
  const updates =
    result instanceof Api.Updates || result instanceof Api.UpdatesCombined ? result.updates : [];
  const byRandom = new Map<string, number>();
  const messages = new Map<number, Api.Message>();
  for (const u of updates) {
    if (u instanceof Api.UpdateMessageID && u.randomId !== undefined)
      byRandom.set(String(u.randomId), u.id);
    if (
      (u instanceof Api.UpdateNewChannelMessage || u instanceof Api.UpdateNewMessage) &&
      u.message instanceof Api.Message
    )
      messages.set(u.message.id, u.message);
  }
  let ids = randomIds.map((r) => byRandom.get(r)).filter((n): n is number => typeof n === "number");
  if (ids.length < randomIds.length) {
    // Repli : messages nouveaux, du plus ancien au plus récent.
    const fallback = [...messages.keys()].sort((a, b) => a - b);
    if (fallback.length > ids.length) ids = fallback;
  }
  const found = ids.map((id) => messages.get(id));
  const entities = found.every((m) => m !== undefined)
    ? found.map((m) => (m as Api.Message).entities ?? [])
    : null;
  return { ids, entities: ids.length > 0 ? entities : null };
}

function countCustomEmoji(entities: readonly Api.TypeMessageEntity[]): number {
  return entities.filter((e) => e instanceof Api.MessageEntityCustomEmoji).length;
}

/** Envoie un média au serveur et renvoie la forme « à publier » (photo ou document avec ses attributs). */
async function uploadedMedia(client: PublishClient, m: AccountMedia): Promise<Api.TypeInputMedia> {
  const buffer = Buffer.from(m.bytes.buffer, m.bytes.byteOffset, m.bytes.byteLength);
  const file = await client.uploadFile({
    file: new CustomFile(m.filename, buffer.byteLength, "", buffer),
    workers: 1,
  });
  const fileName = new Api.DocumentAttributeFilename({ fileName: m.filename });
  switch (m.kind) {
    case "photo":
      return new Api.InputMediaUploadedPhoto({ file });
    case "video":
      return new Api.InputMediaUploadedDocument({
        file,
        mimeType: m.mimeType,
        attributes: [
          new Api.DocumentAttributeVideo({
            supportsStreaming: true,
            duration: m.duration ?? 0,
            w: m.width ?? 1,
            h: m.height ?? 1,
          }),
          fileName,
        ],
      });
    case "animation":
      return new Api.InputMediaUploadedDocument({
        file,
        mimeType: m.mimeType,
        attributes: [new Api.DocumentAttributeAnimated(), fileName],
      });
    default:
      return new Api.InputMediaUploadedDocument({
        file,
        mimeType: m.mimeType || "application/octet-stream",
        attributes: [fileName],
        forceFile: true,
      });
  }
}

/** Média déjà sur le serveur (réponse de `messages.uploadMedia`) → forme acceptée dans un album. */
export function albumInputMedia(media: unknown): Api.TypeInputMedia {
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo)
    return new Api.InputMediaPhoto({
      id: new Api.InputPhoto({
        id: media.photo.id,
        accessHash: media.photo.accessHash,
        fileReference: media.photo.fileReference,
      }),
    });
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document)
    return new Api.InputMediaDocument({
      id: new Api.InputDocument({
        id: media.document.id,
        accessHash: media.document.accessHash,
        fileReference: media.document.fileReference,
      }),
    });
  throw new MtprotoRpcError("MEDIA_INVALID");
}

export type AccountSendOptions = {
  silent: boolean;
  /** Graine des identifiants d'envoi (ex. `post:<id>:<tentative>:<étape>`) ; l'élément d'album est ajouté. */
  randomSeed: string;
};

/** Publie une étape dans le canal `peer`. Les erreurs Telegram sont converties (FLOOD_WAIT, session, code lisible). */
export async function sendAccountStep(
  client: PublishClient,
  peer: Api.TypeInputPeer,
  step: AccountPostStep,
  medias: readonly AccountMedia[],
  opts: AccountSendOptions,
): Promise<AccountStepResult> {
  try {
    const silent = opts.silent ? { silent: true } : {};
    if (step.kind === "text") {
      const rid = deterministicRandomId(`${opts.randomSeed}:0`);
      const res = await client.invoke(
        new Api.messages.SendMessage({
          peer,
          message: step.text.text,
          entities: toMtprotoEntities(step.text.entities),
          randomId: helpers.returnBigInt(rid),
          ...(step.noWebpage ? { noWebpage: true } : {}),
          ...silent,
        }),
      );
      return result(res, [rid], step.text);
    }
    if (step.kind === "media") {
      const m = medias[step.mediaIndex];
      if (!m) throw new MtprotoRpcError("MEDIA_EMPTY");
      const media = await uploadedMedia(client, m);
      const rid = deterministicRandomId(`${opts.randomSeed}:0`);
      const res = await client.invoke(
        new Api.messages.SendMedia({
          peer,
          media,
          message: step.caption?.text ?? "",
          entities: step.caption ? toMtprotoEntities(step.caption.entities) : [],
          randomId: helpers.returnBigInt(rid),
          ...silent,
        }),
      );
      return result(res, [rid], step.caption);
    }
    const items: Api.InputSingleMedia[] = [];
    const rids: bigint[] = [];
    for (const [i, idx] of step.mediaIndexes.entries()) {
      const m = medias[idx];
      if (!m) continue;
      const uploaded = await client.invoke(
        new Api.messages.UploadMedia({ peer, media: await uploadedMedia(client, m) }),
      );
      const rid = deterministicRandomId(`${opts.randomSeed}:${i}`);
      rids.push(rid);
      const withCaption = items.length === 0 && step.caption;
      items.push(
        new Api.InputSingleMedia({
          media: albumInputMedia(uploaded),
          randomId: helpers.returnBigInt(rid),
          message: withCaption ? step.caption!.text : "",
          ...(withCaption ? { entities: toMtprotoEntities(step.caption!.entities) } : {}),
        }),
      );
    }
    if (items.length === 0) throw new MtprotoRpcError("MEDIA_EMPTY");
    const res = await client.invoke(
      new Api.messages.SendMultiMedia({ peer, multiMedia: items, ...silent }),
    );
    return result(res, rids, step.caption);
  } catch (err) {
    throw classifyError(err);
  }
}

function result(res: unknown, rids: bigint[], text: ParsedTelegramText | null): AccountStepResult {
  const sent = sentMessagesOf(
    res,
    rids.map((r) => r.toString()),
  );
  const customEmojiSent = text ? text.entities.filter((e) => e.type === "custom_emoji").length : 0;
  const customEmojiKept = sent.entities
    ? sent.entities.reduce((n, list) => n + countCustomEmoji(list), 0)
    : null;
  return { ids: sent.ids, customEmojiSent, customEmojiKept };
}

/** Derniers messages du canal relus pour retrouver une étape déjà publiée. */
export const FIND_PUBLISHED_HISTORY_LIMIT = 40;

/** Texte tel que Telegram le garde (espaces de début et de fin retirés, fins de ligne unifiées). */
function normalizedText(text: string | undefined | null): string {
  return (text ?? "").replace(/\r\n?/g, "\n").trim();
}

function hasRealMedia(m: Api.Message): boolean {
  // Un aperçu de lien est un « média » pour Telegram, mais le message reste un texte.
  return m.media !== undefined && m.media !== null && !(m.media instanceof Api.MessageMediaWebPage);
}

/**
 * Retrouve dans le canal les messages d'une étape déjà publiée : Telegram a répondu RANDOM_ID_DUPLICATE (un essai
 * précédent est parti, mais la réponse s'est perdue, par exemple une coupure réseau). Relit les derniers messages
 * (`messages.getHistory`) et cherche, parmi ceux publiés depuis `notBefore` et absents de `exclude`, le plus récent qui
 * correspond : même texte pour un texte (aperçu de lien accepté), même légende pour un média seul, album complet (même
 * nombre de messages) avec la même légende. Les messages publiés par le compte passent en premier. Null si rien ne
 * correspond. FLOOD_WAIT et session invalide sont levés (typés).
 */
export async function findPublishedStep(
  client: Pick<TelegramClient, "invoke">,
  peer: Api.TypeInputPeer,
  step: AccountPostStep,
  opts: { notBefore: Date; exclude?: readonly number[]; limit?: number },
): Promise<AccountStepResult | null> {
  let res: unknown;
  try {
    res = await client.invoke(
      new Api.messages.GetHistory({
        peer,
        offsetId: 0,
        offsetDate: 0,
        addOffset: 0,
        limit: opts.limit ?? FIND_PUBLISHED_HISTORY_LIMIT,
        maxId: 0,
        minId: 0,
        hash: helpers.returnBigInt(0),
      }),
    );
  } catch (err) {
    throw classifyError(err);
  }
  const list =
    res instanceof Api.messages.Messages ||
    res instanceof Api.messages.MessagesSlice ||
    res instanceof Api.messages.ChannelMessages
      ? res.messages
      : [];
  const since = Math.floor(opts.notBefore.getTime() / 1000);
  const excluded = new Set(opts.exclude ?? []);
  const recent = list
    .filter((m): m is Api.Message => m instanceof Api.Message)
    .filter((m) => m.date >= since && !excluded.has(m.id))
    // Ceux publiés par le compte connecté d'abord, puis du plus récent au plus ancien.
    .sort((a, b) => Number(b.out === true) - Number(a.out === true) || b.id - a.id);

  const caption = step.kind === "text" ? step.text : step.caption;
  const expected = normalizedText(caption?.text);
  let found: Api.Message[] | null = null;
  if (step.kind === "text") {
    const m = recent.find((x) => !hasRealMedia(x) && normalizedText(x.message) === expected);
    found = m ? [m] : null;
  } else if (step.kind === "media") {
    const m = recent.find(
      (x) => hasRealMedia(x) && !x.groupedId && normalizedText(x.message) === expected,
    );
    found = m ? [m] : null;
  } else {
    const groups = new Map<string, Api.Message[]>();
    for (const m of recent) {
      if (!m.groupedId || !hasRealMedia(m)) continue;
      const key = m.groupedId.toString();
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    for (const g of groups.values()) {
      if (g.length !== step.mediaIndexes.length) continue;
      const sorted = [...g].sort((a, b) => a.id - b.id);
      const text = normalizedText(sorted.find((m) => normalizedText(m.message))?.message);
      if (text === expected) {
        found = sorted;
        break;
      }
    }
  }
  if (!found) return null;
  return {
    ids: found.map((m) => m.id),
    customEmojiSent: caption ? caption.entities.filter((e) => e.type === "custom_emoji").length : 0,
    customEmojiKept: found.reduce((n, m) => n + countCustomEmoji(m.entities ?? []), 0),
  };
}

/** Épingle un message, sans notification (`messages.updatePinnedMessage`). */
export async function pinAccountMessage(
  client: PublishClient,
  peer: Api.TypeInputPeer,
  id: number,
): Promise<void> {
  try {
    await client.invoke(new Api.messages.UpdatePinnedMessage({ peer, id, silent: true }));
  } catch (err) {
    throw classifyError(err);
  }
}

/**
 * Désépingle tous les messages du canal (`messages.unpinAllMessages`). Telegram peut traiter l'historique par morceaux :
 * tant que `offset` n'est pas nul, on rappelle la méthode (10 fois au plus).
 */
export async function unpinAllAccountMessages(
  client: PublishClient,
  peer: Api.TypeInputPeer,
): Promise<void> {
  try {
    for (let i = 0; i < 10; i++) {
      const res = await client.invoke(new Api.messages.UnpinAllMessages({ peer }));
      if (!(res instanceof Api.messages.AffectedHistory) || !res.offset) return;
    }
  } catch (err) {
    const typed = classifyError(err);
    // Rien d'épinglé : pas une erreur.
    if (typed instanceof MtprotoRpcError && typed.code === "CHAT_NOT_MODIFIED") return;
    throw typed;
  }
}

function inputChannelOf(peer: Api.TypeInputPeer): Api.InputChannel {
  if (peer instanceof Api.InputPeerChannel)
    return new Api.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash });
  throw new MtprotoRpcError("CHANNEL_INVALID");
}

/** Supprime des messages du canal (`channels.deleteMessages`, lots de 100). */
export async function deleteAccountMessages(
  client: PublishClient,
  peer: Api.TypeInputPeer,
  ids: readonly number[],
): Promise<void> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (clean.length === 0) return;
  try {
    const channel = inputChannelOf(peer);
    for (let i = 0; i < clean.length; i += DELETE_BATCH)
      await client.invoke(
        new Api.channels.DeleteMessages({ channel, id: clean.slice(i, i + DELETE_BATCH) }),
      );
  } catch (err) {
    throw classifyError(err);
  }
}

/** Canal ouvert avec le compte connecté : publier, épingler, désépingler, supprimer (une seule connexion). */
export type AccountChannel = {
  send(
    step: AccountPostStep,
    medias: readonly AccountMedia[],
    opts: AccountSendOptions,
  ): Promise<AccountStepResult>;
  /** Messages d'une étape déjà publiée (Telegram a répondu RANDOM_ID_DUPLICATE), null si introuvable. */
  findPublished(
    step: AccountPostStep,
    opts: { notBefore: Date; exclude?: readonly number[] },
  ): Promise<AccountStepResult | null>;
  pin(id: number): Promise<void>;
  unpinAll(): Promise<void>;
  deleteMessages(ids: readonly number[]): Promise<void>;
};

/**
 * Ouvre une connexion avec la session du compte, résout le canal, exécute `fn`, déconnecte toujours. Les erreurs de
 * connexion et de canal sont converties (FLOOD_WAIT, session expirée…) ; celles de `fn` remontent telles quelles (les
 * opérations du canal convertissent déjà les leurs). L'appelant tient le verrou de la session (`withMtprotoLock`).
 */
export async function withAccountChannel<T>(
  input: { session: string; channelId: bigint | number | string },
  creds: MtprotoCredentials,
  fn: (channel: AccountChannel) => Promise<T>,
): Promise<T> {
  const client = createClient(input.session, creds.apiId, creds.apiHash);
  try {
    let peer: Api.TypeInputPeer;
    try {
      await client.connect();
      peer = await resolveChannelPeer(client, channelIdToNumber(input.channelId));
    } catch (err) {
      throw classifyError(err);
    }
    return await fn({
      send: (step, medias, opts) => sendAccountStep(client, peer, step, medias, opts),
      findPublished: (step, opts) => findPublishedStep(client, peer, step, opts),
      pin: (id) => pinAccountMessage(client, peer, id),
      unpinAll: () => unpinAllAccountMessages(client, peer),
      deleteMessages: (ids) => deleteAccountMessages(client, peer, ids),
    });
  } finally {
    await client.disconnect().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
}
