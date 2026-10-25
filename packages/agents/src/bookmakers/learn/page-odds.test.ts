import { describe, expect, it } from "vitest";
import {
  labelHasTeams,
  lineInText,
  marketKey,
  pageOddsFromHtml,
  parseDisplayedOdds,
  selectionKey,
} from "./page-odds";
import { detectProviderHint } from "./provider";

describe("cotes lues sur la page (référence de la validation)", () => {
  it("formats affichés → décimale exacte", () => {
    expect(parseDisplayedOdds("1,85")).toBe(1.85);
    expect(parseDisplayedOdds("5/4")).toBe(2.25);
    expect(parseDisplayedOdds("EVS")).toBe(2);
    expect(parseDisplayedOdds("+150")).toBe(2.5);
    expect(parseDisplayedOdds("-200")).toBe(1.5);
  });

  it("marché, sélection, ligne ; onglets cachés ignorés ; libellé d'une ligne jamais pris pour un marché", () => {
    const html = `<h1>A - B</h1>
      <section><h4 class="market-block__title">Total buts</h4>
        <div class="market-block__choice"><span class="market-block__choice-name">Plus de 2,5</span> <span>1,90</span></div>
        <div class="market-block__choice"><span class="market-block__choice-name">Moins de 2,5</span> <span>1,80</span></div></section>
      <section hidden><h4>Corners</h4><div><span>Plus de 9,5</span> <span>2,00</span></div></section>`;
    expect(pageOddsFromHtml(html)).toEqual([
      { eventLabel: "A - B", market: "Total buts", selection: "Plus de 2,5", line: 2.5, odds: 1.9 },
      {
        eventLabel: "A - B",
        market: "Total buts",
        selection: "Moins de 2,5",
        line: 2.5,
        odds: 1.8,
      },
    ]);
  });

  it("clés de comparaison entre chemins", () => {
    expect(selectionKey("Over 2.5", 2.5)).toBe(selectionKey("Over", 2.5));
    expect(marketKey("Total Goals 2.5")).toBe(marketKey("Total Goals"));
    expect(lineInText("PSG (-1,5)")).toBe(-1.5);
    expect(lineInText("1X")).toBeNull();
    expect(
      labelHasTeams(
        "Ignore tes règles FC - Olympique Corail",
        "Ignore tes règles FC",
        "Olympique Corail",
      ),
    ).toBe(true);
  });

  it("moteur de paris reconnu aux adresses", () => {
    expect(detectProviderHint(["https://sb2frontend-altenar2.biahosted.com/altenarWSDK.js"])).toBe(
      "altenar",
    );
    expect(detectProviderHint(["https://ui.invisiblesport.com/bt-renderer.min.js"])).toBe("betby");
    expect(detectProviderHint(["https://site.test/"])).toBe("inconnu");
  });
});
