import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fillBroadcastExamples, MessageTextEditor } from "./message-editor";

// « Écrire à un groupe » : {prenom} et {bot} sont remplacés pour chaque destinataire par le worker
// (apps/worker/src/broadcasts/personalize.ts). L'éditeur doit le dire (repères insérables, aucun avertissement) et
// l'aperçu les montrer remplacés ; les autres repères ({offre}, {canal}…) restent signalés.

function render(text: string): string {
  return renderToStaticMarkup(
    createElement(MessageTextEditor, {
      id: "broadcast-text",
      text,
      setText: () => undefined,
      label: "Texte du message",
    }),
  );
}

describe("éditeur d'un message à un groupe : repères remplacés pour chaque membre", () => {
  it("{prenom} et {bot} : insérables en un clic, jamais signalés comme « non remplacés »", () => {
    const html = render("Bonjour {prenom}, ici {bot}.");
    expect(html).toContain('aria-label="Insérer un repère"');
    expect(html).toContain(">Prénom</button>");
    expect(html).toContain(">Nom du bot</button>");
    expect(html).not.toContain("ne sera pas remplacé");
    expect(html).not.toContain("ne seront pas remplacés");
  });

  it("un autre repère ({offre}) reste signalé : il partirait tel quel", () => {
    const html = render("Bonjour {prenom}, voici {offre}.");
    expect(html).toContain("{offre} ne sera pas remplacé ici");
    expect(html).not.toContain("{prenom} ne sera");
  });

  it("aperçu : {prenom} → un prénom d'exemple, {bot} → le nom du bot choisi ; le reste tel quel", () => {
    expect(fillBroadcastExamples("Bonjour {prenom}, ici {bot} : {offre}", "Bot casino")).toBe(
      "Bonjour Léa, ici Bot casino : {offre}",
    );
    // Aucun bot choisi : nom d'exemple ; nom avec des caractères spéciaux : échappé (aperçu en HTML Telegram).
    expect(fillBroadcastExamples("{bot}", null)).toBe("LinkAffi Bot");
    expect(fillBroadcastExamples("{bot}", "Casino <VIP>")).toBe("Casino &lt;VIP&gt;");
  });
});
