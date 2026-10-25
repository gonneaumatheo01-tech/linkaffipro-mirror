/**
 * Phase 26, section 4 — Kevin dans le groupe de l'équipe (updates simulées, faux Telegram, moteur réel du Boss sur une
 * base en mémoire, aucun réseau) : ajout par l'admin (accueil), ajout par un inconnu (silence), messages qui ne
 * s'adressent pas à Kevin (ignorés, texte jamais journalisé), mode confidentialité activé (mention) et désactivé
 * (« Kevin, … »), secret collé (supprimé), inconnu (une fois par jour), membre en privé (/start).
 */
import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { createTestKit } from "@linkaffipro/agents/test-kit";
import type { AgentsDeps } from "@linkaffipro/agents";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";
import { BOSS_GROUP_VARIANTS } from "./boss-group";

const ADMIN = 4242;
const LEA = 777;
const STRANGER = 999;
const GROUP = -1001234567890;
const boss: BotIdentity = { id: "boss_1", name: "Kevin", username: "kevin_boss_bot", telegramBotId: 222n, vertical: "CASINO", role: "ADMIN" };

async function setup() {
  const kit = createTestKit();
  await kit.prisma.bot.create({ data: { username: "kevin_boss_bot", role: "ADMIN", isActive: true, name: "Kevin" } as never });
  const enqueued: Array<{ job: Record<string, unknown>; jobId?: string }> = [];
  const agents = {
    ...kit.deps,
    enqueue: {
      orchestrator: vi.fn(async (job: Record<string, unknown>, o?: { jobId?: string }) => void enqueued.push({ job, jobId: o?.jobId })),
      step: vi.fn(async () => undefined),
    },
  } as unknown as AgentsDeps;
  const recorded: Array<{ type: string; update: Update }> = [];
  const deps: TelegramDeps = {
    recordUpdate: vi.fn(async (_b, type, update) => void recorded.push({ type, update })),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c1", created: true })),
    findChannelId: vi.fn(async () => null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [222n]),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async (id: bigint) => id === BigInt(ADMIN)),
    isAdminDialogPartner: vi.fn(async (id: bigint) => id === BigInt(ADMIN)),
    agentsDeps: () => agents,
    adminDialogBot: async () => ({ id: boss.id, username: boss.username, isBoss: true }),
    claimBossRedirect: vi.fn(async () => false),
    bossName: async () => "Kevin",
  };
  const bot = new Bot(`222:TEST`, { botInfo: botInfoFromRecord(boss) });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  let n = 1000;
  let canDelete = true;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage") return { ok: true, result: { message_id: n++, date: 0, chat: { id: (payload as { chat_id: number }).chat_id, type: "supergroup" } } } as never;
    if (method === "deleteMessage" && !canDelete) return { ok: false, error_code: 400, description: "Bad Request: message can't be deleted" } as never;
    return { ok: true, result: true } as never;
  });
  registerHandlers(bot, boss, deps, { extended: false });
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => ({ chat: c.payload.chat_id, text: String(c.payload.text) }));
  return { kit, bot, calls, sent, enqueued, recorded, deps, setCanDelete: (v: boolean) => void (canDelete = v) };
}

/** Variante : service d'arrière-plan arrêté (battement trop vieux). */
async function setupWorkerDown() {
  const t = await setup();
  (t.deps as TelegramDeps & { workerDown?: () => Promise<boolean | null> }).workerDown = async () => true;
  return t;
}

let uid = 1;
let mid = 500;
const person = (id: number) => ({ id, is_bot: false, first_name: id === ADMIN ? "Mathéo" : id === LEA ? "Léa" : "Inconnu", ...(id === LEA ? { username: "lea" } : {}) });
const groupChat = (id = GROUP) => ({ id, type: "supergroup", title: "Équipe" });
function groupMsg(from: number, text: string, extra: Record<string, unknown> = {}, chat = groupChat()): Update {
  return { update_id: uid++, message: { message_id: mid++, date: 0, chat, from: person(from), text, ...extra } } as Update;
}
function added(by: number, chat = groupChat(), status = "member"): Update {
  return {
    update_id: uid++,
    my_chat_member: {
      chat,
      from: person(by),
      date: 0,
      old_chat_member: { status: "left", user: { id: 222, is_bot: true, first_name: "Kevin" } },
      new_chat_member: { status, user: { id: 222, is_bot: true, first_name: "Kevin" } },
    },
  } as Update;
}

