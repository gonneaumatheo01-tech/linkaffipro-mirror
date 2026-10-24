import { describe, expect, it } from "vitest";
import { smallTalkReply } from "./fast";

describe("politesse (premier échange réel du client : « ca va » puis « ça va » ont reçu deux réponses différentes)", () => {
  it("salutations, « ça va », remerciements : réponse fixe", () => {
    for (const t of ["salut", "Bonjour Kevin", "coucou !", "hello 👋", "ca va", "ça va ?", "Ça va", "salut ça va ?", "Kevin, ça va ?", "comment ça va", "tu vas bien ?"])
      expect(smallTalkReply(t), t).toBeTruthy();
    expect(smallTalkReply("ca va")).toBe(smallTalkReply("ça va ?"));
    expect(smallTalkReply("merci")).toBe("Avec plaisir 👍");
    expect(smallTalkReply("salut")).toContain("commencer");
  });

  it("une vraie demande n'est jamais prise pour de la politesse", () => {
    for (const t of ["salut, combien j'ai dépensé ?", "ça va le casino ?", "mets le casino en pause", "bonjour, passe le dating en vrai", "agents", "merci de mettre en pause"])
      expect(smallTalkReply(t), t).toBeNull();
  });
});
