import { describe, expect, it, vi } from "vitest";

// Phase 26 : la tâche `boss-text` mesure son attente en file et ne laisse jamais le texte de l'admin dans Redis.
vi.mock("../agents/deps", () => ({ workerAgentsDeps: () => ({}) }));
vi.mock("../agents/admin-voice", () => ({ processAdminVoice: vi.fn() }));
vi.mock("@linkaffipro/agents", () => ({}));
const processBossText = vi.hoisted(() => vi.fn(async () => ({ ok: true, outcome: "answered" })));
vi.mock("../agents/boss-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/boss-text")>()),
  processBossText,
}));
const logged = vi.hoisted(() => ({ info: [] as unknown[], warn: [] as unknown[] }));
vi.mock("../logger", () => ({
  logger: {
    info: (o: unknown) => void logged.info.push(o),
    warn: (o: unknown) => void logged.warn.push(o),
    error: () => undefined,
  },
}));

const { processAgentsOrchestrator } = await import("./agents-orchestrator");
const { bossTextWaitMs, scrubbedBossTextJob, BOSS_TEXT_SLOW_WAIT_MS } = await import("../agents/boss-text");

const data = {
  type: "boss-text" as const,
  botId: "b",
  chatId: 1,
  messageId: 2,
  text: "voici mon texte privé",
  entities: [{ type: "bold", offset: 0, length: 5 }],
};

function fakeJob(over: { timestamp: number; processedOn: number; delay?: number }) {
  const updates: unknown[] = [];
  return {
    job: {
      id: "boss-text-b-2",
      data,
      timestamp: over.timestamp,
      processedOn: over.processedOn,
      opts: over.delay ? { delay: over.delay } : {},
      updateData: vi.fn(async (d: unknown) => void updates.push(d)),
    } as never,
    updates,
  };
}

describe("tâche boss-text : attente mesurée, texte effacé de Redis", () => {
  it("attente = début − mise en file − délai demandé ; jamais négative ; absente sans horodatage", () => {
    expect(bossTextWaitMs({ timestamp: 1000, processedOn: 4000 })).toBe(3000);
    expect(bossTextWaitMs({ timestamp: 1000, processedOn: 4000, opts: { delay: 2000 } })).toBe(1000);
    expect(bossTextWaitMs({ timestamp: 5000, processedOn: 4000 })).toBe(0);
    expect(bossTextWaitMs({})).toBeNull();
  });

  it("attente courte : journal info ; longue (> 20 s) : avertissement ; données gardées sans le texte", async () => {
    const a = fakeJob({ timestamp: 0, processedOn: 1500 });
    await processAgentsOrchestrator(a.job);
    expect(processBossText).toHaveBeenCalledWith(data);
    expect(logged.info.at(-1)).toMatchObject({ waitMs: 1500 });
    expect(a.updates).toEqual([{ ...data, text: "", entities: null }]);

    const b = fakeJob({ timestamp: 0, processedOn: BOSS_TEXT_SLOW_WAIT_MS + 5000 });
    await processAgentsOrchestrator(b.job);
    expect(logged.warn.at(-1)).toMatchObject({ waitMs: BOSS_TEXT_SLOW_WAIT_MS + 5000 });
  });

  it("traitement en erreur : le texte est effacé quand même", async () => {
    processBossText.mockRejectedValueOnce(new Error("panne"));
    const c = fakeJob({ timestamp: 0, processedOn: 10 });
    await expect(processAgentsOrchestrator(c.job)).rejects.toThrow("panne");
    expect(c.updates).toHaveLength(1);
    expect(JSON.stringify(c.updates)).not.toContain("texte privé");
    expect(scrubbedBossTextJob({ ...data, mentions: [{ username: "x" }] }).mentions).toEqual([]);
  });
});
