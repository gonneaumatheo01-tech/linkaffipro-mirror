import { describe, expect, it } from "vitest";
import { mentionsRequiredStep as fromCore } from "@linkaffipro/core";
import { LANGS, MESSAGES } from "../i18n";
import { mentionsRequiredStep } from "./texts";

/**
 * Message d'accueil qui annonce une étape obligatoire (phase 14, décision E5) : une seule règle, dans le paquet core,
 * pour le site et le bot. Ce test garde la règle alignée sur les libellés du bouton « ✅ J'ai rejoint » du bot.
 */
describe("étape obligatoire : une seule règle pour le site et le bot", () => {
  it("le bouton « ✅ J'ai rejoint » est reconnu dans chacune des langues du bot", () => {
    for (const lang of LANGS)
      expect(
        fromCore(`Rejoins nos canaux puis appuie sur ${MESSAGES[lang].joinedLabel}`),
        lang,
      ).toBe(true);
  });

  it("le paquet telegram réutilise la règle du paquet core (aucune deuxième liste)", () => {
    expect(mentionsRequiredStep).toBe(fromCore);
  });
});
