import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ value: undefined as unknown, ourKeys: [] as string[] }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    inviteLink: {
      findMany: vi.fn(async (a: { where: { kind: string } }) =>
        a.where.kind === "LINKAFFI" ? h.ourKeys.map((k) => ({ linkaffiCampaignKey: k })) : [],
      ),
    },
    setting: {
      findUnique: vi.fn(async (a: { where: { key: string } }) =>
        a.where.key === "linkaffi.telegramCampaigns" && h.value !== undefined
          ? { value: h.value }
          : null,
      ),
    },
  },
}));

import {
  TELEGRAM_STALE_AFTER_MS,
  loadLinkaffiTelegramClicks,
  loadTelegramCampaignsView,
  telegramCampaignClicks,
  telegramCampaignsView,
} from "./telegram-campaigns";

const NOW = new Date("2026-10-14T12:00:00Z");

const entry = (over: Record<string, unknown> = {}) => ({
  affiliateId: "aff-paul",
  affiliateName: "Paul",
  name: "Paul VIP",
  inviteLinkId: "link-paul",
  channelId: "chan-1",
  isActive: true,
  clicks: 57,
  registrations: 4,
  ftds: 2,
  members: 10,
  ours: { members: 10, registrations: 4, ftds: 2 },
  linkaffi: true,
  platform: true,
  clicksCheckedAt: "2026-10-14T11:58:00.000Z",
  ...over,
});

const setting = (over: Record<string, unknown> = {}) => ({
  version: 1,
  syncedAt: "2026-10-14T11:58:00.000Z",
  checkedAt: "2026-10-14T11:58:00.000Z",
  available: true,
  error: null,
  sources: { campaigns: "campaigns", members: true, registrations: "players", clicks: "clicks" },
  campaigns: { tgPaul01: entry() },
  divergences: [],
  ...over,
});

describe("vue des campagnes Telegram des affiliés", () => {
  it("jamais relu (réglage absent ou illisible) : « pas encore comparé », sans erreur", () => {
    for (const v of [undefined, null, "x", 3, []]) {
      const view = telegramCampaignsView(v, NOW);
      expect(view).toMatchObject({
        status: "never",
        available: false,
        campaignCount: 0,
        divergences: [],
        stale: false,
      });
    }
  });

  it("Link Affi ne donne rien encore : indisponible, aucun chiffre manquant listé", () => {
    const view = telegramCampaignsView(
      setting({
        available: false,
        sources: { campaigns: null, members: false, registrations: null, clicks: null },
        campaigns: {
          tgPaul01: entry({ clicks: null, members: null, registrations: null, ftds: null }),
        },
      }),
      NOW,
    );
    expect(view).toMatchObject({
      status: "unavailable",
      comparedCount: 0,
      campaignCount: 1,
      missing: [],
    });
    expect(telegramCampaignClicks(view, "tgPaul01")).toBeNull();
  });

  it("tout concorde : « ok », campagnes comparées, clics lisibles", () => {
    const view = telegramCampaignsView(setting(), NOW);
    expect(view).toMatchObject({ status: "ok", comparedCount: 1, missing: [], stale: false });
    expect(view.syncedAt?.toISOString()).toBe("2026-10-14T11:58:00.000Z");
    expect(telegramCampaignClicks(view, "tgPaul01")).toBe(57);
    expect(telegramCampaignClicks(view, "inconnue")).toBeNull();
  });

  it("écarts : libellés du client, terme technique au survol, nom de campagne ou clé, campagne inconnue chez nous", () => {
    const view = telegramCampaignsView(
      setting({
        campaigns: {
          tgPaul01: entry(),
          autreCle: entry({ name: null, affiliateName: null, platform: false, linkaffi: false }),
        },
        divergences: [
          { campaignKey: "tgPaul01", field: "members", ours: 15, theirs: 10 },
          { campaignKey: "autreCle", field: "ftds", ours: 0, theirs: 1 },
          { campaignKey: "tgPaul01", field: "bizarre", ours: 1, theirs: 2 },
        ],
      }),
      NOW,
    );
    expect(view.status).toBe("divergent");
    expect(view.divergences).toEqual([
      {
        id: "tgPaul01:members:0",
        campaignKey: "tgPaul01",
        campaignLabel: "Paul VIP",
        affiliateName: "Paul",
        unknownHere: false,
        field: "members",
        label: "Membres",
        term: null,
        ours: 15,
        theirs: 10,
        gap: 5,
      },
      {
        id: "autreCle:ftds:1",
        campaignKey: "autreCle",
        campaignLabel: "autreCle",
        affiliateName: null,
        unknownHere: true,
        field: "ftds",
        label: "Premiers dépôts",
        term: "FTD",
        ours: 0,
        theirs: 1,
        gap: -1,
      },
    ]);
  });

  it("chiffres partiels : ce que Link Affi ne donne pas encore est nommé", () => {
    const view = telegramCampaignsView(
      setting({
        sources: { campaigns: null, members: true, registrations: null, clicks: null },
        campaigns: { tgPaul01: entry({ clicks: null, registrations: null, ftds: null }) },
      }),
      NOW,
    );
    expect(view.status).toBe("ok");
    expect(view.missing).toEqual(["inscriptions et premiers dépôts", "clics"]);
    expect(view.comparedCount).toBe(1);
  });

  it("dernier essai en échec : raison gardée, chiffres de la dernière lecture réussie toujours là", () => {
    const view = telegramCampaignsView(
      setting({ error: "Link Affi ne répond pas pour l'instant : nouvel essai dans 10 minutes." }),
      NOW,
    );
    expect(view.status).toBe("error");
    expect(view.error).toMatch(/ne répond pas/);
    expect(telegramCampaignClicks(view, "tgPaul01")).toBe(57);
  });

  it("comparaison en retard après trois passages manqués", () => {
    const old = new Date(NOW.getTime() - TELEGRAM_STALE_AFTER_MS - 1000).toISOString();
    expect(telegramCampaignsView(setting({ checkedAt: old }), NOW).stale).toBe(true);
    const recent = new Date(NOW.getTime() - 20 * 60_000).toISOString();
    expect(telegramCampaignsView(setting({ checkedAt: recent }), NOW).stale).toBe(false);
  });

  it("lecture en base : vue et clics par clé", async () => {
    h.value = undefined;
    expect((await loadTelegramCampaignsView(NOW)).status).toBe("never");
    expect((await loadLinkaffiTelegramClicks()).size).toBe(0);
    h.value = setting({
      campaigns: { tgPaul01: entry(), tgZoe001: entry({ clicks: null }) },
    });
    expect((await loadTelegramCampaignsView(NOW)).status).toBe("ok");
    expect([...(await loadLinkaffiTelegramClicks())]).toEqual([
      ["tgPaul01", 57],
      ["tgZoe001", null],
    ]);
  });
});

