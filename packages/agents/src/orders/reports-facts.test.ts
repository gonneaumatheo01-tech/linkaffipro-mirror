/**
 * Phase 33 (intégration) — les rapports de Kevin lisent les chiffres tels que le Grand Chef les donne
 * (`orderPicksFacts` : `parisGagnes`, `parisPerdus`, `coteMoyenne`, `marches`), pas seulement les clés de test.
 */
import { describe, expect, it } from "vitest";
import { orderReportText } from "./reports";

const ev = { number: 7, teamKey: "sports", chatId: "1", days: 3 };
const ctx = { where: "le canal Test", unit: "paris" as const };

describe("rapports de Kevin : chiffres du Grand Chef", () => {
  it("bilan de fin : gagnés, perdus et cote moyenne venus de `orderPicksFacts`", () => {
    const t = orderReportText({ ...ev, type: "finished" }, { done: 6, parisGagnes: 4, parisPerdus: 2, coteMoyenne: 1.9 }, ctx)!;
    expect(t).toContain("6 paris sur Test");
    expect(t).toContain("4 gagnés");
    expect(t).toContain("2 perdus");
    expect(t).toContain("cote moyenne 1,9");
  });

  it("aucun pari réglé : ni « 0 gagné » ni « 0 perdu »", () => {
    const t = orderReportText({ ...ev, type: "finished" }, { done: 6, parisGagnes: 0, parisPerdus: 0, coteMoyenne: null }, ctx)!;
    expect(t).toContain("6 paris sur Test");
    expect(t).not.toMatch(/gagn|perdu/);
  });

  it("point du jour : marchés des paris publiés", () => {
    const t = orderReportText({ ...ev, type: "day_done", day: "2026-10-24", dayIndex: 1 }, { perDay: [{ day: "2026-10-24", done: 2, failed: 0 }], marches: ["Hors-jeux"] }, ctx)!;
    expect(t).toMatch(/^(Jour 1\/3 sur Test|Test, jour 1\/3) : 2 paris publiés \(Hors-jeux\)\.$/);
  });
});
