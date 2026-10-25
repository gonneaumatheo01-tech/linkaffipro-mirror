/**
 * Phase 28, chantier E — réception des vidéos par Kevin pour le montage (updates simulées, faux Telegram, base en
 * mémoire, faux pipeline, aucun réseau) : vidéo + légende, vidéo seule → question à 2 boutons, document vidéo, plus de
 * 2 Go, membre / inconnu ignorés, vidéo transférée sans phrase (pas de montage), boutons des aperçus (admin seulement).
 */
import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import type { BossFastResult, KevinMontageDeps, MontageKevinPort } from "@linkaffipro/agents";
import { ADMIN_TG_ID, createTestKit } from "@linkaffipro/agents/test-kit";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";
import type { BossEngine } from "../boss/engine";
import { montageVideoOf } from "./boss-montage";

vi.mock("../../../agents/src/missions/lifecycle", () => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));

const ADMIN = Number(ADMIN_TG_ID);
const boss: BotIdentity = { id: "boss_1", name: "Kevin", username: "kevin_boss_bot", telegramBotId: 222n, vertical: "CASINO", role: "ADMIN" };

function setup() {
  const kit = createTestKit();
  const jobs: string[] = [];
  const port: Partial<MontageKevinPort> = {
    async createLongVideoAsset(_d, input) {
      const a = (await kit.prisma.mediaAsset.create({ data: { filename: "v.mp4", mimeType: input.mimeType ?? "video/mp4", size: 1, sha256: input.fileUniqueId, kind: "LONG_VIDEO", storage: "telegram" } as never })) as { id: string };
      return { ok: true, assetId: a.id, created: true };
    },
    async createMontageJob(_d, input) {
      const j = (await kit.prisma.montageJob.create({ data: { sourceAssetId: input.sourceAssetId, instructions: input.instructions, chatId: input.chatId, status: "PENDING" } as never })) as { id: string };
      jobs.push(j.id);
      return { id: j.id };
    },
    async setClipDecision(_d, clipId, decision) {
      await kit.prisma.shortClip.updateMany({ where: { id: clipId }, data: { status: decision } });
      return { ok: true };
    },
  };
  const agents: KevinMontageDeps = Object.assign(kit.deps, { montageKevin: port });
  const engine: BossEngine = {
    fastPath: vi.fn(async (_d, input) => (input.forwarded ? { handled: true, reply: "Bien reçu ce message transféré." } : { handled: false, needsAi: true }) as BossFastResult),
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
    agentsDeps: () => agents,
    adminDialogBot: async () => ({ id: boss.id, username: boss.username, isBoss: true }),
    claimBossRedirect: vi.fn(async () => false),
    bossEngine: engine,
    bossName: async () => "Kevin",
    mediaAlbumReplyDelayMs: 5,
    montageQuestionDelayMs: 5,
    downloadTelegramFile: vi.fn(async () => {
      throw new Error("aucun téléchargement attendu");
    }),
  };
  const bot = new Bot(`${boss.telegramBotId}:TEST`, { botInfo: botInfoFromRecord(boss) });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  let n = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage") return { ok: true, result: { message_id: n++, date: 0, chat: { id: ADMIN, type: "private" } } } as never;
    return { ok: true, result: true } as never;
  });
  registerHandlers(bot, boss, deps, { extended: false });
  const sent = () => calls.filter((c) => c.method === "sendMessage");
  return { kit, bot, calls, sent, jobs, deps };
}

let uid = 1;
function msg(extra: Record<string, unknown>, fromId = ADMIN): Update {
  return {
    update_id: uid++,
    message: { message_id: 800 + uid, date: 0, chat: { id: fromId, type: "private", first_name: "A" }, from: { id: fromId, is_bot: false, first_name: "A" }, ...extra },
  } as Update;
}
const VIDEO = { file_id: "vid1", file_unique_id: "uv1", width: 1920, height: 1080, duration: 47 * 60, mime_type: "video/mp4", file_size: 900 * 1024 * 1024 };

