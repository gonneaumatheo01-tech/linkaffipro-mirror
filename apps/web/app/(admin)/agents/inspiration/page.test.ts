import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, primaryButtonCount, visibleText } from "../../settings/categories/page-checks";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import type { ReferenceDetail, ReferenceRow } from "@/lib/agents/inspiration-queries";

// Pages Agents → Inspiration (liste et fiche d'une référence) rendues côté serveur avec des données simulées.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  list: [] as unknown[],
  detail: null as unknown,
  engine: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/agents/inspiration",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("./actions", () => ({ undoInspirationAction: vi.fn(), removeReferenceAction: vi.fn() }));
vi.mock("@/app/(admin)/agents/inspiration/actions", () => ({ undoInspirationAction: vi.fn(), removeReferenceAction: vi.fn() }));
vi.mock("@/lib/agents/queries", () => ({ loadPendingCounts: vi.fn(async () => ({ validations: 0, requests: 1 })) }));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/inspiration-engine", () => ({ loadInspirationEngine: vi.fn(async () => m.engine) }));
vi.mock("@/lib/agents/inspiration-queries", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/inspiration-queries")>()),
  loadInspirationList: vi.fn(async () => m.list),
  loadInspirationDetail: vi.fn(async () => m.detail),
}));
vi.mock("@linkaffipro/db", () => ({ prisma: {}, audit: vi.fn() }));

import ListPage from "./page";
import DetailPage from "./[id]/page";

const row = (o: Partial<ReferenceRow> = {}): ReferenceRow => ({
  id: "ref1",
  username: "roulette_pro",
  title: "Roulette Pro",
  via: "WEB",
  universe: "casino",
  status: "READY",
  unavailableReason: null,
  postCount: 148,
  lastReadAt: new Date("2026-10-24T08:00:00Z"),
  nextReadAt: new Date("2026-10-31T08:00:00Z"),
  createdAt: new Date("2026-10-24T07:55:00Z"),
  targets: [{ id: "c1", title: "Roulette VIP" }],
  profileVersion: 1,
  recs: { proposed: 2, applied: 1, total: 3 },
  ...o,
});

const rec = (o: Record<string, unknown>) => ({
  id: "rec1",
  teamKey: "casino",
  target: "CHANNEL_PLAN",
  targetId: "c1",
  field: "postsPerDay",
  before: 2,
  after: 4,
  evidence: { lines: ["Eux : 4,2 posts par jour sur 148 posts ; vous : 2 sur 28 jours."] },
  expectedGain: "+10 % de vues",
  size: "SMALL",
  status: "APPLIED",
  appliedAt: new Date("2026-10-24T09:00:00Z"),
  appliedBy: "HUMAN",
  undoneAt: null,
  rejectedAt: null,
  weekStart: null,
  createdAt: new Date("2026-10-24T08:30:00Z"),
  targetLabel: "Roulette VIP",
  ...o,
});

const detail = (o: Partial<ReferenceDetail> = {}): ReferenceDetail => ({
  ref: { ...row(), telegramChatId: null, accountLabel: null },
  profile: {
    id: "s1",
    version: 1,
    createdAt: new Date("2026-10-24T08:10:00Z"),
    rules: ["Une accroche en une ligne", "Un emoji au plus"],
    description: "Ton direct, phrases courtes.",
    examples: ["La roulette du soir est ouverte : à toi de jouer."],
    flagged: ["Annonce des gains garantis"],
  },
  profileStats: {
    sampleSize: 148,
    rhythm: [{ key: "postsPerDay", label: "Posts par jour", value: 4.2, sampleSize: 148 }],
    form: [],
    content: [],
    results: [],
    peakSlots: ["19:00", "21:30"],
    quotes: [],
    flagged: [],
    comparisons: [
      { channelId: "c1", channelTitle: "Roulette VIP", ourSampleSize: 30, gaps: [{ key: "ppd", label: "Posts par jour", theirs: 4.2, ours: 2, matters: true }] },
    ],
  },
  profileVersions: new Map([["s1", 1]]),
  usedBy: [{ id: "c1", title: "Roulette VIP" }],
  recs: [rec({}), rec({ id: "rec2", status: "PROPOSED", appliedAt: null, field: "mix", before: { photo: 1 }, after: { photo: 1, video: 1 } })],
  experiments: [],
  rawPosts: [],
  ...o,
});

function checks(html: string) {
  expect(h1Count(html)).toBe(1);
  expect(primaryButtonCount(html)).toBeLessThanOrEqual(1);
  const text = visibleText(html);
  expect(jargonIn(text)).toEqual([]);
  expect(text).not.toMatch(/MTProto|scraping|shingle|hash|BullMQ|worker|\bJSON\b|\bAPI\b/i);
  return text;
}
const renderList = async () => renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) } as never));
const renderDetail = async () =>
  renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "ref1" }), searchParams: Promise.resolve({}) } as never));

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.list = [row(), row({ id: "ref2", username: null, title: "Club privé", via: "FORWARDED", status: "UNAVAILABLE", unavailableReason: "private", postCount: 0, targets: [], recs: { proposed: 0, applied: 0, total: 0 } })];
  m.detail = detail();
  m.engine = {};
});

