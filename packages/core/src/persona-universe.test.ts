import { describe, expect, it } from "vitest";
import {
  allowedIdentities,
  effectiveIdentityKind,
  isAssistantOnlyUniverse,
  mergeNeedsHuman,
  needsHumanReasonLabel,
  needsHumanSilencesAssistant,
  offerButtonTextFor,
  parsePersonaFaq,
  parsePersonaUniverse,
  PERSONA_FAQ_MAX,
} from "./persona-universe";

describe("univers d'une persona", () => {
  it("valeur inconnue ou absente : Rencontres", () => {
    expect(parsePersonaUniverse("casino")).toBe("casino");
    expect(parsePersonaUniverse("sports")).toBe("sports");
    expect(parsePersonaUniverse("poker")).toBe("dating");
    expect(parsePersonaUniverse(null)).toBe("dating");
  });

  it("Casino et Paris : identité assistante imposée, même réglée « fille »", () => {
    expect(effectiveIdentityKind("casino", "GIRL")).toBe("ASSISTANT");
    expect(effectiveIdentityKind("sports", "GIRL")).toBe("ASSISTANT");
    expect(effectiveIdentityKind("dating", "GIRL")).toBe("GIRL");
    expect(effectiveIdentityKind(undefined, "GIRL")).toBe("GIRL");
    expect(effectiveIdentityKind("dating", "autre")).toBe("ASSISTANT");
    expect(allowedIdentities("casino")).toEqual(["ASSISTANT"]);
    expect(isAssistantOnlyUniverse("dating")).toBe(false);
  });
});

describe("fiche d'informations", () => {
  it("nettoie, écarte les entrées incomplètes et garde 40 entrées au plus", () => {
    const raw = [
      { q: "  Bonus ? ", a: " 100 % jusqu'à 200 € " },
      { q: "", a: "x" },
      { q: "y" },
      "texte",
      ...Array.from({ length: 60 }, (_, i) => ({ q: `q${i}`, a: `a${i}` })),
    ];
    const faq = parsePersonaFaq(raw);
    expect(faq[0]).toEqual({ q: "Bonus ?", a: "100 % jusqu'à 200 €" });
    expect(faq).toHaveLength(PERSONA_FAQ_MAX);
    expect(parsePersonaFaq({})).toEqual([]);
  });
});

describe("bouton du lien", () => {
  it("texte par univers quand il est vide ou resté à celui de Rencontres", () => {
    expect(offerButtonTextFor("casino", "Découvrir l'app")).toBe("🎁 Accès VIP et bonus");
    expect(offerButtonTextFor("sports", "")).toBe("🏆 Groupe VIP pronostics");
    expect(offerButtonTextFor("dating", "Découvrir l'app")).toBe("Découvrir l'app");
    expect(offerButtonTextFor("casino", "Mon bonus")).toBe("Mon bonus");
  });
});

describe("passage à un humain", () => {
  it("garde l'heure du premier passage et le motif le plus grave", () => {
    const t1 = new Date("2026-10-24T10:00:00Z");
    const t2 = new Date("2026-10-24T10:05:00Z");
    expect(mergeNeedsHuman({ at: null, reason: null }, "off_faq", t1)).toEqual({ at: t1, reason: "off_faq" });
    expect(mergeNeedsHuman({ at: t1, reason: "off_faq" }, "money", t2)).toEqual({ at: t1, reason: "money" });
    expect(mergeNeedsHuman({ at: t1, reason: "minor" }, "insult", t2)).toEqual({ at: t1, reason: "minor" });
  });

  it("libellés et silence de l'assistante", () => {
    expect(needsHumanReasonLabel("money")).toBe("Demande d'argent");
    expect(needsHumanReasonLabel("x")).toBe("À traiter");
    expect(needsHumanSilencesAssistant("off_faq")).toBe(false);
    expect(needsHumanSilencesAssistant("insult")).toBe(true);
  });
});
