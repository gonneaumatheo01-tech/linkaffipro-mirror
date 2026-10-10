import { describe, expect, it } from "vitest";
import { computeMetrics } from "./metrics";
import {
  adCampaignLine,
  CAMPAIGN_TABS,
  campaignTabHref,
  costLevelLabel,
  DETAIL_METRICS,
  displayDeltas,
  displayVariation,
  entryLinkTitle,
  groupCostsByDay,
  HEADER_METRICS,
  headerDigits,
  headerMoney,
  isLegacyOffersTab,
  JARGON,
  parseCampaignTab,
  postExcerpt,
  shortLinkAddress,
} from "./display";

describe("onglets de la fiche campagne", () => {
  it("six onglets, dans l'ordre de la spécification", () => {
    expect(CAMPAIGN_TABS.map((t) => t.label)).toEqual([
      "Vue d'ensemble",
      "Pubs",
      "Liens",
      "Canaux",
      "Messages",
      "Membres",
    ]);
    for (const t of CAMPAIGN_TABS) expect(t.help.length).toBeLessThan(120);
  });

  it("l'ancien onglet Offres et toute valeur inconnue ouvrent la vue d'ensemble", () => {
    expect(parseCampaignTab("offers")).toBe("overview");
    expect(parseCampaignTab(undefined)).toBe("overview");
    expect(parseCampaignTab("inconnu")).toBe("overview");
    expect(parseCampaignTab(["links", "ads"])).toBe("links");
    expect(parseCampaignTab("members")).toBe("members");
    expect(isLegacyOffersTab("offers")).toBe(true);
    expect(isLegacyOffersTab(["offers"])).toBe(true);
    expect(isLegacyOffersTab("overview")).toBe(false);
  });

  it("adresse d'onglet : période gardée, messages, page et onglet précédent retirés", () => {
    expect(
      campaignTabHref("c1", "ads", {
        range: "30d",
        compare: "1",
        ok: "x",
        error: "y",
        page: "3",
        tab: "links",
        others: "1",
      }),
    ).toBe("/campaigns/c1?range=30d&compare=1&tab=ads");
    expect(campaignTabHref("c1", "overview", { range: "7d" })).toBe("/campaigns/c1?range=7d");
    expect(campaignTabHref("c1", "overview")).toBe("/campaigns/c1");
  });
});

