"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit, Prisma } from "@linkaffipro/db";
import { requireUser, type CurrentUser } from "@/lib/session";
import { levelKey } from "@/lib/campaigns/match";
import { createCampaignEntryLink } from "@/lib/campaigns/entry-links";
import { jsonIds } from "@/lib/campaigns/attribution";
import { keepInactiveChannels } from "@/lib/campaigns/channels";
import { findImportedShellByName, mergeImportedCampaign } from "@/lib/campaigns/merge";
import { campaignCostScope } from "@/lib/campaigns/cost-scope";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import {
  findOfferByKey,
  parseLinkAffiReference,
  UNKNOWN_KEY_MESSAGE,
} from "@/lib/campaigns/wizard";

function isRedirect(err: unknown): boolean {
  return (err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT") ?? false;
}
function go(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

/** Suppressions réservées aux administrateurs (règle produit) : message clair au lieu d'une page d'erreur. */
async function requireAdminOn(path: string, params: Record<string, string>): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN")
    go(path, { ...params, error: "Suppression réservée aux administrateurs." });
  return user;
}

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  adPlatform: z.enum(["", "TIKTOK", "META", "OTHER"]),
  vertical: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]),
  budgetDaily: z.string().trim(),
  notes: z.string().trim().max(2000),
  startAt: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/),
  endAt: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/),
  connectionId: z.string().trim(),
});

function campaignData(formData: FormData) {
  const parsed = campaignSchema.safeParse({
    name: formData.get("name") ?? "",
    adPlatform: formData.get("adPlatform") ?? "",
    vertical: formData.get("vertical") ?? "",
    status: formData.get("status") ?? "DRAFT",
    budgetDaily: formData.get("budgetDaily") ?? "",
    notes: formData.get("notes") ?? "",
    startAt: formData.get("startAt") ?? "",
    endAt: formData.get("endAt") ?? "",
    connectionId: formData.get("connectionId") ?? "",
  });
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.startAt && d.endAt && d.endAt < d.startAt) return null;
  const budget = d.budgetDaily === "" ? null : Number(d.budgetDaily.replace(",", "."));
  const channelIds = formData.getAll("channelIds").map(String).filter(Boolean);
  return {
    name: d.name,
    adPlatform: d.adPlatform === "" ? null : d.adPlatform,
    vertical: isVertical(d.vertical) ? d.vertical : null,
    status: d.status,
    budgetDaily: budget !== null && Number.isFinite(budget) && budget >= 0 ? budget : null,
    notes: d.notes || null,
    startAt: d.startAt ? new Date(`${d.startAt}T00:00:00.000Z`) : null,
    endAt: d.endAt ? new Date(`${d.endAt}T00:00:00.000Z`) : null,
    connectionId: d.connectionId || null,
    channelIds,
  };
}

const CAMPAIGN_FORM_ERROR =
  "Vérifiez le formulaire : nom obligatoire (120 caractères maximum), dates au bon format et fin après le début.";

/** Canaux cochés + canaux désactivés déjà rattachés (jamais retirés en silence). */
async function nextChannelIds(checked: string[], previous: unknown): Promise<string[]> {
  const prev = jsonIds(previous);
  const active = await prisma.channel.findMany({
    where: { id: { in: [...new Set([...checked, ...prev])] }, isActive: true },
    select: { id: true },
  });
  return keepInactiveChannels(checked, prev, new Set(active.map((c) => c.id)));
}

/**
 * Vue d'ensemble → « Modifier la campagne » : nom, plateforme, univers, statut, budget, dates, canaux, compte pub
 * connecté, notes. Changer de compte détache la campagne pub suivie (identifiant externe) : le nouveau compte la
 * retrouvera par son nom, ou elle se rattache depuis l'onglet Pubs.
 */
