/**
 * Phase 26, section 4 — scénario GROUPE de Kevin sur base réelle, faux Telegram, fausse IA (`createFakeBossLlm`),
 * aucun réseau. Webhook réel, chemin rapide réel, interprète réel (`processBossText` comme le worker).
 *
 * Kevin ajouté par l'admin → groupe enregistré, accueil → « Kevin, voici @lea, vidéos casino » → mémorisée (Léa n'avait
 * jamais écrit : présentation en attente ; quand elle dit bonjour, l'admin confirme en privé — @nom, prénom,
 * identifiant — puis elle est notée) → demande MEDIA casino dans le groupe avec
 * @lea → Léa envoie une vidéo #casino #roulette (message suivant) → rangée → « Léa est en vacances jusqu'à lundi » → la
 * demande suivante va à l'admin, Kevin le dit → demande SECRET : mention + lien privé ; clé collée dans le groupe
 * supprimée et jamais journalisée ; refusée en privé de Léa ; acceptée en privé de Marc → Léa « passe le casino en
 * vrai » : résumé adressé à l'admin, Léa ne peut pas confirmer, l'admin si → un inconnu donne un ordre : rien → Kevin
 * ajouté par un inconnu dans un autre groupe : silence → rapport du matin avec les bons @ → mode confidentialité dans
 * les deux sens (mention seule, ou « Kevin, … » et le reste ignoré).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Update } from "grammy/types";
import { prisma } from "@linkaffipro/db";
import { askHuman, createFakeBossLlm, sendDailyReport, type AgentsDeps, type AgentsOrchestratorJob } from "@linkaffipro/agents";
import { getOrCreateBot, prismaTelegramDeps, realBossEngine } from "@linkaffipro/telegram";
import { encrypt } from "@linkaffipro/core";
import { POST } from "@/app/api/telegram/[botId]/route";
import { ctx, resetDb, webhookRequest } from "./helpers";
import { prismaBossTurnFor, processBossText, type BossTextDeps } from "../../../worker/src/agents/boss-text";

const direct = vi.hoisted(() => ({ calls: [] as Array<{ token: string; method: string; payload: Record<string, unknown> }>, next: 7000 }));

vi.mock("grammy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("grammy")>();
  class FakeApi {
    constructor(readonly token: string) {}
    private rec(method: string, payload: Record<string, unknown> = {}) {
      direct.calls.push({ token: this.token, method, payload });
    }
    async getMe() {
      this.rec("getMe");
      return { id: 222, is_bot: true, first_name: "Kevin", username: "kevin_boss_bot" };
    }
    async sendMessage(chat_id: number, text: string, other: Record<string, unknown> = {}) {
      this.rec("sendMessage", { chat_id, text, ...other });
      return { message_id: direct.next++, date: 0, chat: { id: chat_id, type: chat_id < 0 ? "supergroup" : "private" }, text };
    }
    async deleteMessage(chat_id: number, message_id: number) {
      this.rec("deleteMessage", { chat_id, message_id });
      return true;
    }
    async sendChatAction(chat_id: number, action: string) {
      this.rec("sendChatAction", { chat_id, action });
      return true;
    }
  }
  return { ...orig, Api: FakeApi };
});

const ADMIN = 74242;
const LEA = 7001;
const MARC = 7002;
const STRANGER = 9999;
const GROUP = -1009876543210;
const OTHER_GROUP = -1005550000;
const BOSS_TOKEN = `222:BOSS-TOKEN-${"y".repeat(30)}`;
const KEY = "sgoKEYabcdef1234567890XYZ";

const hooked: Array<{ method: string; payload: Record<string, unknown> }> = [];
const enqueued: Array<{ job: AgentsOrchestratorJob; jobId?: string }> = [];
const ids = { boss: "", secret: "" };
const started = new Date();
let canDelete = true;

let uid = 1;
let mid = 100;
const names: Record<number, { first_name: string; username?: string }> = {
  [ADMIN]: { first_name: "Mathéo", username: "matheo" },
  [LEA]: { first_name: "Léa", username: "lea" },
  [MARC]: { first_name: "Marc" },
  [STRANGER]: { first_name: "Inconnu" },
};
const user = (id: number) => ({ id, is_bot: false, ...names[id] });
const groupChat = (id = GROUP) => ({ id, type: "supergroup" as const, title: id === GROUP ? "Équipe" : "Autre" });

function groupMsg(from: number, text: string, extra: Record<string, unknown> = {}): Update {
  mid += 1;
  return { update_id: uid++, message: { message_id: mid, date: Math.floor(Date.now() / 1000), chat: groupChat(), from: user(from), text, ...extra } } as Update;
}
function privateMsg(from: number, text: string): Update {
  mid += 1;
  return {
    update_id: uid++,
    message: { message_id: mid, date: 0, chat: { id: from, type: "private", first_name: "x" }, from: user(from), text, ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] } : {}) },
  } as Update;
}
function added(by: number, chatId = GROUP): Update {
  return {
    update_id: uid++,
    my_chat_member: {
      chat: groupChat(chatId),
      from: user(by),
      date: 0,
      old_chat_member: { status: "left", user: { id: 222, is_bot: true, first_name: "Kevin" } },
      new_chat_member: { status: "member", user: { id: 222, is_bot: true, first_name: "Kevin" } },
    },
  } as Update;
}

async function toBoss(u: Update) {
  const res = await POST(webhookRequest(u, ids.secret), ctx({ botId: ids.boss }));
  expect(res.status).toBe(200);
  return u;
}
const mark = () => ({ h: hooked.length, d: direct.calls.length });
/** Messages envoyés par Kevin depuis un repère, avec la conversation. */
function sentSince(m: { h: number; d: number }): Array<{ chat: number; text: string; payload: Record<string, unknown> }> {
  return [
    ...hooked.slice(m.h).filter((c) => c.method === "sendMessage").map((c) => ({ chat: Number(c.payload.chat_id), text: String(c.payload.text), payload: c.payload })),
    ...direct.calls.slice(m.d).filter((c) => c.method === "sendMessage").map((c) => ({ chat: Number(c.payload.chat_id), text: String(c.payload.text), payload: c.payload })),
  ];
}

