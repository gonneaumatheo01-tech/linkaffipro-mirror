import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit } from "../human/test-kit";
import { askHuman } from "../human/requests";
import { storeLibraryMedia } from "./store";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../missions/lifecycle", () => lifecycle);
beforeEach(() => lifecycle.continueMission.mockClear());

function input(bytes: number[], caption: string) {
  return {
    bytes: new Uint8Array(bytes),
    mimeType: "video/mp4",
    filename: "v.mp4",
    caption,
    botId: "bot_1",
    telegramFileId: `f${bytes.join("")}`,
    fileUniqueId: `u${bytes.join("")}`,
  };
}

describe("dépôt dans la médiathèque", () => {
  it("range, dédoublonne, copie dans le canal Médiathèque, fait avancer la demande MEDIA", async () => {
    const kit = createTestKit();
    await kit.prisma.persona.create({ data: { name: "Léa" } as never });
    await kit.prisma.setting.create({ data: { key: "agents.libraryChannelId", value: "-1001" } });
    const m = await kit.mission();
    await askHuman(kit.deps, {
      kind: "MEDIA",
      key: "library.dating.lea",
      question: "Envoie-moi 2 vidéos avec #dating #source #lea.",
      expected: { count: 2, tags: ["dating", "source", "lea"] },
      missionId: m.id,
    });
    const copy = vi.fn(async () => ({ messageId: 77 }));
    const a = await storeLibraryMedia(kit.deps, { ...input([1], "#dating #source #lea"), copyToLibrary: copy });
    expect(a).toMatchObject({ ok: true, created: true });
    expect((a as { line: string }).line).toBe("Rangé dans la médiathèque ✅ vidéo · Rencontres · source · Léa (1/2 pour la demande en cours)");
    expect(copy).toHaveBeenCalledWith("-1001");
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ teamKey: "dating", kind: "SOURCE", origin: "HUMAN", libraryMessageId: 77 });

    const dup = await storeLibraryMedia(kit.deps, { ...input([1], "#dating #source #lea #plage"), copyToLibrary: copy });
    expect((dup as { line: string }).line).toContain("Déjà dans la médiathèque");
    expect(kit.tables("mediaAsset")).toHaveLength(1);
    expect(kit.tables("mediaAsset")[0]!.theme).toBe("plage");
    expect(copy).toHaveBeenCalledTimes(1);

    const b = await storeLibraryMedia(kit.deps, input([2], "#dating #source #lea"));
    expect((b as { line: string }).line).toContain("demande complète : 2/2");
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "ANSWERED", answerSummary: "2/2 reçus" });
    expect(lifecycle.continueMission).toHaveBeenCalledWith(kit.deps, m.id, { reason: "réponse du client" });
    expect(kit.tables("mediaAssetTelegramFile")).toHaveLength(2);
  });

  it("sans mot-clé : rien n'est rangé", async () => {
    const kit = createTestKit();
    expect(await storeLibraryMedia(kit.deps, input([3], "jolie vidéo"))).toMatchObject({ ok: false });
    expect(kit.tables("mediaAsset")).toHaveLength(0);
  });
});
