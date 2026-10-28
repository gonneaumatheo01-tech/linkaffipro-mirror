/**
 * Lectures en base des écrans Personas (phase 17) : liste, fiche, choix du formulaire (offres, campagnes, visuels,
 * modèles), persona telle que la lit le moteur (bouton « Tester » et aperçu des consignes), textes proposés du profil.
 */
import { jsonIds } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { assistantProfilePlan } from "@linkaffipro/telegram";
import { CHAT_LANGS, type PersonaInput, type VeniceModelInfo } from "@linkaffipro/chat";
import { loadAssistantConfig } from "@/lib/assistant/config";
import { listOfferCandidates } from "@/lib/campaigns/queries";
import { visibleOffers } from "@/lib/campaigns/wizard";
import { OFFER_VISUAL_MIME_TYPES, type PersonaRecord, type ProfileTemplates } from "./form";
import { cleanFaq } from "./faq";
import { personaTurnInput } from "./test-turn";
import type { CampaignChoice, OfferChoice, PersonaListItem, VipLinkChoice } from "./view";

/** Liste des personas : actives d'abord, puis par prénom. */
export async function loadPersonaList(): Promise<PersonaListItem[]> {
  const rows = await prisma.persona.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      gender: true,
      identityKind: true,
      universe: true,
      faq: true,
      isActive: true,
      affiliateCampaign: { select: { name: true, isActive: true } },
      bots: { select: { username: true, mode: true }, orderBy: { username: "asc" } },
      _count: { select: { conversations: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    gender: r.gender,
    identityKind: r.identityKind,
    universe: r.universe,
    faqCount: cleanFaq(r.faq).length,
    isActive: r.isActive,
    offer: r.affiliateCampaign,
    bots: r.bots,
    conversations: r._count.conversations,
  }));
}

export type PersonaDetail = PersonaRecord & {
  createdAt: Date;
  updatedAt: Date;
  affiliateCampaign: {
    id: string;
    name: string;
    isActive: boolean;
    trackingUrlTemplate: string;
  } | null;
  campaign: { id: string; name: string } | null;
  offerMediaAsset: { id: string; filename: string; mimeType: string } | null;
  bots: Array<{ id: string; name: string; username: string; mode: string }>;
  conversations: number;
};

/** Fiche d'une persona (null si elle n'existe pas). */
export async function loadPersona(id: string): Promise<PersonaDetail | null> {
  const p = await prisma.persona.findUnique({
    where: { id },
    include: {
      affiliateCampaign: {
        select: { id: true, name: true, isActive: true, trackingUrlTemplate: true },
      },
      campaign: { select: { id: true, name: true } },
      offerMediaAsset: { select: { id: true, filename: true, mimeType: true } },
      bots: {
        select: { id: true, name: true, username: true, mode: true },
        orderBy: { username: "asc" },
      },
      bookmakers: {
        select: {
          bookmakerKey: true,
          label: true,
          priority: true,
          affiliateCampaignId: true,
          inviteLinkId: true,
        },
        orderBy: { priority: "asc" },
      },
      _count: { select: { conversations: true } },
    },
  });
  if (!p) return null;
  const { _count, ...rest } = p;
  return { ...rest, conversations: _count.conversations };
}

export type PersonaFormChoices = {
  offers: OfferChoice[];
  campaigns: CampaignChoice[];
  images: Array<{ id: string; filename: string; mimeType: string }>;
  models: VeniceModelInfo[];
  defaultModel: string;
  templates: ProfileTemplates;
  /** Liens d'invitation de nos canaux, pour le canal VIP de chaque bookmaker (Paris sportifs). */
  vipLinks: VipLinkChoice[];
};

/** Types de liens proposés comme lien d'un canal VIP (jamais un lien de pub suivie, d'affilié ou de page). */
const VIP_LINK_KINDS = ["MANUAL", "SHARE", "AD_ENTRY"] as const;

/**
 * Choix du formulaire : nos offres actives (celles de l'univers Rencontres d'abord à l'affichage ; seules les offres
 * reconnues comme nôtres quand il y en a), l'offre déjà liée en plus si elle n'y est plus ; nos campagnes ; les
 * images déjà envoyées ; les modèles du cache des réglages ; les textes proposés du profil du bot.
 */
