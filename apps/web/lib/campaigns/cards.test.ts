import { describe, expect, it } from "vitest";
import {
  campaignSummary,
  campaignsHref,
  compactMoney,
  exactMoney,
  filterCampaigns,
  filterCounts,
  flatParams,
  groupMoney,
  groupMoneyDigits,
  hasCampaignFilters,
  matchesCampaignFilters,
  noMatchTitle,
  parseCampaignFilters,
  platformShortLabel,
  plural,
  profitTone,
  sortByStatus,
  splitImportedShells,
  statusRank,
  sumSpend,
  UNIVERSE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  withMinusSign,
} from "./cards";

const rows = [
  { id: "a", vertical: "CASINO", status: "PAUSED" },
  { id: "b", vertical: "SPORTS", status: "ACTIVE" },
  { id: "c", vertical: null, status: "DRAFT" },
  { id: "d", vertical: "CASINO", status: "ACTIVE" },
  { id: "e", vertical: "DATING", status: "ENDED" },
];

describe("filtres de la page Campagnes", () => {
  it("lit l'univers et le statut, en ignorant la casse et les valeurs inconnues", () => {
    expect(parseCampaignFilters({})).toEqual({ vertical: "", status: "" });
    expect(parseCampaignFilters({ vertical: "casino", status: "active" })).toEqual({
      vertical: "CASINO",
      status: "ACTIVE",
    });
    expect(parseCampaignFilters({ vertical: "NONE" })).toEqual({ vertical: "none", status: "" });
    expect(parseCampaignFilters({ vertical: "poker", status: "LIVE" })).toEqual({
      vertical: "",
      status: "",
    });
    expect(parseCampaignFilters({ vertical: ["SPORTS", "CASINO"] }).vertical).toBe("SPORTS");
  });

  it("dit si un filtre est posé", () => {
    expect(hasCampaignFilters({ vertical: "", status: "" })).toBe(false);
    expect(hasCampaignFilters({ vertical: "none", status: "" })).toBe(true);
    expect(hasCampaignFilters({ vertical: "", status: "ENDED" })).toBe(true);
  });

  it("filtre par univers, « sans univers » et statut, en gardant l'ordre", () => {
    expect(filterCampaigns(rows, { vertical: "CASINO", status: "" }).map((r) => r.id)).toEqual([
      "a",
      "d",
    ]);
    expect(filterCampaigns(rows, { vertical: "none", status: "" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterCampaigns(rows, { vertical: "", status: "ACTIVE" }).map((r) => r.id)).toEqual([
      "b",
      "d",
    ]);
    expect(
      filterCampaigns(rows, { vertical: "CASINO", status: "ACTIVE" }).map((r) => r.id),
    ).toEqual(["d"]);
    expect(filterCampaigns(rows, { vertical: "", status: "" })).toHaveLength(5);
  });

  it("un univers inconnu en base compte comme « sans univers »", () => {
    expect(
      matchesCampaignFilters(
        { vertical: "POKER", status: "ACTIVE" },
        { vertical: "none", status: "" },
      ),
    ).toBe(true);
    expect(
      matchesCampaignFilters(
        { vertical: "sports", status: "ACTIVE" },
        { vertical: "SPORTS", status: "" },
      ),
    ).toBe(true);
  });

  it("compte chaque pastille en tenant compte de l'autre filtre", () => {
    const all = filterCounts(rows, { vertical: "", status: "" });
    expect(all.vertical).toMatchObject({ "": 5, CASINO: 2, SPORTS: 1, DATING: 1, none: 1 });
    expect(all.status).toMatchObject({ "": 5, ACTIVE: 2, PAUSED: 1, DRAFT: 1, ENDED: 1 });
    const active = filterCounts(rows, { vertical: "", status: "ACTIVE" });
    expect(active.vertical).toMatchObject({ "": 2, CASINO: 1, SPORTS: 1, DATING: 0, none: 0 });
    const casino = filterCounts(rows, { vertical: "CASINO", status: "ACTIVE" });
    expect(casino.status).toMatchObject({ "": 2, ACTIVE: 1, PAUSED: 1, DRAFT: 0 });
  });

  it("propose les univers du client et « Sans univers », et les statuts au pluriel", () => {
    expect(UNIVERSE_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      "Tous",
      "Casino",
      "Paris sportifs",
      "Rencontres",
      "Sans univers",
    ]);
    expect(STATUS_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      "Tous",
      "Actives",
      "En pause",
      "Brouillons",
      "Terminées",
    ]);
  });
});

describe("regroupements et ordre", () => {
  it("sépare les campagnes pub importées pas encore rattachées", () => {
    const { campaigns, shells } = splitImportedShells([
      { id: "x", importedFrom: null },
      { id: "y", importedFrom: "META" },
      { id: "z", importedFrom: null },
    ]);
    expect(campaigns.map((c) => c.id)).toEqual(["x", "z"]);
    expect(shells.map((c) => c.id)).toEqual(["y"]);
  });

  it("met les actives d'abord, puis en pause, brouillons, terminées, en gardant l'ordre d'origine", () => {
    expect(sortByStatus(rows).map((r) => r.id)).toEqual(["b", "d", "a", "c", "e"]);
    expect(statusRank("INCONNU")).toBe(4);
    expect(sortByStatus([{ status: "X" }, { status: "ACTIVE" }]).map((r) => r.status)).toEqual([
      "ACTIVE",
      "X",
    ]);
  });

  it("additionne les dépenses en ignorant les valeurs non finies", () => {
    expect(sumSpend([{ metrics: { spend: 10.5 } }, { metrics: { spend: 2 } }])).toBe(12.5);
    expect(sumSpend([{ metrics: { spend: Number.NaN } }])).toBe(0);
    expect(sumSpend([])).toBe(0);
  });
});

