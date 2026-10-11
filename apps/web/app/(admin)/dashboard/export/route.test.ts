import { describe, expect, it, vi } from "vitest";
import { ambiguousCpaHeaders } from "@/lib/dashboard/export-cells";
import { EMPTY_TOTALS, derive } from "@/lib/dashboard/metrics";

// Export Statistiques → Pubs rendu sans base : session et tableau simulés.
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1", role: "ADMIN" })) }));
vi.mock("@/lib/dashboard/daily", () => {
  const cur = { ...EMPTY_TOTALS, spend: 394.59, commissions: 922.07, cpaCommissions: 880 };
  const prev = { ...EMPTY_TOTALS, spend: 100, commissions: 24 };
  return {
    loadAdsTable: vi.fn(async () => ({
      rows: [],
      total: cur,
      totalDerived: derive(cur),
      previousTotal: prev,
      previousTotalDerived: derive(prev),
      totalDeltas: { gains: -179.9 },
    })),
  };
});

import { GET } from "./route";

async function csv(qs: string): Promise<string[][]> {
  const res = await GET(new Request(`http://localhost/dashboard/export?${qs}`));
  const text = (await res.text()).replace(/^\uFEFF/, "");
  return text
    .trim()
    .split("\r\n")
    .map((l) => l.split(";").map((c) => c.replace(/^"|"$/g, "")));
}

describe("export CSV des Pubs", () => {
  it("en-têtes : primes des joueurs (commission CPA) et coût par inscription (CPA) jamais confondus", async () => {
    const [head] = await csv("range=7d");
    expect(head).toContain("Primes des joueurs (commission CPA, EUR)");
    expect(head).toContain("Part du revenu (revshare, EUR)");
    expect(head).toContain("Gains (EUR)");
    expect(ambiguousCpaHeaders(head!)).toEqual([]);
    expect(head!.join(" ")).not.toMatch(/par joueur|bénéfice/i);
  });

  it("retour sur dépense pub au centième ; variation vide quand la période d'avant était en perte", async () => {
    const [head, total] = await csv("range=7d&compare=1");
    const col = (label: string) => total![head!.indexOf(label)];
    expect(col("Retour sur dépense pub (ROAS)")).toBe("2.34");
    // Gains d'avant : 24 − 100 = −76 € : pas de pourcentage (règle du site).
    expect(col("Gains (EUR) – période précédente")).toBe("-76.00");
    expect(col("Gains (EUR) – variation (%)")).toBe("");
  });
});
