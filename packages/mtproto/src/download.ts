/**
 * Phase 28 — téléchargement d'un gros fichier (vidéo longue du client, short de plus de 20 Mo) par le compte Telegram
 * connecté : l'API Bot s'arrête à 20 Mo, le compte de l'admin lit sa propre conversation avec Kevin (ou le canal
 * « Médiathèque ») et écrit le fichier en continu sur le disque.
 *
 * - Le message est relu par son identifiant ; dans une conversation privée, les numéros de message du bot et du compte
 *   diffèrent : si le message trouvé n'a pas le bon poids, les 300 derniers messages de la conversation sont parcourus
 *   pour trouver le fichier du même poids.
 * - Reprise : `<dest>.part` déjà là → repris au dernier bloc de 512 Kio complet (un téléchargement coupé ne repart pas
 *   de zéro) ; renommé en `dest` à la fin, poids vérifié.
 * L'appelant tient le verrou `withMtprotoLock` (une seule connexion MTProto à la fois entre le site et le worker).
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, truncate } from "node:fs/promises";
import { dirname } from "node:path";
import { Api, helpers, type TelegramClient } from "telegram";
import { channelIdToNumber } from "./batches";
import { createClient, resolveChannelPeer, type MtprotoCredentials } from "./client";
import { classifyError } from "./errors";

/** Bloc de téléchargement (le plus grand permis par Telegram). */
export const DOWNLOAD_CHUNK_BYTES = 512 * 1024;
/** Messages parcourus au plus pour retrouver un fichier par son poids. */
export const DOWNLOAD_SEARCH_LIMIT = 300;

/** Sous-ensemble du client GramJS utilisé (faux en test). */
export type DownloadClient = {
  getMessages(peer: unknown, opts: { ids?: number[]; limit?: number }): Promise<ArrayLike<Api.Message | undefined>>;
  iterDownload(params: { file: Api.TypeMessageMedia; offset?: ReturnType<typeof helpers.returnBigInt>; requestSize: number; fileSize?: ReturnType<typeof helpers.returnBigInt> }): AsyncIterable<Buffer>;
};

/** Poids du fichier d'un message (document ou vidéo), null sans fichier. */
export function mediaSizeOf(msg: Api.Message | undefined | null): number | null {
  const media = msg?.media;
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) return Number(media.document.size);
  return null;
}

/** Message qui porte le fichier : par identifiant (poids vérifié s'il est connu), sinon par poids dans l'historique. */
export async function findMediaMessage(
  client: DownloadClient,
  peer: unknown,
  input: { messageId: number; sizeBytes?: number | null; searchLimit?: number; idsReliable?: boolean },
): Promise<Api.Message | null> {
  const byId = Array.from(await client.getMessages(peer, { ids: [input.messageId] }))[0];
  const size = mediaSizeOf(byId);
  // Hors canal, le numéro vient du bot (il ne vaut pas pour le compte, et `messages.getMessages` lit TOUTES les
  // conversations du compte) : sans poids connu, on ne prend jamais le fichier d'un autre message.
  if (byId && size !== null && (input.sizeBytes ? size === input.sizeBytes : input.idsReliable === true)) return byId;
  if (!input.sizeBytes) return null;
  const recent = Array.from(await client.getMessages(peer, { limit: input.searchLimit ?? DOWNLOAD_SEARCH_LIMIT }));
  return recent.find((m) => m && mediaSizeOf(m) === input.sizeBytes) ?? null;
}

async function sizeOf(path: string): Promise<number> {
  return stat(path)
    .then((s) => s.size)
    .catch(() => 0);
}

/** Écrit le fichier du message dans `dest` (reprise depuis `<dest>.part`). Rend le poids écrit. */
export async function downloadMessageMediaTo(client: DownloadClient, msg: Api.Message, dest: string): Promise<number> {
  const total = mediaSizeOf(msg);
  if (total === null || !msg.media) throw new Error("ce message ne porte pas de fichier");
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let offset = Math.floor((await sizeOf(part)) / DOWNLOAD_CHUNK_BYTES) * DOWNLOAD_CHUNK_BYTES;
  if (offset > total) offset = 0;
  if ((await sizeOf(part)) > 0) await truncate(part, offset);
  const out = createWriteStream(part, { flags: offset > 0 ? "a" : "w" });
  const done = new Promise<void>((resolve, reject) => {
    out.on("finish", () => resolve());
    out.on("error", reject);
  });
  let written = offset;
  try {
    if (offset < total) {
      for await (const chunk of client.iterDownload({
        file: msg.media,
        offset: helpers.returnBigInt(offset),
        requestSize: DOWNLOAD_CHUNK_BYTES,
        fileSize: helpers.returnBigInt(total),
      })) {
        const buf = written + chunk.length > total ? chunk.subarray(0, total - written) : chunk;
        if (!out.write(buf)) await new Promise<void>((r) => out.once("drain", () => r()));
        written += buf.length;
        if (written >= total) break;
      }
    }
  } finally {
    out.end();
    await done;
  }
  if (written !== total) throw new Error(`téléchargement incomplet (${written} octets sur ${total}) : il reprendra où il s'est arrêté`);
  await rename(part, dest);
  return written;
}

export type AccountDownloadInput = {
  session: string;
  /** Conversation : nom d'utilisateur du bot (privé de l'admin avec Kevin) ou identifiant `-100…` (groupe, canal). */
  peer: string;
  messageId: number;
  sizeBytes?: number | null;
  dest: string;
};

/** Connexion, recherche du message, téléchargement, déconnexion (toujours). */
export async function downloadAccountMedia(input: AccountDownloadInput, creds: MtprotoCredentials): Promise<number> {
  const client: TelegramClient = createClient(input.session, creds.apiId, creds.apiHash);
  try {
    await client.connect();
    const peer = /^-100\d+$/.test(input.peer)
      ? await resolveChannelPeer(client, channelIdToNumber(input.peer))
      : /^-?\d+$/.test(input.peer)
        ? await client.getInputEntity(Number(input.peer))
        : await client.getInputEntity(input.peer.replace(/^@/, ""));
    const dl = client as unknown as DownloadClient;
    const msg = await findMediaMessage(dl, peer, { messageId: input.messageId, sizeBytes: input.sizeBytes ?? null, idsReliable: /^-100\d+$/.test(input.peer) });
    if (!msg) throw new Error("vidéo introuvable dans la conversation du compte connecté (message supprimé ?)");
    return await downloadMessageMediaTo(dl, msg, input.dest);
  } catch (err) {
    if (err instanceof Error && /introuvable|incomplet|ne porte pas/.test(err.message)) throw err;
    throw classifyError(err);
  } finally {
    await client.disconnect().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
}
