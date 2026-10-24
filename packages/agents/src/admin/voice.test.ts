import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit, journalText } from "../human/test-kit";
import { askHuman } from "../human/requests";
import { handleAdminVoice, VOICE_NOT_UNDERSTOOD, voiceToAdminText } from "./voice";
import { VOICE_SECRET_REFUSAL } from "./handle";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../missions/lifecycle", () => lifecycle);
beforeEach(() => lifecycle.continueMission.mockClear());

function run(kit: ReturnType<typeof createTestKit>, transcript: string | null, replyToMessageId?: number) {
  const said: string[] = [];
  const p = handleAdminVoice(kit.deps, { transcript, messageId: 9, replyToMessageId }, async (h) => {
    said.push(h);
  });
  return p.then((r) => ({ ...r, said }));
}

describe("texte d'un vocal", () => {
  it("ponctuation d'élocution, nombres en lettres, oui / non", () => {
    expect(voiceToAdminText("Pause, dating.")).toBe("Pause dating");
    expect(voiceToAdminText("« Le deux. »")).toBe("2");
    expect(voiceToAdminText("Trois !")).toBe("3");
    expect(voiceToAdminText("OK, douze.")).toBe("OK 12");
    expect(voiceToAdminText("Oui, vas-y.")).toBe("oui");
    expect(voiceToAdminText("Non merci.")).toBe("non");
    expect(voiceToAdminText("Non 12 trop long")).toBe("Non 12 trop long");
    expect(voiceToAdminText("https://hf.co/x/lea.safetensors")).toBe("https://hf.co/x/lea.safetensors");
  });
});

describe("vocaux de l'admin", () => {
  it("vocal → commande « pause dating », avec la ligne « J'ai compris » d'abord", async () => {
    const kit = createTestKit();
    const r = await run(kit, "Pause dating.");
    expect(r.outcome).toBe("handled");
    expect(r.said).toEqual(['🎧 J\'ai compris : "Pause dating".', "Équipe Rencontres en pause ⏸"]);
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ teamKey: "dating", paused: true });
  });

  it("vocal → réponse à une demande CHOICE (« le deux ») puis CONFIRM (« oui »)", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "CHOICE", key: "test.choice", question: "Lequel ?", options: ["A", "B", "C"] });
    await askHuman(kit.deps, { kind: "CONFIRM", key: "test.confirm", question: "On y va ?" });
    const c = await run(kit, "Le deux.");
    expect(c.outcome).toBe("handled");
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "ANSWERED", answerSummary: "2. B" });
    // La question suivante part après la réponse.
    expect(kit.sent.at(-1)!.html).toContain("On y va ?");
    await run(kit, "Oui, vas-y.");
    expect(kit.tables("humanRequest")[1]).toMatchObject({ status: "ANSWERED", answerSummary: "oui" });
  });

  it("« vrai dating » par vocal demande OUI ; un niveau aussi, même pour baisser", async () => {
    const kit = createTestKit();
    await run(kit, "Vrai dating");
    expect(kit.sent.at(-1)!.html).toContain("Passer l'équipe Rencontres en vrai ?");
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
    await run(kit, "non");
    await run(kit, "Niveau casino un");
    expect(kit.sent.at(-1)!.html).toContain("Passer l'équipe Casino au niveau 1");
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
  });

  it("vocal incompréhensible → « je n'ai pas compris, réécris-le »", async () => {
    const kit = createTestKit();
    expect((await run(kit, null)).said).toEqual([VOICE_NOT_UNDERSTOOD]);
    expect((await run(kit, " … ")).said).toEqual([VOICE_NOT_UNDERSTOOD]);
    const r = await run(kit, "bla bla le chat");
    expect(r.outcome).toBe("unhandled");
    expect(r.said[1]).toContain("réécris-le");
  });

  it("vocal pendant une demande SECRET : refusé, rien enregistré ni répété ni journalisé", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé fal ?" });
    const r = await run(kit, "ma clé c'est abcd1234efgh5678");
    expect(r.outcome).toBe("secret-refused");
    expect(r.said).toEqual([VOICE_SECRET_REFUSAL]);
    expect(kit.tables("setting").some((s) => String(s.key).startsWith("agents.secret."))).toBe(false);
    expect(kit.tables("humanRequest")[0]!.status).toBe("PENDING");
    expect(journalText(kit)).not.toContain("abcd1234");
    // En réponse au message de la question aussi.
    const msgId = kit.sent[0]!.messageId;
    expect((await run(kit, "zz99zz99zz99", msgId)).outcome).toBe("secret-refused");
    // « clé fal … » dicté sans demande : refusé.
    const kit2 = createTestKit();
    expect((await run(kit2, "clé fal abcdef123456")).said).toEqual([VOICE_SECRET_REFUSAL]);
    expect(kit2.tables("setting").some((s) => String(s.key).startsWith("agents.secret."))).toBe(false);
  });

  it("pendant une demande SECRET, « plus tard » par vocal passe la question", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé fal ?" });
    const r = await run(kit, "Plus tard.");
    expect(r.outcome).toBe("handled");
    expect(kit.tables("humanRequest")[0]!.status).toBe("SKIPPED");
  });
});