export async function updateCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("campaignId"));
  const data = campaignData(formData);
  if (!data) go(`/campaigns/${id}`, { error: CAMPAIGN_FORM_ERROR });
  const current = await prisma.campaign.findUnique({
    where: { id },
    select: { channelIds: true, connectionId: true, externalCampaignId: true },
  });
  if (!current) go("/campaigns", { error: "Campagne introuvable." });
  let adPlatform = data.adPlatform;
  if (data.connectionId && data.connectionId !== current.connectionId) {
    const conn = await prisma.adAccountConnection.findFirst({
      where: { id: data.connectionId, status: "ACTIVE" },
      select: { platform: true, name: true },
    });
    if (!conn)
      go(`/campaigns/${id}`, {
        error:
          "Ce compte publicitaire n'est plus connecté : choisissez-en un autre (Réglages → Connecteurs) ou « sans compte ».",
      });
    if (adPlatform && adPlatform !== conn.platform)
      go(`/campaigns/${id}`, {
        error: `Le compte « ${conn.name} » est un compte ${conn.platform === "META" ? "Meta" : conn.platform === "TIKTOK" ? "TikTok" : "publicitaire"} : choisissez cette plateforme, ou un autre compte.`,
      });
    adPlatform = conn.platform;
  }
  const connectionChanged = data.connectionId !== current.connectionId;
  const channelIds = await nextChannelIds(data.channelIds, current.channelIds);
  await prisma.campaign.update({
    where: { id },
    data: {
      ...data,
      adPlatform,
      channelIds: channelIds as unknown as Prisma.InputJsonValue,
      ...(connectionChanged && current.externalCampaignId
        ? { externalCampaignId: null, adExternalIds: Prisma.DbNull }
        : {}),
    },
  });
  await audit({
    userId: user.id,
    action: "campaign.updated",
    entityType: "Campaign",
    entityId: id,
    metadata: {
      name: data.name,
      status: data.status,
      channelIds,
      ...(connectionChanged
        ? {
            connectionId: data.connectionId,
            previousConnectionId: current.connectionId,
            adCampaignDetached: !!current.externalCampaignId,
          }
        : {}),
    },
  });
  // Rapprochement par le nom : la campagne a un compte mais ne suit aucune campagne pub, et la campagne pub du même
  // nom est déjà importée de ce compte → elle est reprise (comme « Rattacher une campagne pub importée »).
  let byName: { name: string } | null = null;
  let byNameError: string | null = null;
  const followsAdCampaign = !!current.externalCampaignId && !connectionChanged;
  if (data.connectionId && !followsAdCampaign) {
    const shell = await findImportedShellByName(data.connectionId, data.name, id).catch(() => null);
    if (shell)
      try {
        const r = await mergeImportedCampaign({
          targetId: id,
          shellId: shell.id,
          userId: user.id,
          matchedByName: true,
        });
        byName = { name: r.platformName };
      } catch (err) {
        byNameError = err instanceof Error ? err.message : "rattachement impossible";
      }
  }
  await refreshCampaignStats();
  revalidatePath("/campaigns");
  if (byNameError)
    go(`/campaigns/${id}`, {
      error: `Campagne enregistrée, mais la campagne pub du même nom n'a pas pu être reprise : ${byNameError} Réessayez depuis l'onglet Pubs (« Rattacher une campagne pub importée »).`,
    });
  go(`/campaigns/${id}`, {
    ok: byName
      ? `Campagne enregistrée. La campagne pub « ${byName.name} » (même nom, déjà importée du compte) a été reprise : ses groupes, pubs et dépenses sont dans l'onglet Pubs.`
      : "Campagne enregistrée.",
  });
}

export async function addAdSetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) go(`/campaigns/${campaignId}`, { tab: "ads", error: "Donnez un nom au groupe." });
  try {
    const s = await prisma.adSet.create({ data: { campaignId, name } });
    await audit({
      userId: user.id,
      action: "adset.created",
      entityType: "AdSet",
      entityId: s.id,
      metadata: { name },
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, {
      tab: "ads",
      error: "Un groupe porte déjà ce nom dans cette campagne : choisissez-en un autre.",
    });
  }
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "ads", ok: `Groupe « ${name} » ajouté.` });
}

