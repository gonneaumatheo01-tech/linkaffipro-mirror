import { LANDING_OPEN_METHODS } from "@linkaffipro/core";
import { describe, expect, it } from "vitest";
import {
  allocateAdSpend,
  browserLabel,
  buildDirectLinks,
  buildLandingTables,
  costSortValue,
  costView,
  escapeFigures,
  methodLabel,
  openCountsOfFirstClicks,
  openedBySystem,
  type AdSpendAllocation,
  type LandingEscapeCount,
  type LandingOpenCount,
} from "./stats";

const P = "page1";

/** Partage connu d'une pub (tests des tableaux). */
const known = (spend: number, byLink: Record<string, number>): AdSpendAllocation => ({
  state: "known",
  spend,
  byLink: new Map(Object.entries(byLink)),
});

describe("dépense d'une pub partagée entre ses chemins d'arrivée", () => {
  it("bascule du lien direct vers la page : chaque jour à son chemin, jamais comptée deux fois", () => {
    // Pub X : 50 € le 1er (clics sur son lien direct D), 50 € le 2 (visites de la page par le lien de tk01).
    const a = allocateAdSpend({
      adIds: ["X"],
      paths: [
        { linkId: "D", adId: "X", current: false },
        { linkId: "tk01", adId: "X", current: true },
      ],
      spend: [
        { adId: "X", day: "2026-10-01", spend: 50 },
        { adId: "X", day: "2026-10-02", spend: 50 },
      ],
      coarse: new Set(),
      arrivals: [
        { linkId: "D", day: "2026-10-01", n: 100 },
        { linkId: "tk01", day: "2026-10-02", n: 100 },
      ],
      requests: [
        { linkId: "D", day: "2026-10-01", n: 20 },
        { linkId: "tk01", day: "2026-10-02", n: 20 },
      ],
    }).get("X")!;
    expect(a.state).toBe("known");
    expect(a.spend).toBe(100);
    expect(Object.fromEntries(a.byLink)).toEqual({ D: 50, tk01: 50 });
    // Coût par join de chaque côté : 2,50 €, comme celui de la pub (100 € ÷ 40 demandes).
  });

  it("un même jour : au prorata des arrivées ; deux pages reliées à la même pub se la partagent", () => {
    const a = allocateAdSpend({
      adIds: ["X"],
      paths: [
        { linkId: "D", adId: "X", current: true },
        { linkId: "page1-tk01", adId: "X", current: true },
        { linkId: "page2-tk01", adId: "X", current: true },
      ],
      spend: [{ adId: "X", day: "2026-10-03", spend: 40 }],
      coarse: new Set(),
      arrivals: [
        { linkId: "D", day: "2026-10-03", n: 10 },
        { linkId: "page1-tk01", day: "2026-10-03", n: 20 },
        { linkId: "page2-tk01", day: "2026-10-03", n: 10 },
      ],
      requests: [],
    }).get("X")!;
    expect(Object.fromEntries(a.byLink)).toEqual({ D: 10, "page1-tk01": 20, "page2-tk01": 10 });
  });

  it("jour sans arrivée : demandes du jour, sinon arrivées de la période, sinon chemins en service", () => {
    const base = {
      adIds: ["X"],
      paths: [
        { linkId: "A", adId: "X", current: true },
        { linkId: "B", adId: "X", current: false },
      ],
      coarse: new Set<string>(),
    };
    const byRequests = allocateAdSpend({
      ...base,
      spend: [{ adId: "X", day: "d1", spend: 30 }],
      arrivals: [],
      requests: [
        { linkId: "A", day: "d1", n: 1 },
        { linkId: "B", day: "d1", n: 2 },
      ],
    }).get("X")!;
    expect(Object.fromEntries(byRequests.byLink)).toEqual({ A: 10, B: 20 });
    const byPeriod = allocateAdSpend({
      ...base,
      spend: [{ adId: "X", day: "d2", spend: 30 }],
      arrivals: [{ linkId: "B", day: "d1", n: 5 }],
      requests: [],
    }).get("X")!;
    expect(Object.fromEntries(byPeriod.byLink)).toEqual({ B: 30 });
    const byCurrent = allocateAdSpend({
      ...base,
      spend: [{ adId: "X", day: "d1", spend: 30 }],
      arrivals: [],
      requests: [],
    }).get("X")!;
    expect(Object.fromEntries(byCurrent.byLink)).toEqual({ A: 30 });
  });

  it("aucune dépense au niveau de la pub : inconnue, jamais zéro (saisie pour la campagne, ou aucune)", () => {
    const a = allocateAdSpend({
      adIds: ["X", "Y", "Z"],
      paths: [{ linkId: "L", adId: "X", current: true }],
      spend: [{ adId: "Z", day: "d1", spend: 0 }],
      coarse: new Set(["X"]),
      arrivals: [{ linkId: "L", day: "d1", n: 10 }],
      requests: [],
    });
    expect(a.get("X")).toMatchObject({ state: "campaign", spend: null });
    expect(a.get("Y")).toMatchObject({ state: "none", spend: null });
    // Une vraie dépense nulle (ligne à 0 €) reste connue.
    expect(a.get("Z")).toMatchObject({ state: "known", spend: 0 });
  });
});

