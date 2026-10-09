import { describe, expect, it } from "vitest";
import { groupByCategory, perPost, slugify, uniqueSlug, withAverages } from "./category-stats";

describe("slug de catégorie", () => {
  it("retire les accents et met des tirets", () => {
    expect(slugify("Preuve de gains")).toBe("preuve-de-gains");
    expect(slugify("Événement  spécial !")).toBe("evenement-special");
    expect(slugify("  ")).toBe("categorie");
  });
  it("rend le slug unique", () => {
    const taken = new Set(["bonus", "bonus-2"]);
    expect(uniqueSlug("bonus", taken)).toBe("bonus-3");
    expect(uniqueSlug("teasing", taken)).toBe("teasing");
  });
});

describe("moyennes par catégorie", () => {
  it("calcule la moyenne par message, 0 sans message", () => {
    expect(perPost(10, 4)).toBe(2.5);
    expect(perPost(1, 3)).toBe(0.33);
    expect(perPost(5, 0)).toBe(0);
  });
  it("regroupe et moyenne", () => {
    const cats = [{ id: "a", name: "Bonus", color: "#0f0" }, { id: "b", name: "Teasing", color: "#f00" }];
    const posts = [
      { categoryId: "a", stats: { clicks: 10, uniqueClickers: 8, offerClicks: 4, reactionsTotal: 3, registrations: 2, ftds: 1, deposits: 2, depositAmount: "50.5" } },
      { categoryId: "a", stats: { clicks: 0, uniqueClickers: 0, offerClicks: 0, reactionsTotal: 1, registrations: 0, ftds: 0, deposits: 0, depositAmount: 0 } },
      { categoryId: null, stats: null },
      { categoryId: "inconnue", stats: { clicks: 2, uniqueClickers: 2, offerClicks: 0, reactionsTotal: 0, registrations: 0, ftds: 0, deposits: 0, depositAmount: 0 } },
    ];
    const rows = withAverages(groupByCategory(posts, cats));
    const bonus = rows.find((r) => r.categoryId === "a")!;
    expect(bonus.posts).toBe(2);
    expect(bonus.clicks).toBe(10);
    expect(bonus.avg.clicks).toBe(5);
    expect(bonus.avg.reactions).toBe(2);
    expect(bonus.depositAmount).toBe(50.5);
    const none = rows.find((r) => r.categoryId === null)!;
    expect(none.posts).toBe(2);
    expect(none.clicks).toBe(2);
    expect(rows.find((r) => r.categoryId === "b")!.posts).toBe(0);
    expect(rows[0]!.categoryId).toBe("a");
  });
});
