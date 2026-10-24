/** Purge de rétention (relecture adverse, phase 25) : DM des comptes réels et événements Telegram des membres anonymisés. */
import { describe, expect, it, vi } from "vitest";

type Call = { model: string; method: string; args: unknown };
const calls: Call[] = [];
const old = new Date("2023-01-01T00:00:00Z");

vi.mock("@linkaffipro/db", () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args: unknown) => {
          calls.push({ model: name, method, args });
          if (name === "member" && method === "findMany") return Promise.resolve([{ id: "m1", lastSeenAt: old, anonymizedAt: null, telegramUserId: 555n }]);
          if (name === "membership" && method === "findMany") return Promise.resolve([{ id: "ms1" }]);
          if (method === "findMany") return Promise.resolve([]);
          if (method === "findFirst" || method === "findUnique") return Promise.resolve(null);
          if (method === "updateMany" || method === "deleteMany") return Promise.resolve({ count: 1 });
          return Promise.resolve({});
        },
      },
    );
  const prisma = new Proxy(
    { $transaction: async (ops: unknown[]) => Promise.all(ops) },
    { get: (t, k: string) => (k in t ? (t as Record<string, unknown>)[k] : model(k)) },
  );
  return { prisma, audit: vi.fn(async () => undefined), recordEvent: vi.fn(async () => undefined), toJsonValue: (v: unknown) => v };
});
vi.mock("../linkaffi-events/privacy", () => ({ deleteLinkaffiEventsBefore: async () => 0, scrubDeletedMembersLinkaffiEvents: async () => 0 }));
vi.mock("./landing", () => ({ deleteLandingEventsBefore: async () => 0 }));
vi.mock("../logger", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

const { runPurge, REDACTED_PAYLOAD } = await import("./purge");

describe("purge de rétention", () => {
  it("membre anonymisé : DM en attente annulés et vidés ; DM anciens supprimés ; événements telegram.* sans contenu", async () => {
    const r = await runPurge(new Date("2026-10-24T03:00:00Z"));
    const dm = calls.filter((c) => c.model === "accountDm").map((c) => ({ method: c.method, args: c.args as { where: Record<string, unknown>; data?: Record<string, unknown> } }));
    const scope = { OR: [{ telegramUserId: 555n }, { membershipId: { in: ["ms1"] } }] };
    expect(dm).toContainEqual({ method: "updateMany", args: { where: { ...scope, status: "PENDING" }, data: expect.objectContaining({ status: "CANCELLED", text: "" }) } });
    expect(dm.find((d) => d.method === "updateMany" && !("status" in d.args.where))!.args.data!.text).toBe("");
    expect(dm.find((d) => d.method === "deleteMany")!.args.where).toEqual({ createdAt: { lt: r.cutoff } });
    const ev = calls.find((c) => c.model === "event" && c.method === "updateMany")!.args as { where: Record<string, unknown>; data: unknown };
    expect(ev.data).toEqual({ payload: REDACTED_PAYLOAD });
    expect(ev.where).toMatchObject({ type: { startsWith: "telegram." }, member: { anonymizedAt: { not: null } } });
    expect(r).toMatchObject({ membersAnonymized: 1, telegramEventsRedacted: 1, accountDmsDeleted: 1 });
  });
});
