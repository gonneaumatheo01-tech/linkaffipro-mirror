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
      // Sortie de TikTok : 8 aides sur iPhone (3 sorties après l'aide), 2 sur Android (1 sortie après l'aide, et 2
      // visites sorties vers Chrome sans l'aide) ; Telegram ouvert après la sortie 5 fois, dont 3 tout seul.
      escapes: [
        {
          pageId: "p",
          sourceKey: "tk01",
          os: "IOS",
          help: 8,
          helpedEscaped: 3,
          direct: 0,
          autoTried: 3,
          openedAfter: 3,
          autoOpened: 2,
        },
        {
          pageId: "p",
          sourceKey: "tk01",
          os: "ANDROID",
          help: 2,
          helpedEscaped: 1,
          direct: 2,
          autoTried: 3,
          openedAfter: 2,
          autoOpened: 1,
        },
      ],
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
    // Colonnes de la phase 15 inchangées et à la même place ; la sortie de TikTok (phase 16) vient à la fin.
    expect(lines[0]).toBe(
      "Page;Période;Source;Lien à coller;Retirée;Visites;Clics;% de clic;Demandes (join);Acceptés;% visite → join;Pub reliée;Dépense de la pub (€);Coût par join (€);" +
        "Aide affichée;Sortis de TikTok (vers Safari ou Chrome);dont sortis après l'aide;dont sortis sans l'aide (page ouverte dans Safari ou Chrome avant l'appui, ou lien ouvert hors de l'appli);% sortis (sortis après l'aide ÷ aide affichée);" +
        "Aide affichée iPhone;Sortis après l'aide iPhone;% sortis iPhone;Aide affichée Android;Sortis après l'aide Android;% sortis Android;" +
        "Telegram ouvert après la sortie;dont Telegram ouvert tout seul",
    );
    expect(lines[1]).toBe(
      "Promo;7 derniers jours;Lien principal;https://go.goolink.eu/j/promo;;0;0;;0;0;;;;;0;0;0;0;;0;0;;0;0;;0;0",
    );
    expect(lines[2]).toBe(
      "Promo;7 derniers jours;tk01;https://go.goolink.eu/j/promo?src=tk01;;40;10;25,0;4;3;10,0;Pub 1;10,00;2,50;" +
        "10;6;4;2;40,0;8;3;37,5;2;1;50,0;5;3",
    );
    expect(lines[3]).toBe(
      "Promo;7 derniers jours;Toute la page;https://go.goolink.eu/j/promo;;40;10;25,0;4;3;10,0;;10,00;2,50;" +
        "10;6;4;2;40,0;8;3;37,5;2;1;50,0;5;3",
    );
  });
});
