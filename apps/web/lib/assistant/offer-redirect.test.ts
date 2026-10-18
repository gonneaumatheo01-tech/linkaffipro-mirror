import { beforeEach, describe, expect, it, vi } from "vitest";

// Lien d'offre de l'assistant de conversation (phase 17) : adresse finale, robots, première ouverture et ouvertures
// suivantes, sans base (Prisma simulé) et sans file (événement Link Affi simulé).
const m = vi.hoisted(() => {
  const tx = {
    click: { create: vi.fn(), count: vi.fn() },
    assistantOfferLink: { updateMany: vi.fn() },
    trackingLink: { update: vi.fn() },
    conversationEvent: { create: vi.fn() },
  };
  return {
    tx,
    prisma: {
      assistantOfferLink: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
      trackingLink: { update: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (arg: unknown) =>
        typeof arg === "function"
          ? (arg as (t: typeof tx) => unknown)(tx)
          : Promise.all(arg as unknown[]),
      ),
    },
    events: [] as Array<Record<string, unknown>>,
    emit: vi.fn(async () => ({ status: "queued" })),
  };
});

vi.mock("@linkaffipro/db", () => ({
  prisma: m.prisma,
  recordEvent: vi.fn(async (e: Record<string, unknown>) => void m.events.push(e)),
  toJsonValue: (v: unknown) => JSON.parse(JSON.stringify(v)),
}));
vi.mock("@linkaffipro/queue", () => ({ emitLinkaffiEvent: m.emit }));

import { decideRoute } from "@/lib/routing";
import {
  assistantOfferSubIdOf,
  assistantOfferTarget,
  offerOpenRequest,
  recordAssistantOfferOpen,
  resolveAssistantOffer,
  type AssistantOfferRow,
} from "./offer-redirect";

const NOW = new Date("2026-10-18T12:00:00Z");
const SUB = "AbCdEf123456";

function row(over: Partial<AssistantOfferRow> = {}): AssistantOfferRow {
  return {
    id: "aol1",
    subId: SUB,
    botId: "bot1",
    memberId: "m1",
    conversationId: "conv1",
    trackingLinkId: "tl1",
    clickId: null,
    click: null,
    trackingLink: {
      id: "tl1",
      isActive: true,
      destinationTemplate: "https://exemple.test/?s={subid}",
      affiliateCampaign: {
        trackingUrlTemplate: "https://linkaffi.me/go/47eb8mwc?sub_id={subid}",
        campaignKey: "47eb8mwc",
        program: { source: "LINKAFFI" },
      },
    },
    member: { linkaffiCampaignKey: null, affiliateAttributionEndsAt: null, anonymizedAt: null },
    ...over,
  };
}

const HUMAN = new Request(`https://go.goolink.eu/a/${SUB}?utm_source=tg`, {
  headers: {
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
    "x-forwarded-for": "203.0.113.9",
  },
});
const ROBOT = new Request(`https://go.goolink.eu/a/${SUB}`, {
  headers: { "user-agent": "facebookexternalhit/1.1" },
});

beforeEach(() => {
  process.env.IP_HASH_SALT = "sel-test";
  vi.clearAllMocks();
  m.events.length = 0;
  m.tx.click.create.mockResolvedValue({ id: "click1" });
  m.tx.click.count.mockResolvedValue(0);
  m.tx.assistantOfferLink.updateMany.mockResolvedValue({ count: 1 });
  m.tx.trackingLink.update.mockResolvedValue({});
  m.tx.conversationEvent.create.mockResolvedValue({});
});

describe("adresse /a/<subId>", () => {
  it("reconnaît seulement /a/ suivi d'un sub-ID de 12 caractères", () => {
    expect(assistantOfferSubIdOf(["a", SUB])).toBe(SUB);
    expect(assistantOfferSubIdOf(["a", "court"])).toBeNull();
    expect(assistantOfferSubIdOf(["a", SUB, "x"])).toBeNull();
    expect(assistantOfferSubIdOf(["abc12345"])).toBeNull();
    expect(assistantOfferSubIdOf([])).toBeNull();
  });
  it("go.goolink.eu/a/<subId> est réécrit vers la route des redirections, sans session", () => {
    expect(decideRoute("go.goolink.eu", `/a/${SUB}`, "go.goolink.eu")).toEqual({
      kind: "tracking",
      rewriteTo: `/r/a/${SUB}`,
    });
    expect(decideRoute("app.linkaffipro.com", `/r/a/${SUB}`, "go.goolink.eu")).toEqual({
      kind: "public",
    });
  });
});

