import { describe, expect, it } from "vitest";
import { eventsUrlField } from "./events-url-field";

/**
 * Champ « Adresse où envoyer les événements des membres » : après une erreur, la saisie reste dans le champ (React
 * remet le formulaire à zéro après l'action : sans cela, la saisie disparaissait et un second clic enregistrait
 * l'adresse d'origine) ; après un enregistrement, le champ reprend l'adresse du serveur.
 */
describe("champ de l'adresse des événements", () => {
  const url = "https://igqz.supabase.co/functions/v1/telegram-events";

  it("au premier affichage et après un enregistrement : l'adresse du serveur", () => {
    expect(eventsUrlField(url, null)).toEqual({ key: `saved:${url}`, defaultValue: url });
    expect(eventsUrlField("https://autre.example/x", { ok: "Adresse enregistrée." })).toEqual({
      key: "saved:https://autre.example/x",
      defaultValue: "https://autre.example/x",
    });
  });

  it("après une erreur : la saisie refusée reste dans le champ (nouvelle clé à chaque essai)", () => {
    const first = eventsUrlField(url, {
      error: "L'adresse ne doit pas contenir d'identifiant ni de mot de passe.",
      value: "https://user:pw@x.example.com/",
      attempt: 1,
    });
    expect(first.defaultValue).toBe("https://user:pw@x.example.com/");
    const second = eventsUrlField(url, {
      error: "L'adresse ne doit pas contenir d'identifiant ni de mot de passe.",
      value: "https://user:pw@x.example.com/",
      attempt: 2,
    });
    expect(second.defaultValue).toBe("https://user:pw@x.example.com/");
    expect(second.key).not.toBe(first.key);
    expect(first.key).not.toBe(`saved:${url}`);
  });

  it("erreur sans saisie renvoyée (réservé aux administrateurs) : l'adresse du serveur", () => {
    expect(eventsUrlField(url, { error: "Réservé aux administrateurs." }).defaultValue).toBe(url);
  });
});