const fakeLlm = createFakeBossLlm([
  [/^voici @lea/i, { name: "presenter_membre", input: { personne: "@lea", role: "vidéos casino" } }],
  [/^voici Marc/i, { name: "presenter_membre", input: { personne: "Marc", role: "les cotes et le compte Sportaza", equipes: "paris sportifs", natures: "clés" } }],
  [/Léa est en vacances jusqu'à lundi/i, { name: "modifier_membre", input: { personne: "Léa", absent_jusqu_au: "lundi", note: "en vacances jusqu'à lundi" } }],
  [/Léa est de retour/i, { name: "modifier_membre", input: { personne: "Léa", disponible: true } }],
  [/passe le casino en vrai/i, { name: "simulation", input: { equipe: "casino", mode: "vrai" } }],
  [/mets tout en pause/i, { name: "pause", input: { equipe: "tout" } }],
]);

function agents(): AgentsDeps {
  return prismaTelegramDeps.agentsDeps!();
}

function bossTextDeps(): BossTextDeps {
  return {
    agents: agents(),
    engine: realBossEngine,
    loadLlm: async () => fakeLlm,
    async botApi() {
      const rec = await prisma.bot.findUniqueOrThrow({ where: { id: ids.boss } });
      const api = getOrCreateBot(rec, prismaTelegramDeps).api;
      return { sendMessage: (c, t, o) => api.sendMessage(c, t, o), deleteMessage: (c, m) => api.deleteMessage(c, m) };
    },
    adminTelegramId: async () => BigInt(ADMIN),
    bossTurnFor: prismaBossTurnFor,
  };
}

/** Webhook → (si l'interprète est demandé) tâche boss-text traitée comme par le worker. */
async function say(u: Update) {
  const before = enqueued.length;
  await toBoss(u);
  const job = enqueued.slice(before).find((e) => e.job.type === "boss-text");
  if (job) await processBossText(job.job as Extract<AgentsOrchestratorJob, { type: "boss-text" }>, bossTextDeps());
  return job;
}

async function cleanup() {
  await resetDb();
  await prisma.bossTurn.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.mediaAsset.deleteMany({ where: { theme: "roulette", createdAt: { gte: started } } });
  await prisma.agentTeamConfig.deleteMany();
  await prisma.setting.deleteMany({ where: { OR: [{ key: { startsWith: "boss." } }, { key: { startsWith: "agents.secret." } }, { key: "agents.report.lastDay" }] } });
  await prisma.bot.deleteMany({ where: { telegramBotId: 222n } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.setting.upsert({ where: { key: "admin.telegramUserId" }, create: { key: "admin.telegramUserId", value: String(ADMIN) }, update: { value: String(ADMIN) } });
  const boss = await prisma.bot.create({
    data: { name: "Kevin", username: "kevin_boss_bot", telegramBotId: 222n, tokenEncrypted: encrypt(BOSS_TOKEN), vertical: "CASINO", webhookSecret: "secret-boss", role: "ADMIN" },
  });
  ids.boss = boss.id;
  ids.secret = boss.webhookSecret;
  let n = 3000;
  getOrCreateBot(boss, prismaTelegramDeps).api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    hooked.push({ method, payload: p });
    if (method === "sendMessage") return { ok: true, result: { message_id: n++, date: 0, chat: { id: Number(p.chat_id), type: "supergroup" }, text: p.text ?? "" } } as never;
    if (method === "deleteMessage" && !canDelete) return { ok: false, error_code: 400, description: "Bad Request: message can't be deleted" } as never;
    if (method === "getFile") return { ok: true, result: { file_id: p.file_id, file_unique_id: "u", file_path: "videos/v.mp4" } } as never;
    if (method === "copyMessage") return { ok: true, result: { message_id: n++ } } as never;
    return { ok: true, result: true } as never;
  });
  (prismaTelegramDeps as { downloadTelegramFile?: (url: string) => Promise<Uint8Array> }).downloadTelegramFile = async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, ...Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))]);
  (prismaTelegramDeps as { mediaAlbumReplyDelayMs?: number }).mediaAlbumReplyDelayMs = 1;
  agents().enqueue = { orchestrator: async (job, opts) => void enqueued.push({ job, jobId: opts?.jobId }), step: async () => undefined };
});

