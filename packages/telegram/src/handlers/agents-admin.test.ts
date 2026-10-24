import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { askHuman, requestValidation, TEAM_LABELS } from "@linkaffipro/agents";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";
import { prismaAgentsAdminState } from "./agents-test-state";
import { ADMIN_TG_ID, createTestKit, journalText } from "@linkaffipro/agents/test-kit";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../../../agents/src/missions/lifecycle", () => lifecycle);

const identity: BotIdentity = { id: "bot_1", name: "CasinoBot", username: "casinobot", telegramBotId: 111n, vertical: "CASINO" };
const ADMIN = Number(ADMIN_TG_ID);

function makeDeps(kit: ReturnType<typeof createTestKit>) {
  return {
    recordUpdate: vi.fn(async (_b: BotIdentity, _t: string, _u: Update) => undefined),
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
    agentsAdminState: (id: bigint) => prismaAgentsAdminState(kit.prisma, id),
  } satisfies TelegramDeps;
}

function makeBot(deps: TelegramDeps) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  let n = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage") return { ok: true, result: { message_id: n++, date: 0, chat: { id: ADMIN, type: "private" } } } as never;
    return { ok: true, result: true } as never;
  });
  registerHandlers(bot, identity, deps, { extended: false });
  return { bot, calls, sent: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string) };
}

let uid = 1;
function textUpdate(fromId: number, text: string, replyTo?: number): Update {
  return {
    update_id: uid++,
    message: {
      message_id: 500 + uid,
      date: 0,
      chat: { id: fromId, type: "private", first_name: "A" },
      from: { id: fromId, is_bot: false, first_name: "A" },
      text,
      ...(replyTo ? { reply_to_message: { message_id: replyTo, date: 0, chat: { id: fromId, type: "private", first_name: "A" } } } : {}),
    },
  } as Update;
}
function callbackUpdate(fromId: number, data: string): Update {
  return {
    update_id: uid++,
    callback_query: {
      id: `cb${uid}`,
      chat_instance: "x",
      from: { id: fromId, is_bot: false, first_name: "A" },
      message: { message_id: 77, date: 0, chat: { id: fromId, type: "private", first_name: "A" }, text: "aperçu" },
      data,
    },
  } as Update;
}

beforeEach(() => {
  lifecycle.continueMission.mockClear();
  lifecycle.cancelMission.mockClear();
});

async function withValidation() {
  const kit = createTestKit();
  const m = await kit.mission();
  const v = await requestValidation(kit.deps, { missionId: m.id, teamKey: "dating", previewText: "Texte", reason: "niveau 0" });
  return { kit, m, v };
}

describe("boutons de validation (Telegram)", () => {
  it("✅ par l'admin : validé, boutons retirés ; second clic sans effet", async () => {
    const { kit, m, v } = await withValidation();
    const deps = makeDeps(kit);
    const { bot, calls } = makeBot(deps);
    await bot.handleUpdate(callbackUpdate(ADMIN, `agv:${v.validationId}:ok`));
    await bot.handleUpdate(callbackUpdate(ADMIN, `agv:${v.validationId}:ok`));
    expect(lifecycle.continueMission).toHaveBeenCalledTimes(1);
    expect(lifecycle.continueMission).toHaveBeenCalledWith(kit.deps, m.id, { reason: "validation accordée" });
    const answers = calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.payload.text);
    expect(answers[0]).toBe("Validé ✅");
    expect(String(answers[1])).toContain("déjà validé");
    expect(calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
  });

  it("une autre personne : ignorée en silence", async () => {
    const { kit, v } = await withValidation();
    const { bot, calls } = makeBot(makeDeps(kit));
    await bot.handleUpdate(callbackUpdate(999, `agv:${v.validationId}:no`));
    expect(kit.tables("agentValidation")[0]!.status).toBe("PENDING");
    expect(calls.filter((c) => c.method === "answerCallbackQuery")[0]!.payload.text).toBeUndefined();
    expect(calls.some((c) => c.method === "sendMessage")).toBe(false);
  });

  it("✏️ puis message texte : nouveau texte, retour au Contrôle qualité", async () => {
    const { kit, m, v } = await withValidation();
    const { bot, sent } = makeBot(makeDeps(kit));
    await bot.handleUpdate(callbackUpdate(ADMIN, `agv:${v.validationId}:edit`));
    await bot.handleUpdate(textUpdate(ADMIN, "Texte corrigé 💋"));
    expect(kit.tables("agentValidation")[0]).toMatchObject({ status: "EDITED", editedText: "Texte corrigé 💋" });
    expect(lifecycle.continueMission).toHaveBeenCalledWith(kit.deps, m.id, { fromAgent: "controle", reason: "texte corrigé par l'admin" });
    expect(sent().at(-1)).toContain("repasse au contrôle qualité");
  });
});

