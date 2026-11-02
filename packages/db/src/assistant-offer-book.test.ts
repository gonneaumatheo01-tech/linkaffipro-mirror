import { describe, expect, it, vi } from "vitest";

// Client partagé jamais utilisé ici : chaque appel reçoit un faux client (aucune base).
vi.mock("./client", () => ({ prisma: {} }));

import { lastOfferBookmakerKey, type OfferBookDb } from "./assistant-offer-book";

const at = (iso: string) => new Date(`2026-11-02T${iso}:00Z`);

function fakeDb(opts: {
  event?: { payload: unknown; createdAt: Date } | null;
  link?: { sentAt: Date; affiliateCampaignId: string | null } | null;
  books?: string[];
}) {
  const findMany = vi.fn(async () => (opts.books ?? []).map((bookmakerKey) => ({ bookmakerKey })));
  const db = {
    conversationEvent: { findFirst: vi.fn(async () => opts.event ?? null) },
    assistantOfferLink: {
      findFirst: vi.fn(async () =>
        opts.link
          ? {
              sentAt: opts.link.sentAt,
              trackingLink: { affiliateCampaignId: opts.link.affiliateCampaignId },
            }
          : null,
      ),
    },
    personaBookmaker: { findMany },
  } as unknown as OfferBookDb;
  return { db, findMany };
}

describe("bookmaker du dernier lien d'inscription", () => {
  it("aucun lien parti : aucun bookmaker", async () => {
    expect(await lastOfferBookmakerKey(fakeDb({}).db, "c1", "p1")).toBeNull();
  });

  it("clé notée dans l'événement du lien", async () => {
    const { db, findMany } = fakeDb({
      event: { payload: { subId: "s", bookmakerKey: "betportal" }, createdAt: at("10:01") },
      link: { sentAt: at("10:00"), affiliateCampaignId: "aff-celsius" },
    });
    expect(await lastOfferBookmakerKey(db, "c1", "p1")).toBe("betportal");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("événement sans clé (envoi par un bot) : bookmaker de l'offre du dernier lien", async () => {
    const { db, findMany } = fakeDb({
      event: { payload: { subId: "s", offerSends: 1 }, createdAt: at("10:01") },
      link: { sentAt: at("10:00"), affiliateCampaignId: "aff-sportaza" },
      books: ["sportaza"],
    });
    expect(await lastOfferBookmakerKey(db, "c1", "p1")).toBe("sportaza");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { personaId: "p1", affiliateCampaignId: "aff-sportaza" } }),
    );
  });

  it("lien plus récent que l'événement : c'est lui qui compte", async () => {
    const { db } = fakeDb({
      event: { payload: { bookmakerKey: "celsius" }, createdAt: at("09:00") },
      link: { sentAt: at("10:00"), affiliateCampaignId: "aff-betportal" },
      books: ["betportal"],
    });
    expect(await lastOfferBookmakerKey(db, "c1", "p1")).toBe("betportal");
  });

  it("offre partagée par deux bookmakers ou inconnue : jamais de choix au hasard", async () => {
    expect(
      await lastOfferBookmakerKey(
        fakeDb({ link: { sentAt: at("10:00"), affiliateCampaignId: "x" }, books: ["a", "b"] }).db,
        "c1",
        "p1",
      ),
    ).toBeNull();
    expect(
      await lastOfferBookmakerKey(
        fakeDb({ link: { sentAt: at("10:00"), affiliateCampaignId: "x" }, books: [] }).db,
        "c1",
        "p1",
      ),
    ).toBeNull();
  });
});