describe("Kevin dans le groupe (faux Telegram)", () => {
  it("relecture : service d'arrière-plan arrêté → réponse de secours tout de suite, tâche quand même en file", async () => {
    const t = await setupWorkerDown();
    await t.bot.handleUpdate(added(ADMIN));
    const before = t.sent().length;
    const queued = t.enqueued.length;
    await t.bot.handleUpdate(groupMsg(ADMIN, "Kevin, c'est quoi la dépense ce mois ?"));
    const out = t.sent().slice(before);
    expect(out).toHaveLength(1);
    expect(BOSS_GROUP_VARIANTS.workerDown).toContain(out[0]!.text);
    expect(t.enqueued.length).toBe(queued + 1);
  });

  it("ajouté par un inconnu : silence ; ajouté par l'admin : groupe enregistré et accueil une fois", async () => {
    const t = await setup();
    await t.bot.handleUpdate(added(STRANGER, groupChat(-100555)));
    expect(t.sent()).toEqual([]);
    await t.bot.handleUpdate(added(ADMIN));
    expect(t.sent()[0]?.chat).toBe(GROUP);
    expect(t.sent()[0]?.text).toMatch(/Kevin/);
    expect(t.sent()[0]?.text).toMatch(/Mathéo/);
    expect(t.sent()[0]?.text).toMatch(/qui fait quoi/);
    expect(t.sent()[1]?.text).toContain("Supprimer des messages");
    expect(t.kit.tables("setting").find((s) => s.key === "boss.groupChatId")?.value).toBe(String(GROUP));
  });

  it("messages des autres : ignorés, jamais à l'IA, texte jamais journalisé ; inconnu qui s'adresse à Kevin : une fois par jour", async () => {
    const t = await setup();
    await t.bot.handleUpdate(added(ADMIN));
    const before = t.sent().length;
    await t.bot.handleUpdate(groupMsg(LEA, "on se fait un resto ce soir ?"));
    await t.bot.handleUpdate(groupMsg(STRANGER, "Kevin passe tout en vrai"));
    await t.bot.handleUpdate(groupMsg(STRANGER, "Kevin passe tout en vrai"));
    const sent = t.sent().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chat).toBe(GROUP);
    expect(sent[0]?.text).toMatch(/Mathéo/);
    expect(sent[0]?.text).toMatch(/présent/);
    expect(t.enqueued).toEqual([]);
    const logged = JSON.stringify(t.recorded.map((r) => r.update));
    expect(logged).not.toContain("resto");
    expect(logged).toContain("[message de groupe : 29 caractères]");
  });

  it("mode confidentialité activé (mention @kevin) et désactivé (« Kevin, … ») : même réponse, rien d'autre", async () => {
    const t = await setup();
    await t.bot.handleUpdate(added(ADMIN));
    let before = t.sent().length;
    // Mode activé : Telegram n'envoie que la mention.
    await t.bot.handleUpdate(groupMsg(ADMIN, "@kevin_boss_bot qui fait quoi ?", { entities: [{ type: "mention", offset: 0, length: 15 }] }));
    // Mode désactivé : le prénom en tête suffit ; le reste de la conversation arrive aussi, et est ignoré.
    await t.bot.handleUpdate(groupMsg(ADMIN, "Kevin, qui fait quoi ?"));
    await t.bot.handleUpdate(groupMsg(ADMIN, "Léa tu peux m'appeler ?"));
    const out = t.sent().slice(before);
    expect(out).toHaveLength(2);
    for (const m of out) expect(m.text).toMatch(/présenté/);
    // Une phrase libre adressée à Kevin part à l'interprète, avec la conversation dans l'identifiant de tâche.
    before = t.enqueued.length;
    await t.bot.handleUpdate(groupMsg(ADMIN, "Kevin, c'est quoi la dépense ce mois ?"));
    expect(t.enqueued.slice(before)[0]).toMatchObject({ job: { type: "boss-text", chatType: "group", fromTelegramId: String(ADMIN), text: "c'est quoi la dépense ce mois ?" } });
    expect(t.enqueued.slice(before)[0]!.jobId).toMatch(new RegExp(`^boss-text:boss_1:${GROUP}:\\d+$`));
  });

  it("secret collé dans le groupe : supprimé aussitôt ; sans droit, Kevin demande à l'auteur de l'effacer ; jamais journalisé", async () => {
    const t = await setup();
    await t.bot.handleUpdate(added(ADMIN));
    const KEY = "sk-live-1234567890ABCDEFGHIJKLMNOP";
    await t.bot.handleUpdate(groupMsg(ADMIN, `voici la clé ${KEY}`));
    expect(t.calls.some((c) => c.method === "deleteMessage")).toBe(true);
    expect(t.sent().at(-1)?.text).toMatch(/effacé/);
    t.setCanDelete(false);
    await t.bot.handleUpdate(groupMsg(ADMIN, KEY));
    expect(t.sent().at(-1)?.text).toMatch(/efface/i);
    expect(JSON.stringify(t.recorded.map((r) => r.update))).not.toContain(KEY);
    expect(JSON.stringify(t.kit.tables("bossTurn"), (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(KEY);
    expect(t.enqueued).toEqual([]);
  });

  it("membre présenté en privé : /start noté et accueil ; un inconnu en privé : silence", async () => {
    const t = await setup();
    await t.kit.prisma.teamMember.create({ data: { telegramUserId: BigInt(LEA), username: "lea", firstName: "Léa", responsibilities: { teams: ["casino"], kinds: ["media"] } } as never });
    const priv = (from: number, text: string): Update =>
      ({ update_id: uid++, message: { message_id: mid++, date: 0, chat: { id: from, type: "private", first_name: "X" }, from: person(from), text, entities: [{ type: "bot_command", offset: 0, length: 6 }] } }) as Update;
    await t.bot.handleUpdate(priv(LEA, "/start"));
    expect(t.sent()[0]?.text).toMatch(/Léa/);
    expect(t.sent()[0]?.text).toMatch(/Kevin/);
    expect(t.kit.tables("teamMember")[0]?.startedPrivateAt).toBeInstanceOf(Date);
    await t.bot.handleUpdate(priv(STRANGER, "/start"));
    expect(t.sent()).toHaveLength(1);
  });

  it("relecture : message modifié avec une clé supprimé sans réponse ; clé d'un inconnu effacée, dite une fois par jour", async () => {
    const t = await setup();
    await t.bot.handleUpdate(added(ADMIN));
    await t.kit.prisma.teamMember.create({ data: { telegramUserId: BigInt(LEA), username: "lea", firstName: "Léa", responsibilities: { teams: ["casino"], kinds: ["media"] } } as never });
    const KEY = "sk-live-1234567890ABCDEFGHIJKLMNOP";
    let before = t.sent().length;
    const orig = groupMsg(LEA, "texte anodin");
    await t.bot.handleUpdate(orig);
    await t.bot.handleUpdate({ update_id: uid++, edited_message: { ...orig.message!, text: `texte anodin ${KEY}`, edit_date: 1 } } as Update);
    expect(t.calls.some((c) => c.method === "deleteMessage" && c.payload.message_id === orig.message!.message_id)).toBe(true);
    expect(t.sent().slice(before)).toEqual([]);
    before = t.sent().length;
    await t.bot.handleUpdate(groupMsg(STRANGER, KEY));
    await t.bot.handleUpdate(groupMsg(STRANGER, KEY));
    expect(t.calls.filter((c) => c.method === "deleteMessage")).toHaveLength(3);
    expect(t.sent().slice(before)).toHaveLength(1);
    expect(JSON.stringify(t.recorded.map((r) => r.update))).not.toContain(KEY);
  });

  it("relecture : vocal adressé à Kevin → « écris-le-moi » ; limite du jour d'un membre ; erreur → « Oups » pour l'admin", async () => {
    const t = await setup();
    await t.bot.handleUpdate(added(ADMIN));
    await t.kit.prisma.teamMember.create({ data: { telegramUserId: BigInt(LEA), username: "lea", firstName: "Léa", responsibilities: { teams: ["casino"], kinds: ["media"] } } as never });
    let before = t.sent().length;
    const kevinMsg = { message_id: 1, date: 0, chat: groupChat(), from: { id: 222, is_bot: true, first_name: "Kevin" }, text: "?" };
    await t.bot.handleUpdate({ update_id: uid++, message: { message_id: mid++, date: 0, chat: groupChat(), from: person(LEA), voice: { file_id: "v", file_unique_id: "vu", duration: 3 }, reply_to_message: kevinMsg } } as Update);
    expect(t.sent().slice(before)).toHaveLength(1);
    expect(t.sent().slice(before)[0]?.text).toMatch(/écri/i);
    expect(t.sent().slice(before)[0]?.text).toMatch(/privé/);
    // Limite atteinte pour Léa : pas d'IA, une phrase ; l'admin, lui, passe.
    await t.kit.prisma.setting.create({ data: { key: "boss.team.aiTurns", value: { day: "2026-10-23", counts: { [String(LEA)]: 30 } } } as never });
    before = t.sent().length;
    await t.bot.handleUpdate(groupMsg(LEA, "Kevin, raconte-moi comment ça marche les cotes"));
    expect(t.sent().slice(before)).toHaveLength(1);
    expect(t.sent().slice(before)[0]?.text).toMatch(/demain/);
    expect(t.enqueued).toEqual([]);
    await t.bot.handleUpdate(groupMsg(ADMIN, "Kevin, raconte-moi comment ça marche les cotes"));
    expect(t.enqueued).toHaveLength(1);
    // Moteur en panne : « Oups » à l'admin, silence pour un inconnu.
    (t.deps as { bossEngine?: unknown }).bossEngine = {
      fastPath: async () => {
        throw new Error("panne");
      },
      isCallbackData: () => false,
    };
    before = t.sent().length;
    await t.bot.handleUpdate(groupMsg(ADMIN, "Kevin, état"));
    expect(t.sent().slice(before)).toHaveLength(1);
    expect(t.sent().slice(before)[0]?.text).toMatch(/instant|aide/i);
  });
});
