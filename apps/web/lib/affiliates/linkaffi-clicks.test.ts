import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));

import { telegramCampaignsView } from "@/lib/linkaffi/telegram-campaigns";
import { clicksNote, linkaffiClicksFrom } from "./linkaffi-clicks";

/**
 * Clics des campagnes Telegram d'affiliés (vue « Affiliés Link Affi ») : lus dans la vue du réglage
 * « linkaffi.telegramCampaigns » donnée par le SEUL lecteur du réglage (lib/linkaffi/telegram-campaigns.ts, qui
 * s'appuie sur parseTelegramCampaignsState) : Réglages → Connexions et la vue des affiliés lisent la même chose.
 */
const NOW = new Date("2026-10-14T12:00:00Z");
const value = {
  syncedAt: "2026-10-14T10:00:00.000Z",
  available: true,
  campaigns: {
    k1: { affiliateName: "Paul", clicks: 120 },
    k2: { clicks: "15" },
    k3: { clicks: null },
    k4: "illisible",
  },
  divergences: [],
};

describe("clics Link Affi (réglage écrit par la synchro)", () => {
  it("mêmes chiffres que le lecteur commun : clics par clé, inconnu quand le chiffre manque", () => {
    const view = telegramCampaignsView(value, NOW);
    const c = linkaffiClicksFrom(view);
    expect(c.syncedAt?.toISOString()).toBe("2026-10-14T10:00:00.000Z");
    expect(c.available).toBe(true);
    expect(c.clicks).toEqual(
      Object.fromEntries(Object.entries(view.campaigns).map(([k, e]) => [k, e.clicks])),
    );
    expect(c.clicks).toMatchObject({ k1: 120, k2: 15, k3: null });
  });

  it("réglage absent ou illisible : rien de connu, jamais d'erreur", () => {
    for (const v of [null, undefined, "x", 3, [], { campaigns: [] }, { syncedAt: "pas une date" }])
      expect(linkaffiClicksFrom(telegramCampaignsView(v, NOW))).toMatchObject({
        syncedAt: null,
        available: false,
        clicks: {},
      });
  });

  it("Link Affi ne donne encore aucun clic : annoncé comme à venir", () => {
    const c = linkaffiClicksFrom(
      telegramCampaignsView({ ...value, campaigns: { k3: { clicks: null } } }, NOW),
    );
    expect(c.available).toBe(false);
  });

  it("phrase sous les chiffres", () => {
    const fmt = () => "14/10/2026 12:00";
    expect(clicksNote(linkaffiClicksFrom(telegramCampaignsView(null, NOW)), fmt)).toContain(
      "dès que Link Affi les partagera",
    );
    expect(clicksNote(linkaffiClicksFrom(telegramCampaignsView(value, NOW)), fmt)).toBe(
      "Clics : comptés par Link Affi depuis le début de chaque campagne, relus le 14/10/2026 12:00.",
    );
  });
});