export async function loadPersonaFormChoices(current?: {
  affiliateCampaignId: string | null;
  offerMediaAssetId: string | null;
  /** Offres et liens VIP des bookmakers déjà enregistrés (proposés même s'ils ne sont plus dans les listes). */
  bookmakers?: ReadonlyArray<{ affiliateCampaignId: string | null; inviteLinkId: string | null }>;
}): Promise<PersonaFormChoices> {
  const currentLinkIds = (current?.bookmakers ?? []).flatMap((b) =>
    b.inviteLinkId ? [b.inviteLinkId] : [],
  );
  const [candidates, campaigns, images, config, links] = await Promise.all([
    listOfferCandidates(),
    prisma.campaign.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, affiliateCampaignIds: true },
    }),
    prisma.mediaAsset.findMany({
      where: { mimeType: { in: [...OFFER_VISUAL_MIME_TYPES] } },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, filename: true, mimeType: true },
    }),
    loadAssistantConfig(),
    prisma.inviteLink.findMany({
      where: {
        OR: [
          { isActive: true, kind: { in: [...VIP_LINK_KINDS] }, channel: { isActive: true } },
          ...(currentLinkIds.length ? [{ id: { in: currentLinkIds } }] : []),
        ],
      },
      orderBy: [{ channel: { title: "asc" } }, { createdAt: "desc" }],
      take: 300,
      select: {
        id: true,
        name: true,
        telegramInviteLink: true,
        isActive: true,
        channel: { select: { title: true } },
      },
    }),
  ]);
  const offers: OfferChoice[] = visibleOffers(candidates, false).map((o) => ({
    id: o.id,
    name: o.name,
    programName: o.programName,
    vertical: o.vertical,
    isActive: true,
  }));
  const currentOfferIds = [
    current?.affiliateCampaignId,
    ...(current?.bookmakers ?? []).map((b) => b.affiliateCampaignId),
  ].filter((id): id is string => Boolean(id) && !offers.some((o) => o.id === id));
  if (currentOfferIds.length) {
    const rows = await prisma.affiliateCampaign.findMany({
      where: { id: { in: [...new Set(currentOfferIds)] } },
      select: {
        id: true,
        name: true,
        vertical: true,
        isActive: true,
        program: { select: { name: true } },
      },
    });
    for (const o of rows)
      offers.push({
        id: o.id,
        name: o.name,
        programName: o.program.name,
        vertical: o.vertical,
        isActive: o.isActive,
      });
  }
  const currentMediaId = current?.offerMediaAssetId;
  if (currentMediaId && !images.some((m) => m.id === currentMediaId)) {
    const m = await prisma.mediaAsset.findUnique({
      where: { id: currentMediaId },
      select: { id: true, filename: true, mimeType: true },
    });
    if (m) images.unshift(m);
  }
  return {
    offers,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      affiliateCampaignIds: jsonIds(c.affiliateCampaignIds),
    })),
    images,
    models: config.models,
    defaultModel: config.defaultModel,
    templates: profileTemplates(),
    vipLinks: links.map((l) => ({
      id: l.id,
      label: `${l.channel.title.trim() || "Canal sans titre"} · ${l.name}`,
      url: l.telegramInviteLink,
      isActive: l.isActive,
    })),
  };
}

/**
 * Textes proposés du profil du bot, par langue et par rôle, avec le repère `{name}` : exactement ceux que
 * `setAssistantProfile` pose quand la fiche n'a pas de texte (`assistantProfilePlan` de packages/telegram).
 */
export function profileTemplates(): ProfileTemplates {
  const out: ProfileTemplates = {};
  for (const lang of CHAT_LANGS) {
    const entry = (gender: "F" | "M") => {
      const e = assistantProfilePlan({
        name: "{name}",
        gender,
        languages: [lang],
        botDescription: null,
        botShortDescription: null,
      }).entries[0]!;
      return { long: e.description, short: e.shortDescription };
    };
    out[lang] = { F: entry("F"), M: entry("M") };
  }
  return out;
}

/**
 * Persona telle que la lit le moteur (même règle que le worker) : offre utilisable seulement si l'offre liée est
 * active et a son adresse de suivi ; titre du canal = premier canal de la campagne liée, sinon un canal où un bot
 * assistant de cette persona est administrateur ; nom du bot = premier bot assistant qui l'utilise.
 */
export async function loadPersonaTurnInput(id: string): Promise<{
  input: PersonaInput;
  offerLinked: boolean;
  /** Liens actifs des canaux VIP par clé de bookmaker (bouton « Tester »). */
  vipLinks: Record<string, string>;
} | null> {
  const p = await prisma.persona.findUnique({
    where: { id },
    include: {
      affiliateCampaign: { select: { isActive: true, trackingUrlTemplate: true } },
      campaign: { select: { channelIds: true } },
      bookmakers: {
        select: {
          bookmakerKey: true,
          label: true,
          priority: true,
          affiliateCampaign: { select: { isActive: true, trackingUrlTemplate: true } },
          inviteLink: { select: { telegramInviteLink: true, isActive: true } },
        },
      },
      bots: {
        where: { mode: "ASSISTANT" },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!p) return null;
  const offerUsable = Boolean(
    p.affiliateCampaign?.isActive && p.affiliateCampaign.trackingUrlTemplate.trim(),
  );
  const channelTitle = await personaChannelTitle(
    jsonIds(p.campaign?.channelIds),
    p.bots.map((b) => b.id),
  );
  return {
    input: personaTurnInput(p, {
      offerUsable,
      channelTitle,
      botName: p.bots[0]?.name ?? null,
    }),
    offerLinked: Boolean(p.affiliateCampaignId) || p.bookmakers.length > 0,
    vipLinks: Object.fromEntries(
      p.bookmakers.flatMap((b) =>
        b.inviteLink?.isActive ? [[b.bookmakerKey, b.inviteLink.telegramInviteLink]] : [],
      ),
    ),
  };
}

async function personaChannelTitle(channelIds: string[], botIds: string[]): Promise<string | null> {
  if (channelIds.length > 0) {
    const channels = await prisma.channel.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, title: true },
    });
    for (const cid of channelIds) {
      const c = channels.find((x) => x.id === cid);
      if (c?.title) return c.title;
    }
  }
  if (botIds.length === 0) return null;
  const admin = await prisma.channelBotAdmin.findFirst({
    where: { botId: { in: botIds }, revokedAt: null, channel: { isActive: true } },
    orderBy: { detectedAt: "asc" },
    select: { channel: { select: { title: true } } },
  });
  return admin?.channel.title ?? null;
}
