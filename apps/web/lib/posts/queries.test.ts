import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(async (_args: unknown) => 0),
  findMany: vi.fn(async (_args: unknown) => [] as unknown[]),
  campaignScope: vi.fn(async (_id: string) => ({
    channelIds: ["ch1"],
    inviteLinkIds: [],
    trackingLinkIds: [],
    affiliateCampaignIds: ["aff1"],
  })),
  channelFindUnique: vi.fn(async (_args: unknown) => null as unknown),
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    post: { count: mocks.count, findMany: mocks.findMany },
    channel: { findUnique: mocks.channelFindUnique },
  },
}));
vi.mock("@/lib/dashboard/campaign-scope", () => ({ campaignScope: mocks.campaignScope }));

import {
  listCalendarPosts,
  listPosts,
  parsePostListFilters,
  postListQuery,
  postListWhere,
  TEMPLATE_THEMES,
  templateListWhere,
  templateThemeOf,
} from "./queries";
// Bibliothèque de modèles (script `pnpm seed:templates`) : fonctions pures, aucun accès base à l'import.
import { buildTemplateRows, THEME_LABELS } from "../../../../packages/db/prisma/seed-templates";

const base = { channelId: "", status: "", categoryId: "", from: "", to: "" };

beforeEach(() => {
  mocks.count.mockClear();
  mocks.findMany.mockClear();
  mocks.campaignScope.mockClear();
  mocks.channelFindUnique.mockReset();
  mocks.channelFindUnique.mockResolvedValue(null);
});

describe("filtre « Campagne » de la liste des messages", () => {
  it("sans campagne : aucune condition supplémentaire", () => {
    expect(postListWhere(base)).toEqual({ isTemplate: false });
  });
  it("avec campagne : messages de ses canaux ou portant un bouton vers ses offres (ou un lien rattaché)", () => {
    const w = postListWhere(
      { ...base, campaignId: "c1" },
      {
        channelIds: ["ch1"],
        inviteLinkIds: [],
        trackingLinkIds: [],
        affiliateCampaignIds: ["aff1"],
      },
    );
    expect(w.isTemplate).toBe(false);
    const and = w.AND as Array<{ OR: unknown[] }>;
    expect(and[0]!.OR).toEqual([
      { trackingLinks: { some: { campaignId: "c1" } } },
      { channelId: { in: ["ch1"] } },
      { trackingLinks: { some: { affiliateCampaignId: { in: ["aff1"] } } } },
    ]);
  });
  it("se combine avec les autres filtres", () => {
    const w = postListWhere(
      { ...base, channelId: "ch2", status: "SENT", campaignId: "c1" },
      { channelIds: ["ch1"], inviteLinkIds: [], trackingLinkIds: [], affiliateCampaignIds: [] },
    );
    expect(w.channelId).toBe("ch2");
    expect(w.status).toBe("SENT");
    expect(w.AND).toHaveLength(1);
  });
});

describe("paramètres de l'URL (page Messages et export CSV)", () => {
  it("lit campaignId", () => {
    const f = parsePostListFilters(new URLSearchParams("campaignId=c1&channel=ch1&status=SENT"));
    expect(f).toMatchObject({ campaignId: "c1", channelId: "ch1", status: "SENT" });
  });
  it("garde « campaign » comme alias de campaignId", () => {
    expect(parsePostListFilters(new URLSearchParams("campaign=c2")).campaignId).toBe("c2");
    expect(parsePostListFilters({ campaign: "c3" }).campaignId).toBe("c3");
  });
  it("campaignId l'emporte sur l'alias", () => {
    expect(parsePostListFilters({ campaignId: "c1", campaign: "c2" }).campaignId).toBe("c1");
  });
  it("accepte les paramètres de page Next (valeurs multiples : la première compte)", () => {
    const f = parsePostListFilters({
      campaignId: ["c1", "c2"],
      theme: "bonus",
      vertical: "CASINO",
    });
    expect(f).toMatchObject({ campaignId: "c1", theme: "bonus", vertical: "CASINO" });
  });
  it("le lien d'export porte le filtre campagne sous le nom campaignId", () => {
    const q = postListQuery({ ...base, campaignId: "c1", channelId: "ch1" });
    expect(new URLSearchParams(q).get("campaignId")).toBe("c1");
    expect(new URLSearchParams(q).get("campaign")).toBeNull();
    expect(new URLSearchParams(q).get("channel")).toBe("ch1");
    // Aller-retour : ce que la page écrit, l'export le relit à l'identique.
    expect(parsePostListFilters(new URLSearchParams(q))).toMatchObject({
      campaignId: "c1",
      channelId: "ch1",
    });
  });
});

