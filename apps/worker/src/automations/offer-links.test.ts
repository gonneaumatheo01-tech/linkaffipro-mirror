import { beforeEach, describe, expect, it, vi } from "vitest";

// Bouton « Offre (campagne) » d'une relance : à l'envoi, un lien du bot propre à la relance (TrackingLink OFFER
// rattaché à la relance), le même pour tous les membres ; l'identifiant de suivi est créé par le bot au clic.

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  links: new Map<string, Record<string, unknown>>(),
  campaign: { name: "Casino octobre", affiliateCampaignIds: ["aff1", "aff2"] } as Record<
    string,
    unknown
  > | null,
  offers: [
    { id: "aff1", isActive: true, trackingUrlTemplate: "https://linkaffi.me/go/K1?sub_id={subid}" },
    { id: "aff2", isActive: true, trackingUrlTemplate: "https://linkaffi.me/go/K2?sub_id={subid}" },
  ],
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    trackingLink: {
      findUnique: vi.fn(
        async ({ where }: { where: { slug: string } }) => h.links.get(where.slug) ?? null,
      ),
      upsert: vi.fn(async ({ where, create }: { where: { slug: string }; create: Row }) => {
        const row = h.links.get(where.slug) ?? { isActive: true, ...create };
        h.links.set(where.slug, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { slug: string }; data: Row }) => {
        const row = { ...h.links.get(where.slug)!, ...data };
        h.links.set(where.slug, row);
        return row;
      }),
    },
    campaign: { findUnique: vi.fn(async () => h.campaign) },
    affiliateCampaign: { findMany: vi.fn(async () => h.offers) },
  },
}));

import { prisma } from "@linkaffipro/db";
import {
  AUTOMATION_OFFER_SLUG_LENGTH,
  automationOfferSlug,
  offerForLink,
  resolveAutomationButtons,
} from "./offer-links";

const offer = {
  text: "Voir l'offre",
  type: "OFFER" as const,
  campaignId: "camp1",
  affiliateCampaignId: "aff1",
};
const ctx = { ruleId: "rule1", ruleName: "Bienvenue", botUsername: "casinobot" };

beforeEach(() => {
  vi.clearAllMocks();
  h.links.clear();
  h.campaign = { name: "Casino octobre", affiliateCampaignIds: ["aff1", "aff2"] };
});

describe("nom court du lien Offre d'une relance", () => {
  it("stable pour (relance, campagne, offre), 10 caractères acceptés par le bot, propre à chaque relance", () => {
    const a = automationOfferSlug("rule1", "camp1", "aff1");
    expect(a).toBe(automationOfferSlug("rule1", "camp1", "aff1"));
    expect(a).toMatch(new RegExp(`^[0-9A-Za-z]{${AUTOMATION_OFFER_SLUG_LENGTH}}$`));
    expect(automationOfferSlug("rule2", "camp1", "aff1")).not.toBe(a);
    expect(automationOfferSlug("rule1", "camp1", "aff2")).not.toBe(a);
  });
});