describe("chiffres d'une page par source", () => {
  const sources = [
    { pageId: P, key: "", adId: null, isActive: true, inviteLinkId: "l-main" },
    { pageId: P, key: "tk01", adId: "adA", isActive: true, inviteLinkId: "l-tk01" },
    { pageId: P, key: "tk03", adId: "adA", isActive: true, inviteLinkId: "l-tk03" },
    { pageId: P, key: "exo1", adId: null, isActive: true, inviteLinkId: "l-exo1" },
    { pageId: P, key: "old", adId: null, isActive: false, inviteLinkId: null },
    { pageId: P, key: "gone", adId: "adB", isActive: false, inviteLinkId: null },
    { pageId: P, key: "late", adId: "adC", isActive: false, inviteLinkId: null },
  ];
  const links = [
    { id: "l-main", pageId: P, sourceKey: "", adId: null },
    { id: "l-tk01", pageId: P, sourceKey: "tk01", adId: "adA" },
    { id: "l-tk03", pageId: P, sourceKey: "tk03", adId: "adA" },
    { id: "l-exo1", pageId: P, sourceKey: "exo1", adId: null },
    { id: "l-gone", pageId: P, sourceKey: "gone", adId: "adB" },
    // Source retirée alors que sa pub tourne encore : la dépense de la pub lui revient.
    { id: "l-late", pageId: P, sourceKey: "late", adId: "adC" },
  ];

  const tables = buildLandingTables({
    pageIds: [P],
    sources,
    links,
    visits: [
      { pageId: P, sourceKey: "", type: "VIEW", n: 10 },
      { pageId: P, sourceKey: "", type: "CLICK", n: 4 },
      { pageId: P, sourceKey: "tk01", type: "VIEW", n: 200 },
      { pageId: P, sourceKey: "tk01", type: "CLICK", n: 80 },
      { pageId: P, sourceKey: "tk03", type: "VIEW", n: 100 },
      { pageId: P, sourceKey: "tk03", type: "CLICK", n: 20 },
      { pageId: P, sourceKey: "old", type: "VIEW", n: 5 },
      // Source inconnue (jamais enregistrée) : comptée pour le lien principal.
      { pageId: P, sourceKey: "zzz", type: "VIEW", n: 2 },
      { pageId: "autre", sourceKey: "", type: "VIEW", n: 999 },
    ],
    opens: [
      {
        pageId: P,
        sourceKey: "tk01",
        os: "IOS",
        inApp: "TIKTOK",
        method: "TG_SCHEME",
        type: "CLICK",
        n: 50,
      },
      {
        pageId: P,
        sourceKey: "tk01",
        os: "IOS",
        inApp: "TIKTOK",
        method: "TG_SCHEME",
        type: "OPENED",
        n: 40,
      },
      {
        pageId: P,
        sourceKey: "tk01",
        os: "IOS",
        inApp: "TIKTOK",
        method: "HTTPS",
        type: "CLICK",
        n: 10,
      },
      {
        pageId: P,
        sourceKey: "tk01",
        os: "ANDROID",
        inApp: "INSTAGRAM",
        method: "INTENT",
        type: "CLICK",
        n: 20,
      },
      {
        pageId: P,
        sourceKey: "tk01",
        os: "ANDROID",
        inApp: "INSTAGRAM",
        method: "INTENT",
        type: "OPENED",
        n: 5,
      },
      { pageId: P, sourceKey: "", os: null, inApp: null, method: "HTTPS", type: "CLICK", n: 4 },
    ],
    requests: [
      { pageId: P, sourceKey: "tk01", inviteLinkId: "l-tk01", requests: 30, approved: 25 },
      { pageId: P, sourceKey: "tk03", inviteLinkId: "l-tk03", requests: 10, approved: 10 },
      { pageId: P, sourceKey: "", inviteLinkId: "l-main", requests: 1, approved: 0 },
    ],
    unknown: [
      { pageId: P, raw: "zzz", n: 2 },
      { pageId: P, raw: "tk1", n: 5 },
      { pageId: "autre", raw: "x", n: 9 },
    ],
    allocation: new Map([
      // 120 € de la pub A : 90 € par les visites de tk01, 30 € par celles de tk03 (et rien d'autre).
      ["adA", known(120, { "l-tk01": 90, "l-tk03": 30 })],
      // Pub B : sa source est retirée et n'a plus rien sur la période (sa dépense est allée ailleurs).
      ["adB", known(50, { "autre-lien": 50 })],
      ["adC", known(240, { "l-late": 240 })],
    ]),
  });
  const t = tables.get(P)!;
  const row = (k: string) => t.sources.find((s) => s.key === k)!;

  it("une ligne par source active, la retirée seulement si elle a des chiffres ou une dépense", () => {
    expect(t.sources.map((s) => [s.key, s.isActive])).toEqual([
      ["", true],
      ["exo1", true],
      ["tk01", true],
      ["tk03", true],
      ["late", false],
      ["old", false],
    ]);
  });

  it("visites, clics, demandes, acceptés et taux : % de clic et % visite → join", () => {
    expect(row("tk01")).toMatchObject({
      visits: 200,
      clicks: 80,
      requests: 30,
      approved: 25,
      clickRate: 0.4,
      visitToJoin: 0.15,
    });
    // Lien principal : 10 + 2 visites (source inconnue), 4 clics, 1 demande.
    expect(row("")).toMatchObject({ visits: 12, clicks: 4, requests: 1, approved: 0 });
    // Aucune visite : taux « — » (null).
    expect(row("exo1")).toMatchObject({ visits: 0, clickRate: null, visitToJoin: null });
  });

  it("coût par join : la part de la pub figée sur le lien ÷ ses demandes ; « — » sans pub", () => {
    expect(row("tk01")).toMatchObject({
      spend: 90,
      costPerJoin: 3,
      adLinked: true,
      spendNote: null,
    });
    expect(row("tk03")).toMatchObject({ spend: 30, costPerJoin: 3 });
    expect(row("")).toMatchObject({ spend: null, costPerJoin: null, adLinked: false });
    // Dépense sans aucun join : affichée telle quelle, triée comme la plus chère.
    expect(row("late")).toMatchObject({ spend: 240, requests: 0, costPerJoin: null });
    expect(costView(row("late"))).toEqual({ kind: "noJoin", spend: 240 });
    expect(costSortValue(costView(row("late")))).toBe(Number.POSITIVE_INFINITY);
    expect(costView(row(""))).toEqual({ kind: "none" });
    expect(costSortValue(costView(row("")))).toBeNull();
    expect(costView(row("tk01"))).toEqual({ kind: "cost", value: 3 });
  });

  it("total de la page : sommes, dépense de ses chemins, coût par join sur les demandes des pubs connues", () => {
    expect(t.totals).toMatchObject({
      visits: 317,
      clicks: 104,
      requests: 41,
      approved: 35,
      spend: 360,
      costRequests: 40,
    });
    expect(t.totals.costPerJoin).toBe(9);
    expect(t.totals.visitToJoin).toBeCloseTo(41 / 317);
  });

  it("sources inconnues ou retirées vues dans les adresses : signalées, les plus vues d'abord", () => {
    expect(t.unknownSources).toEqual([
      { raw: "tk1", visits: 5 },
      { raw: "zzz", visits: 2 },
    ]);
  });

  it("ouverture de Telegram : par système, puis par navigateur et façon d'ouvrir", () => {
    expect(row("tk01").opened).toEqual([
      {
        os: "IOS",
        clicks: 60,
        opened: 40,
        rate: 40 / 60,
        browsers: [
          {
            key: "IOS:TIKTOK",
            os: "IOS",
            inApp: "TIKTOK",
            label: "TikTok sur iPhone",
            clicks: 60,
            opened: 40,
            rate: 40 / 60,
            methods: [
              { method: "TG_SCHEME", clicks: 50, opened: 40, rate: 0.8 },
              { method: "HTTPS", clicks: 10, opened: 0, rate: 0 },
            ],
            httpsInApp: true,
          },
        ],
      },
      {
        os: "ANDROID",
        clicks: 20,
        opened: 5,
        rate: 0.25,
        browsers: [
          expect.objectContaining({
            label: "Instagram sur Android",
            methods: [{ method: "INTENT", clicks: 20, opened: 5, rate: 0.25 }],
            httpsInApp: false,
          }),
        ],
      },
    ]);
    expect(t.totals.opened.map((o) => [o.os, o.clicks, o.opened])).toEqual([
      ["IOS", 60, 40],
      ["ANDROID", 20, 5],
      ["OTHER", 4, 0],
    ]);
  });

  it("dépense de la pub inconnue (saisie pour toute la campagne) : « — » avec la raison, jamais 0 €", () => {
    const one = buildLandingTables({
      pageIds: [P],
      sources: [
        { pageId: P, key: "", adId: null, isActive: true, inviteLinkId: "m" },
        { pageId: P, key: "tk01", adId: "adX", isActive: true, inviteLinkId: "l1" },
      ],
      links: [{ id: "l1", pageId: P, sourceKey: "tk01", adId: "adX" }],
      visits: [{ pageId: P, sourceKey: "tk01", type: "VIEW", n: 50 }],
      opens: [],
      requests: [{ pageId: P, sourceKey: "tk01", inviteLinkId: "l1", requests: 5, approved: 5 }],
      allocation: new Map([["adX", { state: "campaign", spend: null, byLink: new Map() }]]),
    }).get(P)!;
    const tk = one.sources.find((s) => s.key === "tk01")!;
    expect(tk).toMatchObject({
      spend: null,
      costPerJoin: null,
      adLinked: true,
      spendNote: "campaign",
    });
    expect(one.totals).toMatchObject({ spend: null, costPerJoin: null, spendNote: "campaign" });
    expect(costView(tk)).toEqual({ kind: "none" });
  });

  it("page sans aucun chiffre : zéros et taux absents", () => {
    const empty = buildLandingTables({
      pageIds: ["vide"],
      sources: [{ pageId: "vide", key: "", adId: null, isActive: true }],
      visits: [],
      opens: [],
      requests: [],
      allocation: new Map(),
    }).get("vide")!;
    expect(empty.totals).toMatchObject({
      visits: 0,
      clicks: 0,
      requests: 0,
      spend: null,
      clickRate: null,
      visitToJoin: null,
      costPerJoin: null,
      opened: [],
      escape: {
        help: 0,
        escaped: 0,
        helpedEscaped: 0,
        direct: 0,
        rate: null,
        autoTried: 0,
        openedAfter: 0,
        autoOpened: 0,
        systems: [],
      },
    });
    expect(empty.sources).toHaveLength(1);
    expect(empty.unknownSources).toEqual([]);
  });
});

