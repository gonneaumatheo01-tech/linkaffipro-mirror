import { describe, expect, it, vi } from "vitest";

// Aucune base dans ces tests : seules les regles pures sont verifiees.
vi.mock("@linkaffipro/db", () => ({ prisma: {}, Prisma: {} }));

const { personaSkipReason, toPersonaInput } = await import("./persona");

const row = {
  id: "p1",
  name: "Léa",
  isActive: true,
  identityKind: "GIRL",
  illusion: true,
  age: 24,
  gender: "FEMALE",
  personality: "",
  tone: "",
  languages: ["fr"],
  interests: [],
  extraPrompt: null,
  model: null,
  temperature: null,
  minExchangesBeforeOffer: 4,
  requireInterest: true,
  maxOfferSends: 2,
  followUpAfterHours: 24,
  followUpsMax: 2,
  offerPitch: "",
  offerButtonText: "Voir",
  offerMediaAssetId: null,
  affiliateCampaignId: null,
  affiliateCampaign: null,
} as unknown as Parameters<typeof toPersonaInput>[0];

describe("persona d'un compte réel", () => {
  it("Rencontres : tour permis ; Casino / Paris sportifs : tour sauté (persona_universe)", () => {
    expect(personaSkipReason({ ...row, universe: "dating" })).toBeNull();
    expect(personaSkipReason({ ...row, universe: null })).toBeNull();
    expect(personaSkipReason({ ...row, universe: "casino" })).toBe("persona_universe");
    expect(personaSkipReason({ ...row, universe: "sports" })).toBe("persona_universe");
    expect(personaSkipReason({ ...row, isActive: false })).toBe("persona_inactive");
    expect(personaSkipReason(null)).toBe("no_persona");
  });
  it("univers et fiche d'informations transmis au moteur ; identité assistante imposée hors Rencontres", () => {
    const p = toPersonaInput({ ...row, universe: "casino", faq: [{ q: " Bonus ? ", a: "200 €" }] }, "Compte");
    expect(p).toMatchObject({ universe: "casino", faq: [{ q: "Bonus ?", a: "200 €" }], identity: "ASSISTANT" });
    expect(toPersonaInput(row, "Compte")).toMatchObject({ universe: "dating", faq: [], identity: "GIRL" });
  });
});
