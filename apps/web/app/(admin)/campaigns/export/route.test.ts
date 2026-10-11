import { describe, expect, it, vi } from "vitest";
import { ambiguousCpaHeaders } from "@/lib/dashboard/export-cells";
import { computeMetrics } from "@/lib/campaigns/metrics";

// Export Campagnes rendu sans base : session et liste simulées.
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1", role: "ADMIN" })) }));
vi.mock("@linkaffipro/db", () => ({ prisma: {} }));
vi.mock("@/lib/campaigns/queries", () => {
  const m = (gains: number) =>
    computeMetrics({
      spend: 50,
      members: 3,
      registrations: 1,
      ftds: 1,
      revenue: 0,
      cpaCommissions: gains + 50,
    });
  return {
    listCampaignsUncached: vi.fn(async () => ({
      rows: [
        {
          name: "Paris Ligue des champions",
          adPlatform: null,
          status: "ACTIVE",
          vertical: "SPORTS",
          channels: [],
          links: 1,
          offers: 1,
          importedFrom: null,
          metrics: m(-18),
          previous: m(-62),
        },
      ],
      total: m(-18),
      previousTotal: m(-62),
    })),
  };
});

import { GET } from "./route";

async function csv(qs: string): Promise<string[][]> {
  const res = await GET(new Request(`http://localhost/campaigns/export?${qs}`));
  const text = (await res.text()).replace(/^\uFEFF/, "");
  return text
    .trim()
    .split("\r\n")
    .map((l) => l.split(";").map((c) => c.replace(/^"|"$/g, "")));
}

describe("export CSV des campagnes", () => {
  it("en-têtes : primes des joueurs (commission CPA) et coût par inscription (CPA) jamais confondus", async () => {
    const [head] = await csv("range=7d");
    expect(head).toContain("Primes des joueurs (commission CPA, €)");
    expect(head).toContain("Part du revenu (revshare, €)");
    expect(head).toContain("Coût par inscription (CPA, €)");
    expect(ambiguousCpaHeaders(head!)).toEqual([]);
    expect(head!.join(" ")).not.toMatch(/par joueur|bénéfice/i);
  });

  it("gains d'avant en perte : pas de pourcentage (règle du site), la valeur d'avant reste écrite", async () => {
    const [head, row, total] = await csv("range=7d&compare=1");
    const col = (r: string[] | undefined, label: string) => r![head!.indexOf(label)];
    expect(col(row, "Gains (€)")).toBe("-18,00");
    expect(col(row, "Gains (€) – période précédente")).toBe("-62,00");
    expect(col(row, "Gains (€) – variation (%)")).toBe("");
    expect(col(total, "Gains (€) – variation (%)")).toBe("");
    // Base positive : la variation reste (dépense 50 → 50 : 0 %).
    expect(col(row, "Dépense (€) – variation (%)")).toBe("0,0");
  });
});
