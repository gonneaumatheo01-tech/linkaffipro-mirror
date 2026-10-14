import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));
const { isEventVisibleToCampaign, linkaffiMemberStatus } = await import("./members");

/** Statut d'un membre vu par Link Affi, depuis sa demande la plus récente dans le canal de la campagne. */
describe("statut d'un membre d'affilié", () => {
  it("traduit chaque étape de la demande d'adhésion", () => {
    const at = new Date();
    expect(linkaffiMemberStatus(null)).toBe("unknown");
    for (const s of ["REQUESTED", "PENDING_GATE", "SCHEDULED"])
      expect(linkaffiMemberStatus({ status: s, joinedAt: null })).toBe("requested");
    expect(linkaffiMemberStatus({ status: "APPROVED", joinedAt: null })).toBe("approved");
    expect(linkaffiMemberStatus({ status: "APPROVED", joinedAt: at })).toBe("joined");
    for (const s of ["LEFT", "KICKED"])
      expect(linkaffiMemberStatus({ status: s, joinedAt: at })).toBe("left");
    expect(linkaffiMemberStatus({ status: "DECLINED", joinedAt: null })).toBe("declined");
    for (const s of ["EXPIRED", "FAILED"])
      expect(linkaffiMemberStatus({ status: s, joinedAt: null })).toBe("expired");
    expect(linkaffiMemberStatus({ status: "NOUVEAU", joinedAt: null })).toBe("unknown");
  });
});

/** Rattrapage `GET /members` : jamais ce que l'envoi a retenu (même règle que le worker avant chaque envoi). */
describe("événement rendu à Link Affi pour une campagne", () => {
  const paul = { anonymizedAt: null, linkaffiCampaignKey: "paul" };
  const ev = (status: string, memberId: string | null = "m1") => ({ memberId, status });

  it("membre encore rattaché : tout est rendu (envoyé, en attente, abandonné après 24 h)", () => {
    for (const s of ["SENT", "PENDING", "FAILED"])
      expect(isEventVisibleToCampaign(ev(s), paul, "paul")).toBe(true);
  });

  it("affilié changé ou retiré par un ADMIN : seul ce qui était déjà parti est rendu", () => {
    for (const member of [
      { anonymizedAt: null, linkaffiCampaignKey: "marc" },
      { anonymizedAt: null, linkaffiCampaignKey: null },
    ]) {
      expect(isEventVisibleToCampaign(ev("SENT"), member, "paul")).toBe(true);
      expect(isEventVisibleToCampaign(ev("PENDING"), member, "paul")).toBe(false);
      expect(isEventVisibleToCampaign(ev("FAILED"), member, "paul")).toBe(false);
    }
  });

  it("membre anonymisé ou introuvable : jamais, même déjà envoyé", () => {
    const gone = { anonymizedAt: new Date(), linkaffiCampaignKey: "paul" };
    for (const s of ["SENT", "PENDING", "FAILED"]) {
      expect(isEventVisibleToCampaign(ev(s), gone, "paul")).toBe(false);
      expect(isEventVisibleToCampaign(ev(s), null, "paul")).toBe(false);
      expect(isEventVisibleToCampaign(ev(s), undefined, "paul")).toBe(false);
    }
  });

  it("sans membre sur la ligne : rendu", () => {
    expect(isEventVisibleToCampaign(ev("PENDING", null), null, "paul")).toBe(true);
  });
});
