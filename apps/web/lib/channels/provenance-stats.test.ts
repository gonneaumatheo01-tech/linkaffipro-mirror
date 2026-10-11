import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));

const { bucketOf, outcomeText, provenanceStatsRows, requestsText, share } =
  await import("./provenance-stats");

type L = Parameters<typeof bucketOf>[0] & object;
const link = (id: string, over: Partial<L> = {}): L => ({
  id,
  kind: "MANUAL",
  sourceChannelId: null,
  adPlatform: null,
  name: id,
  ...over,
});
const titles = { tir: "Tir Cadré", roulette: "Zone Roulette" };

describe("statistiques par provenance", () => {
  it("regroupe comme le bot : bouton de chaque canal, chaque lien de partage, pubs par plateforme, autres liens", () => {
    expect(bucketOf(link("g", { kind: "GATE", sourceChannelId: "tir" }), titles)).toEqual({
      key: "gate:tir",
      label: "Bouton « canal à rejoindre » de « Tir Cadré »",
    });
    expect(bucketOf(link("g", { kind: "GATE", sourceChannelId: "gone" }), titles).label).toBe(
      "Bouton « canal à rejoindre » d'un de nos canaux",
    );
    expect(bucketOf(link("s1", { kind: "SHARE", name: "Post Tir Cadré" }))).toEqual({
      key: "share:s1",
      label: "Lien de partage « Post Tir Cadré »",
    });
    expect(bucketOf(link("a", { kind: "AD_ENTRY", adPlatform: "TIKTOK" })).label).toBe(
      "Pubs TikTok",
    );
    expect(bucketOf(link("a", { kind: "AD_ENTRY", adPlatform: "META" })).label).toBe("Pubs Meta");
    expect(bucketOf(link("a", { kind: "AD_ENTRY", adPlatform: "GOOGLE" })).label).toBe(
      "Autres pubs",
    );
    expect(bucketOf(link("m"))).toEqual({ key: "other", label: "Autres liens" });
    expect(bucketOf(null)).toEqual({ key: "other", label: "Autres liens" });
  });

  it("additionne les liens d'une même provenance, les plus nombreuses d'abord, « Autres liens » en dernier", () => {
    const links = new Map(
      [
        link("g1", { kind: "GATE", sourceChannelId: "tir" }),
        link("g2", { kind: "GATE", sourceChannelId: "tir" }),
        link("t1", { kind: "AD_ENTRY", adPlatform: "TIKTOK" }),
        link("t2", { kind: "AD_ENTRY", adPlatform: "TIKTOK" }),
        link("s1", { kind: "SHARE", name: "Post Tir Cadré" }),
        link("m1"),
      ].map((l) => [l.id, l]),
    );
    const rows = provenanceStatsRows({
      counts: [
        { inviteLinkId: null, requests: 40, accepted: 30, left7: 3 },
        { inviteLinkId: "m1", requests: 2, accepted: 2, left7: 0 },
        { inviteLinkId: "g1", requests: 5, accepted: 5, left7: 1 },
        { inviteLinkId: "g2", requests: 3, accepted: 2, left7: 0 },
        { inviteLinkId: "t1", requests: 10, accepted: 7, left7: 2 },
        { inviteLinkId: "t2", requests: 1, accepted: 1, left7: 0 },
        { inviteLinkId: "s1", requests: 4, accepted: 4, left7: 0 },
      ],
      links,
      titles,
      shareLinks: [
        link("s2", { kind: "SHARE", name: "Story" }),
        link("s3", { kind: "SHARE", isActive: false }),
      ],
    });
    expect(rows.map((r) => [r.label, r.requests, r.accepted, r.left7])).toEqual([
      ["Pubs TikTok", 11, 8, 2],
      ["Bouton « canal à rejoindre » de « Tir Cadré »", 8, 7, 1],
      ["Lien de partage « Post Tir Cadré »", 4, 4, 0],
      // Lien de partage actif sans demande : montré à zéro (on voit qu'il ne sert pas). Un lien désactivé : non.
      ["Lien de partage « Story »", 0, 0, 0],
      // Sans lien suivi et liens manuels : « Autres liens », toujours en dernier.
      ["Autres liens", 42, 32, 3],
    ]);
  });

  it("textes : demandes, acceptées, départs dans les 7 jours", () => {
    expect(requestsText(0)).toBe("0 demande");
    expect(requestsText(1)).toBe("1 demande");
    expect(requestsText(1200)).toBe("1 200 demandes");
    expect(share(1, 3)).toBe("33 %");
    expect(share(1, 0)).toBeNull();
    expect(outcomeText({ requests: 12, accepted: 10, left7: 1 })).toBe(
      "10 acceptées (83 %) · 1 départ dans les 7 jours (10 %)",
    );
    expect(outcomeText({ requests: 2, accepted: 1, left7: 0 })).toBe(
      "1 acceptée (50 %) · aucun départ dans les 7 jours",
    );
    expect(outcomeText({ requests: 3, accepted: 0, left7: 0 })).toBe("0 acceptée (0 %)");
    expect(outcomeText({ requests: 0, accepted: 0, left7: 0 })).toBe(
      "aucune demande sur la période",
    );
  });
});
