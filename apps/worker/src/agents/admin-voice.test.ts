import { describe, expect, it, vi } from "vitest";

// Aucune base ni réseau : base en mémoire de la trousse de tests des agents, faux bot, faux transcripteur.
vi.mock("@linkaffipro/db", () => ({ prisma: {}, Prisma: {} }));
vi.mock("../../../../packages/agents/src/missions/lifecycle", () => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));

const { ADMIN_TG_ID, createTestKit } = await import("@linkaffipro/agents/test-kit");
const { NO_KEY, NOT_DOWNLOADED, NoTranscriptionKeyError, processAdminVoice } = await import("./admin-voice");

const ADMIN = Number(ADMIN_TG_ID);

function setup(transcript: string | null | Error, download: Uint8Array | null = new Uint8Array([1, 2, 3])) {
  const kit = createTestKit();
  const sent: Array<{ html: string; replyTo?: number }> = [];
  const transcribe = vi.fn(async () => {
    if (transcript instanceof Error) throw transcript;
    return transcript;
  });
  const deps = {
    agents: kit.deps,
    transcribe,
    botApi: vi.fn(async () => ({
      download: vi.fn(async () => download),
      send: vi.fn(async (_c: number, html: string, replyTo?: number) => void sent.push({ html, replyTo })),
    })),
    adminTelegramId: async () => ADMIN_TG_ID,
  };
  return { kit, deps, sent, transcribe };
}

const job = (chatId = ADMIN) => ({ type: "admin-voice" as const, botId: "bot_1", fileId: "f1", messageId: 55, chatId, mimeType: "audio/ogg" });

describe("vocal de l'admin dans le worker", () => {
  it("téléchargé, transcrit, traité comme « pause dating » ; la 1re ligne répond au vocal", async () => {
    const { kit, deps, sent, transcribe } = setup("Pause dating.");
    const r = await processAdminVoice(job(), deps);
    expect(r).toEqual({ ok: true, outcome: "handled" });
    expect(transcribe).toHaveBeenCalledWith({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg" });
    expect(sent).toEqual([
      { html: '🎧 J\'ai compris : "Pause dating".', replyTo: 55 },
      { html: "Équipe Rencontres en pause ⏸", replyTo: undefined },
    ]);
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ paused: true });
  });

  it("une autre personne : ignorée, rien téléchargé", async () => {
    const { deps, sent, transcribe } = setup("pause dating");
    expect(await processAdminVoice(job(999), deps)).toEqual({ ok: false, outcome: "not-admin" });
    expect(transcribe).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("incompréhensible, non téléchargé, sans clé Venice : messages clairs", async () => {
    const a = setup(null);
    expect((await processAdminVoice(job(), a.deps)).outcome).toBe("not-understood");
    expect(a.sent[0]!.html).toContain("réécris-le");
    const b = setup("x", null);
    expect((await processAdminVoice(job(), b.deps)).outcome).toBe("not-downloaded");
    expect(b.sent[0]!.html).toBe(NOT_DOWNLOADED);
    const c = setup(new NoTranscriptionKeyError());
    expect((await processAdminVoice(job(), c.deps)).outcome).toBe("no-key");
    expect(c.sent[0]!.html).toBe(NO_KEY);
  });
});
