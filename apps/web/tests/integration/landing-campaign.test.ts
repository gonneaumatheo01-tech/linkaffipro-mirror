/**
 * Phase 15, pages d'atterrissage dans Campagnes (base réelle) :
 * - les liens des pages (type LANDING) comptent dans les chiffres de la campagne (demandes, visites = « Clics sur les
 *   pubs »), mais ne sont jamais présentés comme « liens d'entrée » (onglet Liens, carte, en-tête) ;
 * - pub figée sur le lien (D9) : une visite compte pour la campagne du lien que le bouton affichait à ce moment-là, une
 *   seule fois par visite, robots exclus.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { landingVisitsByLink, prisma } from "@linkaffipro/db";
import { scopeFromCampaign } from "@/lib/campaigns/attribution";
import { shownEntryLinkIds } from "@/lib/campaigns/display";
import {
  campaignScopeInclude,
  campaignTotals,
  listCampaignsUncached,
} from "@/lib/campaigns/queries";
import { resolvePeriod } from "@/lib/periods";
import { createBotAndChannel, resetDb } from "./helpers";

const period = resolvePeriod({ range: "7d" });
const ids = { campaign: "", other: "", page: "", direct: "", current: "", old: "", spare: "" };

async function clean() {
  await prisma.landingEvent.deleteMany();
  await prisma.landingSource.deleteMany();
  await prisma.landingPage.deleteMany();
  await prisma.campaign.deleteMany({ where: { name: { startsWith: "P15 · " } } });
}

beforeAll(async () => {
  await clean();
  await resetDb();
  const { bot, channel } = await createBotAndChannel();
  const make = (name: string) =>
    prisma.campaign.create({
      data: {
        name,
        status: "ACTIVE",
        adSets: { create: [{ name: "Groupe 1", ads: { create: [{ name: "Vidéo" }] } }] },
      },
      include: { adSets: { include: { ads: true } } },
    });
  const campaign = await make("P15 · TikTok");
  const other = await make("P15 · Meta");
  ids.campaign = campaign.id;
  ids.other = other.id;
  const ad = campaign.adSets[0]!.ads[0]!;
  const otherAd = other.adSets[0]!.ads[0]!;
  const page = await prisma.landingPage.create({
    data: { slug: "promo-p15", name: "Promo", channelId: channel.id, headline: "Bonus" },
  });
  ids.page = page.id;
  const link = (
    over: Partial<{ kind: "AD_ENTRY" | "LANDING"; campaignId: string; landingAdId: string }> & {
      url: string;
      createdAt: Date;
      landingSource?: string | null;
    },
  ) =>
    prisma.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        telegramInviteLink: over.url,
        name: "Promo-tk01",
        kind: over.kind ?? "LANDING",
        campaignId: over.campaignId ?? null,
        landingAdId: over.landingAdId ?? null,
        ...(over.kind === "AD_ENTRY"
          ? {}
          : {
              landingPageId: page.id,
              landingSource: over.landingSource === undefined ? "tk01" : over.landingSource,
            }),
        createdAt: over.createdAt,
      },
    });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
  // Lien direct de la pub (lien d'entrée affiché), ancien lien de la page créé pour la pub de l'autre campagne (révoqué),
  // lien actuel de la page créé pour la pub de cette campagne, lien en trop d'un passage concurrent (sans source).
  const direct = await link({
    kind: "AD_ENTRY",
    url: "https://t.me/+p15direct",
    createdAt: hoursAgo(30),
    campaignId: campaign.id,
  });
  await prisma.ad.update({ where: { id: ad.id }, data: { inviteLinkId: direct.id } });
  const old = await link({
    url: "https://t.me/+p15old",
    createdAt: hoursAgo(20),
    campaignId: other.id,
    landingAdId: otherAd.id,
  });
  const current = await link({
    url: "https://t.me/+p15new",
    createdAt: hoursAgo(10),
    campaignId: campaign.id,
    landingAdId: ad.id,
  });
  const spare = await link({
    url: "https://t.me/+p15spare",
    createdAt: hoursAgo(9),
    landingSource: null,
  });
  await prisma.inviteLink.update({ where: { id: old.id }, data: { isActive: false } });
  await prisma.inviteLink.update({ where: { id: spare.id }, data: { isActive: false } });
  await prisma.landingSource.create({
    data: { landingPageId: page.id, key: "tk01", adId: ad.id, inviteLinkId: current.id },
  });
  Object.assign(ids, { direct: direct.id, current: current.id, old: old.id, spare: spare.id });

  const view = (visitId: string, at: Date, isBot = false) =>
    prisma.landingEvent.create({
      data: {
        landingPageId: page.id,
        sourceKey: "tk01",
        type: "VIEW",
        visitId,
        isBot,
        createdAt: at,
      },
    });
  await view("visite-ancienne", hoursAgo(15)); // bouton : ancien lien (autre campagne)
  await view("visite-1", hoursAgo(5)); // lien actuel
  await view("visite-1", hoursAgo(4.9)); // même visite : une seule fois
  await view("visite-2", hoursAgo(3));
  await view("robot", hoursAgo(2), true); // robot : jamais compté
  await prisma.landingEvent.create({
    data: {
      landingPageId: page.id,
      sourceKey: "tk01",
      type: "CLICK",
      visitId: "visite-2",
      createdAt: hoursAgo(3),
    },
  });
});

afterAll(async () => {
  await clean();
  await resetDb();
});

describe("pages d'atterrissage dans Campagnes", () => {
  it("visites rattachées au lien affiché à ce moment-là (une par visite, robots exclus)", async () => {
    const rows = await landingVisitsByLink({ since: new Date(Date.now() - 86_400_000) });
    const byLink = new Map<string, number>();
    for (const r of rows) byLink.set(r.inviteLinkId, (byLink.get(r.inviteLinkId) ?? 0) + r.visits);
    expect(Object.fromEntries(byLink)).toEqual({ [ids.old]: 1, [ids.current]: 2 });
    // Périmètre d'une campagne : seulement ses liens.
    const mine = await landingVisitsByLink({
      since: new Date(Date.now() - 86_400_000),
      inviteLinkIds: [ids.current, ids.direct],
    });
    expect(mine.reduce((n, r) => n + r.visits, 0)).toBe(2);
    expect(await landingVisitsByLink({ since: new Date(0), inviteLinkIds: [] })).toEqual([]);
  });

  it("les visites de la page sont des « Clics sur les pubs » de la campagne du lien, jamais de l'autre", async () => {
    const load = (id: string) =>
      prisma.campaign.findUniqueOrThrow({ where: { id }, include: campaignScopeInclude });
    const mine = await campaignTotals(
      ids.campaign,
      scopeFromCampaign(await load(ids.campaign)),
      period,
    );
    const theirs = await campaignTotals(
      ids.other,
      scopeFromCampaign(await load(ids.other)),
      period,
    );
    expect(mine.entryClicks).toBe(2);
    expect(theirs.entryClicks).toBe(1);
  });

  it("liens d'entrée affichés : le lien direct seulement (les liens de la page comptent, mais ne se collent pas dans une pub)", async () => {
    const c = await prisma.campaign.findUniqueOrThrow({
      where: { id: ids.campaign },
      include: campaignScopeInclude,
    });
    expect(scopeFromCampaign(c).inviteLinkIds.sort()).toEqual([ids.current, ids.direct].sort());
    expect(shownEntryLinkIds(c)).toEqual([ids.direct]);
    const list = await listCampaignsUncached(period);
    expect(list.rows.find((r) => r.id === ids.campaign)?.links).toBe(1);
    expect(list.rows.find((r) => r.id === ids.other)?.links).toBe(0);
  });
});
