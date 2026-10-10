import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  text: string;
  categoryId: string | null;
  stats: {
    views: number;
    clicks: number;
    uniqueClickers: number;
    ftds: number;
    registrations: number;
  };
};
const db = vi.hoisted(() => ({ rows: [] as Row[], calls: [] as Array<Record<string, unknown>> }));

// findMany simulé : applique le filtre de catégorie et le seuil minimal comme la vraie requête.
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    post: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        db.calls.push(args.where);
        const cat = args.where.categoryId as string | undefined;
        return db.rows.filter(
          (r) =>
            (cat === undefined || r.categoryId === cat) &&
            (r.stats.clicks >= 5 || (r.stats.views >= 100 && r.stats.clicks >= 1)),
        );
      }),
    },
  },
}));

import { hasEnoughData, loadBestExamples, rankExamples } from "./examples";

const s = (views: number, clicks: number, uniqueClickers: number, ftds = 0) => ({
  views,
  clicks,
  uniqueClickers,
  ftds,
  registrations: 0,
});

beforeEach(() => {
  db.rows = [];
  db.calls = [];
});

describe("« Ce qui marche chez vous » : seuil, tri et repli", () => {
  it("seuil minimal : au moins 5 clics, ou au moins 100 vues avec un clic", () => {
    expect(hasEnoughData(s(0, 4, 4))).toBe(false);
    expect(hasEnoughData(s(0, 5, 3))).toBe(true);
    expect(hasEnoughData(s(99, 2, 2))).toBe(false);
    expect(hasEnoughData(s(100, 1, 1))).toBe(true);
    expect(hasEnoughData(s(500, 0, 0))).toBe(false);
  });
  it("trie par taux (cliqueurs uniques / vues) puis FTD, et non par clics bruts", () => {
    const ranked = rankExamples([
      { text: "gros volume, faible taux", stats: s(10_000, 200, 150) },
      { text: "petit volume, fort taux", stats: s(200, 30, 30) },
      { text: "même taux, plus de FTD", stats: s(200, 30, 30, 4) },
    ]);
    expect(ranked.map((r) => r.text)).toEqual([
      "même taux, plus de FTD",
      "petit volume, fort taux",
      "gros volume, faible taux",
    ]);
  });
  it("sans vues connues : classés après, par clics puis FTD", () => {
    const ranked = rankExamples([
      { text: "sans vues 8 clics", stats: s(0, 8, 8) },
      { text: "avec vues", stats: s(100, 5, 5) },
      { text: "sans vues 12 clics", stats: s(0, 12, 12) },
    ]);
    expect(ranked.map((r) => r.text)).toEqual([
      "avec vues",
      "sans vues 12 clics",
      "sans vues 8 clics",
    ]);
  });
  it("ignore les messages sous le seuil (un seul clic ne suffit plus)", async () => {
    db.rows = [{ text: "un clic", categoryId: "c1", stats: s(10, 1, 1) }];
    expect(await loadBestExamples({ vertical: "CASINO", categoryId: "c1" })).toEqual([]);
    // Le seuil est appliqué dans la requête elle-même (pas seulement après coup).
    expect(db.calls[0]!.stats).toEqual({
      is: { OR: [{ clicks: { gte: 5 } }, { views: { gte: 100 }, clicks: { gte: 1 } }] },
    });
  });
  it("complète avec l'univers sans catégorie quand la catégorie manque de données", async () => {
    db.rows = [
      { text: "catégorie", categoryId: "c1", stats: s(100, 10, 10) },
      { text: "univers A", categoryId: null, stats: s(100, 20, 20) },
      { text: "univers B", categoryId: "c2", stats: s(0, 9, 9) },
    ];
    const out = await loadBestExamples({ vertical: "CASINO", categoryId: "c1" });
    expect(out.map((e) => e.text)).toEqual(["catégorie", "univers A", "univers B"]);
    expect(out[0]!.note).toBe("10 % de clics");
    expect(db.calls).toHaveLength(2);
  });
  it("garde les messages sans templateName (NULL) et n'écarte que les conteneurs d'envois groupés", async () => {
    await loadBestExamples({ vertical: "CASINO" });
    // Un `NOT startsWith` seul écarte aussi les NULL en SQL : la branche `templateName: null` doit être explicite
    // (vérifié sur base réelle dans tests/integration/ai-examples.test.ts).
    expect(db.calls[0]!.AND).toEqual([
      {
        OR: [
          { vertical: "CASINO" },
          { channel: { vertical: "CASINO" } },
          { bot: { vertical: "CASINO" } },
        ],
      },
      { OR: [{ templateName: null }, { NOT: { templateName: { startsWith: "broadcast:" } } }] },
    ]);
    expect(db.calls[0]!.NOT).toBeUndefined();
  });
  it("sans univers : aucun exemple et aucune requête", async () => {
    expect(await loadBestExamples({ vertical: null })).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
  it("écarte le brouillon lui-même et les doublons", async () => {
    db.rows = [
      { text: "Mon brouillon", categoryId: null, stats: s(100, 50, 50) },
      { text: "Autre", categoryId: null, stats: s(100, 10, 10) },
      { text: "Autre", categoryId: null, stats: s(100, 9, 9) },
    ];
    const out = await loadBestExamples({ vertical: "DATING", excludeText: " Mon brouillon " });
    expect(out.map((e) => e.text)).toEqual(["Autre"]);
  });
});