describe("dialogue admin (Telegram)", () => {
  it("secret : rangé chiffré, message supprimé, jamais journalisé, vérification KO → demande ouverte", async () => {
    const kit = createTestKit();
    const { registerSecretVerifier, clearSecretVerifiers } = await import("@linkaffipro/agents");
    clearSecretVerifiers();
    const verify = vi.fn(async (v: string) => (v.endsWith("0000") ? { ok: false, message: "clé refusée" } : { ok: true, message: "ok" }));
    registerSecretVerifier("providers.fal.apiKey", verify);
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Réponds à ce message avec ta clé fal.ai." });
    const deps = makeDeps(kit);
    const { bot, calls, sent } = makeBot(deps);
    const questionId = kit.sent[0]!.messageId;

    await bot.handleUpdate(textUpdate(ADMIN, "fal-BAD-KEY-0000", questionId));
    expect(sent().at(-1)).toContain("KO : clé refusée");
    expect(kit.tables("humanRequest")[0]!.status).toBe("PENDING");

    await bot.handleUpdate(textUpdate(ADMIN, "fal-GOOD-KEY-ab12", questionId));
    expect(verify).toHaveBeenCalledTimes(2);
    expect(sent().at(-1)).toBe("Clé fal.ai enregistrée (…ab12). Vérification : OK ✅");
    expect(kit.tables("humanRequest")[0]!.status).toBe("ANSWERED");
    expect(calls.filter((c) => c.method === "deleteMessage")).toHaveLength(2);

    const logged = JSON.stringify(deps.recordUpdate.mock.calls.map((c) => c[2]));
    expect(logged).not.toContain("KEY");
    expect(logged).toContain("[secret retiré]");
    expect(journalText(kit)).not.toContain("KEY");
    expect(JSON.stringify(kit.tables("setting"))).not.toContain("GOOD-KEY");
    // Aucun message envoyé ne contient la clé.
    expect(sent().join("\n")).not.toContain("GOOD-KEY");
  });

  it("commande « clé cotes … » masquée et supprimée même sans demande", async () => {
    const kit = createTestKit();
    const deps = makeDeps(kit);
    const { bot, calls, sent } = makeBot(deps);
    await bot.handleUpdate(textUpdate(ADMIN, "clé cotes ODDS-SECRET-9z9z"));
    expect(sent().at(-1)).toBe("Clé des cotes enregistrée (…9z9z) ✅");
    expect(calls.some((c) => c.method === "deleteMessage")).toBe(true);
    expect(JSON.stringify(deps.recordUpdate.mock.calls.map((c) => c[2]))).not.toContain("ODDS-SECRET");
  });

  it("CONFIRM par message suivant, « pause dating », « agents », « vrai casino » + OUI", async () => {
    const kit = createTestKit();
    const deps = makeDeps(kit);
    const { bot, sent } = makeBot(deps);
    await bot.handleUpdate(textUpdate(ADMIN, "pause dating"));
    expect(sent().at(-1)).toBe(`Équipe ${TEAM_LABELS.dating} en pause ⏸`);
    await bot.handleUpdate(textUpdate(ADMIN, "agents"));
    // Résumé de supervision (phase 25) : 8 lignes, une par équipe, Ads, Algorithme, santé.
    const lines = sent().at(-1)!.split("\n");
    expect(lines).toHaveLength(8);
    expect(lines.at(-1)).toMatch(/^Santé : /);
    await bot.handleUpdate(textUpdate(ADMIN, "vrai casino"));
    // Résumé et OUI / NON : en réponse directe (chemin d'aujourd'hui) ou par le messager admin (ancien chemin).
    expect([sent().at(-1) ?? "", kit.sent.at(-1)?.html ?? ""].join("\n")).toContain("Passer l'équipe Casino en vrai ?");
    await bot.handleUpdate(textUpdate(ADMIN, "OUI"));
    expect(kit.tables("agentTeamConfig").find((c) => c.teamKey === "casino")).toMatchObject({ simulation: false });
    // Les messages ordinaires de l'admin restent journalisés tels quels (pnpm tg:inbox).
    expect(JSON.stringify(deps.recordUpdate.mock.calls.map((c) => c[2]))).toContain("pause dating");
  });

  it("« ok <n> » valide par numéro court", async () => {
    const { kit, v } = await withValidation();
    const { bot } = makeBot(makeDeps(kit));
    await bot.handleUpdate(textUpdate(ADMIN, `ok ${v.number}`));
    expect(kit.tables("agentValidation")[0]!.status).toBe("APPROVED");
  });

  it("une autre personne qui écrit « agents » : rien côté agents", async () => {
    const kit = createTestKit();
    const deps = makeDeps(kit);
    const { bot, sent } = makeBot(deps);
    await bot.handleUpdate(textUpdate(31337, "agents"));
    await bot.handleUpdate(textUpdate(31337, "pause dating"));
    expect(sent().some((t) => t.includes("Agents") || t.includes("pause"))).toBe(false);
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
  });

  it("message ordinaire de l'admin sans demande : laissé aux autres handlers", async () => {
    const kit = createTestKit();
    const deps = makeDeps(kit);
    const { bot } = makeBot(deps);
    await bot.handleUpdate(textUpdate(ADMIN, "fait"));
    expect(JSON.stringify(deps.recordUpdate.mock.calls[0]![2])).toContain('"text":"fait"');
    expect(kit.tables("auditLog")).toHaveLength(0);
  });
});

