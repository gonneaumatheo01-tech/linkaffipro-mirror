/**
 * Bouton « Offre » d'un message ou d'un envoi : on choisit une de nos campagnes, qui détermine le lien Link Affi.
 * Le choix est conservé (bouton stocké + `TrackingLink.campaignId`), une campagne qui ne contient pas l'offre est
 * refusée, et tout nouveau bouton Offre exige une campagne (seuls les anciens boutons gardent leur lien direct).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn() },
  affiliateCampaign: { findUnique: vi.fn(), findMany: vi.fn() },
  trackingLink: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@linkaffipro/db", () => ({ prisma: db }));

import {
  assertButtonRows,
  copiedOfferChoice,
  materializeOfferButton as materializeWithFlag,
  offerButtonError,
} from "./offer-button";

/** Le bouton stocké (la plupart des tests) ; `relinked` est vérifié à part. */
async function materializeOfferButton(
  ...args: Parameters<typeof materializeWithFlag>
): Promise<Awaited<ReturnType<typeof materializeWithFlag>>["button"]> {
  return (await materializeWithFlag(...args)).button;
}

const offer = {
  id: "aff1",
  isActive: true,
  trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
};
const ctx = { channelId: "ch1", postId: "p1", userId: "u1" };

beforeEach(() => {
  vi.clearAllMocks();
  db.campaign.findUnique.mockResolvedValue({
    id: "camp1",
    name: "Ma campagne",
    affiliateCampaignIds: ["aff1"],
  });
  db.affiliateCampaign.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
    args.where.id === "aff1" ? offer : args.where.id === "aff2" ? { ...offer, id: "aff2" } : null,
  );
  db.affiliateCampaign.findMany.mockResolvedValue([offer, { ...offer, id: "aff2" }]);
  db.trackingLink.findUnique.mockResolvedValue(null);
  db.trackingLink.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...args.data,
    id: "tl-new",
    slug: "abcd1234",
  }));
  db.trackingLink.update.mockImplementation(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
      ...args.data,
      id: args.where.id,
      slug: "old12345",
    }),
  );
});

