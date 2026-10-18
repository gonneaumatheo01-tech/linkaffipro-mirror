import { describe, expect, it } from "vitest";
import { assistantModeRefusal, botModeConfirmMessage } from "./bot-mode-logic";

describe("mode d'un bot : un bot qui gère des canaux ne devient jamais l'assistante", () => {
  it("bot normal qui administre des canaux : refus clair, avec le nombre de canaux et la marche à suivre", () => {
    expect(assistantModeRefusal("STANDARD", 3)).toBe(
      "Ce bot gère 3 canaux : il ne peut pas devenir l'assistante. Créez un bot dédié dans @BotFather (voir le guide) et ajoutez-le ici.",
    );
    expect(assistantModeRefusal("STANDARD", 1)).toMatch(/^Ce bot gère 1 canal : /);
    expect(assistantModeRefusal("STANDARD", 1234)).toContain("1 234 canaux");
  });

  it("aucun refus : bot sans canal, nombre inconnu, ou déjà assistant (sa persona reste modifiable)", () => {
    expect(assistantModeRefusal("STANDARD", 0)).toBeNull();
    expect(assistantModeRefusal("STANDARD")).toBeNull();
    expect(assistantModeRefusal("STANDARD", null)).toBeNull();
    expect(assistantModeRefusal("ASSISTANT", 2)).toBeNull();
  });
});

describe("mode d'un bot : confirmation avant de passer en assistant", () => {
  it("bot normal sans canal : la confirmation reste (il ne s'occupera d'aucun canal)", () => {
    const m = botModeConfirmMessage("STANDARD", "ASSISTANT", 0);
    expect(m).toContain("Ce bot deviendra l'assistante");
    expect(m).toContain("ne s'occupera d'aucun canal");
    expect(m).toMatch(/Continuer \?$/);
  });

  it("nombre de canaux inconnu : la question est posée et conseille un nouveau bot", () => {
    const m = botModeConfirmMessage("STANDARD", "ASSISTANT");
    expect(m).toContain("ne s'occupera plus d'aucun canal");
    expect(m).toContain("nouveau bot");
  });

  it("aucune question : bot qui gère des canaux (refusé, pas confirmé), déjà assistant, ou retour en bot normal", () => {
    expect(botModeConfirmMessage("STANDARD", "ASSISTANT", 3)).toBeNull();
    expect(botModeConfirmMessage("ASSISTANT", "ASSISTANT", 4)).toBeNull();
    expect(botModeConfirmMessage("ASSISTANT", "STANDARD", 4)).toBeNull();
    expect(botModeConfirmMessage("STANDARD", "STANDARD", 4)).toBeNull();
  });
});
