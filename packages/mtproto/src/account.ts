/**
 * Compte Telegram connecté, phase 12 (emojis animés) :
 * - état pour publier : compte Premium (`user.premium`, lu par `users.getUsers` via getMe) et droit de publier dans
 *   chaque canal (créateur, ou administrateur avec « Publier des messages » ; dans un supergroupe, tout membre qui n'est
 *   pas restreint) ;
 * - packs d'emojis animés installés sur le compte (`messages.getEmojiStickers` puis `messages.getStickerSet`).
 * Lecture seule : rien n'est modifié côté Telegram.
 */
import { Api, helpers, type TelegramClient } from "telegram";
import { createClient, type MtprotoCredentials, type MtprotoUser } from "./client";
import {
  classifyError,
  describeRpcCode,
  MtprotoAuthError,
  MtprotoFloodWait,
  MtprotoRpcError,
} from "./errors";

/** Le compte peut-il publier dans ce canal ? `error` : raison en français quand il ne le peut pas. */
export type ChannelPostRight = { canPost: boolean; error: string | null };

export const NOT_ADMIN_MESSAGE =
  "Le compte Telegram connecté n'est pas administrateur de ce canal avec le droit de publier.";
export const NOT_MEMBER_MESSAGE =
  "Le compte Telegram connecté n'est pas dans ce canal : ajoutez-le comme administrateur avec le droit de publier.";
export const RESTRICTED_MESSAGE =
  "Le compte Telegram connecté n'a pas le droit d'écrire dans ce groupe.";

/** Droit de publier d'après l'entité du canal (dialogues du compte) ; null si ce n'est pas un canal. */
export function postRightFromChannelEntity(entity: unknown): ChannelPostRight | null {
  if (!(entity instanceof Api.Channel)) return null;
  if (entity.left) return { canPost: false, error: NOT_MEMBER_MESSAGE };
  if (entity.creator) return { canPost: true, error: null };
  const rights = entity.adminRights;
  const broadcast = entity.broadcast === true || entity.megagroup !== true;
  if (broadcast) {
    return rights?.postMessages
      ? { canPost: true, error: null }
      : { canPost: false, error: NOT_ADMIN_MESSAGE };
  }
  if (rights) return { canPost: true, error: null };
  if (entity.bannedRights?.sendMessages || entity.defaultBannedRights?.sendMessages)
    return { canPost: false, error: RESTRICTED_MESSAGE };
  return { canPost: true, error: null };
}

/** Droit de publier d'après la fiche de participant (`channels.getParticipant`). */
export function postRightFromParticipant(
  participant: unknown,
  channel: { broadcast: boolean; defaultSendBanned?: boolean },
): ChannelPostRight {
  if (participant instanceof Api.ChannelParticipantCreator) return { canPost: true, error: null };
  if (participant instanceof Api.ChannelParticipantAdmin) {
    if (!channel.broadcast) return { canPost: true, error: null };
    return participant.adminRights.postMessages
      ? { canPost: true, error: null }
      : { canPost: false, error: NOT_ADMIN_MESSAGE };
  }
  if (participant instanceof Api.ChannelParticipantLeft)
    return { canPost: false, error: NOT_MEMBER_MESSAGE };
  if (participant instanceof Api.ChannelParticipantBanned)
    return participant.bannedRights.sendMessages || participant.bannedRights.viewMessages
      ? { canPost: false, error: RESTRICTED_MESSAGE }
      : channel.broadcast
        ? { canPost: false, error: NOT_ADMIN_MESSAGE }
        : { canPost: true, error: null };
  // Membre ordinaire.
  if (channel.broadcast) return { canPost: false, error: NOT_ADMIN_MESSAGE };
  return channel.defaultSendBanned
    ? { canPost: false, error: RESTRICTED_MESSAGE }
    : { canPost: true, error: null };
}

/** Raison lisible d'une erreur Telegram sur un canal (le compte n'y a pas accès, canal introuvable…). */
function channelErrorRight(err: Error): ChannelPostRight {
  if (err instanceof MtprotoRpcError) {
    if (err.code === "USER_NOT_PARTICIPANT") return { canPost: false, error: NOT_MEMBER_MESSAGE };
    return { canPost: false, error: describeRpcCode(err.code) };
  }
  return { canPost: false, error: err.message };
}

export type AccountPublishInfo = {
  user: MtprotoUser;
  /** Compte Telegram Premium (indispensable pour publier des emojis animés). */
  premium: boolean;
  /** Par identifiant Telegram du canal (`-100…`, en chaîne). */
  channels: Record<string, ChannelPostRight>;
};

