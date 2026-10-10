import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Page Messages rendue côté serveur avec une base simulée : calendrier (filtres, semaine, meilleurs créneaux),
// liste (5 colonnes, export), galerie de modèles (univers, thème).
const mocks = vi.hoisted(() => ({
  listCalendarPosts: vi.fn(async (_opts: unknown) => [] as unknown[]),
  listPosts: vi.fn(async (_opts: unknown) => ({ rows: [] as unknown[], total: 0, pages: 1 })),
  settings: vi.fn(async (_args: unknown) => [] as unknown[]),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    channel: {
      findMany: vi.fn(async () => [{ id: "ch1", title: "Mediatheque", vertical: "CASINO" }]),
    },
    messageCategory: {
      findMany: vi.fn(async () => [{ id: "cat1", name: "Promo", color: "#000000" }]),
    },
    setting: { findMany: mocks.settings },
  },
}));
vi.mock("@/lib/dashboard/campaign-scope", () => ({ campaignScope: vi.fn() }));
vi.mock("@/lib/campaigns/queries", () => ({
  listCampaignOptions: vi.fn(async () => [{ id: "c1", name: "TT-casino" }]),
}));
vi.mock("@/lib/posts/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posts/queries")>()),
  listCalendarPosts: mocks.listCalendarPosts,
  listPosts: mocks.listPosts,
}));
vi.mock("@/app/(admin)/messages/move-action", () => ({ movePostAction: vi.fn() }));
vi.mock("@/app/(admin)/channels/[id]/actions", () => ({ recomputeBestHoursAction: vi.fn() }));
vi.mock("@/components/admin/remember-filters", () => ({ RememberFilters: () => null }));

import MessagesPage from "./page";

async function render(sp: Record<string, string>): Promise<string> {
  const el = await MessagesPage({ searchParams: Promise.resolve(sp) } as never);
  return renderToStaticMarkup(el);
}

/** Meilleurs horaires du canal ch1 (format du worker) : mardi 19 h devant samedi 20 h. */
const bestHours = {
  key: "besthours.ch1",
  value: {
    channelId: "ch1",
    weeks: 8,
    minPosts: 3,
    posts: 9,
    computedAt: "2026-10-09T04:00:00.000Z",
    categories: {
      all: {
        posts: 9,
        cells: [
          {
            day: 2,
            hour: 19,
            posts: 3,
            views: 0,
            clicks: 12,
            uniqueClickers: 0,
            reactions: 0,
            ctr: null,
            clicksPerPost: 4,
            reactionsPerPost: 0,
          },
          {
            day: 6,
            hour: 20,
            posts: 3,
            views: 0,
            clicks: 6,
            uniqueClickers: 0,
            reactions: 0,
            ctr: null,
            clicksPerPost: 2,
            reactionsPerPost: 0,
          },
          {
            day: 4,
            hour: 12,
            posts: 3,
            views: 0,
            clicks: 3,
            uniqueClickers: 0,
            reactions: 0,
            ctr: null,
            clicksPerPost: 1,
            reactionsPerPost: 0,
          },
        ],
        recommendation: null,
      },
    },
  },
};

beforeEach(() => {
  mocks.listCalendarPosts.mockClear();
  mocks.listPosts.mockClear();
  mocks.settings.mockReset();
  mocks.settings.mockResolvedValue([]);
});

describe("page Messages : un seul bouton principal", () => {
  it("« Programmer un message » est le seul bouton orange ; la vue choisie n'est pas orange", async () => {
    const html = await render({});
    expect(html).toContain("Programmer un message");
    expect(html.match(/bg-brand text-brand-foreground/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>(<svg[^>]*>.*?<\/svg>)?Calendrier/);
  });
});

describe("page Messages : calendrier", () => {
  it("« Semaine du 5 au 11 octobre » en entier (plus de date tronquée)", async () => {
    const html = await render({ week: "2026-10-07" });
    expect(html).toContain("Semaine du 5 au 11 octobre");
    expect(html).not.toContain("Semaine du 05/10/20");
  });
  it("applique la campagne choisie (paramètre campaignId) et la garde dans la navigation", async () => {
    const html = await render({ campaignId: "c1", week: "2026-10-05" });
    expect(mocks.listCalendarPosts).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c1" }),
    );
    expect(html).toMatch(/<select[^>]*name="campaignId"/);
    expect(html).toContain("TT-casino");
    expect(html).toMatch(/Semaine précédente/);
    expect(html).toMatch(/href="\/messages\?week=2026-09-28&amp;campaignId=c1"/);
    expect(html).toMatch(/href="\/messages\?week=2026-10-12&amp;campaignId=c1"/);
  });
  it("l'ancien paramètre « campaign » reste accepté", async () => {
    await render({ view: "calendar", campaign: "c1" });
    expect(mocks.listCalendarPosts).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c1" }),
    );
  });
  it("filtres canal, univers et catégorie", async () => {
    await render({ channelId: "ch1", vertical: "CASINO", category: "cat1" });
    expect(mocks.listCalendarPosts).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "ch1", vertical: "CASINO", categoryId: "cat1" }),
    );
  });
  it("/messages?channelId=<id> (ancien onglet « Meilleurs horaires ») montre les créneaux du canal", async () => {
    mocks.settings.mockResolvedValue([bestHours]);
    const html = await render({ channelId: "ch1", week: "2026-10-05" });
    expect(mocks.settings).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { in: ["besthours.ch1"] } } }),
    );
    expect(html).toContain("Meilleurs créneaux (d&#x27;après vos clics)");
    expect(html).toContain("mardi 19 h");
    // « Programmer un message à ce créneau » pré-remplit le canal.
    expect(html).toMatch(/href="\/messages\/new\?at=[0-9-]+T19%3A00&amp;channel=ch1"/);
    // Le bouton principal garde le canal filtré.
    expect(html).toContain('href="/messages/new?channel=ch1"');
    // Date du calcul et « Recalculer maintenant » (ancien onglet de la fiche canal).
    expect(html).toContain("Calculés le");
    expect(html).toContain("Recalculer maintenant");
  });
  it("sans données : une phrase claire au lieu des créneaux", async () => {
    const html = await render({});
    expect(html).toContain("Pas encore assez de messages envoyés pour conseiller des créneaux");
  });
});

