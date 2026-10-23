import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";
import { ADMIN_TG_ID, createTestKit } from "@linkaffipro/agents/test-kit";

vi.mock("../../../agents/src/missions/lifecycle", () => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));

const identity: BotIdentity = { id: "bot_1", name: "CasinoBot", username: "casinobot", telegramBotId: 111n, vertical: "CASINO" };
const ADMIN = Number(ADMIN_TG_ID);
const channel = { id: -1009999, type: "channel" as const, title: "Canal VIP" };

function setup() {
  const kit = createTestKit();
  const deps = {
    recordUpdate: vi.fn(async () => undefined),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c_vip", created: true })),
    findChannelId: vi.fn(async () => null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n]),
    initPrimaryBot: vi.fn(async () => undefined),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async (id: bigint) => id === ADMIN_TG_ID),
    isAdminDialogPartner: vi.fn(async (id: bigint) => id === ADMIN_TG_ID),
    auditChannel: vi.fn(async () => undefined),
    agentsDeps: () => kit.deps,
    downloadTelegramFile: vi.fn(async (_url: string) => new Uint8Array([1, 2, 3])),
  } satisfies TelegramDeps;
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getFile") return { ok: true, result: { file_id: "F", file_unique_id: "U", file_path: "videos/v.mp4" } } as never;
    if (method === "getChat") return { ok: true, result: { ...channel } } as never;
    if (method === "getChatAdministrators")
      return { ok: true, result: [{ status: "administrator", user: { id: 111, is_bot: true, first_name: "CasinoBot", username: "casinobot" }, can_be_edited: false, is_anonymous: false, can_manage_chat: true, can_invite_users: true }] } as never;
    if (method === "copyMessage") return { ok: true, result: { message_id: 9 } } as never;
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: ADMIN, type: "private" } } } as never;
  });
  registerHandlers(bot, identity, deps, { extended: false });
  const replies = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string);
  return { kit, deps, bot, calls, replies };
}

let uid = 1;
function videoUpdate(fromId: number, caption: string | undefined, extra: Record<string, unknown> = {}): Update {
  return {
    update_id: uid++,
    message: {
      message_id: 300 + uid,
      date: 0,
      chat: { id: fromId, type: "private", first_name: "A" },
      from: { id: fromId, is_bot: false, first_name: "A" },
      video: { file_id: `vid${uid}`, file_unique_id: `u${uid}`, width: 720, height: 1280, duration: 8, mime_type: "video/mp4", file_size: 1000 },
      ...(caption ? { caption } : {}),
      ...extra,
    },
  } as Update;
}

describe("dépôt dans la médiathèque par le bot", () => {
  it("admin + mots-clés : téléchargé, rangé, confirmé en une ligne, copié dans le canal Médiathèque", async () => {
    const { kit, deps, bot, calls, replies } = setup();
    await kit.prisma.setting.create({ data: { key: "agents.libraryChannelId", value: "-100777" } });
    await bot.handleUpdate(videoUpdate(ADMIN, "#casino #roulette"));
    expect(deps.downloadTelegramFile).toHaveBeenCalledWith("https://api.telegram.org/file/bot111:TEST/videos/v.mp4");
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ teamKey: "casino", theme: "roulette", kind: "SOURCE", mimeType: "video/mp4", duration: 8, libraryMessageId: 9 });
    expect(kit.tables("mediaAssetTelegramFile")[0]).toMatchObject({ botId: "bot_1" });
    expect(calls.find((c) => c.method === "copyMessage")?.payload).toMatchObject({ chat_id: "-100777" });
    expect(replies()).toEqual(["Rangé dans la médiathèque ✅ vidéo · Casino · source · thème roulette"]);
  });

  it("toute autre personne : ignorée", async () => {
    const { kit, deps, bot } = setup();
    await bot.handleUpdate(videoUpdate(31337, "#casino #roulette"));
    expect(deps.downloadTelegramFile).not.toHaveBeenCalled();
    expect(kit.tables("mediaAsset")).toHaveLength(0);
  });

  it("média transféré d'un canal sans mot-clé : laissé au transfert de canal", async () => {
    const { kit, deps, bot } = setup();
    await bot.handleUpdate(
      videoUpdate(ADMIN, "Belle soirée #promo", {
        forward_origin: { type: "channel", chat: channel, message_id: 5, date: 0 },
      }),
    );
    expect(deps.downloadTelegramFile).not.toHaveBeenCalled();
    expect(kit.tables("mediaAsset")).toHaveLength(0);
    expect(deps.upsertChannel).toHaveBeenCalled();
  });

  it("album : la légende du premier média vaut pour les suivants", async () => {
    const { kit, deps, bot } = setup();
    let n = 0;
    deps.downloadTelegramFile.mockImplementation(async () => new Uint8Array([++n]));
    await bot.handleUpdate(videoUpdate(ADMIN, "#dating #photo", { media_group_id: "g1" }));
    await bot.handleUpdate(videoUpdate(ADMIN, undefined, { media_group_id: "g1" }));
    expect(kit.tables("mediaAsset")).toHaveLength(2);
    expect(kit.tables("mediaAsset").every((a) => a.teamKey === "dating" && a.kind === "PHOTO")).toBe(true);
  });
});
