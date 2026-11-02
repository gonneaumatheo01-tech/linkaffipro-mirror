import { describe, expect, it, vi } from "vitest";
import type { TurnResult } from "@linkaffipro/chat";

// Aucune base dans ces tests : seule la mise a jour de la conversation apres un tour est verifiee.
vi.mock("@linkaffipro/db", () => ({ prisma: {}, Prisma: {}, toJsonValue: (v: unknown) => v }));

const { turnPatch } = await import("./turn");

const now = new Date("2026-11-02T14:00:00Z");
const later = new Date("2026-11-02T15:30:00Z");

function result(over: Partial<TurnResult>): TurnResult {
  return {
    outcome: "replied",
    sent: [{ text: "mmh", mediaAssetId: null }],
    newStage: "CHAT",
    style: {},
    facts: [],
    language: "fr",
    followUpCount: 0,
    nextFollowUpAt: null,
    offerSent: null,
    ...over,
  } as unknown as TurnResult;
}

describe("relance « t la ? » du compte reel", () => {
  it("prevue quand le lien de la serie vient de partir", () => {
    const data = turnPatch(
      result({
        offerSent: { url: "https://go.goolink.eu/a/x" },
        newFlirtStep: "LINKED",
        nextFollowUpAt: later,
      } as Partial<TurnResult>),
      now,
    );
    expect(data.nextFollowUpAt).toBe(later);
    expect(data.followUpCount).toBe(0);
  });

  it("aucune autre reponse n'en prevoit (relances habituelles hors perimetre du compte reel)", () => {
    const data = turnPatch(result({ newFlirtStep: "PHOTOS", nextFollowUpAt: later }), now);
    expect(data.nextFollowUpAt).toBeNull();
  });

  it("la relance partie : compteur a 1, plus rien de prevu", () => {
    const data = turnPatch(result({ followUpCount: 1, newFlirtStep: "LINKED" }), now);
    expect(data.followUpCount).toBe(1);
    expect(data.nextFollowUpAt).toBeNull();
  });

  it("rien n'est parti : la relance prevue reste en place", () => {
    const data = turnPatch(result({ outcome: "aborted", sent: [] }), now);
    expect(data).not.toHaveProperty("nextFollowUpAt");
    expect(data).not.toHaveProperty("followUpCount");
  });
});
