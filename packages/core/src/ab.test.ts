import { describe, expect, it } from "vitest";
import { AB_DEFAULT_SPLIT, clampSplit, hashBucket, splitAOf, variantFor } from "./ab";

describe("A/B : répartition déterministe", () => {
  it("donne toujours le même seau et la même variante pour un couple (groupe, membre)", () => {
    expect(hashBucket("g1", "m1")).toBe(hashBucket("g1", "m1"));
    expect(variantFor("m1", "g1", 50)).toBe(variantFor("m1", "g1", 50));
  });

  it("produit un seau entre 0 et 99", () => {
    for (let i = 0; i < 500; i++) {
      const b = hashBucket("groupe", `membre-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it("respecte à peu près la part de A sur un grand nombre de membres", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `m${i}`);
    for (const split of [20, 50, 80]) {
      const a = ids.filter((id) => variantFor(id, "groupe-x", split) === "A").length;
      expect(Math.abs(a / ids.length - split / 100)).toBeLessThan(0.04);
    }
  });

  it("répartit différemment selon le groupe (un membre n'est pas toujours A)", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `m${i}`);
    const same = ids.filter((id) => variantFor(id, "g1", 50) === variantFor(id, "g2", 50)).length;
    expect(same).toBeGreaterThan(700);
    expect(same).toBeLessThan(1300);
  });

  it("calcule la part de A depuis la variante stockée", () => {
    expect(splitAOf("A", 30)).toBe(30);
    expect(splitAOf("B", 70)).toBe(30);
    expect(splitAOf("A", null)).toBe(AB_DEFAULT_SPLIT);
    expect(splitAOf(undefined, undefined)).toBe(AB_DEFAULT_SPLIT);
  });

  it("borne la part entre 10 et 90 %", () => {
    expect(clampSplit(5)).toBe(10);
    expect(clampSplit(95)).toBe(90);
    expect(clampSplit(42.4)).toBe(42);
    expect(clampSplit(Number.NaN)).toBe(AB_DEFAULT_SPLIT);
  });
});