describe("vue « Modèles » : univers et thème (sans catégorie)", () => {
  it("liste les 7 thèmes de la bibliothèque", () => {
    expect(TEMPLATE_THEMES.map((t) => t.slug)).toEqual([
      "bonus",
      "preuve-de-gains",
      "teasing",
      "rappel",
      "information",
      "evenement",
      "sondage",
    ]);
    expect(TEMPLATE_THEMES.find((t) => t.slug === "evenement")?.label).toBe("Événement");
  });
  it("univers + thème : code qui commence par modele:<univers>:<thème>:", () => {
    expect(templateListWhere({ vertical: "CASINO", theme: "bonus" })).toEqual({
      isTemplate: true,
      vertical: "CASINO",
      code: { startsWith: "modele:casino:bonus:" },
    });
  });
  it("thème seul : le thème dans chacun des univers", () => {
    expect(templateListWhere({ theme: "rappel" })).toEqual({
      isTemplate: true,
      OR: [
        { code: { startsWith: "modele:casino:rappel:" } },
        { code: { startsWith: "modele:sports:rappel:" } },
        { code: { startsWith: "modele:dating:rappel:" } },
      ],
    });
  });
  it("thème inconnu ou univers inconnu : ignorés", () => {
    expect(templateListWhere({ vertical: "POKER", theme: "%" })).toEqual({ isTemplate: true });
  });
  it("ne filtre plus par catégorie", () => {
    const w = templateListWhere({ vertical: "", theme: "", categoryId: "cat1" } as never);
    expect(w).toEqual({ isTemplate: true });
  });
  it("retrouve le thème d'un modèle de la bibliothèque à partir de son code", () => {
    expect(templateThemeOf("modele:sports:preuve-de-gains:2")).toEqual({
      slug: "preuve-de-gains",
      label: "Preuve de gains",
    });
    expect(templateThemeOf("AB12CD")).toBeNull();
    expect(templateThemeOf("modele:casino:inconnu:1")).toBeNull();
  });
  it("tri des modèles par nom (plus par ordre de catégorie)", async () => {
    await listPosts({ view: "templates", filters: { ...base, theme: "bonus" }, page: 1 });
    const args = mocks.findMany.mock.calls[0]![0] as { orderBy: unknown[]; where: unknown };
    expect(args.orderBy).toEqual([{ templateName: "asc" }, { createdAt: "asc" }]);
    expect(JSON.stringify(args.orderBy)).not.toContain("category");
    expect(mocks.campaignScope).not.toHaveBeenCalled();
  });
});

// Garde-fou : la table des thèmes du site doit rester identique à celle de la bibliothèque de modèles
// (`pnpm seed:templates`). Sinon un thème ajouté d'un seul côté disparaît du filtre « Thème » et la colonne
// Thème affiche « — » pour ses modèles.
describe("thèmes du site = thèmes de la bibliothèque de modèles", () => {
  it("même liste, même ordre, mêmes libellés que THEME_LABELS (seed-templates)", () => {
    expect(TEMPLATE_THEMES).toEqual(
      Object.entries(THEME_LABELS).map(([slug, label]) => ({ slug, label })),
    );
  });
  it("chaque modèle de la bibliothèque est reconnu par le filtre et la colonne Thème", () => {
    const rows = buildTemplateRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const theme = templateThemeOf(row.code);
      expect(theme, row.code).not.toBeNull();
      // Le libellé affiché est celui du nom du modèle « <Univers> · <Thème> · <titre> ».
      expect(row.templateName.split(" · ")[1]).toBe(theme!.label);
      const where = templateListWhere({ vertical: row.vertical, theme: theme!.slug }) as {
        code?: { startsWith: string };
      };
      expect(row.code.startsWith(where.code!.startsWith)).toBe(true);
    }
  });
});

describe("vue « Calendrier » : même filtre Campagne que la liste", () => {
  const weekStart = new Date("2026-10-05T00:00:00+02:00");
  const weekEnd = new Date("2026-10-12T00:00:00+02:00");

  it("sans campagne : messages de la semaine seulement", async () => {
    await listCalendarPosts({ weekStart, weekEnd });
    const args = mocks.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ isTemplate: false, scheduledAt: { gte: weekStart, lt: weekEnd } });
    expect(mocks.campaignScope).not.toHaveBeenCalled();
  });
  it("avec campagne : périmètre de la campagne (canaux, offres, liens) + semaine", async () => {
    await listCalendarPosts({ weekStart, weekEnd, campaignId: "c1" });
    expect(mocks.campaignScope).toHaveBeenCalledWith("c1");
    const args = mocks.findMany.mock.calls[0]![0] as {
      where: { isTemplate: boolean; scheduledAt: unknown; AND: Array<{ OR: unknown[] }> };
    };
    expect(args.where.isTemplate).toBe(false);
    expect(args.where.scheduledAt).toEqual({ gte: weekStart, lt: weekEnd });
    expect(args.where.AND[0]!.OR).toEqual([
      { trackingLinks: { some: { campaignId: "c1" } } },
      { channelId: { in: ["ch1"] } },
      { trackingLinks: { some: { affiliateCampaignId: { in: ["aff1"] } } } },
    ]);
  });
});

// Bot qui publie dans un canal : tests déplacés avec la règle dans packages/db/src/posting.test.ts (phase 19).
