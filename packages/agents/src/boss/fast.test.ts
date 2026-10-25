import { afterEach, describe, expect, it, vi } from "vitest";
import { createBossKit, type BossKit } from "./testing";
import { bossFastPath, looksLikeOrderOrQuestion } from "./fast";
import { bossAiTurn } from "./execute";
import { CONFIRM_VARIANTS, handleBossCallback, isBossCallbackData, rememberBossPendingMessage } from "./confirm";
import { askHuman } from "../human/requests";
import { setBossRegisterPort } from "./register-port";
import { journalText } from "../human/test-kit";
import type { BossFastResult } from "./contract";

vi.mock("../missions/lifecycle", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  continueMission: vi.fn(async () => undefined),
}));

afterEach(() => setBossRegisterPort(null));

const reply = (r: BossFastResult) => (r.handled ? (r.reply ?? "") : "");
const VRAI = { name: "simulation", input: { equipe: "casino", mode: "vrai" } };
const QUOTA = { name: "quota_posts", input: { cible: "Léa", posts_par_jour: 5 } };

async function askVrai(kit: BossKit) {
  const r = await bossAiTurn(kit.deps, kit.input("passe le casino en vrai"));
  expect(r.pendingId).toBeTruthy();
  return r;
}

describe("secrets : jamais envoyés à l'IA", () => {
  it("5 secrets (clé, bookmaker, clé collée pendant une demande, filet « voici la clé », jeton du Boss)", async () => {
    const kit = await createBossKit();
    setBossRegisterPort(async () => ({ username: "kevin_boss_bot" }));
    const texts = [
      "clé fal sk-abcdef1234567890xyz",
      "bookmaker sportaza jean75 MotDePasse123!",
      "voici la clé des cotes sk_live_1234567890abcdef",
      "jeton boss 123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-ra",
    ];
    for (const t of texts) {
      const r = await bossFastPath(kit.deps, kit.input(t));
      expect(r.handled, t).toBe(true);
      expect((r as { deleteMessage?: boolean }).deleteMessage, t).toBe(true);
      const ai = await bossAiTurn(kit.deps, kit.input(t));
      expect(ai.deleteMessage, t).toBe(true);
    }
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.odds.apiKey", question: "Envoie la clé des cotes" });
    const pasted = await bossFastPath(kit.deps, kit.input("a1b2c3d4e5f6g7h8i9j0k1l2"));
    expect(pasted).toMatchObject({ handled: true, deleteMessage: true });
    expect(reply(pasted)).toContain("enregistrée");
    expect(kit.llm.calls.interpret).toHaveLength(0);
    const memory = JSON.stringify(kit.tables("bossTurn"));
    for (const secret of ["sk-abcdef1234567890xyz", "MotDePasse123", "sk_live_1234567890abcdef", "AAEhBOweik6ad9r", "a1b2c3d4e5f6g7h8i9j0k1l2"]) {
      expect(memory).not.toContain(secret);
      expect(journalText(kit)).not.toContain(secret);
    }
    expect(memory).toContain("[secret]");
  });

  it("« jeton boss » : enregistré par le port, la demande SECRET « jeton boss » se ferme même sans « Répondre »", async () => {
    const kit = await createBossKit();
    const port = vi.fn(async () => ({ username: "kevin_boss_bot" }));
    setBossRegisterPort(port);
    await askHuman(kit.deps, { kind: "SECRET", key: "boss.token", question: "Crée un bot dans @BotFather et envoie-moi son jeton" });
    const r = await bossFastPath(kit.deps, kit.input("123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-ra"));
    expect(reply(r)).toContain("@kevin_boss_bot");
    expect(port).toHaveBeenCalledWith("123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-ra");
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "ANSWERED" });
  });
});

