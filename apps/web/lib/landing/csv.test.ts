import { describe, expect, it } from "vitest";
import { landingCsv } from "./csv";
import { buildLandingTables } from "./stats";

describe("export CSV d'une page", () => {
  it("une ligne par source puis le total, nombres au format français", () => {
    const table = buildLandingTables({
      pageIds: ["p"],
      sources: [
        { pageId: "p", key: "", adId: null, isActive: true },
        { pageId: "p", key: "tk01", adId: "a", isActive: true, inviteLinkId: "l1" },
      ],
      links: [{ id: "l1", pageId: "p", sourceKey: "tk01", adId: "a" }],
      visits: [
        { pageId: "p", sourceKey: "tk01", type: "VIEW", n: 40 },
        { pageId: "p", sourceKey: "tk01", type: "CLICK", n: 10 },
      ],
      opens: [],
      requests: [{ pageId: "p", sourceKey: "tk01", inviteLinkId: "l1", requests: 4, approved: 3 }],
      allocation: new Map([["a", { state: "known", spend: 10, byLink: new Map([["l1", 10]]) }]]),
    }).get("p")!;
    const csv = landingCsv({
      page: {
        name: "Promo",
        slug: "promo",
        sources: [
          { key: "", ad: null },
          { key: "tk01", ad: { name: "Pub 1" } },
        ],
      },
      table,
      periodText: "7 derniers jours",
      trackingBase: "https://go.goolink.eu",
    });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe(
      "Page;Période;Source;Lien à coller;Retirée;Visites;Clics;% de clic;Demandes (join);Acceptés;% visite → join;Pub reliée;Dépense de la pub (€);Coût par join (€)",
    );
    expect(lines[1]).toBe(
      "Promo;7 derniers jours;Lien principal;https://go.goolink.eu/j/promo;;0;0;;0;0;;;;",
    );
    expect(lines[2]).toBe(
      "Promo;7 derniers jours;tk01;https://go.goolink.eu/j/promo?src=tk01;;40;10;25,0;4;3;10,0;Pub 1;10,00;2,50",
    );
    expect(lines[3]).toBe(
      "Promo;7 derniers jours;Toute la page;https://go.goolink.eu/j/promo;;40;10;25,0;4;3;10,0;;10,00;2,50",
    );
  });
});
