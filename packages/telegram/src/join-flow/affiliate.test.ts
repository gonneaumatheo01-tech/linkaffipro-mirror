/**
 * Phase 13 : attribution d'un membre à l'affilié Link Affi dont il a utilisé le lien (premier affilié gagne, jamais
 * une personne déjà dans le canal), avec le journal de la décision.
 */
import { describe, expect, it, vi } from "vitest";
import type { InviteLinkInfo, JoinFlowDeps, MemberAffiliate } from "./deps";
import {
  attributeAffiliateFromLink,
  attributeAffiliateSafely,
  isLinkaffiInviteLink,
} from "./affiliate";

const CHANNEL = { id: "cA", telegramChatId: -100100n };
const AT = new Date("2026-10-14T10:00:00Z");

const PAUL: InviteLinkInfo = {
  id: "l_paul",
  kind: "LINKAFFI",
  name: "Paul TG",
  channelId: "cA",
  campaignId: null,
  adPlatform: null,
  adCampaignName: null,
  adName: null,
  sourceChannelId: null,
  telegramInviteLink: "https://t.me/+paul",
  linkaffiCampaignKey: "paulTG01",
  linkaffiCampaignName: "Paul — Telegram",
  linkaffiAffiliateId: "aff-paul",
  linkaffiAffiliateName: "Paul",
  attributionDays: null,
};
const AD: InviteLinkInfo = { ...PAUL, id: "l_ad", kind: "AD_ENTRY", linkaffiCampaignKey: null };

function deps(current: MemberAffiliate | null = null, written = true) {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const d = {
    getMemberAffiliate: vi.fn(async () => current),
    attributeAffiliate: vi.fn(async () => written),
    recordEvent: vi.fn(async (e: Parameters<JoinFlowDeps["recordEvent"]>[0]) => {
      events.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> });
    }),
  };
  return { d, events };
}

function api(status: string | Error) {
  return {
    getChatMember: vi.fn(async () => {
      if (status instanceof Error) throw status;
      return { status };
    }),
  };
}

const base = {
  stage: "request" as const,
  memberId: "m1",
  telegramUserId: 42,
  channel: CHANNEL,
  link: PAUL,
  membershipId: "ms1",
  latestBefore: null,
  at: AT,
  botId: "bot_1",
};