describe("règle pure du bouton Offre", () => {
  it("nouveau bouton sans campagne : refusé, avec un message clair", () => {
    expect(
      offerButtonError(
        { text: "Jouer", campaignId: undefined, affiliateCampaignId: "aff1" },
        { existingLink: null, campaign: null },
      ),
    ).toMatch(/choisissez une campagne/);
  });
  it("campagne qui ne contient pas l'offre : refusé", () => {
    expect(
      offerButtonError(
        { text: "Jouer", campaignId: "camp1", affiliateCampaignId: "aff9" },
        { existingLink: null, campaign: { id: "camp1", affiliateCampaignIds: ["aff1"] } },
      ),
    ).toMatch(/n'est plus dans la campagne|choisissez/);
  });
  it("ancien bouton sans campagne : accepté s'il garde son offre, refusé s'il en change", () => {
    const existingLink = { affiliateCampaignId: "aff1", campaignId: null };
    expect(
      offerButtonError(
        { text: "Jouer", affiliateCampaignId: "aff1" },
        { existingLink, campaign: null },
      ),
    ).toBeNull();
    expect(
      offerButtonError(
        { text: "Jouer", affiliateCampaignId: "aff2" },
        { existingLink, campaign: null },
      ),
    ).toMatch(/choisissez une campagne/);
  });
});

describe("matérialisation du bouton Offre", () => {
  it("garde la campagne dans le bouton stocké et l'écrit sur le lien traqué créé", async () => {
    const b = await materializeOfferButton(
      { text: "Jouer", type: "OFFER", campaignId: "camp1", affiliateCampaignId: "aff1" },
      ctx,
    );
    expect(b).toEqual({
      text: "Jouer",
      type: "OFFER",
      trackingLinkId: "tl-new",
      slug: "abcd1234",
      affiliateCampaignId: "aff1",
      campaignId: "camp1",
    });
    expect(db.trackingLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: "camp1",
          affiliateCampaignId: "aff1",
          kind: "OFFER",
        }),
      }),
    );
  });

  it("met aussi à jour la campagne d'un lien existant", async () => {
    db.trackingLink.findUnique.mockResolvedValue({
      id: "tl-old",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: null,
    });
    const b = await materializeOfferButton(
      {
        text: "Jouer",
        type: "OFFER",
        trackingLinkId: "tl-old",
        campaignId: "camp1",
        affiliateCampaignId: "aff1",
      },
      ctx,
    );
    expect(b.campaignId).toBe("camp1");
    expect(db.trackingLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tl-old" },
        data: expect.objectContaining({ campaignId: "camp1" }),
      }),
    );
  });

  it("un ancien lien d'un autre type (Lien traqué) n'est pas réutilisé : nouveau lien Offre", async () => {
    db.trackingLink.findUnique.mockResolvedValue({
      id: "tl-btn",
      kind: "BUTTON",
      affiliateCampaignId: null,
      campaignId: null,
    });
    const b = await materializeOfferButton(
      {
        text: "Jouer",
        type: "OFFER",
        trackingLinkId: "tl-btn",
        campaignId: "camp1",
        affiliateCampaignId: "aff1",
      },
      ctx,
    );
    expect(db.trackingLink.update).not.toHaveBeenCalled();
    expect(b.trackingLinkId).toBe("tl-new");
  });

  it("refuse une campagne qui ne contient pas l'offre", async () => {
    db.campaign.findUnique.mockResolvedValue({
      id: "camp1",
      name: "Ma campagne",
      affiliateCampaignIds: ["aff2"],
    });
    await expect(
      materializeOfferButton(
        { text: "Jouer", type: "OFFER", campaignId: "camp1", affiliateCampaignId: "aff1" },
        ctx,
      ),
    ).rejects.toThrow(/Ma campagne/);
    expect(db.trackingLink.create).not.toHaveBeenCalled();
  });

  it("refuse un nouveau bouton sans campagne", async () => {
    await expect(
      materializeOfferButton({ text: "Jouer", type: "OFFER", affiliateCampaignId: "aff1" }, ctx),
    ).rejects.toThrow(/choisissez une campagne/);
  });

  it("refuse une campagne supprimée", async () => {
    db.campaign.findUnique.mockResolvedValue(null);
    await expect(
      materializeOfferButton(
        { text: "Jouer", type: "OFFER", campaignId: "camp-x", affiliateCampaignId: "aff1" },
        ctx,
      ),
    ).rejects.toThrow(/choisissez une campagne/);
  });

  it("ancien bouton sans campagne qui garde son offre : accepté, sans campagne", async () => {
    db.trackingLink.findUnique.mockResolvedValue({
      id: "tl-old",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: null,
    });
    const b = await materializeOfferButton(
      { text: "Jouer", type: "OFFER", trackingLinkId: "tl-old", affiliateCampaignId: "aff1" },
      ctx,
    );
    expect(b.campaignId).toBeUndefined();
    expect(b.trackingLinkId).toBe("tl-old");
  });

  it("libellé du lien suffixé pour un message à un groupe", async () => {
    await materializeOfferButton(
      { text: "Jouer", type: "OFFER", campaignId: "camp1", affiliateCampaignId: "aff1" },
      { ...ctx, labelSuffix: " (message à un groupe)" },
    );
    expect(db.trackingLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: "Jouer (message à un groupe)" }),
      }),
    );
  });
});

describe("rattachement d'un lien existant (recalcul des statistiques)", () => {
  it("ancien lien sans campagne rattaché à une campagne : relinked", async () => {
    db.trackingLink.findUnique.mockResolvedValue({
      id: "tl-old",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: null,
    });
    const r = await materializeWithFlag(
      {
        text: "Jouer",
        type: "OFFER",
        trackingLinkId: "tl-old",
        campaignId: "camp1",
        affiliateCampaignId: "aff1",
      },
      ctx,
    );
    expect(r.relinked).toBe(true);
  });

  it("lien déjà dans la même campagne, même offre : pas de recalcul", async () => {
    db.trackingLink.findUnique.mockResolvedValue({
      id: "tl-old",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: "camp1",
    });
    const r = await materializeWithFlag(
      {
        text: "Jouer",
        type: "OFFER",
        trackingLinkId: "tl-old",
        campaignId: "camp1",
        affiliateCampaignId: "aff1",
      },
      ctx,
    );
    expect(r.relinked).toBe(false);
  });

  it("nouveau lien : pas de recalcul (aucun clic passé)", async () => {
    const r = await materializeWithFlag(
      { text: "Jouer", type: "OFFER", campaignId: "camp1", affiliateCampaignId: "aff1" },
      ctx,
    );
    expect(r.relinked).toBe(false);
  });
});