describe("page Messages : liste", () => {
  it("le lien d'export transmet campaignId", async () => {
    const html = await render({ view: "list", campaignId: "c1" });
    expect(mocks.listPosts).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ campaignId: "c1" }) }),
    );
    expect(html).toMatch(/href="\/messages\/export\?campaignId=c1"/);
    expect(html).toMatch(/<select[^>]*name="campaignId"/);
  });
  it("5 colonnes au plus : message, canal, date, statut, clics", async () => {
    mocks.listPosts.mockResolvedValueOnce({
      rows: [
        {
          id: "p1",
          text: "<b>Bonus</b> du soir",
          status: "SCHEDULED",
          scheduledAt: new Date("2026-10-06T17:00:00Z"),
          sentAt: null,
          abGroupId: null,
          abVariant: null,
          buttons: [],
          mediaAssetIds: [],
          channel: { title: "Mediatheque", vertical: "CASINO" },
          category: null,
          stats: { clicks: 12 },
        },
      ],
      total: 1,
      pages: 1,
    });
    const html = await render({ view: "list" });
    const headers = html.match(/<th[^>]*scope="col"/g) ?? [];
    expect(headers).toHaveLength(5);
    expect(html).toContain("Bonus du soir");
    expect(html).toContain("12");
  });
});

describe("page Messages : liste lisible", () => {
  it("titre et corps séparés par « · », date et état sous l'extrait (téléphone), « Effacer les filtres »", async () => {
    mocks.listPosts.mockResolvedValueOnce({
      rows: [
        {
          id: "p2",
          channelId: "ch1",
          text: "<b>Rappel</b>\nVotre bonus expire à minuit",
          status: "DRAFT",
          isTemplate: false,
          scheduledAt: null,
          sentAt: null,
          abGroupId: null,
          abVariant: null,
          buttons: [],
          mediaAssetIds: [],
          channel: { title: "Mediatheque", vertical: "CASINO" },
          category: null,
          stats: null,
        },
      ],
      total: 1,
      pages: 1,
    });
    const html = await render({ view: "list", status: "DRAFT" });
    expect(html).toContain("Rappel · Votre bonus expire à minuit");
    expect(html).toContain("Sans date · Brouillon");
    // La ligne ouvre le même volet que le calendrier (bouton de la première cellule).
    expect(html).toContain('data-open-post="p2"');
    expect(html).toContain("Effacer les filtres");
    expect(html).not.toContain("Réinitialiser");
  });
});

describe("page Messages : galerie de modèles", () => {
  it("filtres univers et thème en pastilles", async () => {
    const html = await render({ view: "templates", theme: "bonus" });
    expect(mocks.listPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "templates",
        filters: expect.objectContaining({ theme: "bonus" }),
      }),
    );
    expect(html).toContain("Preuve de gains");
    expect(html).toContain("Paris sportifs");
    expect(html).toMatch(
      /href="\/messages\?view=templates&amp;theme=bonus"[^>]*aria-current="true"|aria-current="true"[^>]*href="\/messages\?view=templates&amp;theme=bonus"/,
    );
  });
  it("une carte par modèle avec « Utiliser »", async () => {
    mocks.listPosts.mockResolvedValueOnce({
      rows: [
        {
          id: "t1",
          code: "modele:casino:bonus:1",
          templateName: "Casino · Bonus · Bonus du week-end",
          text: "Le bonus du week-end est là",
          vertical: "CASINO",
          buttons: [],
          mediaAssetIds: [],
          category: null,
          channel: { title: "Mediatheque", vertical: "CASINO" },
        },
      ],
      total: 1,
      pages: 1,
    });
    const html = await render({ view: "templates" });
    expect(html).toContain("Bonus du week-end");
    expect(html).toContain('href="/messages/new?from=t1"');
    expect(html).toContain("Utiliser");
  });
  it("aucun modèle : pas de renvoi vers une commande technique", async () => {
    const html = await render({ view: "templates" });
    expect(html).toContain("Aucun modèle");
    expect(html).not.toContain("pnpm");
    expect(html).not.toContain("seed:templates");
  });
});
