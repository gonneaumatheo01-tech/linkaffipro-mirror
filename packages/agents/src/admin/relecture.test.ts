/**
 * Relecture adverse de la phase 25 (correcteur 1) : droits sur les demandes, réponses en réponse à un autre message,
 * fenêtre « ✏️ Corriger », demandes SECRET / TEXT, masquage, double exécution, une question à la fois, compteur MEDIA,
 * résumé d'une clé.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit, journalText } from "../human/test-kit";
import { askHuman, sendNextHumanRequest } from "../human/requests";
import { adminOnlyRequest, answerHumanRequestFromSite, skipHumanRequest } from "../human/site";
import { registerAnswerAction, respondToRequest, type HumanRequestRow } from "../human/respond";
import { clearSecretVerifiers, registerSecretVerifier } from "../human/secrets";
import { requestValidation } from "../validation/requests";
import { storeLibraryMedia } from "../library/store";
import { handleAgentsCallback } from "./callbacks";
import { handleAdminText, rememberEditPrompt, telegramEntitiesToHtml } from "./handle";
import { handleAdminVoice } from "./voice";
import { isSecretAdminText, parseAdminCommand } from "./commands";
import { ADMIN_TG_ID } from "../human/test-kit";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../missions/lifecycle", () => lifecycle);

// Le catalogue du Boss (confirmations de « vrai », « niveau », « budget vidéo ») se charge à la demande : préchargé ici.
beforeAll(async () => {
  await import("../boss/catalog");
  await import("../boss/execute");
}, 60_000);

beforeEach(() => {
  lifecycle.continueMission.mockClear();
  clearSecretVerifiers();
});

const KEY = "fal-AbCdEf0123456789";

describe("1. droits : demandes réservées aux ADMIN", () => {
  it("liste centralisée", () => {
    expect(adminOnlyRequest({ kind: "SECRET" })).toBe(true);
    expect(adminOnlyRequest({ kind: "CONFIRM", onAnswer: { action: "set-simulation", simulation: false } })).toBe(true);
    expect(adminOnlyRequest({ kind: "CONFIRM", onAnswer: { action: "set-simulation", simulation: true } })).toBe(false);
    expect(adminOnlyRequest({ kind: "CONFIRM", onAnswer: { action: "set-autonomy", level: 2 } })).toBe(true);
    expect(adminOnlyRequest({ kind: "CONFIRM", onAnswer: { action: "set-autonomy", level: 1 } })).toBe(false);
    for (const action of ["algo-level", "dating-video-budget", "ads-cpr", "ads-roas", "dating-bench"])
      expect(adminOnlyRequest({ kind: "CHOICE", onAnswer: { action } })).toBe(true);
    expect(adminOnlyRequest({ kind: "CONFIRM", onAnswer: { action: "setting", settingKey: "agents.dailyReport" } })).toBe(false);
  });

  it("un MANAGER ne répond pas (ni ne passe) une demande réservée depuis le site ; l'ADMIN oui", async () => {
    const kit = createTestKit();
    const live = await askHuman(kit.deps, {
      teamKey: "casino",
      kind: "CONFIRM",
      key: "agents.team.casino.live",
      question: "Passer en vrai ?",
      onAnswer: { action: "set-simulation", teamKey: "casino", simulation: false },
    });
    const actor = { via: "SITE" as const, userId: "m1" };
    expect(await answerHumanRequestFromSite(kit.deps, live.requestId, "oui", actor, "MANAGER")).toEqual({
      ok: false,
      message: "Cette demande est réservée aux administrateurs.",
    });
    expect(await skipHumanRequest(kit.deps, live.requestId, actor, "MANAGER")).toMatchObject({ ok: false });
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
    expect(kit.tables("humanRequest")[0]!.status).toBe("PENDING");
    const ok = await answerHumanRequestFromSite(kit.deps, live.requestId, "oui", { via: "SITE", userId: "a1" }, "ADMIN");
    expect(ok.ok).toBe(true);
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ teamKey: "casino", simulation: false });
  });

  it("SECRET depuis le site par un MANAGER : refusé, rien n'est enregistré", async () => {
    const kit = createTestKit();
    const r = await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    expect((await answerHumanRequestFromSite(kit.deps, r.requestId, KEY, { via: "SITE" }, "MANAGER")).ok).toBe(false);
    expect(kit.tables("setting").some((s) => String(s.key).startsWith("agents.secret."))).toBe(false);
  });
});

describe("2. « ok » en réponse à un autre message", () => {
  async function liveAsked() {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "vrai casino", messageId: 1 });
    return kit;
  }

  it("en réponse à un aperçu de validation : la confirmation en cours (vrai casino) n'est jamais confirmée", async () => {
    const kit = await liveAsked();
    const m = await kit.mission({ teamKey: "casino" });
    await requestValidation(kit.deps, { missionId: m.id as string, teamKey: "casino", previewText: "Post", reason: "test" });
    const preview = kit.sent.at(-1)!.messageId;
    await handleAdminText(kit.deps, { text: "oui", messageId: 2, replyToMessageId: preview });
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
    // Phase 26 : « vrai casino » passe par la confirmation du Boss (plus de demande CONFIRM sans expiration).
    expect(kit.tables("humanRequest")).toHaveLength(0);
    expect(kit.tables("setting").some((x) => x.key === "boss.pending")).toBe(true);
  });

  it("en réponse à une ancienne demande close : « Ce message n'est plus une question ouverte »", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "CONFIRM", key: "q.old", question: "Ancienne ?" });
    const oldMsg = kit.sent[0]!.messageId;
    const first = await handleAdminText(kit.deps, { text: "non", messageId: 2, replyToMessageId: oldMsg });
    await first.followUp?.();
    await handleAdminText(kit.deps, { text: "vrai casino", messageId: 3 });
    const r = await handleAdminText(kit.deps, { text: "ok", messageId: 4, replyToMessageId: oldMsg });
    expect(r.reply).toContain("n'est plus une question ouverte");
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
  });

  it("passage en vrai : « ok », « o », 👍, « d'accord » ne confirment jamais ; « Oui. » si", async () => {
    const kit = await liveAsked();
    for (const text of ["ok", "o", "👍", "d'accord"]) {
      await handleAdminText(kit.deps, { text, messageId: 10 });
      expect(kit.tables("agentTeamConfig"), text).toHaveLength(0);
    }
    const r = await handleAdminText(kit.deps, { text: "Oui.", messageId: 11 });
    expect(r.handled).toBe(true);
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ simulation: false });
  });

  it("par vocal : « Oui, vas-y » ne confirme pas un niveau, « Oui. » si", async () => {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "niveau casino 2", messageId: 1 });
    const said: string[] = [];
    await handleAdminVoice(kit.deps, { transcript: "Oui, vas-y.", messageId: 2 }, async (h) => void said.push(h));
    expect(said.at(-1)).toMatch(/exactement « oui »|« oui » tout seul/);
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")?.autonomyLevel ?? 0).toBe(0);
    await handleAdminVoice(kit.deps, { transcript: "Oui.", messageId: 3 }, async (h) => void said.push(h));
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")).toMatchObject({ autonomyLevel: 2 });
  });
});

describe("3. fenêtre « ✏️ Corriger »", () => {
  async function editing() {
    const kit = createTestKit();
    const m = await kit.mission({ teamKey: "casino", payload: { text: "ancien" } });
    const v = await requestValidation(kit.deps, { missionId: m.id as string, teamKey: "casino", previewText: "Post", reason: "test" });
    const cb = await handleAgentsCallback(kit.deps, { data: `agv:${v.validationId}:edit`, fromTelegramId: ADMIN_TG_ID });
    expect(cb.editPromptFor).toBe(v.validationId);
    await rememberEditPrompt(kit.deps, v.validationId, 777);
    return { kit, v, mission: m };
  }
  const payloadText = (kit: ReturnType<typeof createTestKit>) =>
    (kit.tables("agentMission")[0]!.payload as { text?: string }).text;

  it("les commandes passent d'abord : « ok 1 », « pause tout » ne deviennent jamais le texte du post", async () => {
    const { kit, v } = await editing();
    await handleAdminText(kit.deps, { text: "pause tout", messageId: 2 });
    expect(payloadText(kit)).toBe("ancien");
    const r = await handleAdminText(kit.deps, { text: `ok ${v.number}`, messageId: 3 });
    expect(r.reply).toContain("validé");
    expect(payloadText(kit)).toBe("ancien");
    expect(kit.tables("agentValidation")[0]!.status).toBe("APPROVED");
  });

  it("une clé collée ou une demande SECRET en cours : jamais une correction", async () => {
    const { kit } = await editing();
    expect((await handleAdminText(kit.deps, { text: KEY, messageId: 2 })).handled).toBe(false);
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    await handleAdminText(kit.deps, { text: "Nouveau texte du post", messageId: 3 });
    expect(payloadText(kit)).toBe("ancien");
    expect(kit.tables("agentValidation")[0]!.status).toBe("PENDING");
  });

  it("après 15 minutes sans « répondre » : ignorée ; en réponse au message « envoie le nouveau texte » : prise", async () => {
    const { kit } = await editing();
    kit.advance(16 * 60_000);
    expect((await handleAdminText(kit.deps, { text: "Texte tardif", messageId: 2 })).handled).toBe(false);
    expect(payloadText(kit)).toBe("ancien");
    const r = await handleAdminText(kit.deps, { text: "Texte corrigé", messageId: 3, replyToMessageId: 777 });
    expect(r.reply).toContain("remplacé");
    expect(payloadText(kit)).toBe("Texte corrigé");
  });

  it("en réponse à un autre message : pas une correction", async () => {
    const { kit } = await editing();
    expect((await handleAdminText(kit.deps, { text: "Texte", messageId: 2, replyToMessageId: 5555 })).handled).toBe(false);
    expect(payloadText(kit)).toBe("ancien");
  });

  it("8. texte + entités → HTML échappé (« <3 », gras, lien, emoji animé)", async () => {
    const { kit } = await editing();
    const text = "Je t'aime <3 gras lien 🔥";
    await handleAdminText(kit.deps, {
      text,
      messageId: 2,
      entities: [
        { type: "bold", offset: 13, length: 4 },
        { type: "text_link", offset: 18, length: 4, url: "https://x.fr/?a=1&b=2" },
        { type: "custom_emoji", offset: 23, length: 2, custom_emoji_id: "5368324170671202286" },
      ],
    });
    expect(payloadText(kit)).toBe(
      'Je t\'aime &lt;3 <b>gras</b> <a href="https://x.fr/?a=1&amp;b=2">lien</a> <tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji>',
    );
  });
});

describe("entités → HTML (pur)", () => {
  it("sans entité : texte échappé ; imbrication et chevauchement bien formés", () => {
    expect(telegramEntitiesToHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
    expect(
      telegramEntitiesToHtml("abcdef", [
        { type: "bold", offset: 0, length: 4 },
        { type: "italic", offset: 2, length: 4 },
      ]),
    ).toBe("<b>ab<i>cd</i></b><i>ef</i>");
    expect(telegramEntitiesToHtml("x", [{ type: "mention", offset: 0, length: 1 }])).toBe("x");
  });
});

describe("4. demande SECRET ou TEXT en cours : un message ordinaire n'est pas avalé", () => {
  it("SECRET : « fait », « Parfait! » restent pour tg:inbox ; une clé seule est prise ; un identifiant seulement en réponse", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    for (const text of ["fait", "Parfait!", "voici des emojis 🎉🎉"]) {
      expect(await handleAdminText(kit.deps, { text, messageId: 2 })).toEqual({ handled: false });
      expect(isSecretAdminText(text, { pending: { key: "providers.fal.apiKey" } })).toBe(false);
    }
    expect(kit.tables("setting").some((s) => String(s.key).startsWith("agents.secret."))).toBe(false);
    const r = await handleAdminText(kit.deps, { text: KEY, messageId: 3 });
    expect(r).toMatchObject({ handled: true, deleteMessage: true });
    expect(isSecretAdminText(KEY, { pending: { key: "providers.fal.apiKey" } })).toBe(true);
  });

  it("identifiant bookmaker : le message suivant EST l'identifiant, même sans « répondre » (défaut 1 de la relecture)", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.bookmakers.sportaza.login", question: "Ton identifiant ?" });
    expect(isSecretAdminText("jean75", { pending: { key: "providers.bookmakers.sportaza.login" } })).toBe(true);
    expect(isSecretAdminText("fait", { pending: { key: "providers.bookmakers.sportaza.login" } })).toBe(false);
    expect(await handleAdminText(kit.deps, { text: "fait", messageId: 2 })).toEqual({ handled: false });
    const r = await handleAdminText(kit.deps, { text: "jean75", messageId: 3 });
    expect(r).toMatchObject({ handled: true, deleteMessage: true });
    expect(r.reply).toBe("Identifiant sportaza enregistré ✅");
  });

  it("TEXT : rien sans « répondre » au message", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "TEXT", key: "persona.x.name", question: "Prénom ?" });
    expect(kit.sent[0]!.html).toContain("Réponds à ce message");
    expect(await handleAdminText(kit.deps, { text: "Parfait!", messageId: 2 })).toEqual({ handled: false });
    expect(kit.tables("humanRequest")[0]!.status).toBe("PENDING");
  });

  it("secret invalide en réponse : pas enregistré, message non supprimé", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    const r = await handleAdminText(kit.deps, { text: "deux mots", messageId: 2, replyToMessageId: kit.sent[0]!.messageId });
    expect(r.handled).toBe(true);
    expect(r.deleteMessage).toBe(false);
  });
});

describe("5. masquage", () => {
  it("« Clé: fal sk-… » et « clé : fal … » : commande reconnue", () => {
    expect(parseAdminCommand(`Clé: fal ${KEY}`)).toEqual({ type: "secret", key: "providers.fal.apiKey", value: KEY });
    expect(parseAdminCommand(`clé : fal, ${KEY}`)).toEqual({ type: "secret", key: "providers.fal.apiKey", value: KEY });
    expect(isSecretAdminText(`Clé: fal ${KEY}`)).toBe(true);
  });
  it("filet : « voici la clé fal … », « mon mot de passe est … »", () => {
    expect(isSecretAdminText(`voici la clé fal ${KEY}`)).toBe(true);
    expect(isSecretAdminText("mon mot de passe est Azerty2024!Azerty")).toBe(true);
    expect(isSecretAdminText("la clé arrive demain")).toBe(false);
    expect(isSecretAdminText("fait")).toBe(false);
  });
  it("réponse à l'ancien message d'une demande SECRET (expirée, passée, en file) : masquée", () => {
    expect(isSecretAdminText("abc", { replyToMessageId: 42, secretMessageIds: [41, 42] })).toBe(true);
    expect(isSecretAdminText("abc", { replyToMessageId: 43, secretMessageIds: [41, 42] })).toBe(false);
  });
  it("réponse à une demande SECRET close : « plus une question ouverte », message retiré", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    const q = kit.sent[0]!.messageId;
    await handleAdminText(kit.deps, { text: "plus tard", messageId: 2 });
    const r = await handleAdminText(kit.deps, { text: KEY, messageId: 3, replyToMessageId: q });
    expect(r).toMatchObject({ handled: true, deleteMessage: true, reply: expect.stringContaining("plus une question ouverte") });
    expect(kit.tables("setting").some((s) => String(s.key).startsWith("agents.secret."))).toBe(false);
  });
});

describe("6. double exécution", () => {
  it("deux réponses simultanées : l'action ne s'exécute qu'une fois", async () => {
    const kit = createTestKit();
    const action = vi.fn(async () => "Banc lancé");
    registerAnswerAction("test-double", action);
    const r = await askHuman(kit.deps, { kind: "CONFIRM", key: "q.double", question: "Lancer ?", onAnswer: { action: "test-double" } });
    const row = (await kit.prisma.humanRequest.findUnique({ where: { id: r.requestId } })) as HumanRequestRow;
    const [a, b] = await Promise.all([
      respondToRequest(kit.deps, row, "oui", { via: "TELEGRAM" }),
      respondToRequest(kit.deps, row, "oui", { via: "SITE" }),
    ]);
    expect(action).toHaveBeenCalledTimes(1);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });

  it("réponse qui croise l'expiration : rien n'est exécuté", async () => {
    const kit = createTestKit();
    const action = vi.fn(async () => undefined);
    registerAnswerAction("test-expired", action);
    const r = await askHuman(kit.deps, { kind: "CONFIRM", key: "q.exp", question: "Lancer ?", onAnswer: { action: "test-expired" } });
    const row = (await kit.prisma.humanRequest.findUnique({ where: { id: r.requestId } })) as HumanRequestRow;
    await kit.prisma.humanRequest.update({ where: { id: r.requestId }, data: { status: "EXPIRED" } });
    const res = await respondToRequest(kit.deps, row, "oui", { via: "TELEGRAM" });
    expect(res).toMatchObject({ ok: false, message: "Cette demande est déjà traitée." });
    expect(action).not.toHaveBeenCalled();
  });

  it("SECRET refusé par la vérification : la demande redevient PENDING", async () => {
    const kit = createTestKit();
    registerSecretVerifier("providers.fal.apiKey", async () => ({ ok: false, message: "clé inconnue" }));
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    const r = await handleAdminText(kit.deps, { text: KEY, messageId: 2 });
    expect(r.reply).toBe("Clé fal.ai reçue (…6789). La vérification a échoué (clé inconnue). Réessaie en répondant avec une autre clé.");
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "PENDING", answerSummary: null });
  });
});

describe("7. une question à la fois (index unique partiel)", () => {
  it("réservation refusée par l'index (P2002) : la demande reste en file, rien n'est envoyé", async () => {
    const kit = createTestKit();
    const model = kit.prisma._model("humanRequest");
    const original = model.updateMany.bind(model);
    model.updateMany = (async (args: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      // Simule l'index : une autre question est déjà posée par l'autre service.
      if (args.data.status === "PENDING") throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      return original(args);
    }) as typeof model.updateMany;
    await kit.prisma.humanRequest.create({ data: { kind: "TEXT", key: "q.x", question: "?", status: "QUEUED" } as never });
    expect(await sendNextHumanRequest(kit.deps)).toBeNull();
    expect(kit.tables("humanRequest")[0]!.status).toBe("QUEUED");
    expect(kit.sent).toHaveLength(0);
  });
});

describe("8. compteur d'une demande de médias", () => {
  function input(n: number) {
    return {
      bytes: new Uint8Array([n, n + 1, n + 2]),
      mimeType: "image/jpeg",
      filename: `p${n}.jpg`,
      caption: "#dating #photo",
      botId: "bot1",
      telegramFileId: `f${n}`,
      fileUniqueId: `u${n}`,
    };
  }

  it("médias d'un album arrivés ensemble : aucun compté deux fois ni perdu", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "MEDIA", key: "media.x", question: "3 photos", expected: { count: 3, tags: ["dating"] } });
    await Promise.all([storeLibraryMedia(kit.deps, input(1)), storeLibraryMedia(kit.deps, input(10))]);
    const req = kit.tables("humanRequest")[0]!;
    expect((req.expected as { received: number }).received).toBe(2);
    expect(req.status).toBe("PENDING");
  });

  it("clôture : jamais sur une demande expirée", async () => {
    const kit = createTestKit();
    const r = await askHuman(kit.deps, { kind: "MEDIA", key: "media.y", question: "1 photo", expected: { count: 1, tags: ["dating"] } });
    await kit.prisma.humanRequest.update({ where: { id: r.requestId }, data: { status: "EXPIRED" } });
    await storeLibraryMedia(kit.deps, input(20));
    expect(kit.tables("humanRequest")[0]!.status).toBe("EXPIRED");
  });
});

describe("10. résumé d'une clé", () => {
  it("answerSummary et AuditLog : « enregistrée », jamais les derniers caractères", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé ?" });
    const r = await handleAdminText(kit.deps, { text: KEY, messageId: 2 });
    expect(r.reply).toBe("Clé fal.ai enregistrée (…6789) ✅");
    expect(kit.tables("humanRequest")[0]!.answerSummary).toBe("enregistrée");
    expect(journalText(kit)).not.toContain("6789");
  });
  it("mot de passe : aucun caractère, même dans la confirmation", async () => {
    const kit = createTestKit();
    const r = await handleAdminText(kit.deps, { text: "bookmaker sportaza jean Azerty2024!", messageId: 2 });
    expect(r.reply).toBe("Mot de passe sportaza enregistré ✅");
    expect(journalText(kit)).not.toContain("024!");
  });
});