describe("chiffres affichés", () => {
  const m = computeMetrics({
    spend: 100,
    members: 20,
    registrations: 10,
    ftds: 4,
    revenue: 250,
    entryClicks: 300,
    offerClicks: 40,
    deposits: 6,
    depositAmount: 480,
  });

  it("en-tête : dépensé, membres, premiers dépôts, bénéfice (une baisse de dépense est favorable)", () => {
    expect(HEADER_METRICS.map((x) => x.key)).toEqual(["spend", "members", "ftds", "profit"]);
    expect(HEADER_METRICS.find((x) => x.key === "spend")!.favorable).toBe("down");
    expect(HEADER_METRICS.find((x) => x.key === "ftds")!.term).toBe("FTD");
    const big = computeMetrics({
      spend: 12345.6,
      members: 0,
      registrations: 0,
      ftds: 0,
      revenue: 0,
    });
    expect(HEADER_METRICS.map((x) => x.format(big).replace(/\s/g, " "))).toEqual([
      "12 346 €",
      "0",
      "0",
      "\u221212 346 €",
    ]);
    expect(HEADER_METRICS.map((x) => (x.exact ?? x.format)(big).replace(/\s/g, " "))).toEqual([
      "12 345,60 €",
      "0",
      "0",
      "\u221212 345,60 €",
    ]);
    expect(HEADER_METRICS.map((x) => x.format(m).replace(/\s/g, " "))).toEqual([
      "100 €",
      "20",
      "4",
      "150 €",
    ]);
    expect(headerMoney(42.5).replace(/\s/g, " ")).toBe("42,50 €");
    expect(headerMoney(-151.64).replace(/\s/g, " ")).toBe("\u2212152 €");
    expect(headerMoney(null)).toBe("—");
  });

  it("en-tête : dépensé et bénéfice partagent la même précision (comme la grille des cartes)", () => {
    const clean = (s: string) => s.replace(/\s/g, " ");
    // 259,57 € dépensés, 42,13 € de bénéfice : « 260 € » et « 42 € », exacts au survol.
    const mixed = computeMetrics({
      spend: 259.57,
      members: 8,
      registrations: 0,
      ftds: 1,
      revenue: 301.7,
    });
    expect(headerDigits(mixed)).toBe(0);
    expect(HEADER_METRICS.map((x) => clean(x.format(mixed)))).toEqual(["260 €", "8", "1", "42 €"]);
    expect(HEADER_METRICS.map((x) => clean((x.exact ?? x.format)(mixed)))).toEqual([
      "259,57 €",
      "8",
      "1",
      "42,13 €",
    ]);
    // Tout sous 100 € : centimes pour les deux.
    const small = computeMetrics({
      spend: 42.5,
      members: 2,
      registrations: 0,
      ftds: 0,
      revenue: 50,
    });
    expect(headerDigits(small)).toBe(2);
    expect(HEADER_METRICS.map((x) => clean(x.format(small)))).toEqual([
      "42,50 €",
      "2",
      "0",
      "7,50 €",
    ]);
  });

  it("détail : mots du client affichés, terme technique au survol, coûts favorables à la baisse", () => {
    for (const x of [...HEADER_METRICS, ...DETAIL_METRICS]) {
      expect(JARGON.test(x.label), x.label).toBe(false);
      if (x.hint) expect(JARGON.test(x.hint), x.hint).toBe(false);
    }
    const terms = Object.fromEntries(DETAIL_METRICS.map((x) => [x.key, x.term]));
    expect(terms).toMatchObject({ revenue: "NGR", roas: "ROAS", cpl: "CPL", cpa: "CPA" });
    for (const k of ["cpl", "cpa", "costPerFtd"])
      expect(DETAIL_METRICS.find((x) => x.key === k)!.favorable).toBe("down");
    const fmt = Object.fromEntries(
      DETAIL_METRICS.map((x) => [x.key, x.format(m).replace(/\s/g, " ")]),
    );
    expect(fmt).toMatchObject({
      entryClicks: "300",
      roas: "2,50×",
      cpl: "5,00 €",
      cpa: "10,00 €",
      costPerFtd: "25,00 €",
      deposits: "480,00 €",
      revenue: "250,00 €",
    });
  });

  it("dépôts : le montant seul en gros chiffre, le nombre dans la phrase", () => {
    const deposits = DETAIL_METRICS.find((x) => x.key === "deposits")!;
    expect(deposits.format(m).replace(/\s/g, " ")).toBe("480,00 €");
    expect(deposits.hintOf?.(m)).toBe("6 dépôts, premiers et suivants.");
    const one = computeMetrics({
      spend: 0,
      members: 0,
      registrations: 0,
      ftds: 1,
      revenue: 0,
      deposits: 1,
      depositAmount: 20,
    });
    expect(deposits.hintOf?.(one)).toBe("1 dépôt, premiers et suivants.");
    for (const x of DETAIL_METRICS) {
      const h = x.hintOf?.(m);
      if (h) expect(JARGON.test(h), h).toBe(false);
    }
  });

  it("le repère de jargon reconnaît les termes techniques", () => {
    for (const w of ["FTD", "NGR", "cpl", "ROAS", "sub-ID", "subid", "Cohorte", "entonnoir"])
      expect(JARGON.test(`le ${w} du jour`), w).toBe(true);
    expect(JARGON.test("Premiers dépôts")).toBe(false);
  });
});

