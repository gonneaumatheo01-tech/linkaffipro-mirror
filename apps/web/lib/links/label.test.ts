import { describe, expect, it } from "vitest";
import { GROUP_MESSAGE_LINK_SUFFIX, linkLabel, withoutGroupMessageSuffix } from "./label";

describe("nom affiché des liens d'un message à un groupe", () => {
  it("le repère des nouveaux liens est dans les mots du client", () => {
    expect(GROUP_MESSAGE_LINK_SUFFIX).toBe(" (message à un groupe)");
    expect(`Jouer${GROUP_MESSAGE_LINK_SUFFIX}`).not.toMatch(/envoi groupé/i);
  });

  it("un ancien lien « (envoi groupé) » s'affiche avec le nouveau repère", () => {
    expect(linkLabel("Jouer (envoi groupé)")).toBe("Jouer (message à un groupe)");
    expect(linkLabel("Jouer (message à un groupe)")).toBe("Jouer (message à un groupe)");
    // Seulement en fin de nom : un nom choisi par l'équipe n'est pas modifié ailleurs.
    expect(linkLabel("Bonus (envoi groupé) du lundi")).toBe("Bonus (envoi groupé) du lundi");
    expect(linkLabel("Casino Bienvenue")).toBe("Casino Bienvenue");
  });

  it("sans le repère dans la page du message à un groupe", () => {
    expect(withoutGroupMessageSuffix("Jouer (envoi groupé)")).toBe("Jouer");
    expect(withoutGroupMessageSuffix("Jouer (message à un groupe)")).toBe("Jouer");
    expect(withoutGroupMessageSuffix("Jouer")).toBe("Jouer");
  });
});