describe("forme minimale du réglage (données de démonstration, ancienne synchro)", () => {
  // Forme D6 sans `sources`, `checkedAt`, `platform` ni `ours`, comme packages/db/prisma/demo-seed.ts.
  const minimal = {
    syncedAt: "2026-10-14T11:57:00.000Z",
    available: true,
    campaigns: {
      demotgpaul01: {
        affiliateId: "aff-paul",
        affiliateName: "Paul",
        name: "Paul — Telegram",
        inviteLinkId: "link-paul",
        channelId: "chan-1",
        isActive: true,
        clicks: 41,
        members: 12,
        registrations: 4,
        ftds: 1,
      },
      inconnue01: {
        affiliateId: "aff-zoe",
        affiliateName: "Zoé",
        name: "Zoé — Telegram",
        inviteLinkId: "link-zoe",
        clicks: 5,
        members: 2,
        registrations: 0,
        ftds: 0,
      },
    },
    divergences: [
      { campaignKey: "demotgpaul01", field: "ftds", ours: 2, theirs: 1 },
      { campaignKey: "inconnue01", field: "members", ours: 0, theirs: 2 },
    ],
  };

  it("campagne dont nous avons le lien : jamais « inconnue ici » ; chiffres présents : rien d'annoncé comme manquant", async () => {
    h.value = minimal;
    h.ourKeys = ["demotgpaul01"];
    const view = await loadTelegramCampaignsView(NOW);
    expect(view.status).toBe("divergent");
    expect(view.missing).toEqual([]);
    expect(view.checkedAt?.toISOString()).toBe("2026-10-14T11:57:00.000Z");
    const byKey = Object.fromEntries(view.divergences.map((d) => [d.campaignKey, d]));
    expect(byKey.demotgpaul01).toMatchObject({ unknownHere: false, field: "ftds", gap: 1 });
    // Lien annoncé par le réglage mais absent de chez nous : la base décide.
    expect(byKey.inconnue01).toMatchObject({ unknownHere: true });
    expect(telegramCampaignClicks(view, "demotgpaul01")).toBe(41);
  });

  it("nos liens d'affiliés font foi, même contre un repère écrit", () => {
    const value = setting({
      campaigns: {
        tgPaul01: entry({ platform: false }),
        autreCle: entry({ platform: true }),
      },
      divergences: [
        { campaignKey: "tgPaul01", field: "members", ours: 15, theirs: 10 },
        { campaignKey: "autreCle", field: "members", ours: 15, theirs: 10 },
      ],
    });
    const view = telegramCampaignsView(value, NOW, new Set(["tgPaul01"]));
    expect(view.divergences.map((d) => [d.campaignKey, d.unknownHere])).toEqual([
      ["tgPaul01", false],
      ["autreCle", true],
    ]);
  });
});
