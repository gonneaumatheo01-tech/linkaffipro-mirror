import { describe, expect, it } from "vitest";
import { anonymizeText, containsPersonalData } from "./anonymize";
import { buildSample, isExcludedFromSample, type SampleSourceConversation } from "./sample";

describe("anonymisation", () => {
  it("prénoms de la personne, de la persona et prénoms courants", () => {
    expect(anonymizeText("salut Kévinou, moi c'est Léa", { names: ["Kévinou"] })).toBe("salut [prénom], moi c'est [prénom]");
    expect(anonymizeText("Je m'appelle zorglub et toi ?")).toBe("Je m'appelle [prénom] et toi ?");
    expect(anonymizeText("ma pote Julie arrive", {})).toBe("ma pote [prénom] arrive");
    expect(anonymizeText("Bonjour Celine", { names: ["Céline"] })).toBe("Bonjour [prénom]");
    // Un mot qui contient un prénom n'est pas touché.
    expect(anonymizeText("emmanuelle? non, j'adore les emmanchements")).not.toContain("[prénom]manchements");
  });

  it("numéros, adresses mail, liens, @pseudos, adresses", () => {
    expect(anonymizeText("appelle moi au 06 12 34 56 78")).toBe("appelle moi au [numéro]");
    expect(anonymizeText("+33612345678 ou mon code 123456")).toBe("[numéro] ou mon code [numéro]");
    expect(anonymizeText("j'ai 25 ans")).toBe("j'ai 25 ans");
    expect(anonymizeText("écris à toto.x@gmail.com")).toBe("écris à [mail]");
    expect(anonymizeText("va sur https://site.com/x?y=1 ou www.truc.fr ou t.me/canal ou insta.com")).toBe(
      "va sur [lien] ou [lien] ou [lien] ou [lien]",
    );
    expect(anonymizeText("ajoute @mon_snap stp")).toBe("ajoute [pseudo] stp");
    expect(anonymizeText("j'habite 12 rue des Lilas")).toBe("j'habite [adresse]");
    expect(containsPersonalData("Tu fais quoi ce soir ?")).toBe(false);
    expect(containsPersonalData("passe sur t.me/x")).toBe(true);
  });
});

const base = (over: Partial<SampleSourceConversation> = {}): SampleSourceConversation => ({
  createdAt: new Date("2026-10-20T10:00:00Z"),
  isMinor: false,
  stoppedAt: null,
  closedReason: null,
  eventTypes: [],
  stage: "CHAT",
  offerSends: 0,
  converted: false,
  replied: true,
  names: ["Marco", null, "marco_75", "Léa"],
  messages: [
    { direction: "OUT", author: "ASSISTANT", text: "Coucou, moi c'est Léa", isCommand: false, mediaKind: null, createdAt: new Date("2026-10-20T10:00:00Z") },
    { direction: "IN", author: "MEMBER", text: "salut je suis Marco, mon num 0612345678", isCommand: false, mediaKind: null, createdAt: new Date("2026-10-20T10:01:00Z") },
  ],
  ...over,
});

describe("échantillon", () => {
  it("exclut mineurs, /stop et conversations fermées pour mineur", () => {
    expect(isExcludedFromSample(base({ isMinor: true }))).toBe(true);
    expect(isExcludedFromSample(base({ stoppedAt: new Date() }))).toBe(true);
    expect(isExcludedFromSample(base({ closedReason: "MINOR" }))).toBe(true);
    expect(isExcludedFromSample(base({ eventTypes: ["minor"] }))).toBe(true);
    expect(isExcludedFromSample(base({ eventTypes: ["stopped"] }))).toBe(true);
    expect(isExcludedFromSample(base({ closedReason: "TEAM" }))).toBe(false);
    expect(buildSample([base({ isMinor: true }), base({ stoppedAt: new Date() }), base()])).toHaveLength(1);
  });

  it("anonymise, retire commandes et textes système, plafonne à 40 × 12", () => {
    const [c] = buildSample([
      base({
        messages: [
          { direction: "IN", author: "MEMBER", text: "/start", isCommand: true, mediaKind: null, createdAt: new Date("2026-10-20T09:59:00Z") },
          { direction: "OUT", author: "SYSTEM", text: "texte fixe", isCommand: false, mediaKind: null, createdAt: new Date("2026-10-20T09:59:30Z") },
          ...base().messages,
          { direction: "IN", author: "MEMBER", text: "", isCommand: false, mediaKind: "photo", createdAt: new Date("2026-10-20T10:02:00Z") },
        ],
      }),
    ]);
    expect(c!.n).toBe("c1");
    expect(c!.messages).toEqual([
      { who: "profil", text: "Coucou, moi c'est [prénom]" },
      { who: "personne", text: "salut je suis [prénom], mon num [numéro]" },
      { who: "personne", text: "[photo]" },
    ]);
    const many = Array.from({ length: 60 }, (_, i) =>
      base({
        createdAt: new Date(Date.UTC(2026, 9, 1, i)),
        messages: Array.from({ length: 20 }, (_, k) => ({
          direction: k % 2 ? ("IN" as const) : ("OUT" as const),
          author: k % 2 ? "MEMBER" : "ASSISTANT",
          text: `message ${k}`,
          isCommand: false,
          mediaKind: null,
          createdAt: new Date(Date.UTC(2026, 9, 1, i, k)),
        })),
      }),
    );
    const sample = buildSample(many, { conversations: 500, messages: 500 });
    expect(sample).toHaveLength(40);
    expect(sample.every((s) => s.messages.length === 12)).toBe(true);
  });
});