describe("copie faite par le serveur (envoi au reste d'un test A/B)", () => {
  it("ancien bouton sans campagne : accepté, nouveau lien sur la même offre, l'original intact", async () => {
    db.trackingLink.findUnique.mockResolvedValue({
      id: "tl-src",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: null,
    });
    const b = await materializeOfferButton(
      { text: "Jouer", type: "OFFER", trackingLinkId: "tl-src", affiliateCampaignId: "aff1" },
      { ...ctx, copy: true },
    );
    expect(db.trackingLink.update).not.toHaveBeenCalled();
    expect(b).toMatchObject({ trackingLinkId: "tl-new", affiliateCampaignId: "aff1" });
    expect(b.campaignId).toBeUndefined();
  });

  it("l'offre a quitté la campagne : une autre offre active de la campagne est prise", async () => {
    db.campaign.findUnique.mockResolvedValue({
      id: "camp1",
      name: "Ma campagne",
      affiliateCampaignIds: ["aff2"],
    });
    db.trackingLink.findUnique.mockResolvedValue({
      id: "tl-src",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: "camp1",
    });
    const b = await materializeOfferButton(
      {
        text: "Jouer",
        type: "OFFER",
        trackingLinkId: "tl-src",
        campaignId: "camp1",
        affiliateCampaignId: "aff1",
      },
      { ...ctx, copy: true },
    );
    expect(b).toMatchObject({ affiliateCampaignId: "aff2", campaignId: "camp1" });
    expect(db.trackingLink.update).not.toHaveBeenCalled();
  });

  it("règle pure : campagne sans offre active → message clair", () => {
    const r = copiedOfferChoice(
      { text: "Jouer", campaignId: "camp1", affiliateCampaignId: "aff1" },
      {
        sourceLink: { affiliateCampaignId: "aff1" },
        campaign: { id: "camp1", name: "Ma campagne", affiliateCampaignIds: ["aff1"] },
        offers: [{ ...offer, isActive: false }],
      },
    );
    expect(r).toEqual({ error: expect.stringMatching(/n'a plus d'offre active/) });
  });

  it("règle pure : campagne supprimée → l'offre d'origine, sans campagne", () => {
    expect(
      copiedOfferChoice(
        { text: "Jouer", campaignId: "camp-x", affiliateCampaignId: "aff1" },
        { sourceLink: { affiliateCampaignId: "aff1" }, campaign: null, offers: [] },
      ),
    ).toEqual({ offerId: "aff1", campaignId: null });
  });
});

describe("vérification préalable des boutons (aucune écriture)", () => {
  it("refuse un bouton Offre sans campagne et une adresse invalide, sans rien créer", async () => {
    await expect(
      assertButtonRows([[{ text: "Jouer", type: "OFFER", affiliateCampaignId: "aff1" }]]),
    ).rejects.toThrow(/choisissez une campagne/);
    await expect(
      assertButtonRows([[{ text: "Site", type: "URL", url: "javascript:alert(1)" }]]),
    ).rejects.toThrow(/https/);
    expect(db.trackingLink.create).not.toHaveBeenCalled();
    expect(db.trackingLink.update).not.toHaveBeenCalled();
  });

  it("accepte des boutons valables", async () => {
    await expect(
      assertButtonRows([
        [
          { text: "Site", type: "URL", url: "https://exemple.fr" },
          { text: "Jouer", type: "OFFER", campaignId: "camp1", affiliateCampaignId: "aff1" },
        ],
      ]),
    ).resolves.toBeUndefined();
  });
});
