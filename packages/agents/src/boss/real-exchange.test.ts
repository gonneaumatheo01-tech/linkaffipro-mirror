/**
 * Premier vrai échange du client avec Kevin (journal `BossTurn` de la production, nuit du 24 au 25 octobre) : règles
 * pures gardées après le retrait du canal d'inspiration (28 octobre 2026) — réponse à une liste de Kevin par numéro ou
 * par nom, noms de canaux en lettres stylisées, questions qui suivent un blocage.
 */
import { describe, expect, it } from "vitest";
import { isWhyFollowUp, pickOption } from "./choices";
import { matchNames, normName } from "./resolve";

const LINK = "https://t.me/+dryj-6sk6t5lNGY0";
const CORNER = "🚩𝑪𝑶𝑹𝑵𝑬𝑹";

describe("correspondance d'une réponse avec une option (pur)", () => {
  const labels = [CORNER, "paris sportif 1", "Paris sportifs 2", "Test"];
  it("numéro, « le 3 », nom, fautes, accents, lettres stylisées", () => {
    expect(pickOption("3", labels)).toBe(2);
    expect(pickOption("le 3", labels)).toBe(2);
    expect(pickOption("3.", labels)).toBe(2);
    expect(pickOption("n°4", labels)).toBe(3);
    expect(pickOption("Test", labels)).toBe(3);
    expect(pickOption("le canal test", labels)).toBe(3);
    expect(pickOption("paris sportif 1", labels)).toBe(1);
    expect(pickOption("Paris sportifs 2", labels)).toBe(2);
    expect(pickOption("paris sportf 1", labels)).toBe(1);
    expect(pickOption("corner", labels)).toBe(0);
    expect(pickOption("Corners", labels)).toBe(0);
    expect(pickOption(CORNER, labels)).toBe(0);
    expect(pickOption("le premier", labels)).toBe(0);
  });
  it("jamais un choix : numéro hors liste, nom ambigu, phrase longue", () => {
    expect(pickOption("7", labels)).toBeNull();
    expect(pickOption("paris sportif", labels)).toBeNull();
    expect(pickOption(`Je veux que tu t'inspire de ce canal ${LINK} pour le canal test`, labels)).toBeNull();
  });
  it("canal en lettres stylisées retrouvé par « corner », « Corner », « 🚩𝑪𝑶𝑹𝑵𝑬𝑹 »", () => {
    expect(normName(CORNER)).toBe("corner");
    const items = [{ id: "c", name: CORNER }, { id: "t", name: "Test" }];
    for (const raw of ["corner", "Corner", CORNER, "corners"]) expect(matchNames(raw, items).map((i) => i.id), raw).toEqual(["c"]);
  });
  it("questions qui suivent un blocage", () => {
    for (const t of ["Comment ça aucune compte réel ?", "pourquoi ?", "c'est quoi un compte réel ?", "je comprends pas"]) expect(isWhyFollowUp(t), t).toBe(true);
    expect(isWhyFollowUp("Inspire toi de ça pour tir cadré")).toBe(false);
  });
});
