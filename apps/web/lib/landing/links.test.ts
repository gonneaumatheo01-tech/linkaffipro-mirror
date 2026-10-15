import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 15 : liens d'invitation des sources d'une page, côté site (fonctions appelées par la rubrique Pages). Le moteur
 * (ordre des bots, repli, refus, nom tronqué) est testé dans `packages/telegram/src/landing/links.test.ts` ; ici :
 * l'enchaînement à l'enregistrement d'une page (liens retirés, liens créés, pub reliée → recalcul, photo), le journal
 * de l'équipe et les textes affichés. Base et Telegram simulés ; parcours réel : tests/integration/landing-links.test.ts.
 */

const st = vi.hoisted(() => ({
  calls: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  page: null as null | {
    id: string;
    showPhoto: boolean;
    channelId: string;
    channel: { photoFileUniqueId: string | null; chatCheckedAt: Date | null };
  },
  ensure: {
    pageId: "p1",
    found: true,
    created: 0,
    failed: 0,
    sources: [] as unknown[],
  } as Record<string, unknown>,
  revoke: { revoked: 0, disabledOnly: 0, retryLater: 0 },
  ads: { linksFixed: 0, recomputeNeeded: false },
  sources: [] as Array<Record<string, unknown>>,
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    landingPage: {
      findUnique: vi.fn(async () => st.page),
    },
    landingSource: {
      findMany: vi.fn(async () => st.sources),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => {
    st.audits.push(a);
  }),
}));

vi.mock("@linkaffipro/telegram", () => ({
  ensureLandingLinksWithDb: vi.fn(async (pageId: string, opts: unknown) => {
    st.calls.push(`ensure:${pageId}:${JSON.stringify(opts)}`);
    return st.ensure;
  }),
  revokeDetachedLandingLinksWithDb: vi.fn(async (opts: { pageId: string }) => {
    st.calls.push(`detached:${opts.pageId}`);
    return st.revoke;
  }),
  revokeLandingPageLinksWithDb: vi.fn(async (pageId: string, opts: { sourceIds?: string[] }) => {
    st.calls.push(`revoke:${pageId}:${(opts.sourceIds ?? []).join(",")}`);
    return st.revoke;
  }),
  syncLandingAdLinksWithDb: vi.fn(async (opts: { pageId: string }) => {
    st.calls.push(`ads:${opts.pageId}`);
    return st.ads;
  }),
  refreshLandingChannelWithDb: vi.fn(async (channelId: string, opts: { wantsPhoto?: boolean }) => {
    st.calls.push(`chat:${channelId}:${opts.wantsPhoto === true}`);
    return { channelId, status: "unchanged", titleChanged: false, photoChanged: false };
  }),
}));

vi.mock("@/lib/campaigns/refresh", () => ({
  refreshCampaignStats: vi.fn(async () => {
    st.calls.push("recompute");
  }),
}));

const {
  landingLinksMessage,
  loadLandingSourceLinks,
  revokeLandingSourceLinks,
  syncLandingPageLinks,
} = await import("./links");

beforeEach(() => {
  st.calls = [];
  st.audits = [];
  st.page = {
    id: "p1",
    showPhoto: false,
    channelId: "c1",
    channel: { photoFileUniqueId: null, chatCheckedAt: new Date() },
  };
  st.ensure = { pageId: "p1", found: true, created: 0, failed: 0, sources: [] };
  st.revoke = { revoked: 0, disabledOnly: 0, retryLater: 0 };
  st.ads = { linksFixed: 0, recomputeNeeded: false };
  st.sources = [];
});

