import { describe, expect, it } from "vitest";
import {
  isSentLike,
  POST_LANGUAGES,
  postExcerpt,
  postHeaderLine,
  postLanguageOptions,
} from "./display";

describe("extrait d'un message", () => {
  it("sépare le titre et le corps par « · » au lieu de les coller", () => {
    expect(postExcerpt("<b>Rappel</b>\nVotre bonus expire à minuit.")).toBe(
      "Rappel · Votre bonus expire à minuit.",
    );
    expect(postExcerpt("<b>Conseil du jour</b>\n\n  Une photo souriante  \n")).toBe(
      "Conseil du jour · Une photo souriante",
    );
  });
  it("compacte les espaces, décode les entités, retire les balises", () => {
    expect(postExcerpt("<i>Jouer   comporte</i> des risques &amp; 18+")).toBe(
      "Jouer comporte des risques & 18+",
    );
    expect(postExcerpt("Ligne\r\nsuivante")).toBe("Ligne · suivante");
  });
  it("aucun « · » en tête ou en fin, texte vide → chaîne vide", () => {
    expect(postExcerpt("\n\nBonjour\n\n")).toBe("Bonjour");
    expect(postExcerpt("")).toBe("");
    expect(postExcerpt("<b></b>\n")).toBe("");
  });
  it("coupe à la longueur demandée", () => {
    expect(postExcerpt("abcdefghij", 4)).toBe("abcd");
  });
});

describe("ligne sous le titre de la fiche d'un message", () => {
  const base = { bot: "demo_sports_bot", sentLocal: null, scheduledLocal: "2026-10-13T19:00" };
  it("un message programmé « sera publié », un message envoyé « publié »", () => {
    expect(postHeaderLine({ ...base, isTemplate: false, status: "SCHEDULED" })).toBe(
      "Part le mardi 13 octobre à 19:00 · sera publié par @demo_sports_bot",
    );
    expect(
      postHeaderLine({
        ...base,
        isTemplate: false,
        status: "SENT",
        sentLocal: "2026-10-07T19:00",
      }),
    ).toBe("Envoyé le mercredi 7 octobre à 19:00 · publié par @demo_sports_bot");
  });
  it("brouillon, envoi annulé, échec, sans date", () => {
    expect(postHeaderLine({ ...base, isTemplate: false, status: "DRAFT" })).toBe(
      "Prévu le mardi 13 octobre à 19:00 · sera publié par @demo_sports_bot",
    );
    expect(postHeaderLine({ ...base, isTemplate: false, status: "CANCELLED" })).toBe(
      "Était prévu le mardi 13 octobre à 19:00 · envoi annulé",
    );
    expect(postHeaderLine({ ...base, isTemplate: false, status: "FAILED" })).toBe(
      "Prévu le mardi 13 octobre à 19:00 · envoi par @demo_sports_bot",
    );
    expect(
      postHeaderLine({ ...base, scheduledLocal: null, isTemplate: false, status: "DRAFT" }),
    ).toBe("Sans date · sera publié par @demo_sports_bot");
  });
  it("un modèle n'a pas de ligne (rien n'est publié)", () => {
    expect(postHeaderLine({ ...base, isTemplate: true, status: "DRAFT" })).toBeUndefined();
  });
});

describe("message parti ou non (chiffres)", () => {
  it("envoyé, en cours d'envoi, supprimé : chiffres ; sinon : pas encore", () => {
    expect(isSentLike({ status: "SENT", sentAt: new Date() })).toBe(true);
    expect(isSentLike({ status: "SENDING", sentAt: null })).toBe(true);
    expect(isSentLike({ status: "DELETED", sentAt: null })).toBe(true);
    expect(isSentLike({ status: "SCHEDULED", sentAt: null })).toBe(false);
    expect(isSentLike({ status: "DRAFT", sentAt: null })).toBe(false);
    expect(isSentLike({ status: "FAILED", sentAt: new Date() })).toBe(true);
  });
});

describe("langue du message : liste en clair", () => {
  it("les 6 langues du bot, le français d'abord, sans code à taper", () => {
    expect(POST_LANGUAGES.map((l) => l.value)).toEqual(["fr", "en", "es", "pt", "de", "it"]);
    expect(postLanguageOptions("fr")).toEqual(POST_LANGUAGES);
    expect(postLanguageOptions("fr")[0]).toEqual({ value: "fr", label: "Français" });
  });
  it("une langue enregistrée hors de la liste reste choisie (rien n'est perdu)", () => {
    const opts = postLanguageOptions("ru");
    expect(opts).toHaveLength(7);
    expect(opts[6]).toEqual({ value: "ru", label: "Russe" });
    expect(postLanguageOptions("xx").at(-1)).toEqual({ value: "xx", label: "XX" });
    expect(postLanguageOptions("")).toEqual(POST_LANGUAGES);
  });
});