describe("relecture de la phase 25 (dialogue admin)", () => {
  const KEY = "fal-AbCdEf0123456789";
  const logged = (deps: ReturnType<typeof makeDeps>) => JSON.stringify(deps.recordUpdate.mock.calls.map((c) => c[2]));

  it("✏️ : réponse au message « envoie le nouveau texte » (même après 15 min), entités → HTML échappé", async () => {
    const { kit, v } = await withValidation();
    const { bot, calls } = makeBot(makeDeps(kit));
    await bot.handleUpdate(callbackUpdate(ADMIN, `agv:${v.validationId}:edit`));
    const promptIdx = calls.findIndex((c) => c.method === "sendMessage");
    const promptId = 1000 + calls.slice(0, promptIdx).filter((c) => c.method === "sendMessage").length;
    kit.advance(20 * 60_000);
    const late = textUpdate(ADMIN, "Je t'aime <3 vraiment");
    await bot.handleUpdate(late);
    expect(kit.tables("agentValidation")[0]!.status).toBe("PENDING");
    const u = textUpdate(ADMIN, "Je t'aime <3 vraiment", promptId);
    (u.message as unknown as Record<string, unknown>).entities = [{ type: "bold", offset: 13, length: 8 }];
    await bot.handleUpdate(u);
    expect(kit.tables("agentValidation")[0]).toMatchObject({ status: "EDITED", editedText: "Je t'aime &lt;3 <b>vraiment</b>" });
  });

  it("demande SECRET en cours : « Parfait! » reste lisible (journal en clair, message gardé)", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    const deps = makeDeps(kit);
    const { bot, calls } = makeBot(deps);
    await bot.handleUpdate(textUpdate(ADMIN, "Parfait!"));
    expect(logged(deps)).toContain('"text":"Parfait!"');
    expect(calls.some((c) => c.method === "deleteMessage")).toBe(false);
    expect(kit.tables("humanRequest")[0]!.status).toBe("PENDING");
    // Une clé seule, sans « répondre » : prise, masquée et supprimée.
    await bot.handleUpdate(textUpdate(ADMIN, KEY));
    expect(logged(deps)).not.toContain("AbCdEf");
    expect(calls.some((c) => c.method === "deleteMessage")).toBe(true);
  });

  it("clé collée en réponse à une demande SECRET expirée : masquée dans le journal et supprimée", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    const q = kit.sent[0]!.messageId;
    await kit.prisma.humanRequest.update({ where: { id: kit.tables("humanRequest")[0]!.id as string }, data: { status: "EXPIRED" } });
    const deps = makeDeps(kit);
    const { bot, calls, sent } = makeBot(deps);
    await bot.handleUpdate(textUpdate(ADMIN, "abc", q));
    expect(logged(deps)).not.toContain('"text":"abc"');
    expect(logged(deps)).toContain("[secret retiré]");
    expect(calls.some((c) => c.method === "deleteMessage")).toBe(true);
    expect(sent().at(-1)).toContain("plus une question ouverte");
  });

  it("« Clé: fal … » et « voici la clé fal … » : masqués", async () => {
    const kit = createTestKit();
    const deps = makeDeps(kit);
    const { bot } = makeBot(deps);
    await bot.handleUpdate(textUpdate(ADMIN, `Clé: fal ${KEY}`));
    await bot.handleUpdate(textUpdate(ADMIN, `voici la clé fal ${KEY}`));
    expect(logged(deps)).not.toContain("AbCdEf");
  });

  it("traitement en erreur : un message qui contenait un secret est quand même supprimé", async () => {
    const kit = createTestKit();
    const model = kit.prisma._model("setting");
    model.upsert = (async () => {
      throw new Error("base indisponible");
    }) as typeof model.upsert;
    const deps = makeDeps(kit);
    const { bot, calls, sent } = makeBot(deps);
    await bot.handleUpdate(textUpdate(ADMIN, `clé fal ${KEY}`));
    expect(sent().at(-1)).toContain("je n'ai pas pu traiter");
    expect(calls.some((c) => c.method === "deleteMessage")).toBe(true);
  });
});

