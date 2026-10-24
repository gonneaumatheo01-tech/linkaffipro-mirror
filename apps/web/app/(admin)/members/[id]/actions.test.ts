/** Suppression d'un membre (relecture adverse, phase 25) : DM des comptes réels et événements Telegram effacés. */
import { describe, expect, it, vi } from "vitest";

type Call = { model: string; method: string; args: unknown };
const calls: Call[] = [];
const member = { id: "m1", telegramUserId: 777n, anonymizedAt: null };

vi.mock("@linkaffipro/db", () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args: unknown) => {
          calls.push({ model: name, method, args });
          if (name === "member" && method === "findUnique") return Promise.resolve(member);
          if (method === "findMany") return Promise.resolve(name === "membership" ? [{ id: "ms1" }, { id: "ms2" }] : []);
          return { model: name, method, args };
        },
      },
    );
  const prisma = new Proxy(
    { $transaction: async (ops: unknown[]) => ops },
    { get: (t, k: string) => (k in t ? (t as Record<string, unknown>)[k] : model(k)) },
  );
  return { prisma, audit: vi.fn(async () => undefined), recordEvent: vi.fn(async () => undefined), Prisma: {} };
});
vi.mock("@/lib/session", () => ({ ForbiddenError: class extends Error {}, requireAdmin: async () => ({ id: "u1" }), requireUser: async () => ({ id: "u1" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
vi.mock("@/lib/members/tags", () => ({ getTagRegistry: async () => [], memberTags: () => [] }));
vi.mock("@/lib/affiliates/anonymize", () => ({ scrubLinkaffiEventsOps: () => [] }));
vi.mock("@/lib/affiliates/attribution-server", () => ({ changeMemberAffiliate: vi.fn(), removeMemberAffiliate: vi.fn() }));

const { anonymizeMemberAction } = await import("./actions");

describe("suppression d'un membre", () => {
  it("DM en attente des comptes réels annulés et vidés ; événements telegram.* sans contenu", async () => {
    const form = new FormData();
    form.set("memberId", "m1");
    form.set("confirm", "SUPPRIMER");
    await expect(anonymizeMemberAction(form)).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    const dm = calls.filter((c) => c.model === "accountDm" && c.method === "updateMany").map((c) => c.args as { where: Record<string, unknown>; data: Record<string, unknown> });
    const scope = { OR: [{ telegramUserId: 777n }, { membershipId: { in: ["ms1", "ms2"] } }] };
    expect(dm).toContainEqual({ where: { ...scope, status: "PENDING" }, data: expect.objectContaining({ status: "CANCELLED", text: "" }) });
    const scrub = dm.find((d) => !("status" in d.where))!;
    expect(scrub.where).toEqual(scope);
    expect(scrub.data.text).toBe("");
    expect(typeof scrub.data.telegramUserId === "bigint" && (scrub.data.telegramUserId as bigint) < 0n).toBe(true);
    expect(calls).toContainEqual({
      model: "event",
      method: "updateMany",
      args: { where: { memberId: "m1", type: { startsWith: "telegram." } }, data: { payload: { redacted: true } } },
    });
  });
});
