import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit, journalText } from "./test-kit";
import { askHuman, askedMessageIdsOf, humanRequestByMessageId, retireAdminChatMessageIds, retiredMessageIdsOf, withAskedMessageId } from "./requests";
import { handleAdminText } from "../admin/handle";
import { answerHumanRequestFromSite, ensureDailyReportQuestion, relaunchHumanRequest, skipHumanRequest, sweepHumanRequests } from "./site";
import { clearSecretVerifiers, readSecret, registerSecretVerifier, secretSummary } from "./secrets";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../missions/lifecycle", () => lifecycle);

const HOUR = 3600_000;

beforeEach(() => {
  lifecycle.continueMission.mockClear();
  lifecycle.cancelMission.mockClear();
  clearSecretVerifiers();
});

describe("demandes au client", () => {
  it("une seule question à la fois ; la suivante part après la réponse (réponse au message)", async () => {
    const kit = createTestKit();
    const a = await askHuman(kit.deps, { kind: "CONFIRM", key: "q.a", question: "Première ? Réponds oui ou non." });
    const b = await askHuman(kit.deps, { kind: "TEXT", key: "q.b", question: "Deuxième ?" });
    expect(a.sent).toBe(true);
    expect(b.sent).toBe(false);
    expect(kit.sent).toHaveLength(1);
    // Idempotent par clé ouverte.
    expect((await askHuman(kit.deps, { kind: "TEXT", key: "q.b", question: "Deuxième ?" })).requestId).toBe(b.requestId);

    const r = await handleAdminText(kit.deps, { text: "oui", messageId: 1, replyToMessageId: kit.sent[0]!.messageId });
    expect(r).toMatchObject({ handled: true, reply: "Réponse notée ✅" });
    expect(kit.sent).toHaveLength(1);
    await r.followUp?.();
    expect(kit.sent).toHaveLength(2);
    expect(kit.sent[1]!.html).toContain("Deuxième ?");
    expect(kit.tables("humanRequest").map((x) => x.status)).toEqual(["ANSWERED", "PENDING"]);
  });

  it("réponse par le message suivant (sans répondre au message) ; CHOICE par numéro", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "CHOICE", key: "q.c", question: "Lequel préfères-tu ? Réponds 1, 2 ou 3.", options: ["A", "B", "C"] });
    expect(kit.sent[0]!.html).toContain("2. B");
    const bad = await handleAdminText(kit.deps, { text: "9", messageId: 2 });
    expect(bad).toMatchObject({ handled: true, reply: expect.stringContaining("de 1 à 3") });
    const ok = await handleAdminText(kit.deps, { text: "2", messageId: 3 });
    expect(ok.handled).toBe(true);
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "ANSWERED", answerSummary: "2. B" });
  });

  it("sans demande en cours, un message ordinaire n'est pas pris", async () => {
    const kit = createTestKit();
    expect(await handleAdminText(kit.deps, { text: "fait", messageId: 2 })).toEqual({ handled: false });
  });

  it("secret : chiffré, jamais journalisé, message à supprimer, vérification OK", async () => {
    const kit = createTestKit();
    const verify = vi.fn(async () => ({ ok: true, message: "ok" }));
    registerSecretVerifier("providers.fal.apiKey", verify);
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Réponds à ce message avec ta clé fal.ai." });
    const r = await handleAdminText(kit.deps, { text: "fal-SECRET-VALUE-ab12", messageId: 9 });
    expect(r).toMatchObject({ handled: true, secret: true, deleteMessage: true });
    expect(r.reply).toBe("Clé fal.ai enregistrée (…ab12). Vérification : OK ✅");
    expect(verify).toHaveBeenCalledWith("fal-SECRET-VALUE-ab12");
    expect(await readSecret(kit.prisma, "providers.fal.apiKey")).toBe("fal-SECRET-VALUE-ab12");
    expect(await secretSummary(kit.prisma, "providers.fal.apiKey")).toMatchObject({ set: true, last4: "ab12" });
    const stored = JSON.stringify(kit.tables("setting"));
    expect(stored).not.toContain("fal-SECRET-VALUE");
    expect(journalText(kit)).not.toContain("SECRET-VALUE");
    expect(kit.tables("auditLog").some((a) => (a.metadata as { label?: string })?.label === "clé fal.ai enregistrée")).toBe(true);
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "ANSWERED", answerSummary: "enregistrée" });
  });

  it("secret refusé par la vérification : la demande reste ouverte", async () => {
    const kit = createTestKit();
    registerSecretVerifier("providers.fal.apiKey", async () => ({ ok: false, message: "clé inconnue" }));
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé fal.ai ?" });
    const r = await handleAdminText(kit.deps, { text: "mauvaise-cle-0000", messageId: 9 });
    expect(r.reply).toContain("Vérification : KO : clé inconnue");
    expect(r.deleteMessage).toBe(true);
    expect(kit.tables("humanRequest")[0]!.status).toBe("PENDING");
  });

  it("commande « clé fal » : répond à la demande ouverte de la même clé", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé fal.ai ?" });
    const r = await handleAdminText(kit.deps, { text: "clé fal key-123456-wxyz", messageId: 4 });
    expect(r).toMatchObject({ handled: true, deleteMessage: true, reply: "Clé fal.ai enregistrée (…wxyz) ✅" });
    expect(kit.tables("humanRequest")[0]!.status).toBe("ANSWERED");
    expect(journalText(kit)).not.toContain("key-123456");
  });

  it("WAITING_HUMAN puis reprise de la mission à la réponse", async () => {
    const kit = createTestKit();
    const m = await kit.mission();
    await askHuman(kit.deps, { kind: "TEXT", key: "persona.x.name", question: "Prénom ?", missionId: m.id });
    expect(kit.tables("agentMission")[0]!.status).toBe("WAITING_HUMAN");
    // Demande TEXT : seule une réponse au message de la question est prise.
    expect(await handleAdminText(kit.deps, { text: "Léa", messageId: 5 })).toEqual({ handled: false });
    await handleAdminText(kit.deps, { text: "Léa", messageId: 6, replyToMessageId: kit.sent[0]!.messageId });
    expect(lifecycle.continueMission).toHaveBeenCalledWith(kit.deps, m.id, { reason: "réponse du client" });
    expect((kit.tables("agentMission")[0]!.payload as { humanAnswers: unknown }).humanAnswers).toEqual({ "persona.x.name": "Léa" });
  });

  it("rappel une seule fois après 24 h, expiration après 7 jours, relance depuis le site", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "CONFIRM", key: "q.r", question: "Oui ?" });
    kit.advance(23 * HOUR);
    expect(await sweepHumanRequests(kit.deps)).toEqual({ sent: 0, reminded: 0, expired: 0 });
    kit.advance(2 * HOUR);
    expect(await sweepHumanRequests(kit.deps)).toEqual({ sent: 0, reminded: 1, expired: 0 });
    expect(kit.sent[1]).toMatchObject({ replyToMessageId: kit.sent[0]!.messageId });
    expect(kit.sent[1]!.html).toContain("Rappel");
    kit.advance(24 * HOUR);
    expect((await sweepHumanRequests(kit.deps)).reminded).toBe(0);
    kit.advance(6 * 24 * HOUR);
    expect((await sweepHumanRequests(kit.deps)).expired).toBe(1);
    const id = kit.tables("humanRequest")[0]!.id as string;
    expect(kit.tables("humanRequest")[0]!.status).toBe("EXPIRED");
    expect(await relaunchHumanRequest(kit.deps, id, { via: "SITE" })).toMatchObject({ ok: true });
    expect(kit.tables("humanRequest")[0]!.status).toBe("PENDING");
  });

  it("depuis le site : répondre et passer", async () => {
    const kit = createTestKit();
    const a = await askHuman(kit.deps, { kind: "CONFIRM", key: "q.s1", question: "Oui ?" });
    const b = await askHuman(kit.deps, { kind: "TEXT", key: "q.s2", question: "Texte ?" });
    expect(await skipHumanRequest(kit.deps, a.requestId, { via: "SITE", userId: "u1" })).toMatchObject({ ok: true });
    expect(kit.sent).toHaveLength(2);
    expect(await answerHumanRequestFromSite(kit.deps, b.requestId, "bonjour", { via: "SITE", userId: "u1" })).toMatchObject({ ok: true });
    expect(kit.tables("humanRequest").map((x) => x.status)).toEqual(["SKIPPED", "ANSWERED"]);
  });

  it("rapport du matin : demande créée une seule fois, réponse rangée en réglage", async () => {
    const kit = createTestKit();
    await ensureDailyReportQuestion(kit.deps);
    await ensureDailyReportQuestion(kit.deps);
    expect(kit.tables("humanRequest")).toHaveLength(1);
    expect(kit.sent[0]!.html).toContain("Veux-tu recevoir chaque matin le rapport des agents ?");
    await handleAdminText(kit.deps, { text: "Oui", messageId: 7 });
    expect(kit.tables("setting").find((s) => s.key === "agents.dailyReport")?.value).toBe(true);
  });
});

