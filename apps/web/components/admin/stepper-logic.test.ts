import { describe, expect, it } from "vitest";
import { clampStep, stepProgress, stepState, stepSummary } from "./stepper-logic";

const steps = [
  { title: "Nom et univers" },
  { title: "Offres" },
  { title: "Canaux" },
  { title: "Pubs" },
];

describe("logique du Stepper", () => {
  it("donne l'état de chaque étape", () => {
    expect(stepState(0, 1)).toBe("done");
    expect(stepState(1, 1)).toBe("current");
    expect(stepState(2, 1)).toBe("upcoming");
  });

  it("ramène l'étape courante dans les bornes", () => {
    expect(clampStep(-2, 4)).toBe(0);
    expect(clampStep(1, 4)).toBe(1);
    expect(clampStep(9, 4)).toBe(3);
    expect(clampStep(1.7, 4)).toBe(1);
    expect(clampStep(Number.NaN, 4)).toBe(0);
    expect(clampStep(0, 0)).toBe(0);
  });

  it("résume la position en une ligne pour le téléphone", () => {
    expect(stepSummary(steps, 1)).toBe("Étape 2 sur 4 · Offres");
    expect(stepSummary(steps, 0)).toBe("Étape 1 sur 4 · Nom et univers");
    expect(stepSummary(steps, 12)).toBe("Étape 4 sur 4 · Pubs");
    expect(stepSummary([], 0)).toBe("");
  });

  it("calcule l'avancement en pourcentage (étape courante comprise)", () => {
    expect(stepProgress(0, 4)).toBe(25);
    expect(stepProgress(3, 4)).toBe(100);
    expect(stepProgress(1, 3)).toBe(67);
    expect(stepProgress(0, 0)).toBe(0);
  });
});
