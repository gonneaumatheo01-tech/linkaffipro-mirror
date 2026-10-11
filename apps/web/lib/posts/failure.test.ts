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

  it("message publié par le compte Telegram connecté (emojis animés) → réglages du compte", () => {
    for (const reason of [
      "La session du compte Telegram connecté a expiré ou a été révoquée : reconnectez-le dans Réglages → Connexions → Telegram. Puis reprogrammez ce message.",
      "Le compte Telegram connecté n'est pas administrateur de ce canal avec le droit de publier.",
      "Le compte Telegram connecté n'a pas Telegram Premium : les emojis animés ne peuvent pas être publiés.",
      "Telegram ne répond pas au compte connecté : message non publié, reprogrammez-le.",
    ])
      expect(failureFix(reason).kind).toBe("account");
    expect(failureFix("Le compte Telegram connecté n'est pas administrateur.").hint).toContain(
      "Réglages → Connexions → Telegram",
    );
    // Les phrases du bot ne changent pas de famille.
    expect(failureFix("Le bot n'est pas administrateur du canal.").kind).toBe("channel");
  });

  it("cause inconnue ou absente → phrase générale", () => {
    expect(failureFix("Erreur réseau vers Telegram.").kind).toBe("other");
    expect(failureFix(null).kind).toBe("other");
    expect(failureFix(undefined).hint).toMatch(/page du canal/);
  });

  it("publication interrompue : dupliquer plutôt que reprogrammer (phase 12)", () => {
    for (const reason of [
      "Une partie de ce message est déjà publiée dans un autre canal : supprimez-la dans Telegram, puis dupliquez ce message et programmez la copie (elle partira en entier).",
      "Une partie de ce message a déjà été publiée par votre compte Telegram : supprimez-la dans Telegram, puis dupliquez ce message et programmez la copie (elle partira en entier).",
    ])
      expect(failureFix(reason)).toMatchObject({
        kind: "message",
        hint: expect.stringContaining("Dupliquez"),
      });
  });
});