/** Client GramJS minimal pour lire l'état du compte (simulé dans les tests). */
export type AccountClient = Pick<
  TelegramClient,
  "invoke" | "getMe" | "getDialogs" | "getInputEntity"
>;

function toMtprotoUser(me: unknown): { user: MtprotoUser; premium: boolean } {
  if (me instanceof Api.User)
    return {
      user: {
        id: me.id.toString(),
        firstName: me.firstName ?? "",
        username: me.username ?? null,
        phone: me.phone ?? null,
      },
      premium: me.premium === true,
    };
  throw new MtprotoRpcError("USER_INVALID", "Compte Telegram connecté illisible.");
}

/**
 * Lit l'état du compte avec un client déjà connecté : Premium, puis le droit de publier dans chaque canal demandé.
 * Les dialogues du compte (500 derniers) donnent les droits d'un coup ; un canal absent des dialogues est vérifié par
 * `channels.getParticipant`. FLOOD_WAIT et session invalide arrêtent la lecture (levés) ; une autre erreur sur un canal
 * devient « ne peut pas publier » avec sa raison.
 */
export async function readAccountPublishInfo(
  client: AccountClient,
  telegramChatIds: readonly string[],
): Promise<AccountPublishInfo> {
  try {
    const { user, premium } = toMtprotoUser(await client.getMe());
    const channels: Record<string, ChannelPostRight> = {};
    const wanted = [...new Set(telegramChatIds.map(String))];
    if (wanted.length === 0) return { user, premium, channels };
    const byChatId = new Map<string, unknown>();
    const dialogs = await client.getDialogs({ limit: 500 });
    for (const d of dialogs) {
      const e = (d as { entity?: unknown }).entity;
      if (e instanceof Api.Channel) byChatId.set(`-100${e.id.toString()}`, e);
    }
    for (const chatId of wanted) {
      const fromDialog = postRightFromChannelEntity(byChatId.get(chatId));
      if (fromDialog) {
        channels[chatId] = fromDialog;
        continue;
      }
      try {
        const peer = await client.getInputEntity(Number(chatId));
        const res = await client.invoke(
          new Api.channels.GetParticipant({ channel: peer, participant: new Api.InputPeerSelf() }),
        );
        const chat = res.chats.find((c) => c instanceof Api.Channel) as Api.Channel | undefined;
        channels[chatId] = postRightFromParticipant(res.participant, {
          broadcast: chat ? chat.broadcast === true || chat.megagroup !== true : true,
          defaultSendBanned: chat?.defaultBannedRights?.sendMessages === true,
        });
      } catch (err) {
        const typed = classifyError(err);
        if (typed instanceof MtprotoFloodWait || typed instanceof MtprotoAuthError) throw typed;
        // GramJS sans le canal dans son cache : le compte n'y est pas (ou plus).
        if (!(typed instanceof MtprotoRpcError))
          channels[chatId] = { canPost: false, error: NOT_MEMBER_MESSAGE };
        else channels[chatId] = channelErrorRight(typed);
      }
    }
    return { user, premium, channels };
  } catch (err) {
    throw classifyError(err);
  }
}