describe("sortie de TikTok (phase 16) : aide affichée, sortis, % sortis", () => {
  /** Une ligne de la requête `escapes` (zéros par défaut). */
  const esc = (
    os: string | null,
    over: Partial<Omit<LandingEscapeCount, "pageId" | "sourceKey" | "os">> = {},
    sourceKey = "",
    pageId = P,
  ): LandingEscapeCount => ({
    pageId,
    sourceKey,
    os,
    help: 0,
    helpedEscaped: 0,
    direct: 0,
    autoTried: 0,
    openedAfter: 0,
    autoOpened: 0,
    ...over,
  });

  it("par système : aide affichée, sortis, % sortis sur les visites aidées, Telegram ouvert après la sortie", () => {
    const e = escapeFigures([
      esc("IOS", {
        help: 120,
        helpedEscaped: 54,
        autoTried: 54,
        openedAfter: 47,
        autoOpened: 40,
      }),
      esc("ANDROID", {
        help: 80,
        helpedEscaped: 20,
        autoTried: 20,
        openedAfter: 16,
        autoOpened: 15,
      }),
    ]);
    expect(e).toEqual({
      help: 200,
      escaped: 74,
      helpedEscaped: 74,
      direct: 0,
      rate: 74 / 200,
      autoTried: 74,
      openedAfter: 63,
      autoOpened: 55,
      systems: [
        {
          os: "IOS",
          help: 120,
          escaped: 54,
          helpedEscaped: 54,
          direct: 0,
          rate: 54 / 120,
          autoTried: 54,
          openedAfter: 47,
          autoOpened: 40,
        },
        {
          os: "ANDROID",
          help: 80,
          escaped: 20,
          helpedEscaped: 20,
          direct: 0,
          rate: 0.25,
          autoTried: 20,
          openedAfter: 16,
          autoOpened: 15,
        },
      ],
    });
  });

  it("% sortis : seules les visites aidées puis sorties comptent ; une sortie sans aide reste à part", () => {
    // Android : B, E et C voient l'aide, seule C sort ; D arrive directement dans Chrome (lien Meta ouvert hors de
    // l'appli, ou page ouverte dans le navigateur avant l'appui) : sortie comptée, mais pas dans le %.
    const e = escapeFigures([esc("ANDROID", { help: 3, helpedEscaped: 1, direct: 1 })]);
    expect(e.systems).toEqual([
      expect.objectContaining({ os: "ANDROID", help: 3, escaped: 2, direct: 1, rate: 1 / 3 }),
    ]);
    expect(e).toMatchObject({ help: 3, escaped: 2, helpedEscaped: 1, direct: 1, rate: 1 / 3 });
  });

  it("aucune compensation entre systèmes : 100 aides sur iPhone sans sortie et 60 sorties sans l'aide sur Android → 0 %", () => {
    const e = escapeFigures([
      esc("IOS", { help: 100 }),
      esc("ANDROID", { direct: 60, autoTried: 60, openedAfter: 30, autoOpened: 30 }),
    ]);
    expect(e).toMatchObject({ help: 100, escaped: 60, helpedEscaped: 0, direct: 60, rate: 0 });
    expect(e.systems.map((s) => [s.os, s.help, s.escaped, s.rate])).toEqual([
      ["IOS", 100, 0, 0],
      ["ANDROID", 0, 60, null],
    ]);
    // Le total est la somme des numérateurs ÷ la somme des dénominateurs, jamais une moyenne de taux plafonnés.
    const t = escapeFigures([
      esc("IOS", { help: 2, helpedEscaped: 2 }),
      esc("ANDROID", { help: 8, helpedEscaped: 1, direct: 5 }),
    ]);
    expect(t.rate).toBe(3 / 10);
  });

  it("« — » sans aide ; système inconnu → « Autre » ; systèmes vides absents ; aucun plafond", () => {
    const e = escapeFigures([
      esc("IOS", { help: 2, helpedEscaped: 1, direct: 2 }),
      esc(null, { help: 1 }),
      esc("ANDROID"),
    ]);
    expect(e.systems.map((s) => [s.os, s.help, s.escaped, s.rate])).toEqual([
      ["IOS", 2, 3, 0.5],
      ["OTHER", 1, 0, 0],
    ]);
    expect(e).toMatchObject({ help: 3, escaped: 3, rate: 1 / 3 });
    expect(escapeFigures([])).toEqual({
      help: 0,
      escaped: 0,
      helpedEscaped: 0,
      direct: 0,
      rate: null,
      autoTried: 0,
      openedAfter: 0,
      autoOpened: 0,
      systems: [],
    });
  });

  it("dans le tableau : par source et pour toute la page ; source inconnue comptée dans le lien principal", () => {
    const escapes: LandingEscapeCount[] = [
      esc("IOS", { help: 10, helpedEscaped: 6 }, "tk01"),
      esc("ANDROID", { help: 5, helpedEscaped: 1, direct: 2 }, "tk01"),
      esc("IOS", { help: 4, helpedEscaped: 1 }, "zzz"),
      esc("IOS", { help: 99 }, "", "autre"),
    ];
    const t = buildLandingTables({
      pageIds: [P],
      sources: [
        { pageId: P, key: "", adId: null, isActive: true },
        { pageId: P, key: "tk01", adId: null, isActive: true },
        { pageId: P, key: "tk03", adId: null, isActive: true },
      ],
      visits: [{ pageId: P, sourceKey: "tk01", type: "VIEW", n: 30 }],
      opens: [],
      escapes,
      requests: [],
      allocation: new Map(),
    }).get(P)!;
    const row = (k: string) => t.sources.find((s) => s.key === k)!;
    expect(row("tk01").escape).toMatchObject({ help: 15, escaped: 9, direct: 2, rate: 7 / 15 });
    expect(row("tk01").escape.systems.map((s) => [s.os, s.help, s.escaped])).toEqual([
      ["IOS", 10, 6],
      ["ANDROID", 5, 3],
    ]);
    expect(row("").escape).toMatchObject({ help: 4, escaped: 1, rate: 0.25 });
    expect(row("tk03").escape).toMatchObject({ help: 0, escaped: 0, rate: null, systems: [] });
    expect(t.totals.escape).toMatchObject({ help: 19, escaped: 10, direct: 2, rate: 8 / 19 });
    expect(t.totals.escape.systems.map((s) => [s.os, s.help, s.escaped])).toEqual([
      ["IOS", 14, 7],
      ["ANDROID", 5, 3],
    ]);
    // Le tableau principal ne change pas : visites et clics comme avant.
    expect(row("tk01")).toMatchObject({ visits: 30, clicks: 0 });
  });

  it("façons d'ouvrir de la phase 16 : en mots simples", () => {
    expect(methodLabel("TG_FRAME")).toBe("Ouverture en arrière-plan, avec l'aide");
    expect(methodLabel("INTENT_FRAME")).toBe("Ouverture par Android en arrière-plan, avec l'aide");
    expect(methodLabel("AUTO_TG")).toBe("Ouverture automatique après la sortie");
    expect(methodLabel("AUTO_INTENT")).toBe("Ouverture automatique après la sortie");
    expect(methodLabel("TG_NAV")).toBe("Ouverture de l'appli par la page, avec l'aide");
    expect(methodLabel("INTENT_HELP")).toBe("Ouverture par Android, avec l'aide");
    // Toute façon d'ouvrir connue (envoyée ou retirée) a son libellé : jamais « Autre façon d'ouvrir ».
    for (const m of LANDING_OPEN_METHODS) expect(methodLabel(m)).not.toBe("Autre façon d'ouvrir");
  });
});

