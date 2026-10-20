import { describe, expect, it, vi } from "vitest";

// Aucune base dans ces tests : seules les regles pures sont verifiees.
vi.mock("@linkaffipro/db", () => ({ prisma: {}, Prisma: {} }));

const { offerLabel, offerSlug, offerUrl, offerUsable } = await import("./offer-link");
const worker = await import("../../worker/src/assistant/rules");

describe("lien d'offre du userbot", () => {
  it("meme nom court et meme libelle que le worker (un seul lien suivi par persona et par offre)", () => {
    expect(offerSlug("persona1", "offre1")).toBe(worker.assistantOfferSlug("persona1", "offre1"));
    expect(offerLabel("Lea")).toBe(worker.assistantOfferLabel("Lea"));
  });

  it("meme adresse que le worker", () => {
    for (const env of [
      {},
      { TRACKING_BASE_URL: "https://x.test/" },
      { TRACKING_HOST: "https://y.test/" },
    ])
      expect(offerUrl("ABC", env)).toBe(worker.assistantOfferUrl("ABC", env));
    expect(offerUrl("ABC", {})).toBe("https://go.goolink.eu/a/ABC");
  });

  it("offre exploitable : campagne active ET modele d'URL non vide", () => {
    expect(offerUsable({ isActive: true, trackingUrlTemplate: "https://o.test/?s={subid}" })).toBe(
      true,
    );
    expect(offerUsable({ isActive: false, trackingUrlTemplate: "https://o.test" })).toBe(false);
    expect(offerUsable({ isActive: true, trackingUrlTemplate: "  " })).toBe(false);
    expect(offerUsable(null)).toBe(false);
  });
});
