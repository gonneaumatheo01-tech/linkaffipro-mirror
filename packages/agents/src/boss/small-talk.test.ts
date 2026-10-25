import { beforeEach, describe, expect, it } from "vitest";
import { FAST_VARIANTS, isAreYouABotQuestion, smallTalkReply } from "./fast";
import { resetVoiceRotation, voiceCheck } from "./voice";

describe("politesse (premier échange réel du client : « ca va » puis « ça va » ont reçu deux réponses différentes)", () => {
  beforeEach(() => resetVoiceRotation());

  it("salutations, « ça va », remerciements : une réponse de la bonne famille, toujours conforme", () => {
    for (const t of ["salut", "Bonjour Kevin", "coucou !", "hello 👋", "ca va", "ça va ?", "Ça va", "salut ça va ?", "Kevin, ça va ?", "comment ça va", "tu vas bien ?"]) {
      const r = smallTalkReply(t, 1n);
      expect(r, t).toBeTruthy();
      expect(voiceCheck(r!).ok, t).toBe(true);
    }
    expect(FAST_VARIANTS.howAreYou).toContain(smallTalkReply("ca va", 2n));
    expect(FAST_VARIANTS.howAreYou).toContain(smallTalkReply("ça va ?", 2n));
    expect(FAST_VARIANTS.thanks).toContain(smallTalkReply("merci", 2n));
    expect(FAST_VARIANTS.hello).toContain(smallTalkReply("salut", 2n));
    expect(FAST_VARIANTS.hello.some((h) => h.includes("commencer"))).toBe(true);
  });

  it("dans une même conversation, jamais deux fois de suite la même phrase", () => {
    const a = smallTalkReply("ça va ?", 9n);
    const b = smallTalkReply("ca va", 9n);
    expect(a).not.toBe(b);
  });

  it("« t'es un bot ? » posé sincèrement : réponse franche en une phrase", () => {
    for (const t of ["t'es un bot ?", "Tu es un robot ?", "Kevin, t'es une IA ?", "es-tu humain ?", "t'es un bot ou quoi ?", "sérieux t'es un bot ?"]) {
      expect(isAreYouABotQuestion(t), t).toBe(true);
      const r = smallTalkReply(t, 3n)!;
      expect(FAST_VARIANTS.areYouABot).toContain(r);
      expect(r).toMatch(/bot de l'équipe|un bot/);
    }
    expect(isAreYouABotQuestion("t'es un bot, mets le casino en pause")).toBe(false);
  });

  it("une vraie demande n'est jamais prise pour de la politesse", () => {
    for (const t of ["salut, combien j'ai dépensé ?", "ça va le casino ?", "mets le casino en pause", "bonjour, passe le dating en vrai", "agents", "merci de mettre en pause"])
      expect(smallTalkReply(t), t).toBeNull();
  });
});