describe("attribution à l'affilié d'un lien Link Affi", () => {
  it("reconnaît un lien d'affilié (type LINKAFFI avec sa clé)", () => {
    expect(isLinkaffiInviteLink(PAUL)).toBe(true);
    expect(isLinkaffiInviteLink(AD)).toBe(false);
    expect(isLinkaffiInviteLink({ ...PAUL, linkaffiCampaignKey: null })).toBe(false);
    expect(isLinkaffiInviteLink(null)).toBe(false);
  });

  it("rattache un nouveau membre absent du canal, à vie, et le journalise", async () => {
    const { d, events } = deps();
    const r = await attributeAffiliateFromLink(api("left"), d, base);
    expect(r).toEqual({
      status: "attributed",
      campaignKey: "paulTG01",
      affiliateId: "aff-paul",
      endsAt: null,
    });
    expect(d.attributeAffiliate).toHaveBeenCalledWith({
      memberId: "m1",
      campaignKey: "paulTG01",
      affiliateId: "aff-paul",
      inviteLinkId: "l_paul",
      attributedAt: AT,
      endsAt: null,
    });
    expect(events).toEqual([
      {
        type: "member.affiliate_attributed",
        payload: expect.objectContaining({
          membershipId: "ms1",
          inviteLinkId: "l_paul",
          campaignKey: "paulTG01",
          campaignName: "Paul — Telegram",
          affiliateId: "aff-paul",
          affiliateName: "Paul",
          stage: "request",
          attributedAt: AT.toISOString(),
          endsAt: null,
        }),
      },
    ]);
  });

  it("campagne à durée limitée : fin de l'attribution au bout de N jours", async () => {
    const { d } = deps();
    const r = await attributeAffiliateFromLink(api("left"), d, {
      ...base,
      link: { ...PAUL, attributionDays: 30 },
    });
    const ends = new Date(AT.getTime() + 30 * 86_400_000);
    expect(r).toMatchObject({ status: "attributed", endsAt: ends });
    expect(d.attributeAffiliate).toHaveBeenCalledWith(expect.objectContaining({ endsAt: ends }));
  });

  it("premier affilié gagne : un membre déjà rattaché ne change pas d'affilié", async () => {
    const { d, events } = deps({
      campaignKey: "marcTG01",
      affiliateId: "aff-marc",
      attributionEndsAt: null,
    });
    const tg = api("left");
    const r = await attributeAffiliateFromLink(tg, d, base);
    expect(r).toEqual({ status: "not_attributed", reason: "already_attributed" });
    expect(d.attributeAffiliate).not.toHaveBeenCalled();
    // Inutile de demander à Telegram : la décision est déjà prise.
    expect(tg.getChatMember).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "membership.affiliate_not_attributed",
        payload: expect.objectContaining({
          reason: "already_attributed",
          campaignKey: "paulTG01",
          currentCampaignKey: "marcTG01",
          currentAffiliateId: "aff-marc",
        }),
      },
    ]);
  });

  it("membre revenu par le lien de la campagne qui l'a déjà amené : rien à décider ni à journaliser", async () => {
    const { d, events } = deps({
      campaignKey: "paulTG01",
      affiliateId: "aff-paul",
      attributionEndsAt: null,
    });
    const tg = api("left");
    const r = await attributeAffiliateFromLink(tg, d, {
      ...base,
      // Parti du canal, puis nouvelle demande par le même lien.
      latestBefore: { status: "LEFT", inviteLinkId: "l_paul" },
    });
    expect(r).toEqual({ status: "skipped" });
    expect(d.attributeAffiliate).not.toHaveBeenCalled();
    expect(tg.getChatMember).not.toHaveBeenCalled();
    // Jamais « pas rattaché, déjà rattaché à un autre » : il reste le membre de cette campagne.
    expect(events).toEqual([]);
  });

  it("même une attribution terminée n'est jamais écrasée automatiquement", async () => {
    const { d } = deps({
      campaignKey: "marcTG01",
      affiliateId: "aff-marc",
      attributionEndsAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(await attributeAffiliateFromLink(api("left"), d, base)).toEqual({
      status: "not_attributed",
      reason: "already_attributed",
    });
  });

  it("déjà dans le canal (dernière demande acceptée, sans départ) : aucune attribution", async () => {
    const { d, events } = deps();
    const r = await attributeAffiliateFromLink(api("left"), d, {
      ...base,
      latestBefore: { status: "APPROVED", inviteLinkId: "l_ad" },
    });
    expect(r).toEqual({ status: "not_attributed", reason: "already_member" });
    expect(d.attributeAffiliate).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({
      type: "membership.affiliate_not_attributed",
      payload: { reason: "already_member" },
    });
  });

  it("déjà dans le canal selon Telegram : aucune attribution", async () => {
    const { d } = deps();
    const tg = api("member");
    const r = await attributeAffiliateFromLink(tg, d, base);
    expect(r).toEqual({ status: "not_attributed", reason: "already_member" });
    expect(tg.getChatMember).toHaveBeenCalledWith(-100100, 42);
  });

  it("parti du canal (dernière demande LEFT) : rattaché", async () => {
    const { d } = deps();
    const r = await attributeAffiliateFromLink(api("left"), d, {
      ...base,
      latestBefore: { status: "LEFT", inviteLinkId: "l_ad" },
    });
    expect(r.status).toBe("attributed");
  });

  it("Telegram ne répond pas : la base décide (pas dans le canal) → rattaché", async () => {
    const { d } = deps();
    const r = await attributeAffiliateFromLink(api(new Error("réseau")), d, base);
    expect(r.status).toBe("attributed");
  });

  it("deux demandes simultanées : l'écriture conditionnelle refuse la seconde (premier affilié gagne)", async () => {
    const { d, events } = deps(null, false);
    const r = await attributeAffiliateFromLink(api("left"), d, base);
    expect(r).toEqual({ status: "not_attributed", reason: "already_attributed" });
    expect(events.map((e) => e.type)).toEqual(["membership.affiliate_not_attributed"]);
  });

  it("lien désactivé par Link Affi (encore valable chez Telegram) : aucune attribution, journalisée", async () => {
    const { d, events } = deps();
    const tg = api("left");
    const r = await attributeAffiliateFromLink(tg, d, {
      ...base,
      link: { ...PAUL, isActive: false },
    });
    expect(r).toEqual({ status: "not_attributed", reason: "link_disabled" });
    expect(d.attributeAffiliate).not.toHaveBeenCalled();
    // Inutile de demander à Telegram : le lien ne rattache plus personne.
    expect(tg.getChatMember).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "membership.affiliate_not_attributed",
        payload: expect.objectContaining({
          reason: "link_disabled",
          inviteLinkId: "l_paul",
          campaignKey: "paulTG01",
          stage: "request",
        }),
      },
    ]);
    // Entrée directe par ce lien désactivé : même règle.
    const join = deps();
    expect(
      await attributeAffiliateFromLink(null, join.d, {
        ...base,
        stage: "join",
        link: { ...PAUL, isActive: false },
      }),
    ).toEqual({ status: "not_attributed", reason: "link_disabled" });
    expect(join.d.attributeAffiliate).not.toHaveBeenCalled();
    // Lien actif (ou état inconnu, anciens appels) : rattachement normal.
    for (const isActive of [true, undefined]) {
      const ok = deps();
      expect(
        (
          await attributeAffiliateFromLink(api("left"), ok.d, {
            ...base,
            link: { ...PAUL, isActive },
          })
        ).status,
      ).toBe("attributed");
    }
  });

  it("autre lien (pub, partage…) ou aucun lien : rien n'est décidé ni journalisé", async () => {
    for (const link of [AD, null]) {
      const { d, events } = deps();
      expect(await attributeAffiliateFromLink(api("left"), d, { ...base, link })).toEqual({
        status: "skipped",
      });
      expect(d.getMemberAffiliate).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    }
  });

  it("sans les accès d'attribution (anciens tests) : rien", async () => {
    const r = await attributeAffiliateFromLink(
      api("left"),
      { recordEvent: vi.fn(async () => undefined) },
      base,
    );
    expect(r).toEqual({ status: "skipped" });
  });

  it("entrée dans le canal après une demande faite par ce lien : décision déjà prise, rien de plus", async () => {
    const { d, events } = deps({
      campaignKey: "marcTG01",
      affiliateId: "aff-marc",
      attributionEndsAt: null,
    });
    const r = await attributeAffiliateFromLink(null, d, {
      ...base,
      stage: "join",
      latestBefore: { status: "APPROVED", inviteLinkId: "l_paul" },
    });
    expect(r).toEqual({ status: "skipped" });
    expect(events).toEqual([]);
  });

  it("entrée directe par le lien (sans demande) : même règle, sans interroger Telegram", async () => {
    const { d } = deps();
    const r = await attributeAffiliateFromLink(null, d, {
      ...base,
      stage: "join",
      latestBefore: { status: "LEFT", inviteLinkId: "l_ad" },
    });
    expect(r.status).toBe("attributed");
    expect(d.attributeAffiliate).toHaveBeenCalledTimes(1);
  });

  it("erreur de la base pendant l'attribution : journalisée, jamais bloquante pour la demande", async () => {
    const { d } = deps();
    d.attributeAffiliate.mockRejectedValueOnce(new Error("base indisponible"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await attributeAffiliateSafely(api("left"), d, base)).toEqual({ status: "skipped" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