describe("le message suivant répond à la question ouverte (sans « Répondre »)", () => {
  it("TEXT : la réponse est prise ; un ordre ou une question part à l'interprète", async () => {
    const kit = await createBossKit();
    await askHuman(kit.deps, { kind: "TEXT", key: "persona.x.mediaNotes", question: "Quelle tenue pour Léa ?" });
    expect((await bossFastPath(kit.deps, kit.input("mets le casino en pause stp"))).handled).toBe(false);
    expect((await bossFastPath(kit.deps, kit.input("c'est pour quel canal ?"))).handled).toBe(false);
    const r = await bossFastPath(kit.deps, kit.input("robe rouge, plage au coucher du soleil"));
    expect(r.handled).toBe(true);
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "ANSWERED", answerSummary: "robe rouge, plage au coucher du soleil" });
  });

  it("CHOICE par numéro, CONFIRM par oui, SECRET par une clé collée", async () => {
    const kit = await createBossKit();
    await askHuman(kit.deps, { kind: "CHOICE", key: "k.choice", question: "Quel fournisseur ?", options: ["fal.ai", "Magic Hour"] });
    await bossFastPath(kit.deps, kit.input("2"));
    expect(kit.tables("humanRequest")[0]).toMatchObject({ status: "ANSWERED", answerSummary: "2. Magic Hour" });
    await askHuman(kit.deps, { kind: "CONFIRM", key: "k.confirm", question: "On y va ?" });
    await bossFastPath(kit.deps, kit.input("oui"));
    expect(kit.tables("humanRequest")[1]).toMatchObject({ status: "ANSWERED", answerSummary: "oui" });
    await askHuman(kit.deps, { kind: "SECRET", key: "providers.fal.apiKey", question: "Clé fal ?" });
    const r = await bossFastPath(kit.deps, kit.input("fal-0123456789abcdefXYZ"));
    expect(r).toMatchObject({ handled: true, deleteMessage: true });
    expect(kit.tables("humanRequest")[2]).toMatchObject({ status: "ANSWERED" });
  });

  it("règle des ordres et questions (pure)", () => {
    expect(looksLikeOrderOrQuestion("mets le casino en pause")).toBe(true);
    expect(looksLikeOrderOrQuestion("c'est quand ?")).toBe(true);
    expect(looksLikeOrderOrQuestion("Combien j'ai dépensé")).toBe(true);
    expect(looksLikeOrderOrQuestion("robe rouge")).toBe(false);
    expect(looksLikeOrderOrQuestion("Léa, 24 ans, étudiante")).toBe(false);
  });
});

describe("commandes exactes inchangées, gratuites et instantanées", () => {
  it("agents, pause casino, demandes, rapport, plus tard, aide : sans IA", async () => {
    const kit = await createBossKit();
    for (const t of ["agents", "pause casino", "reprends casino", "demandes", "rapport", "plus tard", "aide", "commencer", "ok 12", "niveau casino 1"]) {
      const r = await bossFastPath(kit.deps, kit.input(t));
      expect(r.handled, t).toBe(true);
      expect(reply(r).length, t).toBeGreaterThan(0);
    }
    expect(kit.llm.calls.interpret).toHaveLength(0);
    expect(kit.tables("auditLog").map((a) => a.action)).toEqual(expect.arrayContaining(["agents.team.paused", "agents.team.resumed"]));
  });

  it("phrase libre → interprète", async () => {
    const kit = await createBossKit();
    expect(await bossFastPath(kit.deps, kit.input("mets le dating en pause"))).toEqual({ handled: false, needsAi: true });
  });
});

