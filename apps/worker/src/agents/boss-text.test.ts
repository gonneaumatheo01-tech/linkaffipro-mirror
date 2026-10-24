import { describe, expect, it, vi } from "vitest";

// Aucune base ni réseau : faux bot, faux moteur du Boss, repère « déjà traité » en mémoire.
vi.mock("@linkaffipro/db", () => ({ prisma: {}, Prisma: {} }));

const { BOSS_INTERRUPTED_REPLY, processBossText } = await import("./boss-text");
const { BOSS_ERROR_REPLY } = await import("@linkaffipro/telegram");

const ADMIN = 4242;
const job = (over: Record<string, unknown> = {}) => ({
  type: "boss-text" as const,
  botId: "boss_1",
  chatId: ADMIN,
  messageId: 77,
  text: "combien j'ai dépensé ce mois",
  ...over,
});

function setup(opts: { aiThrows?: boolean; turnStatus?: string | null } = {}) {
  const sent: Array<{ text: string; other?: Record<string, unknown> }> = [];
  const turns = new Map<number, { status: string | null }>();
  if (opts.turnStatus !== undefined) turns.set(77, { status: opts.turnStatus });
  const aiTurn = vi.fn(async (_d: unknown, input: { messageId: number }) => {
    if (opts.aiThrows) throw new Error("IA en panne");
    turns.set(input.messageId, { status: "done" });
    return { reply: "Ce mois : 12,40 €", buttons: [[{ text: "Détail", callbackData: "bsc:x:yes" }]], pendingId: "p9" };
  });
  const remember = vi.fn(async () => undefined);
  const deps = {
    agents: { prisma: {}, enqueue: { orchestrator: vi.fn(), step: vi.fn() } } as never,
    engine: { aiTurn, rememberPendingMessage: remember } as never,
    loadLlm: vi.fn(async () => null),
    botApi: vi.fn(async () => ({
      sendMessage: vi.fn(async (_c: number, text: string, other?: Record<string, unknown>) => {
        sent.push({ text, other });
        return { message_id: 900 + sent.length };
      }),
      deleteMessage: vi.fn(async () => true),
    })),
    adminTelegramId: async () => BigInt(ADMIN),
    bossTurnFor: async (messageId: number) => turns.get(messageId) ?? null,
  };
  return { deps, sent, aiTurn, remember };
}

describe("tâche boss-text (phase 26)", () => {
  it("interprète appelé une fois, réponse en « Répondre » au message, boutons, confirmation mémorisée", async () => {
    const t = setup();
    expect(await processBossText(job(), t.deps)).toEqual({ ok: true, outcome: "answered" });
    expect(t.aiTurn).toHaveBeenCalledTimes(1);
    const input = t.aiTurn.mock.calls[0]![1] as Record<string, unknown>;
    expect(input).toMatchObject({ text: "combien j'ai dépensé ce mois", source: "text", speaker: { kind: "admin" }, chat: { type: "private" } });
    expect(t.sent[0]!.other).toMatchObject({ reply_parameters: { message_id: 77 }, reply_markup: { inline_keyboard: [[{ text: "Détail", callback_data: "bsc:x:yes" }]] } });
    expect(t.remember).toHaveBeenCalledWith(expect.anything(), "p9", 901);
  });

  it("tâche rejouée (worker redémarré) : jamais de double exécution", async () => {
    const t = setup();
    await processBossText(job(), t.deps);
    expect(await processBossText(job(), t.deps)).toEqual({ ok: true, outcome: "already-done" });
    expect(t.aiTurn).toHaveBeenCalledTimes(1);
    expect(t.sent).toHaveLength(1);
  });

  it("premier passage interrompu en route : rien n'est refait, l'admin est prévenu", async () => {
    const t = setup({ turnStatus: "running" });
    expect((await processBossText(job(), t.deps)).outcome).toBe("interrupted");
    expect(t.aiTurn).not.toHaveBeenCalled();
    expect(t.sent[0]!.text).toBe(BOSS_INTERRUPTED_REPLY);
  });

  it("erreur de l'interprète : « Oups… » quand même, jamais de silence", async () => {
    const t = setup({ aiThrows: true });
    expect(await processBossText(job(), t.deps)).toEqual({ ok: false, outcome: "error" });
    expect(t.sent.map((s) => s.text)).toEqual([BOSS_ERROR_REPLY]);
  });

  it("une autre personne : rien", async () => {
    const t = setup();
    expect((await processBossText(job({ chatId: 999 }), t.deps)).outcome).toBe("not-admin");
    expect(t.sent).toHaveLength(0);
  });
});
