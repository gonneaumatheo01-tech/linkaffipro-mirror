/**
 * Phase 34, chantier F — réception par Kevin des entrées Telegram (updates simulées, faux Telegram, base en mémoire,
 * faux moteur du Boss, aucun réseau) : message transféré gardé comme contenu (album = un accusé, phrase juste avant =
 * pas d'accusé), emojis animés gardés, fichier CSV (légende = demande), boutons de choix des comptes publicitaires,
 * post d'un canal tiers gardé comme contenu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { peekDocument, peekForwarded, setBossAdAccountsPort, startOAuthResume, type BossFastResult } from "@linkaffipro/agents";
import { ADMIN_TG_ID, createTestKit } from "@linkaffipro/agents/test-kit";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";
import type { BossEngine } from "../boss/engine";
import { resetBossPhrases } from "./boss-inputs";

vi.mock("../../../agents/src/missions/lifecycle", () => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));

const ADMIN = Number(ADMIN_TG_ID);
const CHAT = String(ADMIN);
const boss: BotIdentity = { id: "boss_1", name: "Kevin", username: "kevin_boss_bot", telegramBotId: 222n, vertical: "CASINO", role: "ADMIN" };
const PERSON = { type: "user", date: 0, sender_user: { id: 77, is_bot: false, first_name: "Léa", username: "lea_vip" } };
const EMOJI = { type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "5368324170671202286" };

beforeEach(() => resetBossPhrases());
afterEach(() => setBossAdAccountsPort(null));

function setup(files: Record<string, Uint8Array> = {}) {
  const kit = createTestKit();
  const fastCalls: Array<Record<string, unknown>> = [];
  const enqueued: Array<{ job: Record<string, unknown>; opts?: { jobId?: string; delayMs?: number } }> = [];
  kit.deps.enqueue.orchestrator = vi.fn(async (job: Record<string, unknown>, o?: { jobId?: string; delayMs?: number }) => {
    enqueued.push({ job, opts: o });
  }) as never;
  const engine: BossEngine = {
    fastPath: vi.fn(async (_d, input) => {
      fastCalls.push(input as unknown as Record<string, unknown>);
      return (input.forwarded ? { handled: true, reply: "Bien reçu ce message transféré." } : { handled: false, needsAi: true }) as BossFastResult;
    }),
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
    agentsDeps: () => kit.deps,
    adminDialogBot: async () => ({ id: boss.id, username: boss.username, isBoss: true }),
    claimBossRedirect: vi.fn(async () => false),
    bossEngine: engine,
    bossName: async () => "Kevin",
    addCustomEmojis: vi.fn(async (input: { emojis: Array<{ customEmojiId: string }> }) => ({ added: input.emojis.map((e) => e.customEmojiId), restored: [], already: [] })),
    mediaAlbumReplyDelayMs: 5,
    downloadTelegramFile: vi.fn(async (url: string) => {
      const name = url.split("/").pop()!;
      if (!files[name]) throw new Error("introuvable");
      return files[name]!;
    }),
  };
  const bot = new Bot(`${boss.telegramBotId}:TEST`, { botInfo: botInfoFromRecord(boss) });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  let n = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getFile") {
      const p = payload as { file_id: string };
      return { ok: true, result: { file_id: p.file_id, file_unique_id: "u", file_path: `documents/${p.file_id}` } } as never;
    }
    if (method === "sendMessage") return { ok: true, result: { message_id: n++, date: 0, chat: { id: ADMIN, type: "private" } } } as never;
    return { ok: true, result: true } as never;
  });
  registerHandlers(bot, boss, deps, { extended: false });
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
  return { kit, bot, calls, sent, enqueued, fastCalls, deps };
}

let uid = 1;
function msg(extra: Record<string, unknown>, fromId = ADMIN): Update {
  return {
    update_id: uid++,
    message: { message_id: 700 + uid, date: 0, chat: { id: fromId, type: "private", first_name: "A" }, from: { id: fromId, is_bot: false, first_name: "A" }, ...extra },
  } as Update;
}

describe("message transféré à Kevin (privé de l'admin)", () => {
  it("texte transféré : gardé tel quel (HTML), passé au chemin rapide comme donnée, une réponse", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ text: "Gros bonus ce soir", entities: [{ type: "bold", offset: 0, length: 10 }], forward_origin: PERSON }));
    expect((await peekForwarded(t.kit.deps, CHAT))?.html).toBe("<b>Gros bonus</b> ce soir");
    expect(t.fastCalls).toHaveLength(1);
    expect(t.fastCalls[0]).toMatchObject({ forwarded: true });
    expect(t.sent()).toHaveLength(1);
    expect(t.enqueued).toEqual([]);
  });

  it("album de 3 photos transféré : un seul contenu, une seule réponse (résumé sans texte), rien vers l'IA", async () => {
    const t = setup();
    for (const [i, extra] of [{ caption: "Ce soir 21 h" }, {}, {}].entries())
      await t.bot.handleUpdate(msg({ media_group_id: "alb1", photo: [{ file_id: `p${i}`, file_unique_id: `u${i}`, width: 10, height: 10 }], forward_origin: PERSON, ...extra }));
    expect(t.sent()).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 40));
    const c = await peekForwarded(t.kit.deps, CHAT);
    expect(c?.media.map((m) => m.fileId)).toEqual(["p0", "p1", "p2"]);
    expect(c?.html).toBe("Ce soir 21 h");
    expect(t.sent()).toHaveLength(1);
    expect(t.sent()[0]).toMatch(/3 photos/);
    expect(t.sent()[0]).not.toContain("21 h");
    expect(t.fastCalls).toHaveLength(0);
    expect(t.enqueued).toEqual([]);
    // Mémoire de Kevin : le résumé, jamais le texte.
    const turns = t.kit.tables("bossTurn").map((r) => String(r.text));
    expect(turns.some((x) => x.startsWith("[message transféré"))).toBe(true);
    expect(turns.join("\n")).not.toContain("21 h");
  });

  it("emojis animés transférés : gardés en <tg-emoji> ET ajoutés à la bibliothèque (chemin de la phase 12)", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ text: "🎁 cadeau", entities: [EMOJI], forward_origin: PERSON }));
    expect((await peekForwarded(t.kit.deps, CHAT))?.html).toBe('<tg-emoji emoji-id="5368324170671202286">🎁</tg-emoji> cadeau');
    expect(t.deps.addCustomEmojis).toHaveBeenCalledTimes(1);
    expect(t.fastCalls).toHaveLength(0);
  });

  it("phrase puis transfert (commentaire de Telegram) : la phrase part à l'interprète après 2 s, le transfert n'a pas d'accusé", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ text: "programme ça demain 20 h sur Zone Interdite" }));
    await t.bot.handleUpdate(msg({ text: "Le texte du post", forward_origin: PERSON }));
    expect(t.enqueued).toHaveLength(1);
    expect(t.enqueued[0]).toMatchObject({ job: { type: "boss-text", text: "programme ça demain 20 h sur Zone Interdite" }, opts: { delayMs: 2000 } });
    expect(t.fastCalls.filter((c) => c.forwarded)).toHaveLength(0);
    expect(t.sent()).toHaveLength(0);
    expect((await peekForwarded(t.kit.deps, CHAT))?.html).toBe("Le texte du post");
  });

  it("une phrase sans rapport n'attend pas", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ text: "combien j'ai dépensé ce mois ?" }));
    expect(t.enqueued[0]!.opts?.delayMs).toBeUndefined();
  });

  it("post d'un canal tiers : gardé comme contenu comme tout transfert (une réponse), jamais rangé comme post de référence", async () => {
    const t = setup();
    await t.bot.handleUpdate(
      msg({ text: "Corner ce soir : plus de 9,5", forward_origin: { type: "channel", date: 0, chat: { id: -100555, type: "channel", title: "Club Corner", username: "club_corner" }, message_id: 77 } }),
    );
    expect(t.kit.tables("referencePost")).toHaveLength(0);
    expect((await peekForwarded(t.kit.deps, CHAT))?.from).toBe("@club_corner");
    expect(t.fastCalls).toHaveLength(1);
    expect(t.fastCalls[0]).toMatchObject({ forwarded: true });
    expect(t.enqueued).toEqual([]);
  });

  it("un inconnu qui transfère à Kevin : rien n'est gardé, silence", async () => {
    const t = setup();
    await t.bot.handleUpdate(msg({ text: "salut", forward_origin: PERSON }, 999));
    expect(await peekForwarded(t.kit.deps, "999")).toBeNull();
    expect(t.sent()).toEqual([]);
  });
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("fichier envoyé à Kevin", () => {
  it("CSV avec légende « importe ces joueurs » : téléchargé, gardé, la légende part à l'interprète, pas d'accusé", async () => {
    const t = setup({ doc1: new Uint8Array([0xef, 0xbb, 0xbf, ...enc("email;pays\na@x.fr;FR\n")]) });
    await t.bot.handleUpdate(msg({ document: { file_id: "doc1", file_unique_id: "d1", file_name: "joueurs.csv", mime_type: "text/csv", file_size: 30 }, caption: "importe ces joueurs" }));
    expect(t.deps.downloadTelegramFile).toHaveBeenCalledWith("https://api.telegram.org/file/bot222:TEST/documents/doc1");
    expect((await peekDocument(t.kit.deps, CHAT))?.text).toBe("email;pays\na@x.fr;FR\n");
    expect(t.enqueued).toHaveLength(1);
    expect(t.enqueued[0]!.job).toMatchObject({ type: "boss-text", text: "importe ces joueurs" });
    expect(JSON.stringify(t.enqueued)).not.toContain("a@x.fr");
    expect(t.sent()).toHaveLength(0);
  });

  it("CSV sans légende : accusé avec lignes et colonnes ; PDF : refus poli ; rien n'est téléchargé pour un mauvais type", async () => {
    const t = setup({ doc2: enc("nom,email\nLéa,l@x.fr\nEmma,e@x.fr\n") });
    await t.bot.handleUpdate(msg({ document: { file_id: "doc2", file_unique_id: "d2", file_name: "liste.csv", mime_type: "text/csv", file_size: 40 } }));
    expect(t.sent()[0]).toMatch(/liste\.csv/);
    expect(t.sent()[0]).toMatch(/2 lignes, colonnes nom, email/);
    expect(t.sent()[0]).not.toContain("l@x.fr");
    await t.bot.handleUpdate(msg({ document: { file_id: "pdf", file_unique_id: "p", file_name: "contrat.pdf", mime_type: "application/pdf", file_size: 40 } }));
    expect(t.sent()[1]).toMatch(/CSV ou (un )?TXT/);
    expect(t.calls.filter((c) => c.method === "getFile")).toHaveLength(1);
    expect(t.enqueued).toEqual([]);
  });
});

describe("boutons de choix des comptes publicitaires (reprise après OAuth)", () => {
  it("l'admin appuie : la fonction du site enregistre le compte, Kevin confirme", async () => {
    const t = setup();
    const port = vi.fn(async () => ({ ok: true as const, connected: 1 }));
    setBossAdAccountsPort(port);
    await startOAuthResume(t.kit.deps, { platform: "META", userId: "u1", chatId: CHAT, accounts: [{ externalId: "act_1", name: "Celsius FR" }] });
    const data = t.kit.sent.at(-1)!.buttons![0]![0]!.callbackData;
    await t.bot.handleUpdate({
      update_id: uid++,
      callback_query: { id: "cq1", from: { id: ADMIN, is_bot: false, first_name: "A" }, chat_instance: "x", data, message: { message_id: 5, date: 0, chat: { id: ADMIN, type: "private", first_name: "A" }, text: "?" } },
    } as Update);
    expect(port).toHaveBeenCalledWith(expect.objectContaining({ platform: "META", userId: "u1", externalIds: ["act_1"], final: true }));
    expect(t.sent().join("\n")).toMatch(/Celsius FR/);
    expect(t.calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
  });
});