function voiceUpdate(fromId: number, size = 5000): Update {
  return {
    update_id: uid++,
    message: {
      message_id: 700 + uid,
      date: 0,
      chat: { id: fromId, type: "private", first_name: "A" },
      from: { id: fromId, is_bot: false, first_name: "A" },
      voice: { file_id: "voice_file", file_unique_id: "vu", duration: 3, mime_type: "audio/ogg", file_size: size },
    },
  } as Update;
}

describe("vocaux de l'admin (phase 20)", () => {
  it("vocal de l'admin : mis en file pour le worker (idempotent), rien d'autre", async () => {
    const kit = createTestKit();
    const { bot, calls } = makeBot(makeDeps(kit));
    const u = voiceUpdate(ADMIN);
    await bot.handleUpdate(u);
    const messageId = (u as { message: { message_id: number } }).message.message_id;
    expect(kit.enqueue.orchestrator).toHaveBeenCalledWith(
      { type: "admin-voice", botId: "bot_1", fileId: "voice_file", messageId, chatId: ADMIN, replyToMessageId: null, mimeType: "audio/ogg" },
      { jobId: `admin-voice:bot_1:${messageId}` },
    );
    expect(calls.some((c) => c.method === "sendMessage" || c.method === "getFile")).toBe(false);
  });

  it("vocal d'une autre personne : ignoré", async () => {
    const kit = createTestKit();
    const { bot } = makeBot(makeDeps(kit));
    await bot.handleUpdate(voiceUpdate(999));
    expect(kit.enqueue.orchestrator).not.toHaveBeenCalled();
  });

  it("vocal trop lourd : message clair, rien en file", async () => {
    const kit = createTestKit();
    const { bot, sent } = makeBot(makeDeps(kit));
    await bot.handleUpdate(voiceUpdate(ADMIN, 3 * 1024 * 1024));
    expect(kit.enqueue.orchestrator).not.toHaveBeenCalled();
    expect(sent()[0]).toContain("Vocal trop long");
  });
});