describe("message de l'admin qui n'est pas une réponse", () => {
  it("question fermée en cours : « fait » ou un texte quelconque continue son chemin, sans « Réponds oui ou non »", async () => {
    const kit = createTestKit();
    await askHuman(kit.deps, { kind: "CONFIRM", key: "test.confirm", question: "On y va ?" });
    expect(await handleAdminText(kit.deps, { text: "fait", messageId: 900 })).toEqual({ handled: false });
    expect(await handleAdminText(kit.deps, { text: "voici des emojis 🎉", messageId: 901 })).toEqual({ handled: false });
    const yes = await handleAdminText(kit.deps, { text: "oui", messageId: 902 });
    expect(yes.handled).toBe(true);
  });
});

describe("bascule vers Kevin : les numéros de message de l'ancien bot ne valent plus « réponse »", () => {
  it("messages retirés (plus de correspondance), gardés à part ; la question reposée ne porte que le nouveau numéro", async () => {
    const kit = createTestKit();
    const a = await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Ta clé fal ?" });
    const oldId = kit.sent[0]!.messageId;
    // Une demande du groupe de l'équipe (autre conversation) n'est pas touchée.
    const g = await kit.prisma.humanRequest.create({ data: { key: "g", kind: "TEXT", status: "ANSWERED", question: "?", chatId: -100n, telegramMessageId: 7 } as never }) as { id: string };
    expect((await humanRequestByMessageId(kit.deps, oldId))?.id).toBe(a.requestId);
    expect(await retireAdminChatMessageIds(kit.deps)).toBe(1);
    expect(await humanRequestByMessageId(kit.deps, oldId)).toBeNull();
    const row = kit.tables("humanRequest").find((r) => r.id === a.requestId)!;
    expect(row.telegramMessageId).toBeNull();
    expect(askedMessageIdsOf(row)).toEqual([]);
    expect(retiredMessageIdsOf(row)).toEqual([oldId]);
    expect(kit.tables("humanRequest").find((r) => r.id === g.id)!.telegramMessageId).toBe(7);
    // Kevin repose la question : seul son numéro vaut réponse.
    await kit.prisma.humanRequest.update({ where: { id: a.requestId }, data: withAskedMessageId(row, 5) });
    const after = kit.tables("humanRequest").find((r) => r.id === a.requestId)!;
    expect(askedMessageIdsOf(after)).toEqual([5]);
    expect(retiredMessageIdsOf(after)).toEqual([oldId]);
    expect((await humanRequestByMessageId(kit.deps, 5))?.id).toBe(a.requestId);
  });
});
