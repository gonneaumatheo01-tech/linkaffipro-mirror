import { describe, expect, it } from "vitest";
import { openAlertsPill, purgeSummary, retentionMonths } from "./alert-view";

describe("Réglages → Alertes : affichage", () => {
  it("pastille des alertes ouvertes", () => {
    expect(openAlertsPill(0)).toEqual({ tone: "success", label: "Aucune alerte ouverte" });
    expect(openAlertsPill(1)).toEqual({ tone: "danger", label: "1 alerte ouverte" });
    expect(openAlertsPill(3)).toEqual({ tone: "danger", label: "3 alertes ouvertes" });
  });

  it("durée de conservation : nombre enregistré, texte numérique, ou 24 mois par défaut", () => {
    expect(retentionMonths(36)).toBe(36);
    expect(retentionMonths("12")).toBe(12);
    expect(retentionMonths(undefined)).toBe(24);
    expect(retentionMonths(null)).toBe(24);
    expect(retentionMonths("abc")).toBe(24);
  });

  it("résumé de la dernière purge, au singulier et au pluriel", () => {
    expect(purgeSummary(null)).toMatch(/Aucune purge/);
    const s = purgeSummary({
      createdAt: new Date("2026-10-09T02:00:00.000Z"),
      metadata: { membersAnonymized: 1, eventsDeleted: 40 },
    });
    expect(s).toMatch(/^Dernière purge le 09\/10\/2026/);
    expect(s).toContain("1 membre anonymisé, 40 événements supprimés.");
    expect(purgeSummary({ createdAt: new Date(), metadata: null })).toContain(
      "0 membre anonymisé, 0 événement supprimé.",
    );
  });
});
