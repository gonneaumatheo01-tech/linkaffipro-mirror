import { describe, expect, it } from "vitest";
import { templateGraph } from "@linkaffipro/core";
import { actionLabel, fromPhrase, messageExcerpt, nodePhrase, nodeTitle } from "./labels";

describe("libellés des blocs", () => {
  it("aperçu d'un message : mots d'exemple, sans mise en forme, coupé", () => {
    expect(messageExcerpt("Bonjour {prenom} ! Vous avez rejoint {canal}")).toBe(
      "Bonjour Léa ! Vous avez rejoint Casino VIP",
    );
    expect(messageExcerpt("<b>Gras</b>   et &lt;3")).toBe("Gras et <3");
    const long = messageExcerpt("x".repeat(80));
    expect(long).toHaveLength(44);
    expect(long.endsWith("…")).toBe(true);
    expect(messageExcerpt("{inconnu} reste")).toBe("{inconnu} reste");
  });

  it("une action en une ligne, sans variable brute ni guillemets imbriqués", () => {
    expect(actionLabel({ type: "send_message", text: "Bonjour {prenom}" })).toBe(
      "Message : Bonjour Léa",
    );
    expect(actionLabel({ type: "notify_team", text: "{prenom} a cliqué" })).toBe(
      "Prévenir l'équipe : Léa a cliqué",
    );
    expect(actionLabel({ type: "tag", tag: "vip" })).toBe("Étiqueter « vip »");
    expect(
      actionLabel(
        { type: "suggest_channel", channelId: "c1" },
        { channels: { c1: "Paris du jour" } },
      ),
    ).toBe("Proposer le canal « Paris du jour »");
  });

  it("chaque bloc d'un parcours : titre et phrase", () => {
    const g = templateGraph("offer_no_signup", { message: { text: "Salut {prenom}" } });
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(nodeTitle(byId.trigger!)).toBe("Départ");
    expect(nodeTitle(byId.wait!)).toBe("Attendre 1 jour");
    expect(nodeTitle(byId.check!)).toBe("Inscrit chez un programme ?");
    expect(nodeTitle(byId.stop!)).toBe("Arrêter");
    expect(nodeTitle(byId.message!)).toBe("Message : Salut Léa");
    expect(nodePhrase(byId.wait!)).toBe("l'attente de 1 jour");
    expect(nodePhrase(byId.check!)).toBe("la question « Inscrit chez un programme ? »");
    expect(nodePhrase(byId.message!)).toBe("le message « Salut Léa »");
    expect(nodePhrase(byId.stop!)).toBe("l'arrêt");
    expect(nodePhrase(byId.trigger!)).toBe("le départ");
  });

  it("contraction de « de » devant une phrase", () => {
    expect(fromPhrase("le départ")).toBe("du départ");
    expect(fromPhrase("l'attente de 1 jour")).toBe("de l'attente de 1 jour");
    expect(fromPhrase("la question « A déjà déposé ? »")).toBe(
      "de la question « A déjà déposé ? »",
    );
  });
});