export async function addAdAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const adSetId = z.string().min(1).parse(formData.get("adSetId"));
  const name = String(formData.get("name") ?? "").trim();
  const inviteLinkId = String(formData.get("inviteLinkId") ?? "");
  if (!name)
    go(`/campaigns/${campaignId}`, { tab: "ads", error: "Donnez un nom à la pub précise." });
  try {
    const ad = await prisma.ad.create({ data: { adSetId, name } });
    await audit({
      userId: user.id,
      action: "ad.created",
      entityType: "Ad",
      entityId: ad.id,
      metadata: { name },
    });
    if (inviteLinkId) await attachLink(ad.id, inviteLinkId, campaignId, user.id);
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, {
      tab: "ads",
      error: err instanceof Error ? err.message : "Création impossible.",
    });
  }
  if (inviteLinkId) await refreshCampaignStats();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "ads", ok: `Pub précise « ${name} » ajoutée.` });
}

/** Retire un lien d'entrée (et son lien goolink) de la campagne : il redevient un lien libre (page Liens). */
function releaseLinkOps(link: { inviteLinkId: string | null; trackingLinkId: string | null }) {
  return [
    ...(link.inviteLinkId
      ? [prisma.inviteLink.update({ where: { id: link.inviteLinkId }, data: { campaignId: null } })]
      : []),
    ...(link.trackingLinkId
      ? [
          prisma.trackingLink.update({
            where: { id: link.trackingLinkId },
            data: { campaignId: null },
          }),
        ]
      : []),
  ];
}

/**
 * Rattache un lien d'entrée (et son lien goolink) à une pub précise, et les marque comme liens de la campagne.
 * Si la pub avait déjà un autre lien, celui-ci quitte la campagne (campagne remise à vide).
 */
async function attachLink(
  adId: string,
  inviteLinkId: string,
  campaignId: string,
  userId: string,
): Promise<void> {
  const [link, ad] = await Promise.all([
    prisma.inviteLink.findUnique({
      where: { id: inviteLinkId },
      include: {
        ad: { select: { id: true } },
        trackingLinks: { where: { kind: "AD_ENTRY" }, select: { id: true }, take: 1 },
      },
    }),
    prisma.ad.findUnique({
      where: { id: adId },
      select: { inviteLinkId: true, trackingLinkId: true },
    }),
  ]);
  if (!link) throw new Error("Ce lien d'entrée est introuvable.");
  if (link.ad && link.ad.id !== adId)
    throw new Error("Ce lien est déjà rattaché à une autre pub précise : détachez-le d'abord.");
  const trackingLinkId = link.trackingLinks[0]?.id ?? null;
  const previous =
    ad && ad.inviteLinkId && ad.inviteLinkId !== inviteLinkId
      ? { inviteLinkId: ad.inviteLinkId, trackingLinkId: ad.trackingLinkId }
      : null;
  await prisma.$transaction([
    // L'ancien lien d'abord : il libère la place (liens uniques par pub) et quitte la campagne.
    ...(previous ? releaseLinkOps(previous) : []),
    prisma.ad.update({ where: { id: adId }, data: { inviteLinkId, trackingLinkId } }),
    prisma.inviteLink.update({ where: { id: inviteLinkId }, data: { campaignId } }),
    ...(trackingLinkId
      ? [prisma.trackingLink.update({ where: { id: trackingLinkId }, data: { campaignId } })]
      : []),
  ]);
  await audit({
    userId,
    action: "ad.link_attached",
    entityType: "Ad",
    entityId: adId,
    metadata: {
      inviteLinkId,
      trackingLinkId,
      replacedInviteLinkId: previous?.inviteLinkId ?? null,
    },
  });
}