describe("Agents → Inspiration (liste)", () => {
  it("références : nom, état, voie, cibles, posts lus, propositions, liens", async () => {
    const html = await renderList();
    const text = checks(html);
    for (const t of ["Inspiration", "@roulette_pro", "Roulette Pro · Casino", "Prête", "Aperçu public", "Roulette VIP", "148", "2 à décider, 1 appliquée", "Club privé", "Illisible", "canal privé", "Posts transférés", "aucun canal choisi", "Ce qui marche"])
      expect(text).toContain(t);
    expect(html).toContain('href="/agents/inspiration/ref1"');
    expect(html).toContain('href="/agents/algo"');
    expect(html).toContain('aria-current="page"');
  });

  it("aucune référence : explication et phrase à écrire à Kevin", async () => {
    m.list = [];
    const text = checks(await renderList());
    expect(text).toContain("Aucun canal d'inspiration pour l'instant");
    expect(text).toContain("inspire-toi de t.me/… pour le canal …");
    expect(text).toContain("transférez-lui 20 à 30 posts");
  });
});

describe("Agents → Inspiration (fiche d'une référence)", () => {
  it("administrateur : référence, eux / nous, profil, propositions avec Annuler, historique, Retirer", async () => {
    const html = await renderDetail();
    const text = checks(html);
    for (const t of [
      "@roulette_pro",
      "aperçu public du canal (sans compte)",
      "t.me/roulette_pro",
      "Eux / Roulette VIP",
      "Écart qui compte",
      "4,2",
      "19:00, 21:30",
      "Une accroche en une ligne",
      "Ton direct, phrases courtes.",
      "La roulette du soir est ouverte",
      "Ce qu'on ne reproduit pas",
      "Annonce des gains garantis",
      "Lu par la Rédaction sur",
      "Posts par jour",
      "Annuler",
      "répondez à Kevin par son numéro",
      "Retirer",
      "Historique",
      "Appliqué : Posts par jour (Roulette VIP)",
    ])
      expect(text).toContain(t);
    expect(html).toContain('href="/channels/c1"');
  });

  it("responsable : lecture seule, ni Annuler ni Retirer", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const text = checks(await renderDetail());
    expect(text).not.toContain("Retirer");
    expect(text).not.toMatch(/\bAnnuler\b(?! une)/);
    expect(text).toContain("Seuls les administrateurs peuvent annuler.");
    expect(text).toContain("Une accroche en une ligne");
  });

  it("pas d'analyse ni de profil, moteur absent : chiffres bruts des posts lus et états vides", async () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({
      postedAt: new Date(Date.UTC(2026, 9, 18 + i, 17)),
      length: 120,
      mediaKind: "photo",
      views: 500,
      hasLink: false,
      hasButton: true,
      hasVipCall: i % 2 === 0,
      hasOdds: false,
    }));
    m.detail = detail({ profile: null, profileStats: null, recs: [], usedBy: [], rawPosts: posts });
    const text = checks(await renderDetail());
    expect(text).toContain("il en faut 20 au moins");
    expect(text).toContain("Heures les plus fréquentes (Paris)");
    expect(text).toContain("19 h (6 posts)");
    expect(text).toContain("photo 100 %");
    expect(text).toContain("Pas encore de profil de style");
    expect(text).toContain("Aucune proposition pour l'instant");
  });

  it("analyse calculée à l'affichage quand le moteur est là", async () => {
    m.detail = detail({ profileStats: null });
    m.engine = {
      analyzeReference: vi.fn(async () => ({
        referenceChannelId: "ref1",
        universe: "casino",
        sampleSize: 148,
        rhythm: [{ key: "ppd", label: "Posts par jour", value: 4.2, sampleSize: 148 }],
        form: [],
        content: [],
        results: [],
        peakSlots: [],
        quotes: ["un deux trois quatre cinq six sept huit neuf dix onze"],
        flagged: [],
      })),
      compareWithChannel: vi.fn(async () => ({ channelId: "c1", channelTitle: "Roulette VIP", ourSampleSize: 12, gaps: [] })),
    };
    const text = checks(await renderDetail());
    expect(text).toContain("calculés à l'instant");
    expect(text).toContain("un deux trois quatre cinq six sept huit neuf dix…");
    expect(text).not.toContain("onze");
  });

  it("référence inconnue ou retirée : page introuvable", async () => {
    m.detail = null;
    await expect(renderDetail()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
