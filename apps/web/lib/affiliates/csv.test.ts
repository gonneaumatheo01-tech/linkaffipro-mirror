import { describe, expect, it } from "vitest";
import {
  affiliateFtdsCsv,
  affiliatesCsv,
  attributionText,
  CAMPAIGN_COLUMNS,
  FTD_COLUMNS,
} from "./csv";
import { emptyFigures, type AffiliateView } from "./figures";

const ref = {
  inviteLinkId: "L1",
  campaignKey: "k1",
  campaignName: "Casino VIP; été",
  affiliateId: "aff-paul",
  affiliateName: "Paul",
  channelId: "ch1",
  channelTitle: "Casino VIP",
  isActive: true,
  attributionDays: 30,
  createdAt: new Date("2026-10-01T10:00:00Z"),
};

const views: AffiliateView[] = [
  {
    id: "aff-paul",
    name: "Paul",
    figures: { ...emptyFigures(120), ftds: 1, revenue: 40.5 },
    campaigns: [
      {
        ref,
        figures: { ...emptyFigures(120), requests: 4, ftds: 1, depositAmount: 80.5, revenue: 40.5 },
        ftdList: [
          {
            playerId: "p1",
            memberId: "m1",
            memberName: "Nora",
            ftdAt: new Date("2026-10-12T10:00:00Z"),
            amount: 50,
            offerName: "Casino Royal",
          },
        ],
      },
    ],
  },
];

const lines = (csv: string) => csv.replace(/^﻿/, "").trim().split("\r\n");

/** En-têtes de test : le nom de chaque colonne (les libellés réels sont dans la route d'export). */
const CAMPAIGN_LABELS = Object.fromEntries(CAMPAIGN_COLUMNS.map((c) => [c, c])) as Record<
  (typeof CAMPAIGN_COLUMNS)[number],
  string
>;
const FTD_LABELS = Object.fromEntries(FTD_COLUMNS.map((c) => [c, c])) as Record<
  (typeof FTD_COLUMNS)[number],
  string
>;

describe("export CSV des affiliés", () => {
  it("une ligne par campagne et un total ; nombres à la française ; clics inconnus vides", () => {
    const csv = affiliatesCsv(
      views,
      { ...emptyFigures(null), requests: 4, ftds: 1, revenue: 40.5 },
      "7 derniers jours",
      CAMPAIGN_LABELS,
    );
    const [head, row, total] = lines(csv);
    expect(head!.split(";")).toEqual([...CAMPAIGN_COLUMNS]);
    expect(row).toBe(
      'Paul;aff-paul;"Casino VIP; été";k1;Casino VIP;oui;30 jours;7 derniers jours;120;4;0;0;0;0;0;1;0;80,50;40,50',
    );
    expect(total).toBe("Total;;;;;;;7 derniers jours;;4;0;0;0;0;0;1;0;0,00;40,50");
  });

  it("sans campagne : l'en-tête seul", () => {
    expect(lines(affiliatesCsv([], emptyFigures(), "x", CAMPAIGN_LABELS))).toHaveLength(1);
  });

  it("liste des premiers dépôts", () => {
    const [head, row] = lines(affiliateFtdsCsv(views, FTD_LABELS));
    expect(head!.split(";")).toEqual([...FTD_COLUMNS]);
    expect(row).toBe('Paul;"Casino VIP; été";Casino VIP;Nora;12/10/2026 12:00;50,00;Casino Royal');
  });

  it("durée d'attribution en mots", () => {
    expect(attributionText(null)).toBe("à vie");
    expect(attributionText(1)).toBe("1 jour");
    expect(attributionText(30)).toBe("30 jours");
  });
});
