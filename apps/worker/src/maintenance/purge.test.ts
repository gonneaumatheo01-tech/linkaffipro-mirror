/** Purge de rétention (relecture adverse, phase 25) : DM des comptes réels et événements Telegram des membres anonymisés. */
import { describe, expect, it, vi } from "vitest";

type Call = { model: string; method: string; args: unknown };
const calls: Call[] = [];
const failures = vi.hoisted(() => ({ memberFindMany: false }));
const old = new Date("2023-01-01T00:00:00Z");

vi.mock("@linkaffipro/db", () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args: unknown) => {
          calls.push({ model: name, method, args });
          if (name === "member" && method === "findMany" && failures.memberFindMany) return Promise.reject(new Error("base indisponible"));
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
const inspiration = vi.hoisted(() => ({ purge: vi.fn(async () => ({ purged: 2 })), rehash: vi.fn(async () => ({ done: true, rehashed: 0 })), redact: vi.fn(async () => ({ done: true, redacted: 0 })) }));
vi.mock("@linkaffipro/agents", () => ({ purgeReferenceTexts: inspiration.purge, rehashReferenceShingles: inspiration.rehash }));
vi.mock("./inspiration-privacy", () => ({ redactForwardedEventsOnce: inspiration.redact }));
vi.mock("../logger", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

const { runPurge, runInspirationPurge, REDACTED_PAYLOAD } = await import("./purge");

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

  it("canal d'inspiration isolé : tourne même si la rétention échoue (erreur relancée après), et une erreur chez lui ne casse pas la purge", async () => {
    inspiration.purge.mockClear();
    failures.memberFindMany = true;
    await expect(runPurge(new Date("2026-10-24T03:00:00Z"))).rejects.toThrow("base indisponible");
    expect(inspiration.purge).toHaveBeenCalledTimes(1);
    expect(inspiration.rehash).toHaveBeenCalled();
    expect(inspiration.redact).toHaveBeenCalled();
    failures.memberFindMany = false;
    inspiration.purge.mockRejectedValueOnce(new Error("panne"));
    inspiration.redact.mockRejectedValueOnce(new Error("panne"));
    const r = await runPurge(new Date("2026-10-24T03:00:00Z"));
    expect(r).toMatchObject({ referenceTextsPurged: 0, membersAnonymized: 1 });
    expect((await runInspirationPurge(new Date())).referenceTextsPurged).toBe(2);
  });
});
