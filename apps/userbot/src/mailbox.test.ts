import { describe, expect, it, vi } from "vitest";
import type { TelegramClient } from "telegram";

vi.mock("./logger", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
const { handleRequest, mailboxTick, USERBOT_HEARTBEAT_KEY, USERBOT_REQUEST_PREFIX } = await import("./mailbox");

function setup(account: Record<string, unknown> = {}) {
  const now = new Date("2026-10-24T12:00:00Z");
  const rows = new Map<string, unknown>();
  const db = {
    setting: {
      findMany: async () => [...rows].map(([key, value]) => ({ key, value })).filter((r) => r.key.startsWith(USERBOT_REQUEST_PREFIX)),
      updateMany: async ({ where, data }: { where: { key: string }; data: { value: unknown } }) => (rows.has(where.key) ? (rows.set(where.key, data.value), { count: 1 }) : { count: 0 }),
      deleteMany: async ({ where }: { where: { key: string } }) => ({ count: rows.delete(where.key) ? 1 : 0 }),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => rows.set(where.key, create.value),
    },
    telegramUserAccount: { findUnique: async () => ({ personaId: null, botId: null, isActive: true, status: "ACTIVE", ...account }) },
  };
  const searchOps = {
    search: vi.fn(async () => [{ id: "1", accessHash: "901", username: "canal_1", title: "Canal 1", subscribers: 1200 }]),
    profile: vi.fn(async () => ({ id: "1", username: "canal_1", title: "Canal 1", subscribers: 1200, about: null, linkedChat: null })),
  };
  const client = {} as TelegramClient;
  const deps = { db: db as never, accounts: () => new Map([["acc1", { client }]]), searchOps, now: () => now };
  return { rows, searchOps, deps, now: () => now };
}

const search = { kind: "prospect-search" as const, accountId: "acc1", op: "search" as const, query: "pronos foot", limit: 20 };

describe("boîte aux lettres du worker", () => {
  it("demande inconnue (ancienne lecture de canal) : refusée, aucun appel Telegram", async () => {
    const k = setup();
    expect(await handleRequest(k.deps, { kind: "history", accountId: "acc1" } as never)).toEqual({ ok: false, error: "demande inconnue" });
    expect(k.searchOps.search).not.toHaveBeenCalled();
  });
  it("boucle : signal de vie, demande traitée et réponse écrite dans la ligne, demande abandonnée effacée", async () => {
    const k = setup();
    k.rows.set(`${USERBOT_REQUEST_PREFIX}a`, { ...search, status: "PENDING", createdAt: k.now().toISOString() });
    k.rows.set(`${USERBOT_REQUEST_PREFIX}vieux`, { ...search, status: "PENDING", createdAt: new Date(k.now().getTime() - 20 * 60_000).toISOString() });
    expect(await mailboxTick(k.deps, { lastBeatAt: 0 })).toBe("done");
    expect(k.rows.get(USERBOT_HEARTBEAT_KEY)).toEqual({ at: k.now().toISOString() });
    expect(k.rows.get(`${USERBOT_REQUEST_PREFIX}a`)).toMatchObject({ status: "DONE", response: { ok: true, channels: [{ username: "canal_1" }] } });
    expect(k.rows.has(`${USERBOT_REQUEST_PREFIX}vieux`)).toBe(false);
  });
});