describe("libellés de lignes", () => {
  it("extrait le texte d'un message sans balises ni entités", () => {
    expect(postExcerpt("<b>Bonus</b>&nbsp;de <i>100 %</i> &amp; tours", "M12")).toBe(
      "Bonus de 100 % & tours",
    );
    expect(postExcerpt("  <br/> ", "M12")).toBe("Message M12");
    expect(postExcerpt(null, "M3")).toBe("Message M3");
  });

  it("extrait d'un message : titre et texte séparés par « · », comme l'accueil", () => {
    expect(postExcerpt("<b>Combiné du week-end</b>\n\nQuatre matchs,  une cote\n", "M1")).toBe(
      "Combiné du week-end · Quatre matchs, une cote",
    );
    expect(postExcerpt("<b>Premier pari remboursé</b>\nJusqu'à 100 € remboursés", "M2")).toBe(
      "Premier pari remboursé · Jusqu'à 100 € remboursés",
    );
    const long = postExcerpt(`Titre\n${"mot ".repeat(80)}`, "M3");
    expect(long.length).toBeLessThanOrEqual(161);
    expect(long.endsWith("…")).toBe(true);
  });

  it("niveau d'une dépense", () => {
    expect(costLevelLabel({ ad: { name: "video-3" }, adSet: { name: "FR" } })).toBe(
      "Pub « video-3 »",
    );
    expect(costLevelLabel({ adSet: { name: "FR" } })).toBe("Groupe « FR »");
    expect(costLevelLabel({})).toBe("Toute la campagne pub");
  });

  it("titre d'un lien d'entrée", () => {
    expect(
      entryLinkTitle({
        name: "TT-x",
        adName: "p",
        ad: { name: "Pub 2", adSet: { name: "Groupe 1" } },
      }),
    ).toBe("Groupe 1 › Pub 2");
    expect(entryLinkTitle({ name: "TT-x", adName: " Pub 4 " })).toBe("Pub 4");
    expect(entryLinkTitle({ name: "TT-x", adName: "" })).toBe("TT-x");
  });

  it("adresse courte d'un lien traqué", () => {
    expect(shortLinkAddress("https://go.goolink.eu/", "ab12")).toBe("go.goolink.eu/ab12");
    expect(shortLinkAddress("http://localhost:3107", "x")).toBe("localhost:3107/x");
  });

  it("ligne d'information de la campagne pub", () => {
    expect(
      adCampaignLine({
        platform: "TIKTOK",
        externalCampaignId: "123",
        platformName: "TT-casino",
        imported: false,
        connectionName: "Compte FR",
      }),
    ).toBe("Pubs TikTok · suit la campagne pub « TT-casino » · compte « Compte FR »");
    expect(
      adCampaignLine({
        platform: null,
        externalCampaignId: null,
        platformName: null,
        imported: false,
        connectionName: null,
      }),
    ).toBe("Plateforme des pubs non précisée");
    expect(
      adCampaignLine({
        platform: "META",
        externalCampaignId: "9",
        platformName: null,
        imported: true,
        connectionName: null,
      }),
    ).toBe("Pubs Meta (Facebook / Instagram) · campagne pub importée d'un compte connecté");
    expect(
      adCampaignLine({
        platform: "OTHER",
        externalCampaignId: null,
        platformName: null,
        imported: false,
        connectionName: null,
      }),
    ).toBe("Pubs sur une autre plateforme");
  });
});

describe("dépenses regroupées par jour", () => {
  const line = (
    id: string,
    day: string,
    spend: number,
    source = "CSV",
    extra: { ad?: { name: string } } = {},
  ) => ({
    id,
    date: new Date(`${day}T00:00:00Z`),
    spend,
    impressions: 100,
    clicks: 5,
    source,
    ...extra,
  });

  it("un jour par ligne, du plus récent au plus ancien, montants additionnés au centime", () => {
    const days = groupCostsByDay([
      line("a", "2026-10-08", 0.1),
      line("b", "2026-10-09", 10, "API", { ad: { name: "Pub 1" } }),
      line("c", "2026-10-08", 0.2, "MANUAL"),
      line("d", "2026-10-08", 1, "CSV"),
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-10-09", "2026-10-08"]);
    expect(days[1]).toMatchObject({ spend: 1.3, impressions: 300, clicks: 15 });
    expect(days[1]!.sources).toEqual(["CSV", "MANUAL"]);
    expect(days[1]!.lines.map((l) => l.id)).toEqual(["a", "c", "d"]);
    expect(days[0]!.lines[0]!.ad?.name).toBe("Pub 1");
  });

  it("aucune ligne : aucun jour ; un montant illisible compte pour 0", () => {
    expect(groupCostsByDay([])).toEqual([]);
    expect(groupCostsByDay([line("x", "2026-10-08", Number.NaN)])[0]!.spend).toBe(0);
  });
});

describe("variations affichées", () => {
  it("comme variationOf pour un chiffre positif", () => {
    expect(displayVariation(120, 100)).toBe(20);
    expect(displayVariation(50, 200)).toBe(-75);
    expect(displayVariation(0, 0)).toBe(0);
    expect(displayVariation(5, 0)).toBeNull();
    expect(displayVariation(null, 3)).toBeNull();
    expect(displayVariation(3, undefined)).toBeNull();
    expect(displayVariation(Number.NaN, 3)).toBeNull();
  });

  it("une perte qui se creuse est une baisse, une perte qui se réduit une hausse", () => {
    expect(displayVariation(-275.19, -21.03)).toBeLessThan(0);
    expect(displayVariation(-10, -20)).toBe(50);
    expect(displayVariation(30, -10)).toBe(400);
    expect(displayVariation(-30, 10)).toBe(-400);
  });

  it("toutes les variations d'une campagne", () => {
    const cur = computeMetrics({ spend: 100, members: 10, registrations: 0, ftds: 2, revenue: 50 });
    const prev = computeMetrics({ spend: 50, members: 0, registrations: 0, ftds: 1, revenue: 80 });
    const d = displayDeltas(cur, prev);
    expect(d.spend).toBe(100);
    expect(d.members).toBeNull();
    expect(d.registrations).toBe(0);
    expect(d.profit).toBe(-266.7);
    expect(d.cpl).toBeNull();
  });
});