describe("adresses des pastilles", () => {
  it("garde la période et l'autre filtre, retire les valeurs vides et les messages de retour", () => {
    const current = { range: "30d", compare: "1", vertical: "CASINO", ok: "Enregistré", error: "" };
    expect(campaignsHref(current, { status: "ACTIVE" })).toBe(
      "/campaigns?range=30d&compare=1&vertical=CASINO&status=ACTIVE",
    );
    expect(campaignsHref(current, { vertical: "" })).toBe("/campaigns?range=30d&compare=1");
    expect(campaignsHref({}, {})).toBe("/campaigns");
  });

  it("aplatit les paramètres d'adresse (première valeur)", () => {
    expect(flatParams({ a: ["1", "2"], b: "x", c: undefined, d: "" })).toEqual({ a: "1", b: "x" });
  });
});

describe("état vide des filtres", () => {
  it("dit en une phrase ce qui est filtré", () => {
    expect(noMatchTitle({ vertical: "", status: "ENDED" })).toBe("Aucune campagne terminée");
    expect(noMatchTitle({ vertical: "CASINO", status: "PAUSED" })).toBe(
      "Aucune campagne Casino en pause",
    );
    expect(noMatchTitle({ vertical: "DATING", status: "" })).toBe("Aucune campagne Rencontres");
    expect(noMatchTitle({ vertical: "none", status: "DRAFT" })).toBe(
      "Aucune campagne sans univers en brouillon",
    );
    expect(noMatchTitle({ vertical: "SPORTS", status: "ACTIVE" })).toBe(
      "Aucune campagne Paris sportifs active",
    );
    expect(noMatchTitle({ vertical: "", status: "" })).toBe("Aucune campagne");
  });
});

describe("formats des cartes", () => {
  it("montants compacts : sans centimes à partir de 100 €", () => {
    const clean = (s: string) => s.replace(/\s/g, " ");
    expect(clean(compactMoney(12345.67))).toBe("12 346 €");
    expect(clean(compactMoney(-1500))).toBe("\u22121 500 €");
    expect(clean(compactMoney(259.57))).toBe("260 €");
    expect(clean(compactMoney(-509.68))).toBe("\u2212510 €");
    expect(clean(compactMoney(99.99))).toBe("99,99 €");
    expect(clean(compactMoney(-42.5))).toBe("\u221242,50 €");
    expect(clean(compactMoney(42.5))).toBe("42,50 €");
    expect(clean(compactMoney(0))).toBe("0,00 €");
    expect(compactMoney(null)).toBe("—");
    expect(compactMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("une seule précision par groupe de montants affichés ensemble", () => {
    const clean = (s: string) => s.replace(/\s/g, " ");
    // Grille à 30 jours : un montant dépasse 100 €, tous passent à l'euro.
    const grid = [1813.2, 558.14, 689.97, 42.13, -509.68];
    expect(groupMoneyDigits(grid)).toBe(0);
    expect(grid.map((n) => clean(groupMoney(n, 0)))).toEqual([
      "1 813 €",
      "558 €",
      "690 €",
      "42 €",
      "\u2212510 €",
    ]);
    // Tous sous 100 € : centimes partout.
    expect(groupMoneyDigits([42.13, -12.5, 0, 99.99])).toBe(2);
    expect(groupMoneyDigits([-100])).toBe(0);
    // Valeurs absentes ignorées ; groupe vide : centimes.
    expect(groupMoneyDigits([null, undefined, Number.NaN, 12])).toBe(2);
    expect(groupMoneyDigits([])).toBe(2);
    // Un petit négatif arrondi à zéro ne garde pas de signe.
    expect(clean(groupMoney(-0.4, 0))).toBe("0 €");
    expect(clean(groupMoney(-0.004, 2))).toBe("0,00 €");
    expect(groupMoney(null, 0)).toBe("—");
    expect(clean(exactMoney(259.57))).toBe("259,57 €");
    expect(clean(exactMoney(-1500))).toBe("\u22121 500,00 €");
  });

  it("vrai signe moins, une seule fois, seulement devant un nombre", () => {
    expect(withMinusSign("-151,64 €")).toBe("\u2212151,64 €");
    expect(withMinusSign("151,64 €")).toBe("151,64 €");
    expect(withMinusSign("TT-casino-FR")).toBe("TT-casino-FR");
    expect(withMinusSign("€ -12")).toBe("€ \u221212");
  });

  it("nom court de la plateforme", () => {
    expect(platformShortLabel("META")).toBe("Meta");
    expect(platformShortLabel("TIKTOK")).toBe("TikTok");
    expect(platformShortLabel("OTHER")).toBe("Autre plateforme");
    expect(platformShortLabel("SNAP")).toBe("SNAP");
    expect(platformShortLabel(null)).toBeNull();
  });

  it("sens du bénéfice", () => {
    expect(profitTone(12)).toBe("positive");
    expect(profitTone(-0.5)).toBe("negative");
    expect(profitTone(0.001)).toBe("neutral");
    expect(profitTone(null)).toBe("neutral");
  });

  it("pluriels et ligne de contexte", () => {
    expect(plural(1, "canal", "canaux")).toBe("1 canal");
    expect(plural(3, "canal", "canaux")).toBe("3 canaux");
    expect(plural(0, "offre")).toBe("0 offre");
    expect(campaignSummary({ platformLabel: "TikTok", channels: 2, links: 1, offers: 3 })).toBe(
      "TikTok · 2 canaux · 1 lien d'entrée · 3 offres",
    );
    expect(campaignSummary({ platformLabel: null, channels: 0, links: 0, offers: 0 })).toBe(
      "Sans pub · 0 canal · 0 lien d'entrée · 0 offre",
    );
  });
});