describe("enregistrement d'une page : liens des sources", () => {
  it("liens manquants créés d'abord, puis liens détachés révoqués (source retirée, ou pub changée : l'ancien lien), puis campagne des liens", async () => {
    st.ensure = {
      pageId: "p1",
      found: true,
      created: 2,
      failed: 0,
      sources: [
        { sourceId: "s1", key: "tk01", status: "ok", inviteLinkId: "l1", url: "u1", created: true },
        { sourceId: "s2", key: "", status: "ok", inviteLinkId: "l2", url: "u2", created: true },
      ],
    };
    st.revoke = { revoked: 1, disabledOnly: 0, retryLater: 0 };
    const r = await syncLandingPageLinks("p1", { userId: "u1" });
    // Le lien remplacé d'une source dont la pub a changé n'est détaché qu'une fois le nouveau lien posé : la révocation
    // vient après la création (le bouton de la page a toujours un lien qui fonctionne).
    expect(st.calls).toEqual(['ensure:p1:{"userId":"u1"}', "detached:p1", "ads:p1"]);
    expect(r).toMatchObject({ found: true, created: 2, failed: 0, revoked: 1 });
    expect(st.audits.map((a) => [a.action, a.entityId])).toEqual([
      ["invite_link.landing_created", "l1"],
      ["invite_link.landing_created", "l2"],
      ["invite_link.landing_revoked", "p1"],
    ]);
  });

  it("campagne d'un lien actuel corrigée : recalcul complet des statistiques demandé", async () => {
    st.ads = { linksFixed: 3, recomputeNeeded: true };
    await syncLandingPageLinks("p1");
    expect(st.calls.at(-1)).toBe("recompute");
  });

  it("le recalcul ne bloque jamais l'enregistrement", async () => {
    st.ads = { linksFixed: 0, recomputeNeeded: true };
    const { refreshCampaignStats } = await import("@/lib/campaigns/refresh");
    vi.mocked(refreshCampaignStats).mockRejectedValueOnce(new Error("Redis coupé"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(syncLandingPageLinks("p1")).resolves.toMatchObject({ found: true });
    err.mockRestore();
  });

  it("photo affichée mais pas encore récupérée : relecture du canal tout de suite", async () => {
    st.page!.showPhoto = true;
    await syncLandingPageLinks("p1");
    expect(st.calls).toContain("chat:c1:true");
  });

  it("canal jamais relu : titre relu tout de suite ; déjà relu et sans photo : rien", async () => {
    st.page!.channel.chatCheckedAt = null;
    await syncLandingPageLinks("p1");
    expect(st.calls).toContain("chat:c1:false");
    st.calls = [];
    st.page!.channel.chatCheckedAt = new Date();
    await syncLandingPageLinks("p1");
    expect(st.calls.some((c) => c.startsWith("chat:"))).toBe(false);
  });

  it("sans utilisateur (worker, script) : aucun journal de l'équipe", async () => {
    st.ensure = {
      ...st.ensure,
      created: 1,
      sources: [
        { sourceId: "s1", key: "", status: "ok", inviteLinkId: "l1", url: "u", created: true },
      ],
    };
    await syncLandingPageLinks("p1");
    expect(st.audits).toEqual([]);
  });

  it("page inconnue : rien n'est fait", async () => {
    st.page = null;
    const r = await syncLandingPageLinks("nope");
    expect(r.found).toBe(false);
    expect(st.calls).toEqual([]);
  });
});

describe("suppression d'une page ou d'une source", () => {
  it("révoque les liens chez Telegram et le note au journal de l'équipe", async () => {
    st.revoke = { revoked: 2, disabledOnly: 1, retryLater: 0 };
    const r = await revokeLandingSourceLinks({ pageId: "p1", sourceIds: ["s1"], userId: "u1" });
    expect(st.calls).toEqual(["revoke:p1:s1"]);
    expect(r.revoked).toBe(2);
    expect(st.audits[0]).toMatchObject({
      action: "invite_link.landing_revoked",
      entityType: "LandingPage",
      entityId: "p1",
      metadata: { sourceIds: ["s1"], revoked: 2, disabledOnly: 1, retryLater: 0 },
    });
  });
});

describe("textes affichés", () => {
  it("message après l'enregistrement", () => {
    expect(landingLinksMessage({ created: 0, failed: 0, firstError: null })).toBeNull();
    expect(landingLinksMessage({ created: 1, failed: 0, firstError: null })).toBe(
      "Lien Telegram créé.",
    );
    expect(landingLinksMessage({ created: 3, failed: 0, firstError: null })).toBe(
      "3 liens Telegram créés.",
    );
    expect(
      landingLinksMessage({ created: 1, failed: 2, firstError: "Telegram ne répond pas." }),
    ).toBe("1 lien Telegram créé. 2 liens en attente : Telegram ne répond pas.");
    expect(landingLinksMessage({ created: 0, failed: 1, firstError: "Refus." })).toBe(
      "1 lien en attente : Refus.",
    );
  });

  it("état du lien de chaque source (bouton « Copier le lien »)", async () => {
    st.sources = [
      {
        id: "s0",
        key: "",
        isActive: true,
        linkError: null,
        inviteLink: { telegramInviteLink: "https://t.me/+abc", isActive: true },
      },
      {
        id: "s1",
        key: "tk01",
        isActive: true,
        linkError: "Telegram refuse…",
        inviteLink: null,
      },
      { id: "s2", key: "exo1", isActive: true, linkError: null, inviteLink: null },
      {
        id: "s3",
        key: "old",
        isActive: false,
        linkError: null,
        inviteLink: { telegramInviteLink: "https://t.me/+old", isActive: false },
      },
    ];
    expect(await loadLandingSourceLinks("p1")).toEqual([
      {
        sourceId: "s0",
        key: "",
        status: "ready",
        inviteUrl: "https://t.me/+abc",
        error: null,
      },
      { sourceId: "s1", key: "tk01", status: "error", inviteUrl: null, error: "Telegram refuse…" },
      { sourceId: "s2", key: "exo1", status: "pending", inviteUrl: null, error: null },
      { sourceId: "s3", key: "old", status: "inactive", inviteUrl: null, error: null },
    ]);
  });
});
