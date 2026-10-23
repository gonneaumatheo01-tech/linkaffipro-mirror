import { beforeEach, describe, expect, it, vi } from "vitest";

// Client partagé jamais utilisé ici : chaque appel reçoit un faux client (aucune base).
vi.mock("./client", () => ({ prisma: {} }));

import { publishingBotFor, type PostingDb } from "./posting";

const mocks = { channelFindUnique: vi.fn(async (_args: unknown) => null as unknown) };
const db = { channel: { findUnique: mocks.channelFindUnique } } as unknown as PostingDb;

beforeEach(() => {
  mocks.channelFindUnique.mockReset();
  mocks.channelFindUnique.mockResolvedValue(null);
});

describe("bot qui publie dans un canal (phase 17 : jamais un assistant de conversation)", () => {
  type B = { id: string; username: string; isActive: boolean; mode: "STANDARD" | "ASSISTANT" };
  const bot = (id: string, over: Partial<B> = {}): B => ({
    id,
    username: `${id}_bot`,
    isActive: true,
    mode: "STANDARD",
    ...over,
  });
  const channel = (primaryBot: B | null, admins: B[]) =>
    mocks.channelFindUnique.mockResolvedValue({
      primaryBot,
      botAdmins: admins.map((b) => ({ bot: b })),
    });

  it("bot principal normal et actif : c'est lui qui publie", async () => {
    channel(bot("p"), [bot("a1")]);
    expect(await publishingBotFor("ch1", {}, db)).toEqual({ id: "p", username: "p_bot" });
  });

  it("bot principal en mode assistant : jamais choisi, le plus ancien administrateur normal publie", async () => {
    channel(bot("p", { mode: "ASSISTANT" }), [
      bot("a1", { mode: "ASSISTANT" }),
      bot("a2"),
      bot("a3"),
    ]);
    expect(await publishingBotFor("ch1", {}, db)).toEqual({ id: "a2", username: "a2_bot" });
  });

  it("bot principal désactivé : le premier administrateur normal et actif", async () => {
    channel(bot("p", { isActive: false }), [bot("a1", { isActive: false }), bot("a2")]);
    expect(await publishingBotFor("ch1", {}, db)).toEqual({ id: "a2", username: "a2_bot" });
  });

  it("seuls des assistants de conversation : aucun bot pour publier", async () => {
    channel(bot("p", { mode: "ASSISTANT" }), [bot("a1", { mode: "ASSISTANT" })]);
    expect(await publishingBotFor("ch1", {}, db)).toBeNull();
  });

  it("canal inconnu : aucun bot", async () => {
    expect(await publishingBotFor("inconnu", {}, db)).toBeNull();
  });

  it("modification : le bot actuel du message est gardé s'il peut encore publier dans ce canal", async () => {
    channel(bot("p"), [bot("a1"), bot("a2")]);
    expect(await publishingBotFor("ch1", { keep: "a2" }, db)).toEqual({ id: "a2", username: "a2_bot" });
  });

  it("modification : bot actuel devenu assistant, désactivé ou plus administrateur → remplacé", async () => {
    channel(bot("p"), [bot("a1", { mode: "ASSISTANT" }), bot("a2", { isActive: false })]);
    expect(await publishingBotFor("ch1", { keep: "a1" }, db)).toEqual({ id: "p", username: "p_bot" });
    expect(await publishingBotFor("ch1", { keep: "a2" }, db)).toEqual({ id: "p", username: "p_bot" });
    expect(await publishingBotFor("ch1", { keep: "parti" }, db)).toEqual({
      id: "p",
      username: "p_bot",
    });
  });

  it("modification : bot actuel devenu assistant et aucun autre bot normal → aucun bot", async () => {
    channel(bot("p", { mode: "ASSISTANT" }), [bot("p", { mode: "ASSISTANT" })]);
    expect(await publishingBotFor("ch1", { keep: "p" }, db)).toBeNull();
  });

  it("la base ne renvoie que les administrateurs normaux et actifs, du plus ancien au plus récent", async () => {
    channel(null, []);
    await publishingBotFor("ch1", {}, db);
    const args = mocks.channelFindUnique.mock.calls[0]![0] as {
      where: unknown;
      select: {
        primaryBot: { select: Record<string, boolean> };
        botAdmins: {
          where: unknown;
          orderBy: unknown;
          select: { bot: { select: Record<string, boolean> } };
        };
      };
    };
    expect(args.where).toEqual({ id: "ch1" });
    expect(args.select.botAdmins.where).toEqual({
      revokedAt: null,
      bot: { isActive: true, mode: "STANDARD" },
    });
    expect(args.select.botAdmins.orderBy).toEqual([{ detectedAt: "asc" }, { id: "asc" }]);
    // Jamais le jeton du bot.
    expect(args.select.primaryBot.select.tokenEncrypted).toBeUndefined();
    expect(args.select.primaryBot.select.mode).toBe(true);
  });
});
