/**
 * « Accepter » / « Refuser » depuis le site : la demande est traitée par le bot qui agit pour le canal, jamais par un
 * bot en mode assistant de conversation (phase 17, `actingStandardBotFor`). Sans bot normal administrateur : rien
 * n'est demandé à Telegram, rien n'est écrit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const tg = vi.hoisted(() => ({
  approve: vi.fn(async () => true),
  decline: vi.fn(async () => true),
}));
vi.mock("grammy", () => ({
  Api: class {
    approveChatJoinRequest = tg.approve;
    declineChatJoinRequest = tg.decline;
  },
  GrammyError: class extends Error {},
}));
vi.mock("@linkaffipro/core", () => ({ decrypt: (s: string) => `token:${s}` }));
const db = vi.hoisted(() => ({
  membershipUpdate: vi.fn(async () => ({})),
  recordEvent: vi.fn(async () => undefined),
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    membership: {
      findUnique: vi.fn(async () => ({
        id: "ms1",
        channelId: "ch1",
        memberId: "m1",
        inviteLinkId: null,
        approvalRuleId: null,
        userChatId: null,
        requestedAt: new Date(),
        source: null,
        member: { telegramUserId: 42n, firstName: null },
        channel: { telegramChatId: -1001n, title: "Canal" },
      })),
      update: db.membershipUpdate,
    },
    inviteLink: { update: vi.fn(async () => ({})) },
    approvalRule: { findUnique: vi.fn(async () => null) },
  },
  recordEvent: db.recordEvent,
}));
vi.mock("@linkaffipro/queue", () => ({
  emitLinkaffiEvent: vi.fn(async () => undefined),
  enqueueDm: vi.fn(async () => undefined),
}));
vi.mock("@linkaffipro/telegram", () => ({
  memberReachabilityWithDb: vi.fn(async () => ({ reachable: false, reason: "never_started" })),
}));
const acting = vi.hoisted(() =>
  vi.fn(async (_channelId: string) => null as { id: string; tokenEncrypted: string } | null),
);
vi.mock("@/lib/channels/acting-bot", () => ({ actingStandardBotFor: acting }));

import { approveNow, declineNow } from "./telegram";

beforeEach(() => {
  vi.clearAllMocks();
  acting.mockResolvedValue(null);
});

describe("accepter ou refuser depuis le site : jamais par un assistant de conversation", () => {
  it("aucun bot normal administrateur : refus lisible, Telegram jamais appelé", async () => {
    expect(await approveNow("ms1", "u1")).toEqual({
      ok: false,
      error: "Aucun bot administrateur sur ce canal.",
    });
    expect(await declineNow("ms1", "u1")).toEqual({
      ok: false,
      error: "Aucun bot administrateur sur ce canal.",
    });
    expect(acting).toHaveBeenCalledWith("ch1");
    expect(tg.approve).not.toHaveBeenCalled();
    expect(tg.decline).not.toHaveBeenCalled();
    expect(db.membershipUpdate).not.toHaveBeenCalled();
  });

  it("acceptée par le bot qui agit pour le canal (bot normal)", async () => {
    acting.mockResolvedValue({ id: "bot-normal", tokenEncrypted: "x" });
    expect(await approveNow("ms1", "u1")).toEqual({ ok: true });
    expect(tg.approve).toHaveBeenCalledWith(-1001, 42);
    expect(db.membershipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED", approvedByBotId: "bot-normal" }),
      }),
    );
  });

  it("refusée par le bot qui agit pour le canal (bot normal)", async () => {
    acting.mockResolvedValue({ id: "bot-normal", tokenEncrypted: "x" });
    expect(await declineNow("ms1", "u1")).toEqual({ ok: true });
    expect(tg.decline).toHaveBeenCalledWith(-1001, 42);
    expect(db.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "membership.declined", botId: "bot-normal" }),
    );
  });
});