export async function attachLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const adId = z.string().min(1).parse(formData.get("adId"));
  const inviteLinkId = String(formData.get("inviteLinkId") ?? "");
  try {
    if (!inviteLinkId) {
      const ad = await prisma.ad.findUnique({
        where: { id: adId },
        select: { inviteLinkId: true, trackingLinkId: true },
      });
      await prisma.$transaction([
        prisma.ad.update({
          where: { id: adId },
          data: { inviteLinkId: null, trackingLinkId: null },
        }),
        ...(ad ? releaseLinkOps(ad) : []),
      ]);
      await audit({
        userId: user.id,
        action: "ad.link_detached",
        entityType: "Ad",
        entityId: adId,
        metadata: {
          inviteLinkId: ad?.inviteLinkId ?? null,
          trackingLinkId: ad?.trackingLinkId ?? null,
        },
      });
    } else await attachLink(adId, inviteLinkId, campaignId, user.id);
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, {
      tab: "ads",
      error: err instanceof Error ? err.message : "Rattachement impossible.",
    });
  }
  await refreshCampaignStats();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, {
    tab: "ads",
    ok: inviteLinkId
      ? "Lien rattaché à la pub précise."
      : "Lien détaché : il ne fait plus partie de la campagne.",
  });
}

const costSchema = z.object({
  campaignId: z.string().min(1),
  level: z.string().regex(/^(campaign|adset|ad):.+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.string().trim(),
  impressions: z.string().trim(),
  clicks: z.string().trim(),
});

/** Saisie manuelle d'une dépense pour un jour (remplace la valeur manuelle existante du même jour). */
export async function addManualCostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = costSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    go("/campaigns", { error: "Saisie incomplète : vérifiez le jour et la dépense." });
  const d = parsed.data;
  const spend = Number(d.spend.replace(",", "."));
  if (!Number.isFinite(spend) || spend < 0)
    go(`/campaigns/${d.campaignId}`, {
      tab: "ads",
      error: "Le montant doit être un nombre positif (ex. 42,50).",
    });
  const [kind, id] = d.level.split(":") as [string, string];
  const level =
    kind === "ad" ? { adId: id } : kind === "adset" ? { adSetId: id } : { campaignId: id };
  const key = levelKey(level);
  const date = new Date(`${d.date}T00:00:00.000Z`);
  // L'API a priorité (voir lib/campaigns/cost-scope.ts) : une saisie un jour déjà couvert compterait deux fois.
  const fromApi = await prisma.adCost.findFirst({
    where: { source: "API", date, OR: campaignCostScope(d.campaignId) },
    select: { id: true },
  });
  if (fromApi)
    go(`/campaigns/${d.campaignId}`, {
      tab: "ads",
      error: `Le ${d.date}, les dépenses de cette campagne arrivent déjà de TikTok / Meta (API) : la saisie manuelle n'est pas nécessaire, l'API a priorité.`,
    });
  await prisma.adCost.upsert({
    where: { levelKey_date_source: { levelKey: key, date, source: "MANUAL" } },
    create: {
      ...level,
      levelKey: key,
      date,
      spend,
      impressions: Number(d.impressions) || 0,
      clicks: Number(d.clicks) || 0,
      source: "MANUAL",
    },
    update: { spend, impressions: Number(d.impressions) || 0, clicks: Number(d.clicks) || 0 },
  });
  await audit({
    userId: user.id,
    action: "adcost.manual",
    entityType: "Campaign",
    entityId: d.campaignId,
    metadata: { level: key, date: d.date, spend },
  });
  // Une dépense ancienne sort de la fenêtre du recalcul horaire (3 jours) : recalcul complet.
  await refreshCampaignStats();
  revalidatePath(`/campaigns/${d.campaignId}`);
  go(`/campaigns/${d.campaignId}`, { tab: "ads", ok: `Dépense du ${d.date} enregistrée.` });
}