afterAll(async () => {
  await cleanup();
});

describe("Kevin dans le groupe de l'équipe : scénario complet (base réelle, faux Telegram, fausse IA)", () => {
  it("1. ajouté par l'admin : groupe enregistré, accueil une fois", async () => {
    const m = mark();
    await toBoss(added(ADMIN));
    expect((await prisma.setting.findUnique({ where: { key: "boss.groupChatId" } }))?.value).toBe(String(GROUP));
    const out = sentSince(m);
    expect(out[0]).toMatchObject({ chat: GROUP, text: expect.stringMatching(/moi c'est Kevin.*Mathéo.*qui fait quoi/) });
  });

  it("2. « Kevin, voici @lea, vidéos casino » : présentation en attente, confirmée par l'admin en privé quand Léa dit bonjour", async () => {
    let m = mark();
    await say(groupMsg(ADMIN, "Kevin, voici @lea, vidéos casino", { entities: [{ type: "mention", offset: 13, length: 4 }] }));
    expect(sentSince(m).map((s) => s.text).join("\n")).toContain("jamais vu @lea");
    m = mark();
    await say(groupMsg(LEA, "Kevin, salut !"));
    const out = sentSince(m);
    expect(out.find((s) => s.chat === GROUP)?.text).toMatch(/^Salut Léa.*avec Mathéo.*je reviens vers toi\.$/);
    expect(out.find((s) => s.chat === ADMIN)?.text).toContain(`@lea vient d'écrire (@lea, prénom « Léa », identifiant ${LEA})`);
    expect(await prisma.teamMember.findUnique({ where: { telegramUserId: BigInt(LEA) } })).toBeNull();
    m = mark();
    await say(privateMsg(ADMIN, "OUI"));
    expect(sentSince(m).map((s) => s.text).join("\n")).toMatch(/oté : Léa, vidéos casino\..*les vidéos et photos/);
    expect(sentSince(m).some((s) => s.chat === GROUP && /Bienvenue.*Léa/.test(s.text))).toBe(true);
    const lea = await prisma.teamMember.findUniqueOrThrow({ where: { telegramUserId: BigInt(LEA) } });
    expect(lea).toMatchObject({ firstName: "Léa", username: "lea", role: "MEMBER", responsibilities: { teams: ["casino"], kinds: ["media"] } });
  });

  it("3. demande MEDIA casino : dans le groupe avec @lea ; Léa envoie la vidéo #casino #roulette (message suivant) : rangée", async () => {
    const m = mark();
    await askHuman(agents(), { teamKey: "casino", kind: "MEDIA", key: "casino.media.roulette", question: "Il me manque 1 vidéo roulette pour le canal Casino VIP : envoie-la ici avec #casino #roulette.", expected: { count: 1, tags: ["casino", "roulette"] } });
    const q = sentSince(m).find((s) => s.chat === GROUP)!;
    expect(q.text.startsWith("@lea ❓ Il me manque 1 vidéo roulette")).toBe(true);
    const req = await prisma.humanRequest.findFirstOrThrow({ where: { key: "casino.media.roulette" } });
    expect(req).toMatchObject({ chatId: BigInt(GROUP), assigneeTelegramId: BigInt(LEA), status: "PENDING" });
    await toBoss(groupMsg(LEA, "", { text: undefined, caption: "#casino #roulette", video: { file_id: "vid1", file_unique_id: "vu1", width: 720, height: 1280, duration: 8, mime_type: "video/mp4", file_size: 1000 } }));
    expect(await prisma.mediaAsset.count({ where: { theme: "roulette", createdAt: { gte: started } } })).toBe(1);
    expect((await prisma.humanRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("ANSWERED");
  });

  it("4. « Léa est en vacances jusqu'à lundi » : la demande suivante va à l'admin, et Kevin le dit", async () => {
    let m = mark();
    await say(groupMsg(ADMIN, "Kevin, Léa est en vacances jusqu'à lundi"));
    expect(sentSince(m).map((s) => s.text).join("\n")).toMatch(/: Léa, absent·e jusqu'au lundi/);
    const lea = await prisma.teamMember.findUniqueOrThrow({ where: { telegramUserId: BigInt(LEA) } });
    expect(lea.awayUntil!.getTime()).toBeGreaterThan(Date.now());
    m = mark();
    await askHuman(agents(), { teamKey: "casino", kind: "MEDIA", key: "casino.media.slots", question: "Il me manque 2 vidéos slots.", expected: { count: 2, tags: ["casino", "slots"] } });
    const q = sentSince(m).find((s) => s.chat === GROUP)!;
    expect(q.text).toContain("Léa est absent·e jusqu'au");
    expect(q.text).toContain("@matheo ❓ Il me manque 2 vidéos slots.");
    expect((await prisma.humanRequest.findFirstOrThrow({ where: { key: "casino.media.slots" } })).assigneeTelegramId).toBeNull();
    // L'admin passe par son message suivant dans le groupe (sans « Répondre »).
    await toBoss(groupMsg(ADMIN, "plus tard"));
    expect((await prisma.humanRequest.findFirstOrThrow({ where: { key: "casino.media.slots" } })).status).toBe("SKIPPED");
  });

  it("5. demande SECRET : mention + lien privé ; clé collée dans le groupe supprimée et jamais journalisée ; acceptée en privé de Marc seulement", async () => {
    // Marc, présenté par une mention cliquable (sans nom d'utilisateur), puis /start en privé.
    await say(groupMsg(ADMIN, "Kevin, voici Marc, il gère les cotes", { entities: [{ type: "text_mention", offset: 13, length: 4, user: user(MARC) }] }));
    expect(await prisma.teamMember.findUnique({ where: { telegramUserId: BigInt(MARC) } })).toMatchObject({ firstName: "Marc", responsibilities: { teams: ["sports"], kinds: ["secret"] } });
    await toBoss(privateMsg(MARC, "/start"));
    expect((await prisma.teamMember.findUniqueOrThrow({ where: { telegramUserId: BigInt(MARC) } })).startedPrivateAt).not.toBeNull();
    let m = mark();
    await askHuman(agents(), { teamKey: "sports", kind: "SECRET", key: "providers.odds.apiKey", question: "Colle la clé SportsGameOdds." });
    const out = sentSince(m);
    const inGroup = out.filter((s) => s.chat === GROUP);
    expect(inGroup).toHaveLength(1);
    expect(inGroup[0]!.text).toContain('<a href="tg://user?id=7002">Marc</a>, envoie-moi la clé des cotes en privé 👉 t.me/kevin_boss_bot');
    expect(inGroup[0]!.text).not.toContain("SportsGameOdds");
    expect(out.some((s) => s.chat === MARC && s.text.includes("SportsGameOdds"))).toBe(true);
    // Collée dans le groupe : supprimée, redemandée en privé, jamais journalisée, jamais rangée.
    m = mark();
    const pasted = await toBoss(groupMsg(MARC, KEY));
    expect(hooked.slice(m.h).some((c) => c.method === "deleteMessage" && c.payload.message_id === pasted.message!.message_id)).toBe(true);
    expect(sentSince(m).find((s) => s.chat === GROUP)!.text).toMatch(/effacé/);
    // Sans droit de suppression : Kevin demande à l'auteur de l'effacer.
    canDelete = false;
    m = mark();
    await toBoss(groupMsg(MARC, `la clé : ${KEY}`));
    expect(sentSince(m).find((s) => s.chat === GROUP)!.text).toContain("efface vite ton message");
    canDelete = true;
    expect(await prisma.setting.findUnique({ where: { key: "agents.secret.providers.odds.apiKey" } })).toBeNull();
    // Léa (pas sa demande) en privé : retirée, jamais rangée.
    await toBoss(privateMsg(LEA, KEY));
    expect(await prisma.setting.findUnique({ where: { key: "agents.secret.providers.odds.apiKey" } })).toBeNull();
    // Marc en privé : rangée, message supprimé.
    m = mark();
    const ok = await toBoss(privateMsg(MARC, KEY));
    expect(await prisma.setting.findUnique({ where: { key: "agents.secret.providers.odds.apiKey" } })).not.toBeNull();
    expect(hooked.slice(m.h).some((c) => c.method === "deleteMessage" && c.payload.chat_id === MARC && c.payload.message_id === ok.message!.message_id)).toBe(true);
    // Jamais en clair : ni journal, ni audit, ni mémoire de Kevin.
    const everything = JSON.stringify(
      [await prisma.event.findMany({ select: { payload: true } }), await prisma.auditLog.findMany({ select: { metadata: true } }), await prisma.bossTurn.findMany({ select: { text: true } })],
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    expect(everything).not.toContain(KEY);
  });

  it("6. Léa « passe le casino en vrai » : résumé adressé à l'admin ; Léa ne peut pas confirmer, l'admin si", async () => {
    let m = mark();
    await say(groupMsg(LEA, "Kevin, passe le casino en vrai"));
    const ask = sentSince(m).find((s) => s.chat === GROUP)!;
    expect(ask.text).toMatch(/^@matheo Léa demande : passer l'équipe Casino en vrai\. OUI \?/);
    const yes = (ask.payload.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard.flat().find((b) => /:yes$/.test(b.callback_data))!;
    // Léa répond OUI à Kevin : refusé.
    m = mark();
    await toBoss(groupMsg(LEA, "OUI", { reply_to_message: { message_id: 3000, date: 0, chat: groupChat(), from: { id: 222, is_bot: true, first_name: "Kevin" }, text: "?" } }));
    expect(sentSince(m).map((s) => s.text)).toEqual(["Ça, c'est Mathéo qui décide."]);
    // Léa appuie sur OUI : silence, rien ne change.
    const cb = (from: number): Update =>
      ({ update_id: uid++, callback_query: { id: `cb${uid}`, chat_instance: "x", from: user(from), message: { message_id: 3001, date: 0, chat: groupChat(), text: "?" }, data: yes.callback_data } }) as Update;
    await toBoss(cb(LEA));
    expect((await prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" } }))?.simulation ?? true).toBe(true);
    // L'admin confirme : en vrai.
    await toBoss(cb(ADMIN));
    expect((await prisma.agentTeamConfig.findUniqueOrThrow({ where: { teamKey: "casino" } })).simulation).toBe(false);
    const audit = await prisma.auditLog.findFirst({ where: { action: "boss.simulation", metadata: { path: ["status"], equals: "escalated" } } });
    expect((audit?.metadata as { telegramActorId?: string }).telegramActorId).toBe(String(LEA));
    await prisma.agentTeamConfig.update({ where: { teamKey: "casino" }, data: { simulation: true } });
  });

  it("7. un inconnu donne un ordre dans le groupe : rien (au plus « je ne te connais pas », une fois)", async () => {
    const m = mark();
    const before = enqueued.length;
    await toBoss(groupMsg(STRANGER, "Kevin, mets tout en pause"));
    await toBoss(groupMsg(STRANGER, "Kevin, mets tout en pause"));
    expect(sentSince(m).map((s) => s.text)).toEqual([expect.stringMatching(/Mathéo (doit )?me présente/)]);
    expect(enqueued.length).toBe(before);
    expect(await prisma.agentTeamConfig.count({ where: { paused: true } })).toBe(0);
  });

  it("8. Kevin ajouté par un inconnu dans un autre groupe : silence, une ligne de journal", async () => {
    const m = mark();
    await toBoss(added(STRANGER, OTHER_GROUP));
    expect(sentSince(m)).toEqual([]);
    expect((await prisma.setting.findUnique({ where: { key: "boss.groupChatId" } }))?.value).toBe(String(GROUP));
    expect(await prisma.event.count({ where: { type: "boss.group.ignored" } })).toBeGreaterThan(0);
  });

  it("9. rapport du matin dans le groupe : 5 lignes avec les @ des personnes qui ont quelque chose en attente", async () => {
    await say(groupMsg(ADMIN, "Kevin, Léa est de retour"));
    await askHuman(agents(), { teamKey: "casino", kind: "MEDIA", key: "casino.media.blackjack", question: "Il me manque 1 vidéo blackjack.", expected: { count: 1, tags: ["casino", "blackjack"] } });
    const m = mark();
    const r = await sendDailyReport(agents(), { force: true });
    expect(r.sent).toBe(true);
    const report = sentSince(m).filter((s) => s.chat === GROUP);
    expect(report).toHaveLength(1);
    const lines = report[0]!.text.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^(Bonjour|Salut|Hello) l'équipe/);
    expect(lines[4]).toContain("@lea 1 question");
    // Le rapport détaillé part aussi en privé à l'admin (préférence par défaut) : le groupe ne le remplace pas.
    expect(sentSince(m).filter((s) => s.chat === ADMIN && s.text.includes("Rapport des agents"))).toHaveLength(1);
  });

  it("10. mode confidentialité : mention seule (activé) ou « Kevin, … » (désactivé) ; le reste est ignoré et jamais journalisé en texte", async () => {
    const m = mark();
    await toBoss(groupMsg(ADMIN, "@kevin_boss_bot qui fait quoi ?", { entities: [{ type: "mention", offset: 0, length: 15 }] }));
    await toBoss(groupMsg(ADMIN, "Kevin, qui fait quoi ?"));
    await toBoss(groupMsg(LEA, "quelqu'un a vu mon chargeur ?"));
    const out = sentSince(m).filter((s) => s.chat === GROUP);
    expect(out).toHaveLength(2);
    for (const o of out) expect(o.text).toContain("Léa (@lea)");
    const logged = JSON.stringify(await prisma.event.findMany({ where: { type: "telegram.message" }, select: { payload: true } }));
    expect(logged).not.toContain("chargeur");
    expect(logged).not.toContain("qui fait quoi");
  });
});
