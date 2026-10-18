import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  const state = {
    persona: null as Row | null,
    offer: null as Row | null,
    link: null as Row | null,
    upserts: [] as Row[],
    updates: [] as Row[],
    offerLinks: [] as Row[],
    failNextCreate: 0,
    deleted: [] as Row[],
  };
  const prisma = {
    persona: { findUnique: vi.fn(async () => state.persona) },
    affiliateCampaign: { findUnique: vi.fn(async () => state.offer) },
    trackingLink: {
      upsert: vi.fn(async (args: { where: { slug: string }; create: Row }) => {
        state.upserts.push(args);
        if (!state.link) state.link = { id: "tl1", isActive: true, ...args.create };
        return state.link;
      }),
      update: vi.fn(async (args: Row) => {
        state.updates.push(args);
        return args;
      }),
    },
    assistantOfferLink: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        if (state.failNextCreate > 0) {
          state.failNextCreate--;
          throw new PrismaClientKnownRequestError("Unique constraint failed", "P2002");
        }
        state.offerLinks.push(data);
        return { id: `aol${state.offerLinks.length}` };
      }),
      deleteMany: vi.fn(async (args: Row) => {
        state.deleted.push(args);
        return { count: 1 };
      }),
    },
  };
  return { state, prisma, Prisma: { PrismaClientKnownRequestError } };
});

vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, Prisma: db.Prisma }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createAssistantOfferLink, dropUnsentOfferLink } from "./offer-link";
import { assistantOfferSlug } from "./rules";

const ctx = {
  conversationId: "conv1",
  personaId: "p1",
  botId: "bot1",
  memberId: "mem1",
  source: "pub1",
};
const env = { TRACKING_BASE_URL: "https://go.goolink.eu" };
const TEMPLATE = "https://linkaffi.me/go/abcd1234?sub_id={subid}";

describe("lien d'offre de l'assistant", () => {
  beforeEach(() => {
    Object.assign(db.state, {
      persona: { name: "Léa", affiliateCampaignId: "off1", campaignId: "camp1" },
      offer: { id: "off1", isActive: true, trackingUrlTemplate: TEMPLATE },
      link: null,
      failNextCreate: 0,
    });
    db.state.upserts.length = 0;
    db.state.updates.length = 0;
    db.state.offerLinks.length = 0;
    db.state.deleted.length = 0;
  });

  it("crée le lien OFFER de la persona (nom court stable) et un sub-ID neuf par envoi", async () => {
    const a = await createAssistantOfferLink(ctx, env);
    const b = await createAssistantOfferLink(ctx, env);
    expect(db.state.upserts[0]).toMatchObject({
      where: { slug: assistantOfferSlug("p1", "off1") },
      create: {
        kind: "OFFER",
        destinationTemplate: TEMPLATE,
        label: "Assistant « Léa »",
        affiliateCampaignId: "off1",
        campaignId: "camp1",
        personaId: "p1",
      },
      update: {},
    });
    expect(a?.url).toBe(`https://go.goolink.eu/a/${a?.subId}`);
    expect(a?.subId).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(b?.subId).not.toBe(a?.subId);
    expect(db.state.offerLinks[0]).toMatchObject({
      subId: a?.subId,
      conversationId: "conv1",
      personaId: "p1",
      botId: "bot1",
      memberId: "mem1",
      trackingLinkId: "tl1",
      source: "pub1",
    });
    expect(db.state.updates).toHaveLength(0);
  });

  it("aucune offre liée, offre inactive ou sans adresse, lien désactivé par l'équipe : aucun lien", async () => {
    db.state.persona = { name: "Léa", affiliateCampaignId: null, campaignId: null };
    expect(await createAssistantOfferLink(ctx, env)).toBeNull();
    db.state.persona = { name: "Léa", affiliateCampaignId: "off1", campaignId: null };
    db.state.offer = { id: "off1", isActive: false, trackingUrlTemplate: TEMPLATE };
    expect(await createAssistantOfferLink(ctx, env)).toBeNull();
    db.state.offer = { id: "off1", isActive: true, trackingUrlTemplate: " " };
    expect(await createAssistantOfferLink(ctx, env)).toBeNull();
    db.state.offer = { id: "off1", isActive: true, trackingUrlTemplate: TEMPLATE };
    db.state.link = {
      id: "tl1",
      isActive: false,
      destinationTemplate: TEMPLATE,
      campaignId: null,
      personaId: "p1",
      label: "Assistant « Léa »",
    };
    expect(await createAssistantOfferLink(ctx, env)).toBeNull();
    expect(db.state.offerLinks).toHaveLength(0);
  });

  it("adresse de l'offre ou campagne changée : le lien la suit", async () => {
    db.state.link = {
      id: "tl1",
      isActive: true,
      destinationTemplate: "https://ancienne/{subid}",
      campaignId: "camp1",
      personaId: "p1",
      label: "Assistant « Léa »",
    };
    await createAssistantOfferLink(ctx, env);
    expect(db.state.updates[0]).toEqual({
      where: { id: "tl1" },
      data: {
        destinationTemplate: TEMPLATE,
        campaignId: "camp1",
        personaId: "p1",
        label: "Assistant « Léa »",
      },
    });
  });

  it("sub-ID déjà pris : un autre, une seule fois", async () => {
    db.state.failNextCreate = 1;
    const r = await createAssistantOfferLink(ctx, env);
    expect(r).not.toBeNull();
    expect(db.state.offerLinks).toHaveLength(1);
    db.state.failNextCreate = 2;
    await expect(createAssistantOfferLink(ctx, env)).rejects.toThrow("Unique constraint failed");
  });

  it("lien jamais parti : retiré s'il n'a jamais été ouvert", async () => {
    await dropUnsentOfferLink("AbCdEfGh1234");
    expect(db.state.deleted[0]).toEqual({
      where: { subId: "AbCdEfGh1234", clickId: null, opens: 0 },
    });
  });
});