describe("adresse finale", () => {
  it("offre Link Affi du lien, sub-ID de cet envoi", () => {
    expect(assistantOfferTarget(row(), NOW)).toEqual({
      target: `https://linkaffi.me/go/47eb8mwc?sub_id=${SUB}`,
      reopened: false,
      telegramCampaignKey: null,
      offerCampaignKey: "47eb8mwc",
      affiliateActive: false,
    });
  });
  it("membre d'affilié (attribution en cours) : `tg` ajouté, comme les boutons d'offre", () => {
    const t = assistantOfferTarget(
      row({
        member: {
          linkaffiCampaignKey: "aff01",
          affiliateAttributionEndsAt: null,
          anonymizedAt: null,
        },
      }),
      NOW,
    );
    expect(t?.target).toBe(`https://linkaffi.me/go/47eb8mwc?sub_id=${SUB}&tg=aff01`);
    expect(t?.telegramCampaignKey).toBe("aff01");
    expect(t?.affiliateActive).toBe(true);
    // Attribution terminée : pas de `tg`.
    const ended = assistantOfferTarget(
      row({
        member: {
          linkaffiCampaignKey: "aff01",
          affiliateAttributionEndsAt: new Date("2026-01-01T00:00:00Z"),
          anonymizedAt: null,
        },
      }),
      NOW,
    );
    expect(ended?.target).not.toContain("tg=");
    expect(ended?.affiliateActive).toBe(false);
  });
  it("déjà ouvert : même adresse que le premier clic", () => {
    const t = assistantOfferTarget(
      row({
        clickId: "click1",
        click: { id: "click1", destination: "https://linkaffi.me/go/x?sub_id=1" },
      }),
      NOW,
    );
    expect(t).toMatchObject({ target: "https://linkaffi.me/go/x?sub_id=1", reopened: true });
  });
  it("lien désactivé ou sans adresse : rien (page par défaut)", () => {
    expect(
      assistantOfferTarget(row({ trackingLink: { ...row().trackingLink, isActive: false } }), NOW),
    ).toBeNull();
    expect(
      assistantOfferTarget(
        row({
          trackingLink: { ...row().trackingLink, destinationTemplate: "", affiliateCampaign: null },
        }),
        NOW,
      ),
    ).toBeNull();
  });
  it("sub-ID inconnu : null (une seule requête)", async () => {
    m.prisma.assistantOfferLink.findUnique.mockResolvedValue(null);
    expect(await resolveAssistantOffer(SUB, NOW)).toBeNull();
    expect(m.prisma.assistantOfferLink.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("ouverture", () => {
  it("robot connu : rien n'est compté", async () => {
    const r = row();
    const res = await recordAssistantOfferOpen(
      { row: r, offer: assistantOfferTarget(r, NOW)!, at: NOW },
      offerOpenRequest(ROBOT),
    );
    expect(res).toBe("bot");
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
    expect(m.events).toEqual([]);
  });

  it("première ouverture humaine : clic, compteurs, événements, jamais de relance automatique", async () => {
    const r = row({
      member: {
        linkaffiCampaignKey: "aff01",
        affiliateAttributionEndsAt: null,
        anonymizedAt: null,
      },
    });
    const offer = assistantOfferTarget(r, NOW)!;
    const req = offerOpenRequest(HUMAN);
    expect(req.isBot).toBe(false);
    expect(req.ipHash).toHaveLength(64);
    expect(await recordAssistantOfferOpen({ row: r, offer, at: NOW }, req)).toBe("first");
    expect(m.tx.click.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trackingLinkId: "tl1",
          subId: SUB,
          memberId: "m1",
          botId: "bot1",
          conversationId: "conv1",
          destination: offer.target,
          linkaffiTelegramCampaignKey: "aff01",
          utm: { utm_source: "tg" },
        }),
      }),
    );
    expect(m.tx.assistantOfferLink.updateMany).toHaveBeenCalledWith({
      where: { id: "aol1", clickId: null },
      data: { clickId: "click1", firstOpenedAt: NOW, opens: { increment: 1 } },
    });
    expect(m.tx.trackingLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { clicks: { increment: 1 }, uniqueClicks: { increment: 1 } },
      }),
    );
    expect(m.tx.conversationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "offer_opened" }) }),
    );
    expect(m.events.map((e) => e.type)).toEqual(["click.offer", "conversation.offer_opened"]);
    expect(m.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "offer_clicked", sourceId: "click1", memberId: "m1" }),
    );
  });

  it("ouverture simultanée déjà enregistrée : comptée comme une ouverture suivante", async () => {
    m.tx.assistantOfferLink.updateMany.mockResolvedValue({ count: 0 });
    const r = row();
    const res = await recordAssistantOfferOpen(
      { row: r, offer: assistantOfferTarget(r, NOW)!, at: NOW },
      offerOpenRequest(HUMAN),
    );
    expect(res).toBe("reopened");
    expect(m.prisma.assistantOfferLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { opens: { increment: 1 } } }),
    );
    expect(m.events).toEqual([]);
  });

  it("ouverture suivante : opens + 1 et un clic de plus sur le lien, sans nouveau clic ni événement", async () => {
    const r = row({
      clickId: "click1",
      click: { id: "click1", destination: "https://linkaffi.me/go/x" },
    });
    const res = await recordAssistantOfferOpen(
      { row: r, offer: assistantOfferTarget(r, NOW)!, at: NOW },
      offerOpenRequest(HUMAN),
    );
    expect(res).toBe("reopened");
    expect(m.tx.click.create).not.toHaveBeenCalled();
    expect(m.prisma.trackingLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tl1" }, data: { clicks: { increment: 1 } } }),
    );
    expect(m.emit).not.toHaveBeenCalled();
  });
});
