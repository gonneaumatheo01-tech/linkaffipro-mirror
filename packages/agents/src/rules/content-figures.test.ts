/** Relecture de la phase 25 : chiffres de l'offre par couple (nombre, unité), liens de toute terminaison, mentions d'IA en minuscules. */
import { describe, expect, it } from "vitest";
import { foreignLinks, mentionsAi } from "./content";
import { inventedFigures, normalizeNumber, offerFigureCouples } from "./figures";

describe("chiffres de l'offre : couples nombre + unité", () => {
  const facts = "Bonus 100 % jusqu'à 200 €, valable 7 jours.";
  const refused = [
    "100 spins offerts",
    "7 € offerts",
    "€500 welcome bonus",
    "$1,000 bonus",
    "R$ 500 de bônus",
    "50 FS pour toi",
    "200 $ de bonus",
    "100 giros grátis",
    "20 tours gratuits",
  ];
  for (const t of refused)
    it(`refuse : ${t}`, () => expect(inventedFigures(t, facts)).not.toEqual([]));
  const accepted = [
    "Bonus 100 % jusqu'à 200 € !",
    "Jusqu'à 200 euros, valable 7 jours",
    "€200 de bonus",
    "Rendez-vous à 21h ce soir",
    "Ton bonus de 100% t'attend, 7 jours pour en profiter",
  ];
  for (const t of accepted)
    it(`accepte : ${t}`, () => expect(inventedFigures(t, facts)).toEqual([]));

  it("symbole avant le nombre, unités en plusieurs langues, virgule + 3 chiffres = milliers", () => {
    expect(offerFigureCouples("1,000€")).toEqual([{ value: "1000", unit: "eur" }]);
    expect(offerFigureCouples("€500 welcome bonus")).toEqual([{ value: "500", unit: "eur" }]);
    expect(offerFigureCouples("$1,000 bonus")).toEqual([{ value: "1000", unit: "usd" }]);
    expect(offerFigureCouples("R$ 500")).toEqual([{ value: "500", unit: "brl" }]);
    expect(offerFigureCouples("500 reais")).toEqual([{ value: "500", unit: "brl" }]);
    expect(offerFigureCouples("50 FS, 30 giros, 20 spins, 10 tours")).toEqual(
      ["50", "30", "20", "10"].map((value) => ({ value, unit: "spins" })),
    );
    expect(offerFigureCouples("valable 7 jours")).toEqual([{ value: "7", unit: "days" }]);
    expect(offerFigureCouples("mise x35")).toEqual([{ value: "35", unit: "x" }]);
    expect(normalizeNumber("1.000")).toBe("1000");
    expect(normalizeNumber("1 000")).toBe("1000");
    expect(offerFigureCouples("1\u00a0000 €")).toEqual([{ value: "1000", unit: "eur" }]);
    expect(normalizeNumber("50,5")).toBe("50.5");
    expect(normalizeNumber("200,00")).toBe("200");
    expect(normalizeNumber("1,000.50")).toBe("1000.5");
  });

  it("même nombre, unité différente : refusé", () => {
    expect(inventedFigures("100 spins", "Bonus 100 %")).toEqual(["100"]);
    expect(inventedFigures("1,000€", "jusqu'à 1 000 €")).toEqual([]);
  });
});

describe("liens : toute terminaison de domaine", () => {
  const flagged: Array<[string, string]> = [
    ["Va sur monsite.top ce soir", "monsite.top"],
    ["Inscris-toi sur stake.ag", "stake.ag"],
    ["1xbet.mobi pour parier", "1xbet.mobi"],
    ["Teste exemple.ai", "exemple.ai"],
    ["ex.nl", "ex.nl"],
    ["Joue sur casino.fun !", "casino.fun"],
    ["Rejoins telegram.dog/abc", "telegram.dog"],
    ["Tout en majuscules : STAKE.AG", "stake.ag"],
  ];
  for (const [t, host] of flagged)
    it(`signale : ${t}`, () => expect(foreignLinks(t)).toContain(host));
  it("nos liens suivis restent permis ; « etc. » et les abréviations ne sont pas des liens", () => {
    expect(foreignLinks("Clique ici : https://go.goolink.eu/abc ou go.goolink.eu/x")).toEqual([]);
    expect(foreignLinks("Roulette, blackjack, etc. Tout y est")).toEqual([]);
    expect(foreignLinks("Des jeux (p.ex. la roulette) ce soir")).toEqual([]);
    expect(foreignLinks("Fin de la soirée.Merci à tous")).toEqual([]);
    expect(foreignLinks("Gagne 2.5x ta mise")).toEqual([]);
  });
});

describe("mention d'IA : tournures en minuscules et outils", () => {
  const refused = [
    "photo faite par une ia 😅",
    "c'est une ia",
    "made with Midjourney",
    "deepfake",
    "photo ia générée",
    "ai generated pic",
    "image faite avec flux",
    "un faceswap marrant",
    "créée avec DALL-E",
    "stable diffusion powered",
  ];
  for (const t of refused) it(`refuse : ${t}`, () => expect(mentionsAi(t)).not.toBeNull());
  const accepted = [
    "il y a du monde ce soir",
    "la ville est à nous",
    "Julia t'attend",
    "le flux de joueurs est énorme",
    "j'ai la dalle",
    "Vai ai tavoli stasera",
  ];
  for (const t of accepted) it(`accepte : ${t}`, () => expect(mentionsAi(t)).toBeNull());
});
