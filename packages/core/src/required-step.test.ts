import { describe, expect, it } from "vitest";
import { mentionsRequiredStep, textsMentionRequiredStep } from "./required-step";

/**
 * Règle unique (phase 14, décision E5) : un message d'accueil qui annonce une étape obligatoire. Réunit les cas du site
 * (« Ce que dit le bot », formulaire de la règle) et du paquet telegram.
 */
describe("message d'accueil qui parle d'une étape obligatoire", () => {
  it("repère les tournures, mise en forme, accents, majuscules et apostrophes ignorés", () => {
    for (const text of [
      "Rejoins les deux canaux ci-dessous, puis clique sur « J'ai rejoint » pour être accepté",
      "Rejoins les deux canaux ci-dessous, puis clique sur « J’ai rejoint » pour être accepté",
      "Appuie sur <b>✅ J’ai rejoint</b>",
      "Appuie sur ✅ Jai rejoint",
      "Dernière étape avant d'entrer !",
      "Dernière étape : rejoins nos canaux",
      "C'est OBLIGATOIRE pour entrer",
      "Ces canaux sont <b>obligatoires</b>",
      "Pour etre acceptee, rejoins nos canaux",
      "Join, then tap ✅ I joined",
      "Then tap ✅ I joined",
      "Join our channels to be accepted",
      "Last step before you get in",
      "These channels are mandatory",
      "Únete y pulsa ✅ Ya me uní",
      "Entre e toque em ✅ Já entrei",
      "Tritt bei und tippe auf ✅ Beigetreten",
      "Unisciti e tocca ✅ Mi sono unito",
      "Rejoins nos canaux&nbsp;: c'est <i>obligatoire</i>",
    ])
      expect(mentionsRequiredStep(text), text).toBe(true);
  });

  it("un accueil qui propose seulement les canaux n'est pas signalé", () => {
    for (const text of [
      "Salut {prenom} ! Ta demande pour <b>{canal}</b> est bien reçue : elle sera validée {delai}. En attendant, découvre aussi nos autres canaux ci-dessous.",
      "Ta demande est reçue, découvre aussi nos canaux.",
      "Bienvenue !",
      "",
      null,
      undefined,
    ])
      expect(mentionsRequiredStep(text), String(text)).toBe(false);
  });

  it("textes d'un message dans plusieurs langues : une seule langue suffit", () => {
    expect(
      textsMentionRequiredStep({
        fr: "Bienvenue !",
        en: "Join our channels, then tap ✅ I joined",
      }),
    ).toBe(true);
    expect(textsMentionRequiredStep({ fr: "Bienvenue !" })).toBe(false);
    expect(textsMentionRequiredStep(null)).toBe(false);
    expect(textsMentionRequiredStep({ fr: 3 as unknown as string })).toBe(false);
  });
});