describe("vidéo envoyée à Kevin par l'admin", () => {
  it("vidéo + légende : montage lancé, une réponse (47 min, 1080p), rien de téléchargé dans le webhook", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ video: VIDEO, caption: "Kevin, découpe ça en shorts de 15 secondes, cam en haut à droite" }));
    expect(t.jobs).toHaveLength(1);
    expect(t.sent()).toHaveLength(1);
    expect(String(t.sent()[0]!.payload.text)).toMatch(/reçu.*\(47 min, 1080p\)/);
    expect(t.calls.some((c) => c.method === "getFile")).toBe(false);
    expect(t.deps.downloadTelegramFile).not.toHaveBeenCalled();
  });

  it("vidéo seule : question « je la monte ou je la garde ? » avec 2 boutons, un instant après", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ video: VIDEO }));
    expect(t.sent()).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(t.sent()).toHaveLength(1);
    const kb = t.sent()[0]!.payload.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    expect(kb.inline_keyboard[0]!.map((b) => b.callback_data.replace(/\d+/, "N"))).toEqual(["mvc:N:m", "mvc:N:l"]);
    expect(t.jobs).toHaveLength(0);
  });

  it("document vidéo (fichier .mov) : pris pour le montage", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ document: { file_id: "d1", file_unique_id: "ud1", file_name: "live.mov", mime_type: "video/quicktime", file_size: 300 * 1024 * 1024 }, caption: "monte cette vidéo" }));
    expect(t.jobs).toHaveLength(1);
  });

  it("plus de 2 Go : refus clair, rien d'enregistré", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ video: { ...VIDEO, file_size: 2.5 * 1024 ** 3 }, caption: "découpe ça" }));
    expect(t.jobs).toHaveLength(0);
    expect(String(t.sent()[0]!.payload.text)).toMatch(/2 Go au plus/);
  });

  it("un membre ou un inconnu : rien (le montage est réservé à l'admin)", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ video: VIDEO, caption: "découpe ça en shorts" }, 77));
    await new Promise((r) => setTimeout(r, 20));
    expect(t.jobs).toHaveLength(0);
    expect(t.sent()).toHaveLength(0);
    expect(t.kit.tables("mediaAsset")).toHaveLength(0);
  });

  it("vidéo transférée sans phrase : pas de montage, le chemin des messages transférés continue", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ video: VIDEO, caption: "#casino ce soir", forward_origin: { type: "user", date: 0, sender_user: { id: 5, is_bot: false, first_name: "Léa" } } }));
    await new Promise((r) => setTimeout(r, 40));
    expect(t.jobs).toHaveLength(0);
    expect(t.sent().every((c) => !/plan de coupe|je la monte|en shorts/i.test(String(c.payload.text)))).toBe(true);
  });

  it("bouton ✅ d'un aperçu : seul l'admin le fait valoir", async () => {
    const t = setup();
    const job = (await t.kit.prisma.montageJob.create({ data: { sourceAssetId: "a", instructions: {}, chatId: String(ADMIN), status: "PREVIEW" } as never })) as { id: string };
    const clip = (await t.kit.prisma.shortClip.create({ data: { montageJobId: job.id, index: 1, startMs: 0, endMs: 15_000, durationMs: 15_000, status: "PREVIEW_SENT", assetId: "s1" } as never })) as { id: string };
    const cb = (from: number) =>
      ({ update_id: uid++, callback_query: { id: `q${uid}`, from: { id: from, is_bot: false, first_name: "X" }, chat_instance: "c", data: `msh:${clip.id}:ok`, message: { message_id: 5, date: 0, chat: { id: from, type: "private" } } } }) as Update;
    await t.bot.handleUpdate(cb(77));
    expect(t.kit.tables("shortClip")[0]!.status).toBe("PREVIEW_SENT");
    await t.bot.handleUpdate(cb(ADMIN));
    expect(t.kit.tables("shortClip")[0]!.status).toBe("APPROVED");
    expect(t.sent().some((c) => /validé/.test(String(c.payload.text)))).toBe(true);
  });

  it("lecture d'un message (pur)", () => {
    expect(montageVideoOf({ message_id: 1, document: { file_id: "a", file_unique_id: "b", file_name: "x.csv", mime_type: "text/csv" } })).toBeNull();
    expect(montageVideoOf({ message_id: 1, document: { file_id: "a", file_unique_id: "b", file_name: "x.mkv" } })?.asDocument).toBe(true);
  });
});