describe("boutons d'un message de relance à l'envoi", () => {
  it("lien simple inchangé ; bouton Offre → lien du bot de la relance, créé une fois puis réutilisé", async () => {
    const rows = [[offer], [{ text: "Site", url: "https://exemple.fr" }]];
    const first = await resolveAutomationButtons(rows, ctx);
    const slug = automationOfferSlug("rule1", "camp1", "aff1");
    expect(first).toEqual({
      rows: [
        [{ text: "Voir l'offre", url: `https://t.me/casinobot?start=o${slug}` }],
        [{ text: "Site", url: "https://exemple.fr" }],
      ],
      dropped: [],
    });
    expect(prisma.trackingLink.upsert).toHaveBeenCalledTimes(1);
    expect(h.links.get(slug)).toMatchObject({
      kind: "OFFER",
      automationRuleId: "rule1",
      campaignId: "camp1",
      affiliateCampaignId: "aff1",
      destinationTemplate: "https://linkaffi.me/go/K1?sub_id={subid}",
      label: "Voir l'offre (relance « Bienvenue »)",
    });
    // Deuxième membre : même lien (l'identifiant de suivi de chacun est créé par le bot au clic).
    const second = await resolveAutomationButtons(rows, { ...ctx, botUsername: "autrebot" });
    expect(second.rows[0]![0]!.url).toBe(`https://t.me/autrebot?start=o${slug}`);
    expect(prisma.trackingLink.upsert).toHaveBeenCalledTimes(1);
  });

  it("offre retirée de la campagne : le lien prend la première offre active de la campagne", async () => {
    h.campaign = { name: "Casino octobre", affiliateCampaignIds: ["aff2"] };
    await resolveAutomationButtons([[offer]], ctx);
    expect(h.links.get(automationOfferSlug("rule1", "camp1", "aff1"))).toMatchObject({
      affiliateCampaignId: "aff2",
    });
  });

  it("campagne supprimée ou sans offre active : erreur en français (exécution en erreur, journal)", async () => {
    h.campaign = null;
    await expect(resolveAutomationButtons([[offer]], ctx)).rejects.toThrow(
      /campagne de l'offre a été supprimée/,
    );
    h.campaign = { name: "Vide", affiliateCampaignIds: [] };
    await expect(resolveAutomationButtons([[offer]], ctx)).rejects.toThrow(
      /« Vide » n'a plus d'offre active/,
    );
  });

  it("lien déjà créé puis campagne supprimée : la relance s'arrête avec la même erreur (journal)", async () => {
    await resolveAutomationButtons([[offer]], ctx);
    // Suppression de la campagne : le lien reste (Campagnes → Liens) mais n'est plus rattaché à la campagne.
    const slug = automationOfferSlug("rule1", "camp1", "aff1");
    h.links.set(slug, { ...h.links.get(slug)!, campaignId: null });
    h.campaign = null;
    await expect(resolveAutomationButtons([[offer]], ctx)).rejects.toThrow(
      /Bouton « Voir l'offre » : la campagne de l'offre a été supprimée/,
    );
  });

  it("lien déjà créé puis campagne sans offre active : erreur en français", async () => {
    await resolveAutomationButtons([[offer]], ctx);
    h.campaign = { name: "Casino octobre", affiliateCampaignIds: [] };
    await expect(resolveAutomationButtons([[offer]], ctx)).rejects.toThrow(
      /« Casino octobre » n'a plus d'offre active/,
    );
  });

  it("lien créé avec l'offre de repli : il reprend l'offre du bouton quand elle revient dans la campagne", async () => {
    h.campaign = { name: "Casino octobre", affiliateCampaignIds: ["aff2"] };
    await resolveAutomationButtons([[offer]], ctx);
    const slug = automationOfferSlug("rule1", "camp1", "aff1");
    expect(h.links.get(slug)).toMatchObject({ affiliateCampaignId: "aff2" });
    h.campaign = { name: "Casino octobre", affiliateCampaignIds: ["aff1", "aff2"] };
    await resolveAutomationButtons([[offer]], ctx);
    expect(h.links.get(slug)).toMatchObject({
      affiliateCampaignId: "aff1",
      destinationTemplate: "https://linkaffi.me/go/K1?sub_id={subid}",
    });
    // Offre inchangée : aucune écriture.
    vi.mocked(prisma.trackingLink.update).mockClear();
    await resolveAutomationButtons([[offer]], ctx);
    expect(prisma.trackingLink.update).not.toHaveBeenCalled();
  });

  it("lien désactivé par l'équipe : le bouton n'est pas envoyé et il est signalé", async () => {
    h.links.set(automationOfferSlug("rule1", "camp1", "aff1"), {
      slug: automationOfferSlug("rule1", "camp1", "aff1"),
      isActive: false,
    });
    const r = await resolveAutomationButtons(
      [[offer, { text: "Site", url: "https://exemple.fr" }]],
      ctx,
    );
    expect(r).toEqual({
      rows: [[{ text: "Site", url: "https://exemple.fr" }]],
      dropped: ["Voir l'offre"],
    });
  });

  it("choix de l'offre (règle pure)", () => {
    const offers = [
      { id: "a", isActive: true, trackingUrlTemplate: "A" },
      { id: "b", isActive: false, trackingUrlTemplate: "B" },
      { id: "c", isActive: true, trackingUrlTemplate: "C" },
    ];
    expect(offerForLink("a", ["a", "c"], offers)?.id).toBe("a");
    expect(offerForLink("b", ["b", "c"], offers)?.id).toBe("c");
    expect(offerForLink("a", ["c"], offers)?.id).toBe("c");
    expect(offerForLink("a", [], offers)).toBeNull();
  });
});
