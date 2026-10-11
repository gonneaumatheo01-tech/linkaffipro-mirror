import { describe, expect, it } from "vitest";
import { placeholdersToComplete } from "@/components/messages/preview-placeholders";
import { buildTemplateRows } from "../../../../packages/db/prisma/seed-templates";
import { parsePostListFilters } from "./queries";
import { offerButtonsToChoose, templateCardTitle, templatesHref } from "./templates";

describe("galerie de modèles", () => {
  it("garde le titre des modèles de la bibliothèque (univers et thème sont en pastilles)", () => {
    expect(templateCardTitle("Casino · Bonus · Bonus du week-end")).toBe("Bonus du week-end");
    expect(templateCardTitle("Casino · Bonus · Titre · avec point")).toBe("Titre · avec point");
    expect(templateCardTitle("Mon modèle")).toBe("Mon modèle");
    expect(templateCardTitle("  ")).toBe("Modèle sans nom");
  });
  it("adresse des filtres, relue à l'identique par la page", () => {
    const href = templatesHref({ vertical: "SPORTS", theme: "rappel", categoryId: "k1" });
    expect(href).toBe("/messages?view=templates&vertical=SPORTS&theme=rappel&category=k1");
    const f = parsePostListFilters(new URLSearchParams(href.split("?")[1]));
    expect(f).toMatchObject({ vertical: "SPORTS", theme: "rappel", categoryId: "k1" });
    expect(templatesHref({ vertical: "", theme: "" })).toBe("/messages?view=templates");
  });
});

describe("modèle avec bouton Offre : la campagne se choisit à l'utilisation", () => {
  it("compte les boutons Offre sans campagne choisie", () => {
    expect(offerButtonsToChoose([[{ text: "🎁 J'en profite", type: "OFFER" }]])).toBe(1);
    expect(
      offerButtonsToChoose([
        [{ text: "a", type: "OFFER", campaignId: "c1", affiliateCampaignId: "o1" }],
        [{ text: "b", type: "OFFER" }],
      ]),
    ).toBe(1);
    // Ancien bouton sans campagne (avant les campagnes) : un nouveau message en exige une.
    expect(offerButtonsToChoose([[{ text: "a", type: "OFFER", affiliateCampaignId: "o1" }]])).toBe(
      1,
    );
    expect(offerButtonsToChoose([[{ text: "Site", type: "URL", url: "https://x.fr" }]])).toBe(0);
    expect(offerButtonsToChoose([])).toBe(0);
  });
  it("modèles fournis : plus aucun mot à compléter ; ceux qui parlent de l'offre demandent une campagne", () => {
    const rows = buildTemplateRows();
    for (const r of rows) {
      expect(placeholdersToComplete(r.text), r.code).toEqual([]);
      expect(offerButtonsToChoose(r.buttons), r.code).toBe(r.buttons.length > 0 ? 1 : 0);
    }
    expect(rows.filter((r) => offerButtonsToChoose(r.buttons) > 0)).toHaveLength(43);
  });
});
