import { describe, expect, it, vi } from "vitest";

// Aucune base dans ces tests : seules les regles pures sont verifiees.
vi.mock("@linkaffipro/db", () => ({ prisma: {}, Prisma: {} }));

const { recipientAllowedFrom } = await import("./welcome-dm");

describe("DM de bienvenue d'un compte reel", () => {
  const alive = { anonymizedAt: null };
  const gone = { anonymizedAt: new Date() };
  it("membre normal : envoye", () => {
    expect(recipientAllowedFrom(42n, alive, alive)).toBe(true);
    expect(recipientAllowedFrom(42n, alive, null)).toBe(true);
  });
  it("membre anonymise : jamais rien envoye", () => {
    expect(recipientAllowedFrom(-42n, null, null)).toBe(false);
    expect(recipientAllowedFrom(42n, gone, null)).toBe(false);
    expect(recipientAllowedFrom(42n, null, gone)).toBe(false);
    expect(recipientAllowedFrom(42n, alive, gone)).toBe(false);
    // Identifiant remplace par l'anonymisation et aucune adhesion : plus personne a qui ecrire.
    expect(recipientAllowedFrom(42n, null, null)).toBe(false);
  });
});