describe("ouverture de Telegram", () => {
  it("les façons d'ouvrir se comparent dans un même navigateur, jamais en mélangeant Safari et TikTok", () => {
    // Safari : 100 clics, 80 ouverts (lien classique) ; TikTok : lien classique 10 %, ouverture directe 40 %.
    const rows: LandingOpenCount[] = [
      { pageId: P, sourceKey: "", os: "IOS", inApp: null, method: "HTTPS", type: "CLICK", n: 100 },
      { pageId: P, sourceKey: "", os: "IOS", inApp: null, method: "HTTPS", type: "OPENED", n: 80 },
      {
        pageId: P,
        sourceKey: "",
        os: "IOS",
        inApp: "TIKTOK",
        method: "HTTPS",
        type: "CLICK",
        n: 100,
      },
      {
        pageId: P,
        sourceKey: "",
        os: "IOS",
        inApp: "TIKTOK",
        method: "HTTPS",
        type: "OPENED",
        n: 10,
      },
      {
        pageId: P,
        sourceKey: "",
        os: "IOS",
        inApp: "TIKTOK",
        method: "TG_SCHEME",
        type: "CLICK",
        n: 100,
      },
      {
        pageId: P,
        sourceKey: "",
        os: "IOS",
        inApp: "TIKTOK",
        method: "TG_SCHEME",
        type: "OPENED",
        n: 40,
      },
    ];
    const [ios] = openedBySystem(rows);
    expect(ios!.browsers.map((b) => [b.label, b.methods.map((m) => [m.method, m.rate])])).toEqual([
      [
        "TikTok sur iPhone",
        [
          ["HTTPS", 0.1],
          ["TG_SCHEME", 0.4],
        ],
      ],
      ["Safari ou Chrome sur iPhone", [["HTTPS", 0.8]]],
    ]);
    // Dans TikTok, l'ouverture directe fait 4 fois mieux ; le lien classique dans une appli est un minimum.
    expect(ios!.browsers[0]!.httpsInApp).toBe(true);
    expect(ios!.browsers[1]!.httpsInApp).toBe(false);
  });

  it("une ouverture ne dépasse jamais les clics ; systèmes sans clic absents ; libellés", () => {
    const rows: LandingOpenCount[] = [
      {
        pageId: P,
        sourceKey: "",
        os: "IOS",
        inApp: "INSTAGRAM",
        method: "TG_SCHEME",
        type: "CLICK",
        n: 2,
      },
      {
        pageId: P,
        sourceKey: "",
        os: "IOS",
        inApp: "INSTAGRAM",
        method: "TG_SCHEME",
        type: "OPENED",
        n: 3,
      },
      {
        pageId: P,
        sourceKey: "",
        os: "ANDROID",
        inApp: null,
        method: "INTENT",
        type: "OPENED",
        n: 1,
      },
    ];
    const out = openedBySystem(rows);
    expect(out.map((o) => [o.os, o.clicks, o.opened, o.rate])).toEqual([["IOS", 2, 2, 1]]);
    expect(out[0]!.browsers[0]!.methods).toEqual([
      { method: "TG_SCHEME", clicks: 2, opened: 2, rate: 1 },
    ]);
    expect(methodLabel("TG_SCHEME")).toBe("Ouverture directe de l'appli");
    expect(methodLabel("NOUVELLE")).toBe("Autre façon d'ouvrir");
    expect(browserLabel("ANDROID", "FACEBOOK")).toBe("Facebook ou Messenger sur Android");
    expect(browserLabel("ANDROID", null)).toBe("Chrome ou autre navigateur sur Android");
    expect(browserLabel("OTHER", null)).toBe("Ordinateur ou autre appareil");
  });

  it("premiers appuis seulement : la comparaison suit le tirage au sort, avec les clics du tableau", () => {
    // Exemple du chef de projet, une fois les nouveaux appuis écartés par la lecture en base : 100 visites tirées
    // sur l'ouverture directe (60 ouvertes), 100 sur le lien classique (20 ouvertes). Les 30 personnes qui ont
    // réappuyé après un échec de l'ouverture directe ne tirent plus le lien classique vers 15 %.
    const key = { pageId: P, sourceKey: "", os: "ANDROID", inApp: "TIKTOK" };
    const rows = openCountsOfFirstClicks([
      { ...key, method: "TG_SCHEME", clicks: 100, opened: 60 },
      { ...key, method: "HTTPS", clicks: 100, opened: 20 },
      { ...key, method: "INTENT", clicks: 3, opened: 0 },
    ]);
    expect(rows).toEqual([
      { ...key, method: "TG_SCHEME", type: "CLICK", n: 100 },
      { ...key, method: "TG_SCHEME", type: "OPENED", n: 60 },
      { ...key, method: "HTTPS", type: "CLICK", n: 100 },
      { ...key, method: "HTTPS", type: "OPENED", n: 20 },
      { ...key, method: "INTENT", type: "CLICK", n: 3 },
    ]);
    const [android] = openedBySystem(rows);
    expect(android!.clicks).toBe(203);
    expect(android!.browsers[0]!.methods.map((m) => [m.method, m.clicks, m.rate])).toEqual([
      ["HTTPS", 100, 0.2],
      ["TG_SCHEME", 100, 0.6],
      ["INTENT", 3, 0],
    ]);
  });
});