const PLATFORMS = ["TIKTOK", "META", "OTHER"] as const;

/** Onglet Liens : ajoute une pub précise et son lien d'entrée (goolink + invitation Telegram) à la campagne. */
export async function addEntryLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const channelId = String(formData.get("channelId") ?? "");
  const adName = String(formData.get("adName") ?? "").trim();
  const adSetName = String(formData.get("adSetName") ?? "").trim();
  const platformRaw = String(formData.get("platform") ?? "");
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      name: true,
      adPlatform: true,
      adSets: { select: { _count: { select: { ads: true } } } },
    },
  });
  if (!campaign) go("/campaigns", { error: "Campagne introuvable." });
  if (!channelId)
    go(`/campaigns/${campaignId}`, {
      tab: "links",
      error: "Choisissez le canal que ce lien doit ouvrir.",
    });
  const platform = (PLATFORMS as readonly string[]).includes(platformRaw)
    ? (platformRaw as (typeof PLATFORMS)[number])
    : (campaign.adPlatform ?? "OTHER");
  const count = campaign.adSets.reduce((n, s) => n + s._count.ads, 0);
  try {
    const r = await createCampaignEntryLink({
      campaignId,
      campaignName: campaign.name,
      channelId,
      platform,
      adName: adName || `Pub ${count + 1}`,
      adSetName: adSetName || undefined,
      userId: user.id,
    });
    if (!campaign.adPlatform)
      await prisma.campaign.update({ where: { id: campaignId }, data: { adPlatform: platform } });
    await refreshCampaignStats();
    revalidatePath(`/campaigns/${campaignId}`);
    go(`/campaigns/${campaignId}`, {
      tab: "links",
      ok: `Lien d'entrée « ${r.trackingLink.label} » créé : copiez son adresse dans la pub.`,
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, {
      tab: "links",
      error: err instanceof Error ? err.message : "Création du lien impossible.",
    });
  }
}

/** Onglet Canaux : enregistre les canaux cochés (les canaux désactivés déjà rattachés sont conservés). */
export async function updateChannelsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const checked = [...new Set(formData.getAll("channelIds").map(String).filter(Boolean))];
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { channelIds: true },
  });
  if (!campaign) go("/campaigns", { error: "Campagne introuvable." });
  const channelIds = await nextChannelIds(checked, campaign.channelIds);
  await prisma.campaign.update({ where: { id: campaignId }, data: { channelIds } });
  await audit({
    userId: user.id,
    action: "campaign.channels_updated",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: { channelIds },
  });
  await refreshCampaignStats();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, {
    tab: "channels",
    ok: `${channelIds.length} canal${channelIds.length > 1 ? "aux" : ""} enregistré${channelIds.length > 1 ? "s" : ""}.`,
  });
}

/** Onglet Offres : ajoute une campagne Link Affi (choisie dans la liste ou collée sous forme de lien linkaffi.me/go/<clé>). */
export async function addOfferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const chosen = String(formData.get("affiliateCampaignId") ?? "").trim();
  const pasted = String(formData.get("reference") ?? "").trim();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { affiliateCampaignIds: true },
  });
  if (!campaign) go("/campaigns", { error: "Campagne introuvable." });
  let offer: { id: string; name: string } | null = null;
  if (chosen)
    offer = await prisma.affiliateCampaign.findFirst({
      where: { id: chosen, isActive: true },
      select: { id: true, name: true },
    });
  else if (pasted) {
    const key = parseLinkAffiReference(pasted);
    if (!key)
      go(`/campaigns/${campaignId}`, {
        tab: "offers",
        error: "Collez un lien de la forme https://linkaffi.me/go/<clé> ou la clé seule.",
      });
    const candidates = await prisma.affiliateCampaign.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        campaignKey: true,
        externalId: true,
        trackingUrlTemplate: true,
        program: { select: { name: true } },
      },
    });
    offer = findOfferByKey(
      key,
      candidates.map((c) => ({ ...c, programName: c.program.name })),
    );
  } else
    go(`/campaigns/${campaignId}`, {
      tab: "offers",
      error: "Choisissez une offre dans la liste ou collez un lien d'offre.",
    });
  if (!offer) go(`/campaigns/${campaignId}`, { tab: "offers", error: UNKNOWN_KEY_MESSAGE });
  const current = jsonIds(campaign.affiliateCampaignIds);
  if (!current.includes(offer.id)) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { affiliateCampaignIds: [...current, offer.id] },
    });
    await audit({
      userId: user.id,
      action: "campaign.affiliate_linked",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: { affiliateCampaignId: offer.id, affiliateCampaignName: offer.name },
    });
  }
  await refreshCampaignStats();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "offers", ok: `Offre « ${offer.name} » rattachée.` });
}

