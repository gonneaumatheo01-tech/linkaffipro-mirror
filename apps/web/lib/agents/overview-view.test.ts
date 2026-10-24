import { describe, expect, it } from "vitest";
import {
  hasResults,
  needsAttention,
  providerState,
  sortApplied,
  spendLabel,
  spendRows,
  spendTotalCents,
  todayFigures,
} from "./overview-view";

const results = (posts: number) => ({
  d7: { posts, views: 0, clicks: 0, registrations: 0, ftds: 0, commissions: 0 },
  d28: { posts, views: 0, clicks: 0, registrations: 0, ftds: 0, commissions: 0 },
});

describe("résumé de supervision à l'écran", () => {
  it("postes de dépense : libellé, plafond, projection et couleur", () => {
    const rows = spendRows({
      spend: [
        { provider: "llm", cents: 1230, capCents: 5000, projectedCents: 3000 },
        { provider: "video", cents: 8500, capCents: 10000, projectedCents: 9500 },
        { provider: "image", cents: 1500, capCents: 1500, projectedCents: 2000 },
        { provider: "odds", cents: 200, capCents: null, projectedCents: 400 },
        { provider: "llm2", cents: 100, capCents: 1000, projectedCents: 1200 },
      ],
    });
    expect(rows[0]).toMatchObject({ label: "IA d'écriture", pct: 25, tone: "brand" });
    expect(rows[0]!.text).toMatch(/12,30\s€ sur 50,00\s€/);
    expect(rows[0]!.projection).toMatch(/30,00\s€ prévus à la fin du mois$/);
    expect(rows[1]).toMatchObject({ label: "Vidéos IA", pct: 85, tone: "warning" });
    expect(rows[2]).toMatchObject({ pct: 100, tone: "danger" });
    expect(rows[3]).toMatchObject({ pct: null, tone: "brand" });
    expect(rows[3]!.text).toContain("aucun plafond");
    // Projection au-dessus du plafond : prévenu avant d'y être.
    expect(rows[4]).toMatchObject({ label: "llm2", pct: 10, tone: "warning" });
    expect(rows[4]!.projection).toContain("au-dessus du plafond");
    expect(spendTotalCents({ spend: [{ provider: "llm", cents: 10, capCents: null, projectedCents: 0 }, { provider: "image", cents: 5, capCents: 0, projectedCents: 0 }] })).toBe(15);
    expect(spendRows({ spend: [{ provider: "image", cents: 5, capCents: 0, projectedCents: 5 }] })[0]!.pct).toBe(100);
    expect(spendLabel("screenshot")).toBe("Captures d'écran");
  });

  it("chiffres du jour dans l'ordre, en couleur seulement quand il faut agir", () => {
    const f = todayFigures({ today: { created: 3, published: 1, waiting: 1, rejected: 0, failed: 2, fallbacks: 1 } });
    expect(f.map((x) => x.label)).toEqual(["Créées", "Publiées", "En attente", "Refusées", "Échouées", "Replis"]);
    expect(f.find((x) => x.key === "waiting")!.tone).toBe("warning");
    expect(f.find((x) => x.key === "failed")!.tone).toBe("danger");
    expect(f.find((x) => x.key === "created")!.tone).toBeUndefined();
  });

  it("résultats : rien à montrer sans post sur 28 jours", () => {
    expect(hasResults({ results: results(0) })).toBe(false);
    expect(hasResults({ results: results(2) })).toBe(true);
  });

  it("fournisseurs : clé absente, jamais appelé, erreurs, fonctionne", () => {
    const p = { key: "fal", label: "fal.ai", keyPresent: true, lastOkAt: "2026-10-24T08:00:00Z", errors24h: 0 };
    expect(providerState({ ...p, keyPresent: false })).toEqual({ tone: "muted", label: "Clé absente" });
    expect(providerState({ ...p, lastOkAt: null })).toEqual({ tone: "muted", label: "Jamais appelé" });
    expect(providerState({ ...p, errors24h: 3 })).toEqual({ tone: "warning", label: "3 erreurs en 24 h" });
    expect(providerState({ ...p, errors24h: 1, lastOkAt: null })).toEqual({ tone: "danger", label: "1 erreur en 24 h" });
    expect(providerState(p)).toEqual({ tone: "success", label: "Fonctionne" });
  });

  it("attention et tri des réglages appliqués", () => {
    expect(needsAttention({ pendingValidations: 1, openHumanRequests: 2, openAlerts: 3 })).toBe(6);
    expect(sortApplied([{ appliedAt: "2026-10-20T08:00:00Z" }, { appliedAt: "2026-10-22T08:00:00Z" }])[0]!.appliedAt).toBe(
      "2026-10-22T08:00:00Z",
    );
  });
});