describe("liens directs des pubs (comparaison)", () => {
  it("liens qui ont servi, plus de demandes d'abord ; % clic → join et coût par join", () => {
    const v = buildDirectLinks({
      links: [
        { id: "l1", name: "Pub 1", platform: "TIKTOK", isActive: true, adId: "a1" },
        { id: "l2", name: "Pub 2", platform: "META", isActive: true, adId: null },
        { id: "l3", name: "Pub morte", platform: null, isActive: false, adId: null },
      ],
      clicks: new Map([
        ["l1", 100],
        ["l2", 50],
      ]),
      requests: new Map([
        ["l1", { requests: 5, approved: 4 }],
        ["l2", { requests: 10, approved: 9 }],
      ]),
      allocation: new Map([["a1", known(25, { l1: 25 })]]),
    });
    expect(v.rows.map((r) => [r.name, r.clickToJoin, r.costPerJoin])).toEqual([
      ["Pub 2", 0.2, null],
      ["Pub 1", 0.05, 5],
    ]);
    expect(v.totals).toEqual({
      clicks: 150,
      requests: 15,
      approved: 13,
      spend: 25,
      clickToJoin: 0.1,
      costPerJoin: 5,
    });
  });

  it("une pub reliée à une source de la page : sa dépense n'est jamais comptée deux fois", () => {
    // Pub A (100 €) : son lien direct ne sert plus (toute sa dépense va à la page) ; pub B : 50 €, 10 demandes.
    const direct = buildDirectLinks({
      links: [
        { id: "ilA", name: "Vidéo bonus", platform: "TIKTOK", isActive: true, adId: "adA" },
        { id: "ilB", name: "Autre pub", platform: "TIKTOK", isActive: true, adId: "adB" },
      ],
      clicks: new Map([["ilB", 100]]),
      requests: new Map([["ilB", { requests: 10, approved: 9 }]]),
      allocation: new Map([
        ["adA", known(100, { "page-tk01": 100 })],
        ["adB", known(50, { ilB: 50 })],
      ]),
      adsOnPages: new Set(["adA"]),
    });
    expect(direct.rows.map((r) => r.name)).toEqual(["Autre pub"]);
    expect(direct.totals).toMatchObject({ spend: 50, costPerJoin: 5 });
    // Pub partagée entre la page et son lien direct : signalée, chacun sa part.
    const shared = buildDirectLinks({
      links: [{ id: "ilA", name: "Vidéo bonus", platform: "TIKTOK", isActive: true, adId: "adA" }],
      clicks: new Map([["ilA", 20]]),
      requests: new Map([["ilA", { requests: 4, approved: 4 }]]),
      allocation: new Map([["adA", known(100, { "page-tk01": 80, ilA: 20 })]]),
      adsOnPages: new Set(["adA"]),
    });
    expect(shared.rows[0]).toMatchObject({ spend: 20, costPerJoin: 5, sharedWithPage: true });
    // Dépense saisie pour toute la campagne : « — » avec la raison.
    const coarse = buildDirectLinks({
      links: [{ id: "ilA", name: "Vidéo bonus", platform: "TIKTOK", isActive: true, adId: "adA" }],
      clicks: new Map([["ilA", 20]]),
      requests: new Map(),
      allocation: new Map([["adA", { state: "campaign", spend: null, byLink: new Map() }]]),
    });
    expect(coarse.rows[0]).toMatchObject({ spend: null, spendNote: "campaign", costPerJoin: null });
    expect(coarse.totals.spend).toBeNull();
  });
});
