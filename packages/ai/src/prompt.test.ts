import { describe, expect, it } from "vitest";
import { buildRulesBlock, buildUserMessage, resolveRiskNotice } from "./prompt";
import { DEFAULT_MODEL } from "./models";
import type { AiRequest, AiSurface } from "./types";

const rules = buildRulesBlock(resolveRiskNotice(null));

function request(surface: AiSurface | null, text = "Nouveau bonus ce soir"): AiRequest {
  return {
    kind: "improve",
    text,
    context: { vertical: "CASINO", language: "fr", surface, hasMedia: false },
    model: DEFAULT_MODEL,
  };
}

describe("consigne sur les repères {prenom}… (remplacés seulement dans les messages privés)", () => {
  it("les règles disent que les repères ne sont remplacés QUE dans les messages privés, jamais dans un canal", () => {
    expect(rules).toMatch(/uniquement dans les messages privés/i);
    expect(rules).toMatch(/jamais dans un message de canal/i);
    // Plus d'affirmation générale « remplacés automatiquement à l'envoi » valable partout.
    expect(rules).not.toMatch(/sont remplacés automatiquement à l'envoi :/);
    // {offre} n'est remplacé nulle part : l'assistant ne doit pas le proposer.
    expect(rules).toMatch(/\{offre\}[^\n]*n'est remplacé nulle part/);
    // Les repères du brouillon restent recopiés à l'identique (aucune perte).
    expect(rules).toMatch(/recopie[^\n]*exactement/);
  });

  it("message de canal et modèle : la demande interdit d'ajouter un repère", () => {
    for (const s of ["post", "template"] as const) {
      const msg = buildUserMessage(request(s));
      expect(msg).toContain("Repères : aucun");
      expect(msg).toMatch(/n'ajoute aucun repère/);
      expect(msg).toContain("{prenom}");
    }
  });

  it("messages privés : la demande liste les repères remplacés à l'envoi pour cet écran", () => {
    expect(buildUserMessage(request("bot_text"))).toMatch(
      /Repères remplacés à l'envoi ici : \{prenom\}, \{canal\}, \{liste_canaux\}, \{delai\}, \{bot\}/,
    );
    expect(buildUserMessage(request("automation"))).toMatch(
      /Repères remplacés à l'envoi ici : \{prenom\}, \{canal\}, \{bot\}\./,
    );
    expect(buildUserMessage(request("broadcast"))).toMatch(
      /Repères remplacés à l'envoi ici : \{prenom\}, \{bot\}\./,
    );
    for (const s of ["bot_text", "automation", "broadcast"] as const)
      expect(buildUserMessage(request(s))).not.toContain("Repères : aucun");
  });

  it("écran inconnu : rien d'affirmé sur les repères (prudence : n'en ajoute pas)", () => {
    const msg = buildUserMessage(request(null));
    expect(msg).toMatch(/n'ajoute aucun repère/);
    expect(msg).not.toContain("Repères remplacés à l'envoi ici");
  });
});
