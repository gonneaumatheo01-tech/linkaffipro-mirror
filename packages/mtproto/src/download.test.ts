import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Api, helpers } from "telegram";
import { DOWNLOAD_CHUNK_BYTES, downloadMessageMediaTo, findMediaMessage, mediaSizeOf, type DownloadClient } from "./download";

const big = helpers.returnBigInt;

function videoMessage(id: number, size: number): Api.Message {
  const document = new Api.Document({
    id: big(id),
    accessHash: big(1),
    fileReference: Buffer.alloc(0),
    date: 0,
    mimeType: "video/mp4",
    size: big(size),
    dcId: 2,
    attributes: [],
  });
  return new Api.Message({ id, peerId: new Api.PeerUser({ userId: big(1) }), date: 0, message: "", media: new Api.MessageMediaDocument({ document }) });
}

function content(size: number): Buffer {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = i % 251;
  return b;
}

function fakeClient(messages: Api.Message[], data: Buffer, opts: { cutAfter?: number } = {}) {
  const offsets: number[] = [];
  let served = 0;
  const client: DownloadClient = {
    async getMessages(_peer, o) {
      if (o.ids) return o.ids.map((id) => messages.find((m) => m.id === id));
      return messages.slice(0, o.limit);
    },
    iterDownload(p) {
      const start = Number(p.offset ?? 0);
      offsets.push(start);
      return (async function* () {
        for (let at = start; at < data.length; at += p.requestSize) {
          if (opts.cutAfter !== undefined && served >= opts.cutAfter) throw new Error("connexion coupée");
          served++;
          yield data.subarray(at, Math.min(data.length, at + p.requestSize));
        }
      })();
    },
  };
  return { client, offsets };
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lap-mtproto-dl-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("téléchargement par le compte connecté", () => {
  it("retrouve le fichier par son poids quand les numéros de message diffèrent (conversation privée)", async () => {
    const size = 25 * 1024 * 1024;
    const msgs = [videoMessage(900, 1234), videoMessage(901, size), videoMessage(77, 999)];
    const { client } = fakeClient(msgs, Buffer.alloc(0));
    expect((await findMediaMessage(client, "kevbot", { messageId: 77, sizeBytes: size }))?.id).toBe(901);
    expect((await findMediaMessage(client, "kevbot", { messageId: 77, sizeBytes: 999 }))?.id).toBe(77);
    expect(await findMediaMessage(client, "kevbot", { messageId: 77, sizeBytes: 5 })).toBeNull();
    expect(mediaSizeOf(msgs[1])).toBe(size);
  });

  it("poids inconnu : jamais le fichier d'un autre message pris par son seul numéro, sauf dans un canal", async () => {
    const msgs = [videoMessage(77, 999)];
    const { client } = fakeClient(msgs, Buffer.alloc(0));
    expect(await findMediaMessage(client, "kevbot", { messageId: 77, sizeBytes: null })).toBeNull();
    expect((await findMediaMessage(client, "-1001234", { messageId: 77, sizeBytes: null, idsReliable: true }))?.id).toBe(77);
  });

  it("écrit le fichier en continu et reprend après une coupure au dernier bloc complet", async () => {
    const total = DOWNLOAD_CHUNK_BYTES * 2 + 1000;
    const data = content(total);
    const msg = videoMessage(5, total);
    const dest = join(dir, "source.mp4");
    const first = fakeClient([msg], data, { cutAfter: 1 });
    await expect(downloadMessageMediaTo(first.client, msg, dest)).rejects.toThrow(/coupée/);
    // Fichier partiel abîmé au-delà du bloc : tronqué au dernier bloc complet.
    await writeFile(`${dest}.part`, Buffer.concat([data.subarray(0, DOWNLOAD_CHUNK_BYTES), Buffer.from("déchet")]));
    const second = fakeClient([msg], data);
    expect(await downloadMessageMediaTo(second.client, msg, dest)).toBe(total);
    expect(second.offsets).toEqual([DOWNLOAD_CHUNK_BYTES]);
    expect((await readFile(dest)).equals(data)).toBe(true);
    await expect(readFile(`${dest}.part`)).rejects.toThrow();
  });
});
