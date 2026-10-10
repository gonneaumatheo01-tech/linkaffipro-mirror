import { describe, expect, it } from "vitest";
import { SETTINGS_CARDS } from "../nav";
import { groupTabs, SETTINGS_GROUPS } from "./group-nav-logic";

describe("Réglages : pages regroupées sous une carte", () => {
  it("chaque groupe reprend exactement les liens de sa carte, dans le même ordre", () => {
    const cardOf = { content: "content", alerts: "alerts" } as const;
    for (const [group, def] of Object.entries(SETTINGS_GROUPS)) {
      const card = SETTINGS_CARDS.find((c) => c.key === cardOf[group as keyof typeof cardOf]);
      expect(card?.title).toBe(def.label);
      expect(def.pages.map((p) => p.href)).toEqual((card?.links ?? []).map((l) => l.href));
    }
  });

  it("une seule page active : celle qui est ouverte", () => {
    const tabs = groupTabs("content", "tags");
    expect(tabs.filter((t) => t.active).map((t) => t.href)).toEqual(["/settings/tags"]);
    expect(groupTabs("alerts", "alerts").find((t) => t.active)?.label).toBe("Alertes");
    expect(groupTabs("alerts", "inconnue").some((t) => t.active)).toBe(false);
  });

  it("libellés en français courant, sans jargon", () => {
    for (const def of Object.values(SETTINGS_GROUPS))
      for (const p of def.pages) expect(p.label).not.toMatch(/postback|webhook|segment|sub-?id/i);
  });
});