/** Onglet Offres : retire une campagne Link Affi (les boutons déjà publiés passent à une autre offre de la campagne). */
export async function removeOfferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const offerId = z.string().min(1).parse(formData.get("affiliateCampaignId"));
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { affiliateCampaignIds: true },
  });
  if (!campaign) go("/campaigns", { error: "Campagne introuvable." });
  const next = jsonIds(campaign.affiliateCampaignIds).filter((id) => id !== offerId);
  await prisma.campaign.update({ where: { id: campaignId }, data: { affiliateCampaignIds: next } });
  await audit({
    userId: user.id,
    action: "campaign.affiliate_unlinked",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: { affiliateCampaignId: offerId },
  });
  await refreshCampaignStats();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "offers", ok: "Offre retirée de la campagne." });
}

/** Onglet Pubs : « Rattacher une campagne pub importée » (voir lib/campaigns/merge.ts). */
export async function attachImportedCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const importedId = String(formData.get("importedCampaignId") ?? "");
  if (!importedId)
    go(`/campaigns/${campaignId}`, {
      tab: "ads",
      error: "Choisissez la campagne pub importée à rattacher.",
    });
  try {
    const r = await mergeImportedCampaign({
      targetId: campaignId,
      shellId: importedId,
      userId: user.id,
    });
    await refreshCampaignStats();
    revalidatePath("/campaigns");
    go(`/campaigns/${campaignId}`, {
      tab: "ads",
      ok: `Campagne pub « ${r.platformName} » rattachée : ses groupes, pubs et dépenses sont maintenant dans cette campagne.`,
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, {
      tab: "ads",
      error: err instanceof Error ? err.message : "Rattachement impossible.",
    });
  }
}

/**
 * Avant la suppression de pubs : leurs liens d'entrée (et liens goolink) sont rattachés à la campagne s'ils ne l'étaient
 * que par la pub (rattachement automatique de la synchro), pour qu'ils y restent avec leurs membres, clics et joueurs.
 */
function keepLinksInCampaignOps(
  campaignId: string,
  ads: ReadonlyArray<{ inviteLinkId: string | null; trackingLinkId: string | null }>,
) {
  const inviteLinkIds = ads.map((a) => a.inviteLinkId).filter((x): x is string => !!x);
  const trackingLinkIds = ads.map((a) => a.trackingLinkId).filter((x): x is string => !!x);
  return [
    ...(inviteLinkIds.length
      ? [
          prisma.inviteLink.updateMany({
            where: { id: { in: inviteLinkIds }, campaignId: null },
            data: { campaignId },
          }),
        ]
      : []),
    ...(trackingLinkIds.length
      ? [
          prisma.trackingLink.updateMany({
            where: { id: { in: trackingLinkIds }, campaignId: null },
            data: { campaignId },
          }),
        ]
      : []),
  ];
}

