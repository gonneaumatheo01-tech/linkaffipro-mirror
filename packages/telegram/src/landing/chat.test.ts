/**
 * Phase 15 (D7) : le nom affiché sur une page d'atterrissage est toujours le vrai titre du canal, relu chez Telegram
 * (`getChat`), avec la petite photo si une page l'affiche. Telegram simulé, sans base.
 */
import { describe, expect, it } from "vitest";
import {
  LANDING_CHAT_STALE_MS,
  refreshLandingChat,
  refreshLandingChats,
  type LandingChatChannel,
  type LandingChatClient,
  type LandingChatDeps,
} from "./chat";

const NOW = new Date("2026-10-15T10:00:00Z");

function channel(over: Partial<LandingChatChannel> = {}): LandingChatChannel {
  return {
    id: "c1",
    title: "Casino VIP",
    username: null,
    telegramChatId: -1001n,
    photoFileUniqueId: null,
    wantsPhoto: false,
    bots: [
      { botId: "b1", username: "casinobot" },
      { botId: "b2", username: "sportsbot" },
    ],
    ...over,
  };
}

type Chat = {
  title?: string;
  username?: string;
  photo?: { small_file_id: string; small_file_unique_id: string };
};

function world(
  opts: {
    chat?: Chat;
    /** Erreur forcée d'un bot à getChat. */
    fail?: Record<string, { error_code: number; description: string }>;
    channels?: LandingChatChannel[];
  } = {},
) {
  const calls: Array<[string, string, unknown]> = [];
  const saved: Array<{ channelId: string; data: Record<string, unknown> }> = [];
  const published: unknown[] = [];
  const clientOf = (botId: string): LandingChatClient => ({
    async getChat(chatId) {
      calls.push([botId, "getChat", chatId]);
      const f = opts.fail?.[botId];
      if (f) throw Object.assign(new Error(f.description), f);
      return { id: Number(chatId), type: "channel", ...(opts.chat ?? { title: "Casino VIP" }) };
    },
    async getFile(fileId) {
      calls.push([botId, "getFile", fileId]);
      return { file_path: `photos/${fileId}.jpg` };
    },
    async download(filePath) {
      calls.push([botId, "download", filePath]);
      return new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    },
  });
  const deps: LandingChatDeps = {
    listChannels: async () => opts.channels ?? [channel()],
    clientFor: async (botId) => clientOf(botId),
    saveChat: async (channelId, data) => {
      saved.push({ channelId, data: data as Record<string, unknown> });
    },
    publishInvalidate: async (msg) => {
      published.push(msg);
      return true;
    },
    warn: () => undefined,
    sleep: async () => undefined,
  };
  return { deps, calls, saved, published };
}

