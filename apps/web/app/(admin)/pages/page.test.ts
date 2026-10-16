import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Rubrique « Pages » rendue côté serveur avec des chiffres simulés : colonne « % sortis » (phase 16, sortie de TikTok)
// à côté des visites, clics et demandes, seulement quand l'aide a servi sur la période.
const mocks = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/pages",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1", role: "ADMIN" })) }));
vi.mock("@/lib/env", () => ({ env: { trackingBaseUrl: "https://go.goolink.eu" } }));
vi.mock("@/lib/landing/queries", async () => {
  const { resolvePeriod } = await import("@/lib/periods");
  return {
    loadLandingList: vi.fn(async () => ({
      rows: mocks.rows,
      period: resolvePeriod({ range: "7d" }, new Date("2026-10-16T10:00:00Z")),
    })),
  };
});

import { buildLandingTables, type LandingEscapeCount } from "@/lib/landing/stats";
import PagesPage from "./page";

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

function pageRow(id: string, name: string, escapes: Omit<LandingEscapeCount, "pageId">[]) {
  const table = buildLandingTables({
    pageIds: [id],
    sources: [{ pageId: id, key: "", adId: null, isActive: true }],
    visits: [
      { pageId: id, sourceKey: "", type: "VIEW", n: 50 },
      { pageId: id, sourceKey: "", type: "CLICK", n: 20 },
    ],
    opens: [],
    escapes: escapes.map((e) => ({ ...e, pageId: id })),
    requests: [],
    allocation: new Map(),
  }).get(id)!;
  return {
    id,
    name,
    slug: id,
    headline: "Les meilleurs bonus",
    isActive: true,
    channel: { id: "c1", title: "Casino VIP", vertical: "CASINO" },
    linkReady: true,
    linkError: null,
    sourceCount: 1,
    table,
  };
}

const zero = { help: 0, helpedEscaped: 0, direct: 0, autoTried: 0, openedAfter: 0, autoOpened: 0 };

async function render(): Promise<string> {
  const el = await PagesPage({ searchParams: Promise.resolve({}) } as never);
  return visible(renderToStaticMarkup(el));
}

describe("rubrique Pages : liste des pages", () => {
  it("colonne « % sortis » : sorties après l'aide ÷ aides, « N sur M aides » dessous", async () => {
    mocks.rows = [
      // 12 aides, 3 sorties après l'aide et 4 sorties sans l'aide : 25 % (les sorties sans l'aide n'y entrent pas).
      pageRow("promo", "Promo TikTok", [
        { ...zero, sourceKey: "", os: "IOS", help: 8, helpedEscaped: 2 },
        { ...zero, sourceKey: "", os: "ANDROID", help: 4, helpedEscaped: 1, direct: 4 },
      ]),
      pageRow("calme", "Page sans aide", []),
    ];
    const html = await render();
    expect(html).toContain("% sortis");
    expect(html).toMatch(/Promo TikTok .*25 % 3 sur 12 aides/);
    expect(html).toMatch(/Page sans aide .*— /);
  });

  it("aucune aide sur la période : pas de colonne « % sortis »", async () => {
    mocks.rows = [pageRow("calme", "Page sans aide", [])];
    const html = await render();
    expect(html).not.toContain("% sortis");
    expect(html).toContain("Page sans aide");
  });
});
