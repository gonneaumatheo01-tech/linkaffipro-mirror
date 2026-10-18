import { describe, expect, it } from "vitest";
import { actingBotNotice } from "./acting-bot-notice";

// Fiche canal : nos bots administrateurs existent mais aucun ne peut agir ; le conseil dépend de la raison.

const bot = (username: string, isActive = true, mode = "STANDARD") => ({
  username,
  isActive,
  mode,
});

describe("alerte « aucun bot de ce canal ne peut accepter les demandes »", () => {
  it("un bot normal et actif : aucune alerte", () => {
    expect(actingBotNotice([bot("a", false), bot("b"), bot("c", true, "ASSISTANT")])).toBeNull();
  });

  it("aucun bot administrateur : pas cette alerte (une autre le dit)", () => {
    expect(actingBotNotice([])).toBeNull();
  });

  it("bots normaux désactivés seulement : il suffit d'en réactiver un dans Réglages → Bots", () => {
    const n = actingBotNotice([bot("a", false), bot("b", false)]);
    expect(n?.sentences).toEqual([
      "@a, @b sont désactivés : réactivez-en un dans Réglages → Bots.",
    ]);
    expect(n?.sentences.join(" ")).not.toMatch(/Telegram/);
  });

  it("assistants de conversation seulement : ajouter un autre de nos bots dans Telegram", () => {
    const n = actingBotNotice([bot("lea", true, "ASSISTANT")]);
    expect(n?.sentences).toEqual([
      "@lea est un assistant de conversation : il ne s'occupe que de ses conversations privées.",
      "Dans Telegram, ajoutez un autre de nos bots comme administrateur avec le droit « Ajouter des membres », puis cliquez « Re-vérifier les droits des bots ».",
    ]);
  });

  it("les deux : chaque bot avec sa raison, la réactivation suffit", () => {
    const n = actingBotNotice([bot("a", false), bot("lea", false, "ASSISTANT")]);
    expect(n?.sentences).toEqual([
      "@a est désactivé : réactivez-le dans Réglages → Bots.",
      "@lea est un assistant de conversation : il ne s'occupe que de ses conversations privées.",
    ]);
  });
});
