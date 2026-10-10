import { describe, expect, it } from "vitest";
import { bestSlotsHref, channelTabHref, CHANNEL_TABS, parseChannelTab } from "./tabs";

describe("onglets de la fiche canal", () => {
  it("quatre onglets en langage courant, sans « Meilleurs horaires »", () => {
    expect(CHANNEL_TABS.map((t) => t.label)).toEqual([
      "Qui peut entrer et quand",
      "Ce que dit le bot",
      "Demandes",
      "Membres",
    ]);
  });

  it("libellés courts sur téléphone (deux par rangée, 20 caractères au plus)", () => {
    for (const t of CHANNEL_TABS) expect(t.short.length).toBeLessThanOrEqual(20);
    expect(CHANNEL_TABS.find((t) => t.key === "requests")?.short).toBe("Demandes");
  });

  it("garde les anciennes clés et retombe sur la règle d'entrée", () => {
    expect(parseChannelTab("requests")).toBe("requests");
    expect(parseChannelTab(["members"])).toBe("members");
    expect(parseChannelTab("sequences")).toBe("sequences");
    expect(parseChannelTab("besthours")).toBe("rules");
    expect(parseChannelTab(undefined)).toBe("rules");
  });

  it("adresses", () => {
    expect(channelTabHref("ck1", "requests")).toBe("/channels/ck1?tab=requests");
    expect(bestSlotsHref("ck1")).toBe("/messages?channelId=ck1");
  });
});
