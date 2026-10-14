/**
 * Lectures des affiliés Link Affi (phase 13) : campagnes Telegram d'affiliés (liens LINKAFFI), chiffres de la vue
 * « Affiliés Link Affi », périmètre d'un affilié pour les filtres, membres d'affiliés par canal (avertissement des
 * messages). Lecture seule ; les règles sont dans scope.ts et figures.ts.
 */
import { ourPlayers, prisma, type Prisma } from "@linkaffipro/db";
import { loadTelegramCampaignsView } from "@/lib/linkaffi/telegram-campaigns";
import { displayName } from "@/lib/members/query";
import { periodEnd, periodStart, type Period } from "@/lib/periods";
import { computeAffiliateViews, type AffiliateFigures, type AffiliateView } from "./figures";
import { linkaffiClicksFrom, type LinkaffiClicks } from "./linkaffi-clicks";
import { loadAffiliateCampaigns } from "./campaigns";
import {
  affiliateOptions,
  affiliatePlayerWhere,
  type AffiliateCampaignRef,
  type AffiliateOption,
} from "./scope";

export { affiliateScope, loadAffiliateCampaigns, loadAffiliateOptions } from "./campaigns";

/**
 * Clics Link Affi des campagnes (synchro, `Setting` « linkaffi.telegramCampaigns »), lus par le même lecteur que
 * Réglages → Connexions ; inconnus sans synchro (ou si la lecture échoue : la page s'affiche quand même).
 */
export async function loadLinkaffiClicks(): Promise<LinkaffiClicks> {
  const view = await loadTelegramCampaignsView().catch(() => null);
  return view ? linkaffiClicksFrom(view) : { syncedAt: null, available: false, clicks: {} };
}

export type AffiliatesPage = {
  /** Toutes les campagnes (choix des filtres), même hors filtre. */
  campaigns: AffiliateCampaignRef[];
  affiliates: AffiliateView[];
  totals: AffiliateFigures;
  clicks: LinkaffiClicks;
  /** Canaux qui ont au moins une campagne d'affilié (filtre « Canal »). */
  channels: Array<{ id: string; title: string }>;
  /** Affiliés connus (filtre « Affilié »). */
  options: AffiliateOption[];
};

const memberRef = { select: { linkaffiCampaignKey: true, affiliateInviteLinkId: true } } as const;

/**
 * Vue « Affiliés Link Affi » sur la période : chiffres par campagne puis par affilié (définitions dans figures.ts),
 * filtrés par canal et par affilié. Nos joueurs seulement (`ourPlayers`).
 */
export async function loadAffiliatesPage(input: {
  period: Period;
  channelId?: string | null;
  affiliateId?: string | null;
}): Promise<AffiliatesPage> {
  const [campaigns, clicks] = await Promise.all([loadAffiliateCampaigns(), loadLinkaffiClicks()]);
  const channels = [
    ...new Map(
      campaigns.map((c) => [c.channelId, { id: c.channelId, title: c.channelTitle }]),
    ).values(),
  ].sort((a, b) => a.title.localeCompare(b.title, "fr"));
  const options = affiliateOptions(campaigns);
  if (campaigns.length === 0)
    return {
      campaigns,
      affiliates: [],
      totals: computeAffiliateViews(
        {
          campaigns,
          memberships: [],
          present: [],
          offerClicks: [],
          players: [],
          playerEvents: [],
          clicks: {},
        },
        { start: new Date(0), end: new Date(0) },
      ).totals,
      clicks,
      channels,
      options,
    };

  const start = periodStart(input.period);
  const end = periodEnd(input.period);
  const within = { gte: start, lt: end };
  const keys = [...new Set(campaigns.map((c) => c.campaignKey))];
  const channelIds = channels.map((c) => c.id);
  const attributed: Prisma.MembershipWhereInput = {
    channelId: { in: channelIds },
    member: { linkaffiCampaignKey: { in: keys } },
  };
  const playerWhere: Prisma.PlayerWhereInput = {
    AND: [
      (await ourPlayers()) as Prisma.PlayerWhereInput,
      affiliatePlayerWhere(keys) as Prisma.PlayerWhereInput,
    ],
  };
  const [memberships, present, offerClicks, players, playerEvents] = await Promise.all([
    prisma.membership.findMany({
      where: {
        AND: [
          attributed,
          { OR: [{ requestedAt: within }, { approvedAt: within }, { leftAt: within }] },
        ],
      },
      select: {
        channelId: true,
        requestedAt: true,
        approvedAt: true,
        leftAt: true,
        member: memberRef,
      },
    }),
    prisma.membership.findMany({
      where: { AND: [attributed, { status: "APPROVED" }] },
      select: { channelId: true, memberId: true, member: memberRef },
    }),
    prisma.click.findMany({
      where: { linkaffiTelegramCampaignKey: { in: keys }, isBot: false, createdAt: within },
      select: { linkaffiTelegramCampaignKey: true, createdAt: true, member: memberRef },
    }),
    prisma.player.findMany({
      where: playerWhere,
      select: {
        id: true,
        memberId: true,
        registeredAt: true,
        ftdAt: true,
        ftdAmount: true,
        affiliateCampaign: { select: { name: true } },
        click: { select: { linkaffiTelegramCampaignKey: true } },
        member: {
          select: {
            linkaffiCampaignKey: true,
            affiliateInviteLinkId: true,
            firstName: true,
            lastName: true,
            username: true,
            anonymizedAt: true,
            telegramUserId: true,
          },
        },
      },
    }),
    prisma.playerEvent.findMany({
      where: {
        type: { in: ["FTD", "DEPOSIT", "REDEPOSIT", "NGR"] },
        occurredAt: within,
        player: playerWhere,
      },
      select: { playerId: true, type: true, amount: true, occurredAt: true },
    }),
  ]);
  const { affiliates, totals } = computeAffiliateViews(
    {
      campaigns,
      memberships,
      present,
      offerClicks,
      players: players.map((p) => ({
        id: p.id,
        memberId: p.memberId,
        memberName: p.member ? displayName(p.member) : "Joueur sans membre",
        offerName: p.affiliateCampaign.name,
        registeredAt: p.registeredAt,
        ftdAt: p.ftdAt,
        ftdAmount: p.ftdAmount === null ? null : Number(p.ftdAmount),
        click: p.click,
        member: p.member,
      })),
      playerEvents: playerEvents.map((e) => ({
        playerId: e.playerId,
        type: e.type,
        amount: e.amount === null ? null : Number(e.amount),
        occurredAt: e.occurredAt,
      })),
      clicks: clicks.clicks,
    },
    { start, end },
    { channelId: input.channelId || null, affiliateId: input.affiliateId || null },
  );
  return { campaigns, affiliates, totals, clicks, channels, options };
}

/**
 * Membres d'affiliés présents par canal (attribution en cours) : un message publié par le compte Telegram (sans
 * boutons) dans ces canaux ne peut pas créditer les affiliés (avertissement du formulaire des messages).
 */
export async function affiliateMembersByChannel(
  channelIds?: readonly string[],
  now = new Date(),
): Promise<Record<string, number>> {
  const rows = await prisma.membership
    .groupBy({
      by: ["channelId"],
      where: {
        status: "APPROVED",
        ...(channelIds ? { channelId: { in: [...channelIds] } } : {}),
        member: {
          linkaffiCampaignKey: { not: null },
          anonymizedAt: null,
          OR: [{ affiliateAttributionEndsAt: null }, { affiliateAttributionEndsAt: { gt: now } }],
        },
      },
      _count: { _all: true },
    })
    .catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.channelId, r._count._all]));
}
