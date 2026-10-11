import { describe, expect, it } from "vitest";
import { failureFix } from "./failure";

describe("message en échec : que faire", () => {
  it("droits du bot ou accès au canal → page du canal", () => {
    for (const reason of [
      "Le bot n'est pas administrateur du canal (ou n'a pas le droit de publier).",
      "Telegram a refusé l'envoi : le bot n'est plus administrateur du canal (exemple de démonstration).",
      "Canal introuvable : le bot n'y a plus accès.",
      "Accès refusé par Telegram : Forbidden: bot was kicked from the channel chat",
    ])
      expect(failureFix(reason).kind).toBe("channel");
    expect(failureFix("Le bot n'est pas administrateur du canal.").hint).toContain(
      "Re-vérifier les droits des bots",
    );
  });

  it("contenu refusé → modifier le message", () => {
    for (const reason of [
      "Texte trop long pour Telegram (4096 caractères, 1024 pour une légende).",
      "Mise en forme HTML invalide (balise non fermée ou non acceptée).",
      "Média refusé par Telegram (taille ou format).",
      "URL de bouton invalide.",
    ])
      expect(failureFix(reason).kind).toBe("message");
  });

  it("cause inconnue ou absente → phrase générale", () => {
    expect(failureFix("Erreur réseau vers Telegram.").kind).toBe("other");
    expect(failureFix(null).kind).toBe("other");
    expect(failureFix(undefined).hint).toMatch(/page du canal/);
  });
});
