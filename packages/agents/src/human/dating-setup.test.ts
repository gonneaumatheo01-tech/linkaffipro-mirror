import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit, journalText } from "./test-kit";
import { handleAdminText } from "../admin/handle";
import { storeLibraryMedia } from "../library/store";
import { DATING_SETUP_SETTING, datingPersonas, ensureDatingSetupQuestions } from "./dating-setup";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../missions/lifecycle", () => lifecycle);
beforeEach(() => {
  lifecycle.continueMission.mockClear();
});

async function setup() {
  const kit = createTestKit();
  const lea = await kit.prisma.persona.create({ data: { name: "Léa", isActive: true, identityKind: "GIRL", referenceImageIds: [] } as never });
  const offer = await kit.prisma.affiliateCampaign.create({ data: { vertical: "CASINO" } as never });
  await kit.prisma.persona.create({ data: { name: "Max", isActive: true, identityKind: "ASSISTANT", affiliateCampaignId: offer.id, referenceImageIds: [] } as never });
  await kit.prisma.persona.create({ data: { name: "Zoé", isActive: false, identityKind: "GIRL", referenceImageIds: [] } as never });
  return { kit, lea };
}

/** Répond à la question en cours (comme l'admin sur Telegram), puis envoie la suivante. */
async function answer(kit: ReturnType<typeof createTestKit>, text: string) {
  const r = await handleAdminText(kit.deps, { text, messageId: 1, replyToMessageId: kit.sent.at(-1)!.messageId });
  await r.followUp?.();
  return r;
}

function photo(n: number, caption: string) {
  return {
    bytes: new Uint8Array([n, n, n]),
    mimeType: "image/jpeg",
    filename: `p${n}.jpg`,
    caption,
    botId: "bot_1",
    telegramFileId: `f${n}`,
    fileUniqueId: `u${n}`,
  };
}

describe("questions de mise en route Dating", () => {
  it("personas Dating : actives, fille ou rattachées à Dating", async () => {
    const { kit, lea } = await setup();
    expect((await datingPersonas(kit.deps)).map((p) => p.id)).toEqual([lea.id]);
  });

  it("ordre des questions, une seule fois", async () => {
    const { kit, lea } = await setup();
    expect(await ensureDatingSetupQuestions(kit.deps)).toEqual({ queued: 4 });
    expect(kit.tables("humanRequest").map((r) => `${r.kind} ${r.key}`)).toEqual([
      "SECRET providers.fal.apiKey",
      `TEXT persona.${lea.id}.loraUrl`,
      `TEXT persona.${lea.id}.loraTrigger`,
      `MEDIA persona.${lea.id}.referenceImages`,
    ]);
    expect(kit.tables("humanRequest")[3]!.expected).toMatchObject({ count: 1, tags: ["dating", "reference", "lea"] });
    // Une seule question envoyée à la fois : la première.
    expect(kit.sent).toHaveLength(1);
    expect(kit.sent[0]!.html).toContain("https://fal.ai/dashboard/keys");
    expect(kit.tables("setting").some((s) => s.key === DATING_SETUP_SETTING)).toBe(true);
    // Idempotent.
    expect(await ensureDatingSetupQuestions(kit.deps)).toEqual({ queued: 0 });
    expect(kit.tables("humanRequest")).toHaveLength(4);
    // Questions courtes (5 lignes au plus).
    for (const r of kit.tables("humanRequest")) expect(String(r.question).split("\n").length).toBeLessThanOrEqual(5);
  });

  it("réponses : clé, LoRA, déclencheur, photo de référence ; plus de question sur les vidéos", async () => {
    const { kit, lea } = await setup();
    await ensureDatingSetupQuestions(kit.deps);
    const key = await answer(kit, "fal_key_abcdef123456");
    expect(key.deleteMessage).toBe(true);
    expect(journalText(kit)).not.toContain("abcdef123456");

    await answer(kit, "https://huggingface.co/x/resolve/main/lea.safetensors");
    await answer(kit, "« leagirl »");
    const p = kit.tables("persona").find((x) => x.id === lea.id)!;
    expect(p).toMatchObject({ loraUrl: "https://huggingface.co/x/resolve/main/lea.safetensors", loraTrigger: "leagirl" });

    // Photo de référence déposée : la demande MEDIA se clôt et l'image va dans la persona.
    await storeLibraryMedia(kit.deps, photo(1, "#dating #reference #lea"));
    expect(kit.tables("humanRequest")[3]!.status).toBe("ANSWERED");
    expect(kit.tables("persona").find((x) => x.id === lea.id)!.referenceImageIds).toHaveLength(1);

    expect(kit.tables("humanRequest").every((r) => r.status !== "QUEUED" && r.status !== "PENDING")).toBe(true);
    expect(kit.sent.map((m) => m.html).join("\n")).not.toMatch(/vidéos sources|Plafond des vidéos|banc d'essai/);
  });


  it("anciennes questions du plafond vidéo et du banc d'essai encore ouvertes : réponse claire, rien n'est réglé", async () => {
    const { kit, lea } = await setup();
    await kit.prisma.setting.create({ data: { key: DATING_SETUP_SETTING, value: { askedAt: "x" } } });
    await kit.prisma.humanRequest.create({ data: { teamKey: "dating", kind: "CHOICE", key: "agents.team.dating.videoBudget", question: "Plafond des vidéos IA ?", options: ["50 €", "100 €", "200 €"], status: "PENDING", onAnswer: { action: "dating-video-budget", resume: false } } as never });
    await kit.prisma.humanRequest.create({ data: { teamKey: "dating", kind: "CONFIRM", key: `persona.${lea.id}.bench`, question: "Banc d'essai ?", status: "QUEUED", onAnswer: { action: "dating-bench", personaId: lea.id, resume: false } } as never });
    const r = await handleAdminText(kit.deps, { text: "2", messageId: 1 });
    expect(r.reply).toContain("Les vidéos IA ne sont plus produites");
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
  });

  it("adresse LoRA refusée (http), acceptée avec doute (hôte inconnu)", async () => {
    const { kit } = await setup();
    await kit.prisma.setting.create({ data: { key: "agents.secret.providers.fal.apiKey", value: { enc: "x", last4: "abcd" } } });
    await ensureDatingSetupQuestions(kit.deps);
    const bad = await answer(kit, "http://exemple.com/lea.safetensors");
    expect(bad.reply).toContain("https://");
    const ok = await answer(kit, "https://exemple.com/lea");
    expect(ok.reply).toContain("vérifie");
  });


});

describe("photos de référence", () => {
  it("la plus récente d'abord, 3 au plus", async () => {
    const { kit, lea } = await setup();
    for (let n = 1; n <= 4; n++) await storeLibraryMedia(kit.deps, photo(n, "#dating #reference #lea"));
    const ids = kit.tables("mediaAsset").map((a) => a.id);
    expect(kit.tables("persona").find((x) => x.id === lea.id)!.referenceImageIds).toEqual([ids[3], ids[2], ids[1]]);
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ kind: "REFERENCE", personaId: lea.id, origin: "HUMAN" });
  });

  it("vidéo #dating #source #lea : SOURCE / HUMAN / persona", async () => {
    const { kit, lea } = await setup();
    await storeLibraryMedia(kit.deps, { ...photo(9, "#dating #source #Léa"), mimeType: "video/mp4", filename: "v.mp4" });
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ kind: "SOURCE", origin: "HUMAN", personaId: lea.id, teamKey: "dating" });
  });
});
