import { describe, expect, it } from "vitest";
import { clampSplit, excludeServed, hashBucket, parseAbForm, pickWinner, splitAOf, variantFor } from "./ab";

describe("répartition A/B", () => {
  it("est déterministe et stable", () => {
    expect(variantFor("m1", "g1", 50)).toBe(variantFor("m1", "g1", 50));
    expect(hashBucket("g1", "m1")).toBe(hashBucket("g1", "m1"));
    expect(hashBucket("g1", "m1")).toBeGreaterThanOrEqual(0);
    expect(hashBucket("g1", "m1")).toBeLessThan(100);
  });
  it("respecte la part demandée à ±5 % sur 1 000 membres", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `member-${i}`);
    for (const split of [30, 50, 70]) {
      const a = ids.filter((id) => variantFor(id, "groupe-x", split) === "A").length;
      expect(Math.abs(a / 10 - split)).toBeLessThanOrEqual(5);
    }
  });
  it("dépend du groupe : deux tests différents répartissent différemment", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `m${i}`);
    const same = ids.filter((id) => variantFor(id, "g1", 50) === variantFor(id, "g2", 50)).length;
    expect(same).toBeLessThan(200);
  });
  it("retrouve la part de A depuis chaque variante", () => {
    expect(splitAOf("A", 30)).toBe(30);
    expect(splitAOf("B", 70)).toBe(30);
    expect(splitAOf("A", null)).toBe(50);
  });
  it("borne la part entre 10 et 90", () => {
    expect(clampSplit(5)).toBe(10);
    expect(clampSplit(95)).toBe(90);
    expect(clampSplit(42.4)).toBe(42);
    expect(clampSplit(Number.NaN)).toBe(50);
  });
});

describe("formulaire A/B", () => {
  it("lit la variante B et la part", () => {
    const fd = new FormData();
    fd.set("abEnabled", "1");
    fd.set("textB", " Salut B ");
    fd.set("buttonsB", JSON.stringify([[{ text: "x", type: "URL", url: "https://a" }]]));
    fd.set("abSplit", "35");
    const r = parseAbForm(fd);
    expect(r).toEqual({ enabled: true, textB: "Salut B", buttonsB: [[{ text: "x", type: "URL", url: "https://a" }]], mediaAssetIdB: undefined, split: 35 });
  });
  it("est désactivé par défaut et tolère un JSON cassé", () => {
    expect(parseAbForm(new FormData())).toEqual({ enabled: false });
    const fd = new FormData();
    fd.set("abEnabled", "1");
    fd.set("buttonsB", "{pas du json");
    expect(parseAbForm(fd)).toMatchObject({ enabled: true, buttonsB: [] });
  });
});

describe("gagnant", () => {
  it("désigne la variante au meilleur taux de clic", () => {
    const r = pickWinner([
      { variant: "A", sent: 100, uniqueClicks: 10 },
      { variant: "B", sent: 100, uniqueClicks: 25 },
    ]);
    expect(r).toEqual({ status: "winner", variant: "B", ctr: 0.25 });
  });
  it("attend au moins 30 envois par variante", () => {
    expect(pickWinner([{ variant: "A", sent: 100, uniqueClicks: 50 }, { variant: "B", sent: 12, uniqueClicks: 12 }])).toEqual({ status: "insufficient", minSent: 30 });
  });
  it("signale une égalité et ignore l'envoi au reste", () => {
    expect(pickWinner([{ variant: "A", sent: 50, uniqueClicks: 5 }, { variant: "B", sent: 50, uniqueClicks: 5 }, { variant: "REST", sent: 500, uniqueClicks: 400 }])).toEqual({ status: "tie" });
  });
});

describe("exclusion", () => {
  it("retire les membres déjà servis", () => {
    expect(excludeServed(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
  });
});
