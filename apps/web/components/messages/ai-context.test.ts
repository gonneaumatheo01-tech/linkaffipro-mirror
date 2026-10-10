import { describe, expect, it } from "vitest";
import { resolvePostVertical } from "./ai-context";

const channels = [
  { id: "c1", vertical: null },
  { id: "c2", vertical: "SPORTS" },
  { id: "c3", vertical: "DATING" },
];
const campaigns = [
  { id: "k1", vertical: "CASINO" },
  { id: "k2", vertical: null },
];

describe("univers transmis à l'assistant IA depuis un message", () => {
  it("priorité à la campagne du bouton Offre", () => {
    const rows = [[{ text: "Jouer", type: "OFFER" as const, campaignId: "k1" }]];
    expect(resolvePostVertical({ rows, campaigns, channels, channelIds: ["c2"] })).toBe("CASINO");
  });
  it("puis l'univers du modèle, puis le premier canal coché qui a un univers", () => {
    expect(
      resolvePostVertical({
        rows: [],
        campaigns,
        channels,
        channelIds: ["c2"],
        templateVertical: "DATING",
      }),
    ).toBe("DATING");
    expect(
      resolvePostVertical({ rows: [], campaigns, channels, channelIds: ["c1", "c2", "c3"] }),
    ).toBe("SPORTS");
  });
  it("ignore une campagne sans univers et un univers invalide ; null si rien n'est connu", () => {
    const rows = [
      [
        { text: "Offre", type: "OFFER" as const, campaignId: "k2" },
        { text: "Lien", type: "URL" as const },
      ],
    ];
    expect(resolvePostVertical({ rows, campaigns, channels, channelIds: ["c3"] })).toBe("DATING");
    expect(
      resolvePostVertical({
        rows: [],
        campaigns,
        channels,
        channelIds: ["c1"],
        templateVertical: "AUTRE",
      }),
    ).toBeNull();
  });
});
