/**
 * Phase 32 (chantier C) — recherche de prospection par la session du userbot : lecture seule, compte qui converse
 * refusé, 5 s entre deux demandes, 100 par jour, FLOOD_WAIT et avertissement renvoyés (jamais attendus), et test
 * adverse : aucune méthode d'adhésion, d'envoi ni d'invitation n'est accessible sur ce chemin. Faux Telegram, aucun réseau.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TelegramClient } from "telegram";

vi.mock("./logger", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
const { handleRequest } = await import("./mailbox");
const {
  gramjsProspectSearchOps,
  handleProspectSearch,
  newProspectSearchState,
  PROSPECT_SEARCH_ALLOWED_REQUESTS,
  telegramWarningOf,
  toFoundChannels,
  toProfile,
} = await import("./prospect-search");

const channel = (id: number, extra: Record<string, unknown> = {}) => ({ className: "Channel", id, accessHash: 900 + id, broadcast: true, username: `canal_${id}`, title: `Canal ${id}`, ...extra });

describe("conversion (règles pures)", () => {
  it("recherche : canaux publics de diffusion seulement, sans doublon", () => {
    const found = toFoundChannels([
      channel(1, { participantsCount: 1200 }),
      channel(2, { broadcast: false, megagroup: true }),
      channel(3, { username: null }),
      { className: "User", id: 4 },
      channel(1),
    ]);
    expect(found).toEqual([{ id: "1", accessHash: "901", username: "canal_1", title: "Canal 1", subscribers: 1200 }]);
  });
  it("fiche : abonnés, description, groupe lié", () => {
    const p = toProfile(
      { fullChat: { participantsCount: 5400, about: "  Pronos foot chaque jour  ", linkedChatId: 77 }, chats: [channel(1), { className: "Channel", id: 77, megagroup: true, username: "canal_1_chat", title: "Discussion" }] },
      { id: "1", username: "canal_1" },
    );
    expect(p).toEqual({ id: "1", username: "canal_1", title: "Canal 1", subscribers: 5400, about: "Pronos foot chaque jour", linkedChat: { username: "canal_1_chat", title: "Discussion" } });
  });
  it("avertissements de Telegram reconnus (compte limité, gelé…), FLOOD_WAIT à part", () => {
    expect(telegramWarningOf(Object.assign(new Error("PEER_FLOOD"), { errorMessage: "PEER_FLOOD" }))).toBe("PEER_FLOOD");
    expect(telegramWarningOf(Object.assign(new Error("FROZEN_METHOD_INVALID"), { errorMessage: "FROZEN_METHOD_INVALID" }))).toMatch(/FROZEN/);
    expect(telegramWarningOf(new Error("CHANNEL_PRIVATE"))).toBeNull();
  });
});

function fakeClient(responses: Record<string, unknown> = {}) {
  const invoked: string[] = [];
  const client = {
    invoke: vi.fn(async (req: { className: string }) => {
      invoked.push(req.className);
      return responses[req.className] ?? { chats: [] };
    }),
  };
  return { client: client as unknown as TelegramClient, invoked };
}

function mailbox(account: Record<string, unknown> = {}) {
  let now = new Date("2026-10-27T02:00:00Z");
  const db = {
    setting: { findMany: async () => [], updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }), upsert: async () => undefined },
    telegramUserAccount: { findUnique: async () => ({ personaId: null, botId: null, isActive: true, status: "ACTIVE", ...account }) },
  };
  const searchOps = {
    search: vi.fn(async () => [{ id: "1", accessHash: "901", username: "canal_1", title: "Canal 1", subscribers: 1200 }]),
    profile: vi.fn(async () => ({ id: "1", username: "canal_1", title: "Canal 1", subscribers: 1200, about: null, linkedChat: null })),
  };
  const { client } = fakeClient();
  const deps = { db: db as never, accounts: () => new Map([["acc1", { client }]]), searchOps, now: () => now };
  return { deps, searchOps, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

const search = (accountId = "acc1") => ({ kind: "prospect-search" as const, accountId, op: "search" as const, query: "pronos foot", limit: 20 });

describe("demande prospect-search", () => {
  it("compte qui converse (persona, bot fantôme), inactif ou non connecté : refusé, aucun appel Telegram", async () => {
    for (const acc of [{ personaId: "p1" }, { botId: "b1" }, { isActive: false }, { status: "ERROR" }]) {
      const k = mailbox(acc);
      expect(await handleRequest(k.deps, search())).toMatchObject({ ok: false });
      expect(k.searchOps.search).not.toHaveBeenCalled();
    }
    const k = mailbox();
    expect(await handleRequest(k.deps, search("autre"))).toMatchObject({ ok: false, error: expect.stringMatching(/non connecté/) });
  });

  it("recherche puis fiche : 5 s au moins entre deux demandes d'un même compte ; jamais d'adhésion", async () => {
    const k = mailbox();
    const state = newProspectSearchState();
    expect(await handleRequest(k.deps, search(), state)).toMatchObject({ ok: true, calls: 1, channels: [{ username: "canal_1" }] });
    const profile = { kind: "prospect-search" as const, accountId: "acc1", op: "profile" as const, channel: { id: "1", accessHash: "901", username: "canal_1" } };
    expect(await handleRequest(k.deps, profile, state)).toBe("later");
    k.advance(5_000);
    expect(await handleRequest(k.deps, profile, state)).toMatchObject({ ok: true, profile: { subscribers: 1200 } });
  });

  it("100 demandes par jour et par compte au plus", async () => {
    const state = newProspectSearchState();
    const { client } = fakeClient();
    const ops = { search: vi.fn(async () => []), profile: vi.fn() };
    let t = Date.parse("2026-10-27T02:00:00Z");
    for (let i = 0; i < 100; i++) {
      expect(await handleProspectSearch(client, search(), state, { ops: ops as never, now: t })).toMatchObject({ ok: true });
      t += 5_000;
    }
    expect(await handleProspectSearch(client, search(), state, { ops: ops as never, now: t })).toMatchObject({ ok: false, error: expect.stringMatching(/plafond/) });
    expect(ops.search).toHaveBeenCalledTimes(100);
  });

  it("FLOOD_WAIT renvoyé (jamais attendu), avertissement renvoyé tel quel", async () => {
    const state = newProspectSearchState();
    const { client } = fakeClient();
    const ops = {
      search: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("FLOOD_WAIT_120"), { errorMessage: "FLOOD_WAIT_120", seconds: 120 }))
        .mockRejectedValueOnce(Object.assign(new Error("PEER_FLOOD"), { errorMessage: "PEER_FLOOD" })),
      profile: vi.fn(),
    };
    const t = Date.parse("2026-10-27T02:00:00Z");
    expect(await handleProspectSearch(client, search(), state, { ops: ops as never, now: t })).toEqual({ ok: false, floodWaitSeconds: 120 });
    expect(await handleProspectSearch(client, search(), state, { ops: ops as never, now: t + 5_000 })).toEqual({ ok: false, warning: "PEER_FLOOD" });
  });
});

describe("test adverse : aucune adhésion, aucun envoi sur ce chemin", () => {
  it("les appels GramJS réels n'envoient QUE la recherche et la fiche (faux client)", async () => {
    const { client, invoked } = fakeClient({
      "contacts.Search": { chats: [channel(1, { participantsCount: 50 })] },
      "channels.GetFullChannel": { fullChat: { participantsCount: 50, about: "x" }, chats: [channel(1)] },
    });
    const found = await gramjsProspectSearchOps.search(client, "pronos foot", 50);
    expect(found).toHaveLength(1);
    await gramjsProspectSearchOps.profile(client, { id: found[0]!.id, accessHash: found[0]!.accessHash, username: found[0]!.username });
    expect(invoked).toEqual(["contacts.Search", "channels.GetFullChannel"]);
    expect(invoked.every((c) => (PROSPECT_SEARCH_ALLOWED_REQUESTS as readonly string[]).includes(c))).toBe(true);
  });

  it("le code du chemin ne construit aucune méthode d'adhésion, d'envoi ni d'invitation", () => {
    const code = readFileSync(join(import.meta.dirname, "prospect-search.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\b(JoinChannel|joinChannel|ImportChatInvite|importChatInvite|SendMessage|sendMessage|SendMedia|sendFile|ForwardMessages|forwardMessages|InviteToChannel|AddChatUser|StartBot|sendReaction|SendReaction|ResolveUsername|GetHistory)\b/);
    // Seules méthodes de l'API Telegram utilisées : la recherche et la fiche.
    const apiCalls = [...code.matchAll(/new Api\.([A-Za-z.]+)\(/g)].map((m) => m[1]);
    expect(new Set(apiCalls)).toEqual(new Set(["contacts.Search", "InputChannel", "channels.GetFullChannel"]));
    expect(code).not.toMatch(/client\.(?!invoke\b)[a-zA-Z]+\(/);
  });
});