describe("relecture du titre et de la photo d'un canal", () => {
  it("titre changé chez Telegram : enregistré, heure de relecture posée, pages du canal invalidées", async () => {
    const w = world({ chat: { title: "Casino VIP 🎰 (nouveau)", username: "casinovip" } });
    const r = await refreshLandingChat(w.deps, channel(), NOW);
    expect(r).toMatchObject({ status: "updated", titleChanged: true, photoChanged: false });
    expect(w.saved).toEqual([
      {
        channelId: "c1",
        data: { checkedAt: NOW, title: "Casino VIP 🎰 (nouveau)", username: "casinovip" },
      },
    ]);
    expect(w.published).toEqual([{ channelId: "c1" }]);
  });

  it("rien n'a changé : seule l'heure de relecture, aucune invalidation", async () => {
    const w = world();
    const r = await refreshLandingChat(w.deps, channel(), NOW);
    expect(r.status).toBe("unchanged");
    expect(w.saved).toEqual([{ channelId: "c1", data: { checkedAt: NOW } }]);
    expect(w.published).toEqual([]);
  });

  it("photo affichée par une page : téléchargée quand elle change, rien si c'est la même", async () => {
    const photo = { small_file_id: "F1", small_file_unique_id: "U1" };
    const w = world({ chat: { title: "Casino VIP", photo } });
    const r = await refreshLandingChat(w.deps, channel({ wantsPhoto: true }), NOW);
    expect(r).toMatchObject({ status: "updated", photoChanged: true, titleChanged: false });
    expect(w.calls.map(([, m, a]) => [m, a])).toEqual([
      ["getChat", -1001],
      ["getFile", "F1"],
      ["download", "photos/F1.jpg"],
    ]);
    const data = w.saved[0]!.data as { photo: { uniqueId: string; bytes: Uint8Array } };
    expect(data.photo.uniqueId).toBe("U1");
    expect(Array.from(data.photo.bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
    expect(w.published).toEqual([{ channelId: "c1" }]);

    const same = world({ chat: { title: "Casino VIP", photo } });
    await refreshLandingChat(
      same.deps,
      channel({ wantsPhoto: true, photoFileUniqueId: "U1" }),
      NOW,
    );
    expect(same.calls.map(([, m]) => m)).toEqual(["getChat"]);
    expect(same.published).toEqual([]);
  });

  it("photo retirée chez Telegram : effacée ici ; aucune page ne l'affiche : jamais téléchargée", async () => {
    const w = world({ chat: { title: "Casino VIP" } });
    await refreshLandingChat(w.deps, channel({ wantsPhoto: true, photoFileUniqueId: "U1" }), NOW);
    expect(w.saved[0]!.data).toEqual({ checkedAt: NOW, photo: null });
    expect(w.published).toEqual([{ channelId: "c1" }]);

    const off = world({
      chat: { title: "Casino VIP", photo: { small_file_id: "F", small_file_unique_id: "U" } },
    });
    await refreshLandingChat(off.deps, channel({ wantsPhoto: false }), NOW);
    expect(off.calls.map(([, m]) => m)).toEqual(["getChat"]);
  });

  it("premier bot refusé (plus membre du canal) : le suivant lit le titre", async () => {
    const w = world({
      chat: { title: "Nouveau titre" },
      fail: { b1: { error_code: 400, description: "Bad Request: chat not found" } },
    });
    const r = await refreshLandingChat(w.deps, channel(), NOW);
    expect(r.status).toBe("updated");
    expect(w.calls.map(([b]) => b)).toEqual(["b1", "b2"]);
  });

  it("aucun bot ne peut lire le canal : heure de relecture posée quand même (pas d'appel à chaque passage)", async () => {
    const refused = { error_code: 403, description: "Forbidden: bot is not a member" };
    const w = world({ fail: { b1: refused, b2: refused } });
    const r = await refreshLandingChat(w.deps, channel(), NOW);
    expect(r.status).toBe("failed");
    expect(w.saved).toEqual([{ channelId: "c1", data: { checkedAt: NOW } }]);
  });

  it("Telegram surchargé (429) : rien n'est écrit, nouvel essai au passage suivant", async () => {
    const w = world({
      fail: { b1: { error_code: 429, description: "Too Many Requests: retry after 9" } },
    });
    const r = await refreshLandingChat(w.deps, channel(), NOW);
    expect(r.status).toBe("retry");
    expect(w.saved).toEqual([]);
    expect(w.calls).toHaveLength(1);
  });
});

describe("passage périodique", () => {
  it("relit les canaux dont la relecture date de plus de 30 minutes, s'arrête au premier 429", async () => {
    let asked: { checkedBefore: Date; limit: number } | null = null;
    const w = world({
      channels: [channel({ id: "c1" }), channel({ id: "c2" }), channel({ id: "c3" })],
      fail: { b1: { error_code: 429, description: "Too Many Requests: retry after 9" } },
    });
    w.deps.listChannels = async (q) => {
      asked = q;
      return [channel({ id: "c1" }), channel({ id: "c2" })];
    };
    const r = await refreshLandingChats(w.deps, { now: NOW, limit: 25 });
    expect(asked).toEqual({
      checkedBefore: new Date(NOW.getTime() - LANDING_CHAT_STALE_MS),
      limit: 25,
    });
    expect(LANDING_CHAT_STALE_MS).toBe(30 * 60_000);
    expect(r).toMatchObject({ checked: 0, updated: 0, failed: 0, retryLater: 2 });
    expect(w.calls).toHaveLength(1);
  });

  it("compte les canaux relus et mis à jour", async () => {
    const w = world({
      chat: { title: "Autre titre" },
      channels: [channel({ id: "c1" }), channel({ id: "c2" })],
    });
    const r = await refreshLandingChats(w.deps, { now: NOW });
    expect(r).toMatchObject({ checked: 2, updated: 2, failed: 0, retryLater: 0 });
    expect(w.published).toEqual([{ channelId: "c1" }, { channelId: "c2" }]);
  });
});