/** Onglet Pubs : supprime une pub précise (ADMIN). Ses coûts propres sont supprimés ; son lien d'entrée reste dans la campagne. */
export async function deleteAdAction(formData: FormData): Promise<void> {
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const adId = z.string().min(1).parse(formData.get("adId"));
  const user = await requireAdminOn(`/campaigns/${campaignId}`, { tab: "ads" });
  const ad = await prisma.ad.findFirst({
    where: { id: adId, adSet: { campaignId } },
    select: {
      id: true,
      name: true,
      inviteLinkId: true,
      trackingLinkId: true,
      adSet: { select: { name: true } },
    },
  });
  if (!ad) go(`/campaigns/${campaignId}`, { tab: "ads", error: "Pub introuvable." });
  await prisma.$transaction([
    ...keepLinksInCampaignOps(campaignId, [ad]),
    prisma.ad.delete({ where: { id: adId } }),
  ]);
  await audit({
    userId: user.id,
    action: "ad.deleted",
    entityType: "Ad",
    entityId: adId,
    metadata: { name: ad.name, adSet: ad.adSet.name, campaignId, inviteLinkId: ad.inviteLinkId },
  });
  await refreshCampaignStats();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "ads", ok: `Pub « ${ad.name} » supprimée.` });
}

/** Onglet Pubs : supprime un groupe et ses pubs précises (ADMIN). Leurs liens d'entrée restent dans la campagne. */
export async function deleteAdSetAction(formData: FormData): Promise<void> {
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const adSetId = z.string().min(1).parse(formData.get("adSetId"));
  const user = await requireAdminOn(`/campaigns/${campaignId}`, { tab: "ads" });
  const adSet = await prisma.adSet.findFirst({
    where: { id: adSetId, campaignId },
    select: {
      id: true,
      name: true,
      _count: { select: { ads: true } },
      ads: { select: { inviteLinkId: true, trackingLinkId: true } },
    },
  });
  if (!adSet) go(`/campaigns/${campaignId}`, { tab: "ads", error: "Groupe introuvable." });
  await prisma.$transaction([
    ...keepLinksInCampaignOps(campaignId, adSet.ads),
    prisma.adSet.delete({ where: { id: adSetId } }),
  ]);
  await audit({
    userId: user.id,
    action: "adset.deleted",
    entityType: "AdSet",
    entityId: adSetId,
    metadata: { name: adSet.name, campaignId, ads: adSet._count.ads },
  });
  await refreshCampaignStats();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "ads", ok: `Groupe « ${adSet.name} » supprimé.` });
}

/**
 * Vue d'ensemble : supprime la campagne (ADMIN). Groupes, pubs, coûts et statistiques de la campagne sont supprimés ;
 * ses liens d'entrée et liens traqués restent (page Liens) mais ne sont plus rattachés à une campagne ; les membres,
 * clics et joueurs sont conservés.
 */
export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const user = await requireAdminOn(`/campaigns/${campaignId}`, {});
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      externalCampaignId: true,
      connectionId: true,
      affiliateCampaignIds: true,
      channelIds: true,
      _count: { select: { adSets: true, inviteLinks: true, trackingLinks: true } },
    },
  });
  if (!campaign) go("/campaigns", { error: "Campagne introuvable." });
  await prisma.campaign.delete({ where: { id: campaignId } });
  await audit({
    userId: user.id,
    action: "campaign.deleted",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: {
      name: campaign.name,
      externalCampaignId: campaign.externalCampaignId,
      connectionId: campaign.connectionId,
      affiliateCampaignIds: jsonIds(campaign.affiliateCampaignIds),
      channelIds: jsonIds(campaign.channelIds),
      adSets: campaign._count.adSets,
      inviteLinks: campaign._count.inviteLinks,
      trackingLinks: campaign._count.trackingLinks,
    },
  });
  await refreshCampaignStats();
  revalidatePath("/campaigns");
  go("/campaigns", { ok: `Campagne « ${campaign.name} » supprimée.` });
}