/** État du compte pour publier (connexion dédiée, toujours fermée). L'appelant tient le verrou de la session. */
export async function getAccountPublishInfo(
  session: string,
  creds: MtprotoCredentials,
  telegramChatIds: readonly string[],
): Promise<AccountPublishInfo> {
  const client = createClient(session, creds.apiId, creds.apiHash);
  try {
    try {
      await client.connect();
    } catch (err) {
      throw classifyError(err);
    }
    return await readAccountPublishInfo(client, telegramChatIds);
  } finally {
    await client.disconnect().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
}

export type InstalledEmoji = {
  customEmojiId: string;
  /** Emoji standard de remplacement (`DocumentAttributeCustomEmoji.alt`). */
  fallback: string;
  format: "tgs" | "webm" | "webp" | null;
};

export type InstalledEmojiPack = { shortName: string; title: string; emojis: InstalledEmoji[] };

/** Format d'un emoji animé d'après le type de son fichier. */
export function emojiFormatOfMime(mime: string | undefined): InstalledEmoji["format"] {
  if (mime === "application/x-tgsticker") return "tgs";
  if (mime === "video/webm") return "webm";
  if (mime === "image/webp") return "webp";
  return null;
}

/** Emoji animé d'un document de pack (identifiant = `document.id`, remplacement = `alt`) ; null sinon. */
export function emojiFromDocument(doc: unknown): InstalledEmoji | null {
  if (!(doc instanceof Api.Document)) return null;
  const attr = doc.attributes.find((a) => a instanceof Api.DocumentAttributeCustomEmoji) as
    Api.DocumentAttributeCustomEmoji | undefined;
  if (!attr) return null;
  const id = doc.id.toString();
  if (!/^\d{1,20}$/.test(id) || id === "0") return null;
  return { customEmojiId: id, fallback: attr.alt || "⭐", format: emojiFormatOfMime(doc.mimeType) };
}

export type InstalledPacksResult = {
  packs: InstalledEmojiPack[];
  /** Packs installés sur le compte (tous, même ceux pas encore lus). */
  total: number;
  /** Packs sautés sans appel à Telegram (déjà complets dans la bibliothèque, d'après `skipPack`). */
  skippedPacks: number;
  /** Lecture arrêtée par Telegram (FLOOD_WAIT trop long) : attente demandée, en secondes ; null si tout est lu. */
  floodWaitSeconds: number | null;
};

/** Attente maximale acceptée en cours de lecture (au-delà, on s'arrête et on reprend plus tard). */
export const PACKS_FLOOD_SLEEP_MAX_S = 30;

export type InstalledPacksOptions = {
  maxPacks?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Pack à ne pas relire (ex. déjà complet dans la bibliothèque : autant d'emojis que `count`). Une reprise après une
   * attente imposée repart ainsi là où la lecture s'était arrêtée, au lieu de relire les mêmes packs à chaque fois.
   */
  skipPack?: (pack: { shortName: string; count: number }) => boolean;
};

/**
 * Packs d'emojis animés installés sur le compte et leurs emojis, avec un client déjà connecté. Un pack introuvable est
 * sauté, comme un pack que `skipPack` écarte ; une attente courte imposée par Telegram est respectée sur place (une fois
 * par pack), une attente longue arrête la lecture avec ce qui a été lu (`floodWaitSeconds`).
 */
export async function readInstalledEmojiPacks(
  client: Pick<TelegramClient, "invoke">,
  opts: InstalledPacksOptions = {},
): Promise<InstalledPacksResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxPacks = opts.maxPacks ?? 200;
  let all: unknown;
  try {
    all = await client.invoke(new Api.messages.GetEmojiStickers({ hash: helpers.returnBigInt(0) }));
  } catch (err) {
    throw classifyError(err);
  }
  const sets =
    all instanceof Api.messages.AllStickers
      ? all.sets.filter((s) => s instanceof Api.StickerSet)
      : [];
  const packs: InstalledEmojiPack[] = [];
  let skippedPacks = 0;
  for (const set of sets.slice(0, maxPacks)) {
    if (opts.skipPack?.({ shortName: set.shortName, count: set.count })) {
      skippedPacks++;
      continue;
    }
    let res: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await client.invoke(
          new Api.messages.GetStickerSet({
            stickerset: new Api.InputStickerSetID({ id: set.id, accessHash: set.accessHash }),
            hash: 0,
          }),
        );
        break;
      } catch (err) {
        const typed = classifyError(err);
        if (typed instanceof MtprotoFloodWait) {
          if (attempt === 0 && typed.seconds <= PACKS_FLOOD_SLEEP_MAX_S) {
            await sleep(typed.seconds * 1000 + 500);
            continue;
          }
          return { packs, total: sets.length, skippedPacks, floodWaitSeconds: typed.seconds };
        }
        if (typed instanceof MtprotoAuthError) throw typed;
        res = null; // pack supprimé ou illisible : on passe au suivant
        break;
      }
    }
    if (!(res instanceof Api.messages.StickerSet)) continue;
    const emojis = res.documents
      .map(emojiFromDocument)
      .filter((e): e is InstalledEmoji => e !== null);
    if (emojis.length === 0) continue;
    const meta = res.set instanceof Api.StickerSet ? res.set : set;
    packs.push({ shortName: meta.shortName, title: meta.title, emojis });
  }
  return { packs, total: sets.length, skippedPacks, floodWaitSeconds: null };
}

/** Packs d'emojis animés installés (connexion dédiée, toujours fermée). L'appelant tient le verrou de la session. */
export async function listInstalledEmojiPacks(
  session: string,
  creds: MtprotoCredentials,
  opts: InstalledPacksOptions = {},
): Promise<InstalledPacksResult> {
  const client = createClient(session, creds.apiId, creds.apiHash);
  try {
    try {
      await client.connect();
    } catch (err) {
      throw classifyError(err);
    }
    return await readInstalledEmojiPacks(client, opts);
  } finally {
    await client.disconnect().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
}
