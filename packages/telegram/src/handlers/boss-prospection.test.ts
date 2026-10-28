/**
 * Phase 32, chantier C — boutons des alertes de la prospection sur Kevin (`pra:<alerte>:<action>`), updates simulées :
 * l'admin appuie → Veilleur (`handleAlertCallback`), petit message au doigt puis réponse ; un inconnu → message au
 * doigt seulement ; les boutons `prospect:` restent servis. Faux Telegram, base en mémoire, aucun réseau.
 */
import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import type { BossFastResult, ProspectionKevinDeps } from "@linkaffipro/agents";
import { ADMIN_TG_ID, createTestKit } from "@linkaffipro/agents/test-kit";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";
import type { BossEngine } from "../boss/engine";

const ADMIN = Number(ADMIN_TG_ID);
const boss: BotIdentity = { id: "boss_1", name: "Kevin", username: "kevin_boss_bot", telegramBotId: 222n, vertical: "CASINO", role: "ADMIN" };

function setup() {
  const kit = createTestKit();
  const handleAlertCallback = vi.fn(async (_d: unknown, input: { data: string }) =>
    input.data.endsWith(":note") ? { handled: true, toast: "Écris ta note", reply: "Écris ta note sur @pronos_fr." } : { handled: true, toast: "Vu", removeButtons: true },
  );
  const handleProspectCallback = vi.fn(async () => ({ handled: true, toast: "Noté" }));
  const agents = Object.assign(kit.deps, {
    prospectionAdvanced: { handleAlertCallback },
    prospectionKevin: { handleProspectCallback },
  }) as unknown as ProspectionKevinDeps;
  const engine: BossEngine = {
    fastPath: vi.fn(async () => ({ handled: false, needsAi: true }) as BossFastResult),
    aiTurn: vi.fn(async () => ({ reply: "ia" })),
    isCallbackData: (d) => d.startsWith("bsc:"),
    callback: vi.fn(async () => ({})),
    rememberPendingMessage: vi.fn(async () => undefined),
    loadLlm: vi.fn(async () => null),
  };
  const deps: TelegramDeps = {
    recordUpdate: vi.fn(async () => undefined),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c1", created: true })),
    findChannelId: vi.fn(async () => null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n]),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async (id: bigint) => id === ADMIN_TG_ID),
    isAdminDialogPartner: vi.fn(async (id: bigint) => id === ADMIN_TG_ID),
    agentsDeps: () => agents as never,
    adminDialogBot: async () => ({ id: boss.id, username: boss.username, isBoss: true }),
    claimBossRedirect: vi.fn(async () => false),
    bossEngine: engine,
    bossName: async () => "Kevin",
  };
  const bot = new Bot(`${boss.telegramBotId}:TEST`, { botInfo: botInfoFromRecord(boss) });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage") return { ok: true, result: { message_id: 900, date: 0, chat: { id: ADMIN, type: "private" } } } as never;
    return { ok: true, result: true } as never;
  });
  registerHandlers(bot, boss, deps, { extended: false });
  return { bot, calls, handleAlertCallback, handleProspectCallback };
}

let uid = 1;
const press = (data: string, from = ADMIN): Update =>
  ({ update_id: uid++, callback_query: { id: `q${uid}`, from: { id: from, is_bot: false, first_name: "X" }, chat_instance: "c", data, message: { message_id: 5, date: 0, chat: { id: from, type: "private" } } } }) as Update;

describe("boutons des alertes de la prospection (pra:)", () => {
  it("✅ Vu par l'admin : Veilleur appelé, message au doigt, boutons retirés", async () => {
    const t = setup();
    await t.bot.handleUpdate(press("pra:a1:seen"));
    expect(t.handleAlertCallback).toHaveBeenCalledTimes(1);
    expect(t.handleAlertCallback.mock.calls[0]![1]).toMatchObject({ data: "pra:a1:seen", actorTelegramId: String(ADMIN) });
    expect(t.calls.find((c) => c.method === "answerCallbackQuery")?.payload.text).toBe("Vu");
    expect(t.calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
  });

  it("📝 Note : la question part dans la conversation", async () => {
    const t = setup();
    await t.bot.handleUpdate(press("pra:a1:note"));
    expect(t.calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text)).toEqual(["Écris ta note sur @pronos_fr."]);
  });

  it("un inconnu : message au doigt seulement, le Veilleur n'est pas appelé", async () => {
    const t = setup();
    await t.bot.handleUpdate(press("pra:a1:mute", 77));
    expect(t.handleAlertCallback).not.toHaveBeenCalled();
    expect(t.calls.some((c) => c.method === "sendMessage")).toBe(false);
  });

  it("les boutons prospect: restent servis", async () => {
    const t = setup();
    await t.bot.handleUpdate(press("prospect:p1:contacted"));
    expect(t.handleProspectCallback).toHaveBeenCalledTimes(1);
    expect(t.handleAlertCallback).not.toHaveBeenCalled();
  });
});
