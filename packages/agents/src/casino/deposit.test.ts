import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit, ADMIN_TG_ID } from "../human/test-kit";
import { storeLibraryMedia, libraryAlbumLine } from "../library/store";
import { handleAgentsCallback } from "../admin/callbacks";
import { handleAdminText } from "../admin/handle";
import { classifyCasinoMedia, type CasinoStockRow } from "./contracts";
import { stockPhrase } from "./deposit";

const stock = vi.hoisted(() => ({ rows: null as CasinoStockRow[] | null }));
vi.mock("./contracts", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  casinoStock: vi.fn(async () => {
    if (!stock.rows) throw new Error("casinoStock : à écrire (chantier A)");
    return stock.rows;
  }),
}));
vi.mock("../missions/lifecycle", () => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
beforeEach(() => {
  stock.rows = null;
});

function input(bytes: number[], caption: string, mimeType = "video/mp4") {
  return {
    bytes: new Uint8Array(bytes),
    mimeType,
    filename: mimeType.startsWith("image/") ? "i.jpg" : "v.mp4",
    caption,
    botId: "bot_1",
    telegramFileId: `f${bytes.join("")}`,
    fileUniqueId: `u${bytes.join("")}`,
  };
}

const row = (theme: string, unused: number, channelId = "c1"): CasinoStockRow => ({
  channelId,
  channelTitle: channelId,
  theme,
  unused,
  state: unused === 0 ? "empty" : unused < 3 ? "low" : "ok",
});

describe("dépôt casino par le bot", () => {
  it("plusieurs thèmes : rangée HUMAN, SOURCE, thème principal + theme:<clé>, ligne avec le stock", async () => {
    const kit = createTestKit();
    stock.rows = [row("roulette", 4), row("bonus", 2), row("bonus", 5, "c2")];
    const r = await storeLibraryMedia(kit.deps, input([1], "#casino #roulette #bonus"));
    expect(r).toMatchObject({ ok: true, created: true, casino: { themes: ["roulette", "bonus"], unknownThemes: [] } });
    expect(r.line).toBe("Vidéo rangée ✅ roulette, 4 médias non utilisés ; bonus, 2 à 5 médias non utilisés selon le canal");
    expect(kit.tables("mediaAsset")[0]).toMatchObject({
      teamKey: "casino",
      origin: "HUMAN",
      kind: "SOURCE",
      theme: "roulette",
      personaId: null,
      tags: ["casino", "theme:roulette", "theme:bonus"],
    });
  });

  it("image → PHOTO ; synonyme ; stock indisponible → confirmation sans les chiffres", async () => {
    const kit = createTestKit();
    const r = await storeLibraryMedia(kit.deps, input([2], "#casino #slots", "image/jpeg"));
    expect(r.line).toBe("Image rangée ✅ machines-a-sous");
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ kind: "PHOTO", theme: "machines-a-sous" });
  });

  it("doublon : thèmes fusionnés, thème principal gardé", async () => {
    const kit = createTestKit();
    await storeLibraryMedia(kit.deps, input([3], "#casino #roulette"));
    const dup = await storeLibraryMedia(kit.deps, input([3], "#casino #bonus"));
    expect(dup).toMatchObject({ ok: true, created: false });
    expect(dup.line).toBe("Vidéo déjà rangée : thèmes mis à jour ✅ roulette, bonus");
    expect(kit.tables("mediaAsset")).toHaveLength(1);
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ theme: "roulette", tags: ["casino", "theme:roulette", "theme:bonus"] });
  });

  it("#casino seul : « à classer », la ligne le dit ; classement par classifyCasinoMedia (thèmes connus, AuditLog)", async () => {
    const kit = createTestKit();
    const r = await storeLibraryMedia(kit.deps, input([4], "#casino"));
    expect(r.line).toBe("Vidéo rangée ✅ à classer dans la fiche Casino du site (aucun thème reconnu)");
    const asset = kit.tables("mediaAsset")[0]!;
    expect(asset).toMatchObject({ teamKey: "casino", theme: null, tags: ["casino", "a-classer"] });

    const actor = { userId: "u_admin", via: "SITE" as const };
    expect(await classifyCasinoMedia(kit.deps, { assetId: asset.id as string, themes: ["poker"] }, actor)).toMatchObject({ ok: false });
    expect(await classifyCasinoMedia(kit.deps, { assetId: asset.id as string, themes: [] }, actor)).toMatchObject({ ok: false });
    const ok = await classifyCasinoMedia(kit.deps, { assetId: asset.id as string, themes: ["Jackpot", "#live"] }, actor);
    expect(ok).toEqual({ ok: true, message: "Média classé ✅ jackpot, live" });
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ theme: "jackpot", tags: ["casino", "theme:jackpot", "theme:live"] });
    expect(kit.tables("auditLog").find((a) => a.action === "agents.casino.media_classified")).toMatchObject({
      userId: "u_admin",
      entityId: asset.id,
      metadata: { before: [], after: ["jackpot", "live"], via: "SITE" },
    });
  });

  it("thème inconnu : « à classer » + question à bouton ; le bouton (admin seulement) crée le thème et classe", async () => {
    const kit = createTestKit();
    await kit.prisma.agentTeamConfig.create({ data: { teamKey: "casino", settings: { casino: { lowStock: 4 }, other: 1 } } as never });
    const r = await storeLibraryMedia(kit.deps, input([5], "#casino #crash"));
    expect(r.line).toBe(
      "Vidéo rangée ✅ à classer dans la fiche Casino du site (aucun thème reconnu) · thème inconnu : crash (je te demande s'il faut le créer)",
    );
    // Un 2e média avec le même thème inconnu s'ajoute à la même question.
    await storeLibraryMedia(kit.deps, input([6], "#casino #crash #roulette"));
    expect(kit.tables("humanRequest")).toHaveLength(1);
    const req = kit.tables("humanRequest")[0]!;
    expect(req).toMatchObject({ kind: "CONFIRM", key: "casino.theme.crash", status: "PENDING", teamKey: "casino" });
    const question = kit.sent.find((m) => m.html.includes("crash"))!;
    expect(question.buttons).toEqual([
      [
        { text: "Créer le thème crash", callbackData: `agh:${req.id}:oui` },
        { text: "Non", callbackData: `agh:${req.id}:non` },
      ],
    ]);

    // Quelqu'un d'autre : ignoré en silence.
    expect(await handleAgentsCallback(kit.deps, { data: `agh:${req.id}:oui`, fromTelegramId: 999n })).toEqual({ handled: true });
    expect(kit.tables("humanRequest")[0]!.status).toBe("PENDING");

    const click = await handleAgentsCallback(kit.deps, { data: `agh:${req.id}:oui`, fromTelegramId: ADMIN_TG_ID });
    expect(click).toMatchObject({ handled: true, removeButtons: true, reply: "Thème « crash » créé ✅ ; 2 médias rangés dedans." });
    expect(kit.tables("humanRequest")[0]!.status).toBe("ANSWERED");
    const team = kit.tables("agentTeamConfig")[0]!;
    expect(team.settings).toEqual({ casino: { lowStock: 4, themes: [...(await import("./contracts")).CASINO_DEFAULT_THEMES, "crash"] }, other: 1 });
    const [a, b] = kit.tables("mediaAsset");
    expect(a).toMatchObject({ theme: "crash", tags: ["casino", "theme:crash"] });
    expect(b).toMatchObject({ theme: "roulette", tags: ["casino", "theme:roulette", "theme:crash"] });
    expect(kit.tables("auditLog").some((x) => x.action === "agents.casino.theme_created")).toBe(true);

    // Le thème existe : un nouveau dépôt est rangé directement.
    const next = await storeLibraryMedia(kit.deps, input([7], "#casino #crash"));
    expect(next.line).toBe("Vidéo rangée ✅ crash");
  });

  it("thème inconnu refusé par écrit (« non ») : rien n'est créé, le média reste à classer", async () => {
    const kit = createTestKit();
    await storeLibraryMedia(kit.deps, input([8], "#casino #crash"));
    const r = await handleAdminText(kit.deps, { text: "non", messageId: 1, replyToMessageId: null });
    expect(r.reply).toContain("le média reste à classer");
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ theme: null, tags: ["casino", "a-classer"] });
  });

  it("album : une seule ligne", async () => {
    const kit = createTestKit();
    stock.rows = [row("roulette", 6)];
    const results = [];
    for (const n of [9, 10, 11]) results.push(await storeLibraryMedia(kit.deps, input([n], "#casino #roulette")));
    results.push(await storeLibraryMedia(kit.deps, input([12], "#casino")));
    expect(await libraryAlbumLine(kit.deps, results, 1)).toBe(
      "4 médias rangés ✅ roulette, 6 médias non utilisés · 1 à classer dans la fiche Casino du site\n1 média n'a pas pu être rangé : renvoie-le.",
    );
  });

  it("formule du stock", () => {
    expect(stockPhrase("live", [])).toBe("live (sur aucun canal casino pour l'instant)");
    expect(stockPhrase("live", [row("live", 1)])).toBe("live, 1 média non utilisé");
    expect(stockPhrase("live", [row("live", 0), row("live", 0, "c2")])).toBe("live, 0 média non utilisé");
  });
});
