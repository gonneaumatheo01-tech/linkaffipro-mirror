/**
 * Réglages d'un canal : un bot en mode assistant de conversation ne devient jamais « Bot principal » (phase 17). Le
 * formulaire ne le propose pas ; une valeur envoyée à la main est refusée par le serveur, sans rien enregistrer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace", url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: "MANAGER" })),
}));
vi.mock("@linkaffipro/telegram", () => ({
  importChannelByChatId: vi.fn(),
  importChannelByUsername: vi.fn(),
  importedChannelMessage: vi.fn(),
  listActiveBots: vi.fn(),
  mapWithLimit: vi.fn(),
  recheckAllChannelRights: vi.fn(),
}));
const db = vi.hoisted(() => ({
  botFindUnique: vi.fn(async (_args: unknown) => null as { mode: string } | null),
  channelUpdate: vi.fn(async (_args: unknown) => ({})),
  audit: vi.fn(async (_args: unknown) => undefined),
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: { bot: { findUnique: db.botFindUnique }, channel: { update: db.channelUpdate } },
  audit: db.audit,
}));

import { updateChannelAction } from "./actions";

function form(primaryBotId: string): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    channelId: "ch1",
    vertical: "CASINO",
    language: "fr",
    primaryBotId,
    isActive: "on",
    returnTo: "/channels/ch1?tab=rules",
  }))
    fd.append(k, v);
  return fd;
}

async function run(fd: FormData): Promise<URLSearchParams> {
  try {
    await updateChannelAction(fd);
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return new URLSearchParams(url.split("?")[1] ?? "");
    throw err;
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("réglages du canal : bot principal", () => {
  it("bot normal : enregistré", async () => {
    db.botFindUnique.mockResolvedValueOnce({ mode: "STANDARD" });
    const q = await run(form("b1"));
    expect(q.get("ok")).toBe("Réglages du canal enregistrés.");
    expect(db.channelUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ primaryBotId: "b1" }) }),
    );
  });

  it("bot en mode assistant de conversation : refusé, rien n'est enregistré", async () => {
    db.botFindUnique.mockResolvedValueOnce({ mode: "ASSISTANT" });
    const q = await run(form("b2"));
    expect(q.get("error")).toMatch(
      /assistant de conversation : il ne peut pas être le bot principal/,
    );
    expect(db.channelUpdate).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("bot inconnu : refusé, rien n'est enregistré", async () => {
    const q = await run(form("inconnu"));
    expect(q.get("error")).toMatch(/introuvable/);
    expect(db.channelUpdate).not.toHaveBeenCalled();
  });

  it("aucun bot principal (le premier bot administrateur) : enregistré sans lecture des bots", async () => {
    const q = await run(form(""));
    expect(q.get("ok")).toBe("Réglages du canal enregistrés.");
    expect(db.botFindUnique).not.toHaveBeenCalled();
    expect(db.channelUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ primaryBotId: null }) }),
    );
  });
});
