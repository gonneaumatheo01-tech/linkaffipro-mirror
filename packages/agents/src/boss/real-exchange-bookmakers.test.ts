/**
 * Deuxième vrai échange du client avec Kevin (journal `BossTurn` de la production, 25 octobre, 9 h 50) : « Salut boss
 * ça va », « Tu peux te connecter à sportaza ? », un mot de passe collé (retiré), « Clé », « Bookmaker », « Je peux te
 * donner les identifiants du bookmaker sportaza ». Fausse IA qui ne sait rien : tout doit passer sans elle.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBossKit, type BossKit } from "./testing";
import { bossAiTurn, EXECUTE_VARIANTS, UNMET_HEADS } from "./execute";
import { bossFastPath, credentialsOffer, smallTalkReply } from "./fast";
import { voiceCheck } from "./voice";

vi.mock("../bookmakers/credentials", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  askBookmakerCredentials: vi.fn(async () => ({ asked: true, reason: "asked" })),
}));

const ADMIN = 4242n;
const adminCtx = { speaker: { kind: "admin" as const, telegramUserId: ADMIN, firstName: "Mathéo" }, chat: { type: "private" as const, chatId: ADMIN } };
let kit: BossKit;

async function say(text: string): Promise<{ reply: string; viaAi: boolean }> {
  const input = kit.input(text, adminCtx);
  const fast = await bossFastPath(kit.deps, input);
  if (fast.handled) return { reply: fast.reply ?? "", viaAi: false };
  return { reply: (await bossAiTurn(kit.deps, input)).reply ?? "", viaAi: true };
}

beforeEach(async () => {
  kit = await createBossKit([]);
});

describe("échange réel du 25 octobre : bookmakers", () => {
  it("« Salut boss ça va » : une politesse, jamais « pas encore possible »", async () => {
    expect(smallTalkReply("Salut boss ça va")).toBeTruthy();
    const r = await say("Salut boss ça va");
    expect(r.viaAi).toBe(false);
    for (const head of UNMET_HEADS) expect(r.reply).not.toContain(head);
  });

  it.each(["Je peux te donner les identifiants du bookmaker sportaza", "Bookmaker", "identifiants", "identifiants bookmakers"])(
    "« %s » : la demande privée des identifiants part, sans IA",
    async (text) => {
      const r = await say(text);
      expect(r.viaAi).toBe(false);
      for (const head of UNMET_HEADS) expect(r.reply).not.toContain(head);
      const { askBookmakerCredentials } = await import("../bookmakers/credentials");
      expect(askBookmakerCredentials).toHaveBeenCalled();
    },
  );

  it("« nouveaux identifiants bookmakers » → redemandés ; une question sur les cotes n'est jamais prise pour une offre", () => {
    expect(credentialsOffer("nouveaux identifiants bookmakers")).toBe("change");
    expect(credentialsOffer("quels matchs sur Sportaza ce soir ?")).toBeNull();
    expect(credentialsOffer("la cote de PSG chez Celsius avec mon compte ?")).toBeNull();
    expect(credentialsOffer("Clé")).toBeNull();
  });

  it("le texte après un secret retiré n'a plus de repères entre chevrons (effacés par Telegram) et suit la voix de Kevin", () => {
    const t = EXECUTE_VARIANTS.secretRemoved[0]!;
    expect(t).not.toMatch(/<[^>]*>/);
    expect(t).toContain("identifiants bookmakers");
    expect(voiceCheck(t).ok).toBe(true);
  });
});
