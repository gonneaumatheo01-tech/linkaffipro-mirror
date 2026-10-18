/**
 * Bot qui crée les liens d'entrée d'un canal (`actingBotForChannel`) : bot principal s'il est administrateur, sinon le
 * plus ancien administrateur ; jamais un bot en mode assistant de conversation (phase 17).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn(async (_args: unknown) => null as unknown));
vi.mock("@linkaffipro/db", () => ({
  prisma: { channel: { findUnique } },
  audit: vi.fn(),
  recordEvent: vi.fn(),
}));

import { actingBotForChannel, LinkError } from "./create";

type B = { id: string; username: string; isActive: boolean; mode: "STANDARD" | "ASSISTANT" };
const bot = (id: string, over: Partial<B> = {}): B => ({
  id,
  username: `${id}_bot`,
  isActive: true,
  mode: "STANDARD",
  ...over,
});
const channel = (primaryBot: B | null, admins: B[]) =>
  findUnique.mockResolvedValue({
    id: "ch1",
    title: "Canal",
    primaryBot,
    botAdmins: admins.map((b) => ({ bot: b })),
  });

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue(null);
});

describe("bot qui crée les liens d'entrée", () => {
  it("bot principal normal et administrateur : c'est lui", async () => {
    channel(bot("p"), [bot("a1"), bot("p")]);
    expect((await actingBotForChannel("ch1")).bot.id).toBe("p");
  });

  it("bot principal en mode assistant : jamais choisi, le plus ancien administrateur normal le remplace", async () => {
    const assistant = bot("p", { mode: "ASSISTANT" });
    channel(assistant, [assistant, bot("a2")]);
    expect((await actingBotForChannel("ch1")).bot.id).toBe("a2");
  });

  it("seuls des assistants de conversation : refus lisible, aucun lien créé", async () => {
    const assistant = bot("p", { mode: "ASSISTANT" });
    channel(assistant, [assistant]);
    await expect(actingBotForChannel("ch1")).rejects.toThrow(LinkError);
    await expect(actingBotForChannel("ch1")).rejects.toThrow(/Aucun bot administrateur/);
  });

  it("la base ne renvoie que les administrateurs normaux et actifs, du plus ancien au plus récent", async () => {
    channel(null, [bot("a1")]);
    await actingBotForChannel("ch1");
    const args = findUnique.mock.calls[0]![0] as {
      include: { botAdmins: { where: unknown; orderBy: unknown } };
    };
    expect(args.include.botAdmins.where).toEqual({
      revokedAt: null,
      bot: { isActive: true, mode: "STANDARD" },
    });
    expect(args.include.botAdmins.orderBy).toEqual([{ detectedAt: "asc" }, { id: "asc" }]);
  });

  it("canal inconnu : refus lisible", async () => {
    await expect(actingBotForChannel("inconnu")).rejects.toThrow("Canal introuvable.");
  });
});
