import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Actions « Liens de partage » de la fiche canal : un responsable peut créer et désactiver (D9), les champs sont
 * validés, les refus reviennent en français dans l'écran, la fiche est rafraîchie après chaque changement. La logique
 * (Telegram, base, journal) est simulée ici : voir lib/channels/share-links.test.ts et l'intégration.
 */

const state = vi.hoisted(() => ({
  role: "MANAGER" as "ADMIN" | "MANAGER",
  loggedIn: true,
  revalidated: [] as string[],
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    state.revalidated.push(p);
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => {
    if (!state.loggedIn)
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    return { id: "u1", role: state.role, telegramUserId: null };
  }),
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: { channel: { findUnique: vi.fn(async () => ({ title: "Zone Interdite" })) } },
}));
const logic = vi.hoisted(() => ({
  create: vi.fn(),
  disable: vi.fn(),
}));
vi.mock("@/lib/channels/share-links", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/channels/share-links")>();
  return { ...orig, createShareLink: logic.create, disableShareLink: logic.disable };
});
vi.mock("@linkaffipro/telegram", () => ({}));
vi.mock("@/lib/approval/telegram", () => ({ actingBotFor: vi.fn() }));

const { createShareLinkAction, disableShareLinkAction } = await import("./share-links-actions");
const { ShareLinkError } = await import("@/lib/channels/share-links");

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.role = "MANAGER";
  state.loggedIn = true;
  state.revalidated = [];
  logic.create.mockReset();
  logic.disable.mockReset();
});

describe("créer un lien de partage", () => {
  it("un responsable crée un lien nommé, « À poster dans » facultatif ; la fiche est rafraîchie", async () => {
    logic.create.mockResolvedValue({ id: "l1", name: "Post Tir Cadré", url: "https://t.me/+abc" });
    const r = await createShareLinkAction(
      null,
      fd({ channelId: "zone", name: "  Post  Tir Cadré ", sourceChannelId: "tir" }),
    );
    expect(r).toEqual({ created: { id: "l1", name: "Post Tir Cadré", url: "https://t.me/+abc" } });
    expect(logic.create).toHaveBeenCalledWith({
      channelId: "zone",
      name: "Post Tir Cadré",
      sourceChannelId: "tir",
      userId: "u1",
    });
    expect(state.revalidated).toEqual(["/channels/zone"]);

    await createShareLinkAction(
      null,
      fd({ channelId: "zone", name: "Story", sourceChannelId: "" }),
    );
    expect(logic.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Story", sourceChannelId: null }),
    );
  });

  it("champs refusés avant tout appel : nom vide ou trop long, canal absent", async () => {
    expect(await createShareLinkAction(null, fd({ channelId: "zone", name: "  " }))).toEqual({
      error: "Donnez un nom au lien (par exemple « Post Tir Cadré »).",
    });
    expect(
      (await createShareLinkAction(null, fd({ channelId: "zone", name: "x".repeat(70) })))?.error,
    ).toMatch(/trop long/);
    expect(await createShareLinkAction(null, fd({ name: "Story" }))).toEqual({
      error: "Canal introuvable : rechargez la page.",
    });
    expect(logic.create).not.toHaveBeenCalled();
    expect(state.revalidated).toEqual([]);
  });

  it("refus de Telegram : le message en français revient dans le volet", async () => {
    logic.create.mockRejectedValue(
      new ShareLinkError("Telegram refuse que @zone_bot crée un lien dans « Zone Interdite ». …"),
    );
    expect(await createShareLinkAction(null, fd({ channelId: "zone", name: "Story" }))).toEqual({
      error: "Telegram refuse que @zone_bot crée un lien dans « Zone Interdite ». …",
    });
    expect(state.revalidated).toEqual([]);
  });

  it("une erreur inattendue n'est pas maquillée ; sans session : renvoi à la connexion", async () => {
    logic.create.mockRejectedValue(new Error("base indisponible"));
    await expect(
      createShareLinkAction(null, fd({ channelId: "zone", name: "Story" })),
    ).rejects.toThrow("base indisponible");
    state.loggedIn = false;
    await expect(
      createShareLinkAction(null, fd({ channelId: "zone", name: "Story" })),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("désactiver un lien de partage", () => {
  it("un responsable désactive : message de réussite, fiche rafraîchie", async () => {
    logic.disable.mockResolvedValue({
      name: "Post",
      revokedOnTelegram: true,
      error: null,
      bot: "zone_bot",
      alreadyDisabled: false,
    });
    const r = await disableShareLinkAction(fd({ channelId: "zone", linkId: "l1" }));
    expect(r).toEqual({
      ok: "Lien « Post » désactivé : il ne fonctionne plus dans Telegram. Les demandes déjà reçues restent.",
    });
    expect(logic.disable).toHaveBeenCalledWith({ channelId: "zone", linkId: "l1", userId: "u1" });
    expect(state.revalidated).toEqual(["/channels/zone"]);
  });

  it("désactivé ici mais pas chez Telegram : dit comme un avertissement", async () => {
    logic.disable.mockResolvedValue({
      name: "Post",
      revokedOnTelegram: false,
      error: "403",
      bot: "zone_bot",
      alreadyDisabled: false,
    });
    const r = await disableShareLinkAction(fd({ channelId: "zone", linkId: "l1" }));
    expect(r.error).toMatch(/désactivé ici, mais Telegram n'a pas pu le retirer/);
    expect(state.revalidated).toEqual(["/channels/zone"]);
  });

  it("lien introuvable ou Telegram injoignable : message, rien n'est rafraîchi", async () => {
    expect(await disableShareLinkAction(fd({ channelId: "zone" }))).toEqual({
      error: "Lien introuvable : rechargez la page.",
    });
    logic.disable.mockRejectedValue(new ShareLinkError("Telegram ne répond pas pour l'instant."));
    expect(await disableShareLinkAction(fd({ channelId: "zone", linkId: "l1" }))).toEqual({
      error: "Telegram ne répond pas pour l'instant.",
    });
    expect(state.revalidated).toEqual([]);
  });

  it("administrateur : mêmes droits", async () => {
    state.role = "ADMIN";
    logic.disable.mockResolvedValue({
      name: "Post",
      revokedOnTelegram: true,
      error: null,
      bot: "b",
      alreadyDisabled: true,
    });
    expect(await disableShareLinkAction(fd({ channelId: "zone", linkId: "l1" }))).toEqual({
      ok: "Le lien « Post » était déjà désactivé.",
    });
  });
});