describe("cycle d'une confirmation", () => {
  it("OUI en texte : exécuté une seule fois, journalisé", async () => {
    const kit = await createBossKit([["passe le casino en vrai", VRAI]]);
    const r = await askVrai(kit);
    await rememberBossPendingMessage(kit.deps, r.pendingId!, 555);
    expect(r.reply).toMatch(/Casino en vrai/);
    const yes = await bossFastPath(kit.deps, kit.input("OUI"));
    expect(reply(yes)).toContain("en vrai ✅");
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")).toMatchObject({ simulation: false });
    expect(CONFIRM_VARIANTS.nothingToConfirm).toContain(reply(await bossFastPath(kit.deps, kit.input("oui"))));
    // Retour en simulation : immédiat.
    const back = await bossAiTurn({ ...kit.deps, llm: (await createBossKit([["remets en simulation", { name: "simulation", input: { equipe: "casino", mode: "simulation" } }]])).llm }, kit.input("remets en simulation"));
    expect(back.reply).toContain("en simulation");
  });

  it("NON et « annule » : rien ne change", async () => {
    const kit = await createBossKit([["passe le casino en vrai", VRAI]]);
    await askVrai(kit);
    expect(reply(await bossFastPath(kit.deps, kit.input("non")))).toMatch(/rien n'a changé|rien n'a bougé|rien touché/i);
    await askVrai(kit);
    expect(reply(await bossFastPath(kit.deps, kit.input("annule")))).toMatch(/rien n'a changé|rien n'a bougé|rien touché/i);
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")?.simulation ?? true).toBe(true);
    expect(CONFIRM_VARIANTS.nothingToCancel).toContain(reply(await bossFastPath(kit.deps, kit.input("annule"))));
  });

  it("expiration après 10 minutes", async () => {
    const kit = await createBossKit([["passe le casino en vrai", VRAI]]);
    await askVrai(kit);
    kit.advance(10 * 60_000 + 1);
    expect(reply(await bossFastPath(kit.deps, kit.input("ouais")))).toContain("expiré");
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")?.simulation ?? true).toBe(true);
  });

  it("une seule à la fois : la nouvelle remplace la précédente (et le dit)", async () => {
    const kit = await createBossKit([
      ["passe le casino en vrai", VRAI],
      ["passe à cinq posts par jour sur Léa", QUOTA],
    ]);
    await askVrai(kit);
    const second = await bossAiTurn(kit.deps, kit.input("passe à cinq posts par jour sur Léa"));
    expect(second.reply).toMatch(/remplace ta demande d'avant|J'oublie la demande d'avant/);
    await bossFastPath(kit.deps, kit.input("oui"));
    expect(kit.tables("channelAgentPlan").find((p) => p.channelId === kit.ids.chLea)).toMatchObject({ postsPerDay: 5 });
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")?.simulation ?? true).toBe(true);
  });

  it("boutons OUI / NON : seul l'admin est écouté", async () => {
    const kit = await createBossKit([["passe le casino en vrai", VRAI]]);
    const r = await askVrai(kit);
    const yes = r.buttons![0]![0]!.callbackData;
    expect(isBossCallbackData(yes)).toBe(true);
    expect(await handleBossCallback(kit.deps, { data: yes, fromTelegramId: 999n })).toEqual({ handled: true });
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")?.simulation ?? true).toBe(true);
    const ok = await handleBossCallback(kit.deps, { data: yes, fromTelegramId: 4242n });
    expect(ok.reply).toContain("en vrai");
    expect(CONFIRM_VARIANTS.noLongerExists).toContain((await handleBossCallback(kit.deps, { data: yes, fromTelegramId: 4242n })).reply);
  });

  it("un membre (mode groupe) ne peut pas confirmer", async () => {
    const kit = await createBossKit([["passe le casino en vrai", VRAI]]);
    await askVrai(kit);
    const r = await bossFastPath(kit.deps, kit.input("oui", { speaker: { kind: "member", telegramUserId: 77n, memberId: "m1", role: "MEMBER", firstName: "Léa" } }));
    expect(reply(r)).toContain("l'admin qui décide");
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")?.simulation ?? true).toBe(true);
  });
});

describe("tour avec l'IA", () => {
  it("sans IA : le Boss le dit ; pas de double exécution pour un même message", async () => {
    const kit = await createBossKit([["mets le dating en pause", { name: "pause", input: { equipe: "dating" } }]]);
    const none = await bossAiTurn({ ...kit.deps, llm: null }, kit.input("mets le dating en pause"));
    expect(none.reply).toContain("commandes simples");
    const input = kit.input("mets le dating en pause");
    await bossAiTurn(kit.deps, input);
    const again = await bossAiTurn(kit.deps, input);
    expect(again).toEqual({});
    expect(kit.tables("auditLog").filter((a) => a.action === "agents.team.paused")).toHaveLength(1);
  });

  it("non couvert : « Je ne sais pas encore faire ça » + actions proches + besoin noté", async () => {
    const kit = await createBossKit([["commande une pizza", { name: "pas_prevu", input: {} }]]);
    const r = await bossAiTurn(kit.deps, kit.input("commande une pizza"));
    // Voix de Kevin : ce qui bloque en une phrase, puis une proposition (plus de liste de puces).
    expect(r.reply).toMatch(/ne sais pas encore/i);
    expect(r.reply).toMatch(/\?/);
    expect(kit.tables("bossUnmet")).toHaveLength(1);
  });

  it("une erreur ne lève jamais : « Oups… »", async () => {
    const kit = await createBossKit();
    const llm = { interpret: vi.fn(async () => { throw new Error("boom"); }), write: vi.fn() };
    const r = await bossAiTurn({ ...kit.deps, llm: llm as never }, kit.input("bonjour"));
    expect(r.reply).toMatch(/^Oups/);
  });
});
