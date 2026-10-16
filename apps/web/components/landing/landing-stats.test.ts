import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Chiffres d'une page (rubrique « Pages », phase 16) rendus côté serveur : colonne « % sortis » du tableau des
// sources, sortie de TikTok (sorties sans l'aide à part, Telegram ouvert après la sortie), textes exacts.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/pages/p",
  useSearchParams: () => new URLSearchParams(),
}));

import { buildLandingTables, type LandingEscapeCount } from "@/lib/landing/stats";
import { resolvePeriod } from "@/lib/periods";
import { LandingSourceDetail, LandingStats } from "./landing-stats";

/** Texte visible (balises retirées, entités décodées, espaces repliés). */
function visible(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;| | /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (
  os: string,
  over: Partial<LandingEscapeCount>,
  sourceKey = "tk01",
): LandingEscapeCount => ({
  pageId: "p",
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

function table(escapes: LandingEscapeCount[]) {
  return buildLandingTables({
    pageIds: ["p"],
    sources: [
      { pageId: "p", key: "", adId: null, isActive: true },
      { pageId: "p", key: "tk01", adId: null, isActive: true },
    ],
    visits: [
      { pageId: "p", sourceKey: "tk01", type: "VIEW", n: 40 },
      { pageId: "p", sourceKey: "tk01", type: "CLICK", n: 10 },
    ],
    opens: [],
    escapes,
    requests: [],
    allocation: new Map(),
  }).get("p")!;
}

const ESCAPES = [
  // tk01 : 8 aides sur iPhone (3 sorties après l'aide), 2 sur Android (1 sortie après l'aide) et 2 visites arrivées
  // dans Chrome sans l'aide ; Telegram ouvert après la sortie 5 fois, dont 3 tout seul.
  escape("IOS", { help: 8, helpedEscaped: 3, autoTried: 3, openedAfter: 3, autoOpened: 2 }),
  escape("ANDROID", {
    help: 2,
    helpedEscaped: 1,
    direct: 2,
    autoTried: 3,
    openedAfter: 2,
    autoOpened: 1,
  }),
];

function renderStats(t: ReturnType<typeof table>): string {
  return visible(
    renderToStaticMarkup(
      createElement(LandingStats, {
        pageId: "p",
        table: t,
        previous: null,
        period: resolvePeriod({ range: "7d" }, new Date("2026-10-16T10:00:00Z")),
        compare: false,
        direct: {
          rows: [],
          totals: {
            clicks: 0,
            requests: 0,
            approved: 0,
            spend: null,
            clickToJoin: null,
            costPerJoin: null,
          },
        },
        slug: "promo",
        trackingBase: "https://go.goolink.eu",
        adNames: {},
        readyKeys: ["", "tk01"],
      }),
    ),
  );
}

describe("chiffres d'une page : sortie de TikTok", () => {
  it("tableau des sources : colonne « % sortis » avec « N sur M aides »", () => {
    const html = renderStats(table(ESCAPES));
    expect(html).toContain("% sortis");
    // tk01 : 4 sorties après l'aide sur 10 aides = 40 % (les 2 sorties sans l'aide n'y entrent pas).
    expect(html).toMatch(/tk01 .*40 % 4 sur 10 aides/);
  });

  it("sortie de TikTok : sorties sans l'aide à part, Telegram ouvert après la sortie, textes exacts", () => {
    const html = renderStats(table(ESCAPES));
    expect(html).toContain("Aide affichée 10");
    expect(html).toContain("Sortis de TikTok 6");
    expect(html).toContain("dont 2 sans l'aide");
    expect(html).toContain("% sortis 40 %");
    expect(html).toContain("Telegram ouvert après la sortie : 5 sur 6 sorties, dont 3 tout seul.");
    expect(html).not.toContain("tout seul ensuite");
    // L'ouverture automatique n'est pas promise partout : Chrome sur iPhone demande un appui.
    expect(html).toContain("sur iPhone, Chrome demande un appui sur le bouton");
    expect(html).not.toContain("la page ouvre Telegram toute seule");
    // Plus de consigne « Comparez les façons d'ouvrir » (une seule façon par appli depuis la phase 16).
    expect(html).not.toContain("Comparez les façons d'ouvrir");
  });

  it("période sans aide : pas de colonne « % sortis » (rien à comparer)", () => {
    const html = renderStats(table([]));
    expect(html).not.toContain("% sortis");
    expect(html).toContain("Aucune aide affichée sur la période.");
  });

  it("volet d'une source : sortis, dont sans l'aide, % sortis par système, Telegram ouvert après la sortie", () => {
    const row = table(ESCAPES).sources.find((s) => s.key === "tk01")!;
    const html = visible(
      renderToStaticMarkup(
        createElement(LandingSourceDetail, {
          row,
          url: "https://go.goolink.eu/j/promo?src=tk01",
          ready: true,
          adName: null,
        }),
      ),
    );
    expect(html).toContain("Sortis de TikTok 6 dont 2 sans l'aide");
    expect(html).toContain("% sortis 40 %");
    expect(html).toContain("% sortis sur iPhone 37,5 % (3 sur 8 aides affichées)");
    expect(html).toContain("% sortis sur Android 50 % (1 sur 2 aides affichées)");
    expect(html).toContain("Telegram ouvert après la sortie 5 sur 6 sorties dont 3 tout seul");
  });
});
