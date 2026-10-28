/**
 * Kevin parle comme un collègue (28 octobre 2026) : discussion libre, mémoire de la conversation, texte du code redit
 * naturellement ; et les garde-fous du code : chiffre absent des données, « c'est fait » sans action, panne de l'IA,
 * QA refusé → le texte d'avant part tel quel.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createBossKit } from "./testing";
import { bossAiTurn, UNMET_HEADS } from "./execute";
import { writeBossTurn } from "./memory";
import { claimsDone, rewritableResult } from "./converse";
import { FAST_VARIANTS } from "./fast";
import { resetVoiceRotation, voiceCheck } from "./voice";
import { createFakeQaLlm, type FakeQaStep } from "../qa/testing";
import { BOSS_CONVERSE_MODEL, bossLlmFromClient, type FakeBossTable } from "./llm";
import type { AiClient } from "@linkaffipro/ai";

const APPROVE: FakeQaStep = { verdict: "APPROVED", reasons: [], corrections: [] };
const REJECT: FakeQaStep = {
  verdict: "REJECTED",
  reasons: [{ code: "HALLUCINATION", message: "Pas dans les données.", severity: "critical" }],
  corrections: [{ field: "response", expected: "rien", got: "quelque chose", suggestion: "retire-le" }],
};

const TABLE: FakeBossTable = [
  ["tu penses quoi de la journée", { name: "discuter", input: { sujet: "la journée" } }],
  ["et tu crois qu'elle va marcher", { name: "discuter", input: {} }],
  ["merci pour hier", { name: "discuter", input: {} }],
  ["merci", { name: "discuter", input: {} }],
  ["fais-moi un café", { name: "pas_prevu", input: { besoin: "un café" } }],
  ["mets le casino en pause", { name: "pause", input: { equipe: "casino" } }],
];

async function kitWith(converser: (user: string) => string, qa: (i: number) => FakeQaStep = () => APPROVE) {
  const kit = await createBossKit(TABLE, { converser });
  const qaLlm = createFakeQaLlm({ respond: (_req, i) => qa(i) });
  (kit.deps as { qaLlm?: unknown }).qaLlm = qaLlm;
  return { kit, qaLlm };
}

beforeEach(() => resetVoiceRotation());

describe("Kevin répond comme un collègue", () => {
  it("discussion libre : la réponse du rédacteur part, contrôlée par le QA, sans rien noter ni proposer", async () => {
    const said = "Plutôt bien, les équipes ont tourné sans accroc ce matin. Tu veux que je regarde un canal en particulier ?";
    const { kit, qaLlm } = await kitWith(() => said);
    const r = await bossAiTurn(kit.deps, kit.input("tu penses quoi de la journée ?"));
    expect(r.reply).toBe(said);
    expect(r.buttons).toBeUndefined();
    expect(kit.llm.calls.converse).toHaveLength(1);
    expect(kit.llm.calls.converse[0]!.user).toContain("tu penses quoi de la journée ?");
    expect(qaLlm.calls).toHaveLength(1);
    const turn = kit.tables("bossTurn").find((t) => t.role === "BOSS");
    expect(turn).toMatchObject({ status: "answered", actionKey: "discuter", text: said });
    // Une discussion n'est pas un besoin non couvert.
    expect(kit.tables("bossUnmet")).toHaveLength(0);
    expect(voiceCheck(r.reply!).ok).toBe(true);
  });

  it("la mémoire de la conversation part au rédacteur (sans le tour en cours)", async () => {
    const { kit } = await kitWith(() => "Difficile à dire si tôt. On regarde les premiers clics demain matin, ça te va ?");
    await writeBossTurn(kit.deps, { role: "ADMIN", text: "j'ai lancé une pub TikTok hier sur le dating", telegramMessageId: 1 });
    await writeBossTurn(kit.deps, { role: "BOSS", text: "Bien noté pour la pub TikTok.", telegramMessageId: 1, status: "answered" });
    const r = await bossAiTurn(kit.deps, kit.input("et tu crois qu'elle va marcher ?"));
    expect(r.reply).toContain("premiers clics");
    const user = kit.llm.calls.converse[0]!.user;
    expect(user).toContain("Admin : j'ai lancé une pub TikTok hier sur le dating");
    expect(user).toContain("Kevin : Bien noté pour la pub TikTok.");
    expect(user).not.toContain("Kevin : …");
    // Le message en cours n'est donné qu'une fois, à part.
    expect(user.split("et tu crois qu'elle va marcher ?").length - 1).toBe(1);
  });

  it("chiffre absent des données → jamais envoyé : la réponse d'avant part", async () => {
    const { kit, qaLlm } = await kitWith(() => "Grosse journée : 42 inscriptions et un bon rythme sur le dating.");
    const r = await bossAiTurn(kit.deps, kit.input("tu penses quoi de la journée ?"));
    expect(r.reply).not.toContain("42");
    expect(UNMET_HEADS.some((h) => r.reply!.startsWith(h))).toBe(true);
    expect(qaLlm.calls).toHaveLength(0);
  });

  it("« c'est fait » alors que rien n'a été fait → refusé", async () => {
    expect(claimsDone("C'est fait, j'ai mis le casino en pause.")).toBe(true);
    expect(claimsDone("✅ Lancé.")).toBe(true);
    expect(claimsDone("Je peux le mettre en pause si tu veux.")).toBe(false);
    const { kit } = await kitWith(() => "C'est fait, j'ai mis le casino en pause pour toi.");
    const r = await bossAiTurn(kit.deps, kit.input("merci pour hier"));
    expect(r.reply).not.toContain("casino en pause");
    expect(UNMET_HEADS.some((h) => r.reply!.startsWith(h))).toBe(true);
    // Une politesse connue retombe sur la phrase fixe.
    const k2 = await kitWith(() => "C'est fait, j'ai mis le casino en pause pour toi.");
    const thanks = await bossAiTurn(k2.kit.deps, k2.kit.input("merci"));
    expect(FAST_VARIANTS.thanks).toContain(thanks.reply);
  });

  it("IA du rédacteur en panne → texte d'avant (« pas encore possible » + proposition)", async () => {
    const { kit } = await kitWith(() => {
      throw new Error("ECONNRESET");
    });
    const r = await bossAiTurn(kit.deps, kit.input("fais-moi un café"));
    expect(r.reply).not.toMatch(/ECONNRESET/);
    expect(UNMET_HEADS.some((h) => r.reply!.startsWith(h))).toBe(true);
    expect(kit.tables("bossUnmet").length).toBeGreaterThan(0);
  });

  it("demande impossible : début écrit par le rédacteur, la proposition (boutons) reste au code", async () => {
    const head = "Un café, j'aimerais bien, mais je ne sais pas encore faire ça d'ici.";
    const { kit } = await kitWith(() => head);
    const r = await bossAiTurn(kit.deps, kit.input("fais-moi un café"));
    expect(r.reply!.startsWith(head)).toBe(true);
    expect(r.reply).toMatch(/noté/);
    expect(r.buttons?.length).toBeGreaterThan(0);
  });

  it("QA refusé 3 fois → le texte du code, jamais la version non vérifiée", async () => {
    const { kit, qaLlm } = await kitWith(
      () => "Plutôt calme de mon côté ce matin, les équipes avancent tranquillement sur leurs canaux.",
      () => REJECT,
    );
    const r = await bossAiTurn(kit.deps, kit.input("tu penses quoi de la journée ?"));
    expect(r.reply).not.toContain("Plutôt calme");
    expect(qaLlm.calls).toHaveLength(3);
    expect(UNMET_HEADS.some((h) => r.reply!.startsWith(h))).toBe(true);
  });

  it("action faite : le texte du code est redit naturellement si chiffres, noms et sens sont gardés ; sinon tel quel", async () => {
    // Texte du code d'abord (sans rédacteur).
    const plain = await createBossKit(TABLE);
    const code = (await bossAiTurn(plain.deps, plain.input("mets le casino en pause"))).reply!;
    expect(code).toBeTruthy();
    expect(rewritableResult({ reply: code })).toBe(true);

    const faithful = `Ça marche. ${code.replace(/<[^>]+>/g, "")} Plus rien ne part de leur côté tant que tu ne relances pas.`;
    const ok = await kitWith(() => faithful);
    const r1 = await bossAiTurn(ok.kit.deps, ok.kit.input("mets le casino en pause"));
    expect(ok.kit.tables("auditLog").some((a) => a.action === "boss.pause")).toBe(true);

    const invented = await kitWith(() => "Le casino est en pause, et j'ai coupé 3 posts prévus ce soir.");
    const r2 = await bossAiTurn(invented.kit.deps, invented.kit.input("mets le casino en pause"));
    expect(r2.reply).toBe(code);
    // La version fidèle remplace le texte du code ; le rédacteur a reçu le texte du code et le message.
    expect(r1.reply).toBe(faithful);
    expect(ok.kit.llm.calls.converse).toHaveLength(1);
    expect(ok.kit.llm.calls.converse[0]!.user).toContain("RÉSULTAT DU CODE");
    expect(ok.kit.llm.calls.converse[0]!.user).toContain(code.replace(/<[^>]+>/g, ""));
  });

  it("jamais redit : confirmation, boutons, liste numérotée, mot exact attendu, lien", () => {
    expect(rewritableResult({ reply: "Je passe le casino en vrai ?", buttons: [[]] })).toBe(false);
    expect(rewritableResult({ reply: "Lequel ?\n1. Casino VIP\n2. Casino Bonus" })).toBe(false);
    expect(rewritableResult({ reply: "Réponds OUI pour confirmer." })).toBe(false);
    expect(rewritableResult({ reply: "Ouvre https://app.linkaffipro.com/agents pour voir." })).toBe(false);
    expect(rewritableResult({ reply: "Casino en pause." })).toBe(true);
  });

  it("IA réelle : le rédacteur appelle le meilleur modèle (Opus 5.5, effort « low ») et compte la dépense du Boss", async () => {
    const kit = await createBossKit();
    const seen: { model: string; effort?: string }[] = [];
    const client = {
      async createMessage(req: { model: string; effort?: "low" | "medium" | "high" }) {
        seen.push({ model: req.model, effort: req.effort });
        return { text: "Salut !", usage: { inputTokens: 1000, outputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn" };
      },
    } as unknown as AiClient;
    const llm = bossLlmFromClient(kit.prisma as never, client);
    const r = await llm.converse!({ system: "s", user: "u" });
    expect(r.text).toBe("Salut !");
    expect(seen).toEqual([{ model: BOSS_CONVERSE_MODEL, effort: "low" }]);
    expect(BOSS_CONVERSE_MODEL).toBe("claude-opus-5-5");
    expect(r.costCents).toBeGreaterThan(0);
    expect(kit.tables("agentUsage")[0]).toMatchObject({ teamKey: "boss", provider: "llm", calls: 1 });
  });

  it("sans rédacteur (IA d'avant), rien ne change : aucun appel, mêmes textes", async () => {
    const kit = await createBossKit(TABLE);
    const r = await bossAiTurn(kit.deps, kit.input("fais-moi un café"));
    expect(UNMET_HEADS.some((h) => r.reply!.startsWith(h))).toBe(true);
    expect(kit.llm.calls.converse).toHaveLength(0);
  });
});
