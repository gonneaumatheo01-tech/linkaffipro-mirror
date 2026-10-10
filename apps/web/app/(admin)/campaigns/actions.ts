"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { invalidateDashboards } from "@/lib/dashboard/cache";
import { levelKey } from "@/lib/campaigns/match";
import { createCampaignEntryLink } from "@/lib/campaigns/entry-links";
import { jsonIds } from "@/lib/campaigns/attribution";
import { findOfferByKey, parseLinkAffiReference, UNKNOWN_KEY_MESSAGE } from "@/lib/campaigns/wizard";

function isRedirect(err: unknown): boolean {
  return (err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT") ?? false;
}
function go(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  adPlatform: z.enum(["", "TIKTOK", "META", "OTHER"]),
  vertical: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]),
  budgetDaily: z.string().trim(),
  notes: z.string().trim().max(2000),
  startAt: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  endAt: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/),
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
    channelIds: channelIds as unknown as Prisma.InputJsonValue,
  };
}

const CAMPAIGN_FORM_ERROR = "Vérifiez le formulaire : nom obligatoire (120 caractères maximum), dates au bon format et fin après le début.";

export async function createCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const data = campaignData(formData);
  if (!data) go("/campaigns/new", { error: CAMPAIGN_FORM_ERROR });
  const c = await prisma.campaign.create({ data });
  await audit({
    userId: user.id,
    action: "campaign.created",
    entityType: "Campaign",
    entityId: c.id,
    metadata: { name: c.name },
  });
  revalidatePath("/campaigns");
  go(`/campaigns/${c.id}`, {
    ok: "Campagne créée. Ajoutez ses offres, ses canaux et ses liens d'entrée depuis les onglets.",
  });
}

export async function updateCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("campaignId"));
  const data = campaignData(formData);
  if (!data) go(`/campaigns/${id}`, { error: CAMPAIGN_FORM_ERROR });
  await prisma.campaign.update({ where: { id }, data });
  await audit({
    userId: user.id,
    action: "campaign.updated",
    entityType: "Campaign",
    entityId: id,
    metadata: { name: data.name, status: data.status },
  });
  revalidatePath("/campaigns");
  go(`/campaigns/${id}`, { ok: "Campagne enregistrée." });
}

export async function addAdSetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) go(`/campaigns/${campaignId}`, { error: "Donnez un nom au groupe." });
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
  if (!name) go(`/campaigns/${campaignId}`, { error: "Donnez un nom à la pub précise." });
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
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "ads", ok: `Pub précise « ${name} » ajoutée.` });
}

/** Rattache un lien d'entrée (et son lien goolink) à une pub précise, et les marque comme liens de la campagne. */
async function attachLink(adId: string, inviteLinkId: string, campaignId: string, userId: string): Promise<void> {
  const link = await prisma.inviteLink.findUnique({
    where: { id: inviteLinkId },
    include: {
      ad: { select: { id: true } },
      trackingLinks: { where: { kind: "AD_ENTRY" }, select: { id: true }, take: 1 },
    },
  });
  if (!link) throw new Error("Ce lien d'entrée est introuvable.");
  if (link.ad && link.ad.id !== adId)
    throw new Error("Ce lien est déjà rattaché à une autre pub précise : détachez-le d'abord.");
  const trackingLinkId = link.trackingLinks[0]?.id ?? null;
  await prisma.$transaction([
    prisma.ad.update({ where: { id: adId }, data: { inviteLinkId, trackingLinkId } }),
    prisma.inviteLink.update({ where: { id: inviteLinkId }, data: { campaignId } }),
    ...(trackingLinkId ? [prisma.trackingLink.update({ where: { id: trackingLinkId }, data: { campaignId } })] : []),
  ]);
  await audit({
    userId,
    action: "ad.link_attached",
    entityType: "Ad",
    entityId: adId,
    metadata: { inviteLinkId, trackingLinkId },
  });
}

export async function attachLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const adId = z.string().min(1).parse(formData.get("adId"));
  const inviteLinkId = String(formData.get("inviteLinkId") ?? "");
  try {
    if (!inviteLinkId) {
      await prisma.ad.update({
        where: { id: adId },
        data: { inviteLinkId: null, trackingLinkId: null },
      });
      await audit({
        userId: user.id,
        action: "ad.link_detached",
        entityType: "Ad",
        entityId: adId,
      });
    } else await attachLink(adId, inviteLinkId, campaignId, user.id);
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, {
      tab: "ads",
      error: err instanceof Error ? err.message : "Rattachement impossible.",
    });
  }
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, {
    tab: "ads",
    ok: inviteLinkId ? "Lien rattaché à la pub précise." : "Lien détaché.",
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
      error: "Le montant doit être un nombre positif (ex. 42,50).",
    });
  const [kind, id] = d.level.split(":") as [string, string];
  const level =
    kind === "ad" ? { adId: id } : kind === "adset" ? { adSetId: id } : { campaignId: id };
  const key = levelKey(level);
  const date = new Date(`${d.date}T00:00:00.000Z`);
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
  invalidateDashboards();
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
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true, adPlatform: true, adSets: { select: { _count: { select: { ads: true } } } } } });
  if (!campaign) go("/campaigns", { error: "Campagne introuvable." });
  if (!channelId) go(`/campaigns/${campaignId}`, { tab: "links", error: "Choisissez le canal que ce lien doit ouvrir." });
  const platform = (PLATFORMS as readonly string[]).includes(platformRaw) ? (platformRaw as (typeof PLATFORMS)[number]) : (campaign.adPlatform ?? "OTHER");
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
    if (!campaign.adPlatform) await prisma.campaign.update({ where: { id: campaignId }, data: { adPlatform: platform } });
    invalidateDashboards();
    revalidatePath(`/campaigns/${campaignId}`);
    go(`/campaigns/${campaignId}`, { tab: "links", ok: `Lien d'entrée « ${r.trackingLink.label} » créé : copiez son adresse dans la pub.` });
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, { tab: "links", error: err instanceof Error ? err.message : "Création du lien impossible." });
  }
}

/** Onglet Canaux : enregistre les canaux cochés. */
export async function updateChannelsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const channelIds = [...new Set(formData.getAll("channelIds").map(String).filter(Boolean))];
  await prisma.campaign.update({ where: { id: campaignId }, data: { channelIds } });
  await audit({ userId: user.id, action: "campaign.channels_updated", entityType: "Campaign", entityId: campaignId, metadata: { channelIds } });
  invalidateDashboards();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "channels", ok: `${channelIds.length} canal${channelIds.length > 1 ? "aux" : ""} enregistré${channelIds.length > 1 ? "s" : ""}.` });
}

/** Onglet Offres : ajoute une campagne Link Affi (choisie dans la liste ou collée sous forme de lien linkaffi.me/go/<clé>). */
export async function addOfferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const chosen = String(formData.get("affiliateCampaignId") ?? "").trim();
  const pasted = String(formData.get("reference") ?? "").trim();
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { affiliateCampaignIds: true } });
  if (!campaign) go("/campaigns", { error: "Campagne introuvable." });
  let offer: { id: string; name: string } | null = null;
  if (chosen) offer = await prisma.affiliateCampaign.findFirst({ where: { id: chosen, isActive: true }, select: { id: true, name: true } });
  else if (pasted) {
    const key = parseLinkAffiReference(pasted);
    if (!key) go(`/campaigns/${campaignId}`, { tab: "offers", error: "Collez un lien de la forme https://linkaffi.me/go/<clé> ou la clé seule." });
    const candidates = await prisma.affiliateCampaign.findMany({ where: { isActive: true }, select: { id: true, name: true, campaignKey: true, externalId: true, trackingUrlTemplate: true, program: { select: { name: true } } } });
    offer = findOfferByKey(key, candidates.map((c) => ({ ...c, programName: c.program.name })));
  } else go(`/campaigns/${campaignId}`, { tab: "offers", error: "Choisissez une offre dans la liste ou collez un lien d'offre." });
  if (!offer) go(`/campaigns/${campaignId}`, { tab: "offers", error: UNKNOWN_KEY_MESSAGE });
  const current = jsonIds(campaign.affiliateCampaignIds);
  if (!current.includes(offer.id)) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { affiliateCampaignIds: [...current, offer.id] } });
    await audit({ userId: user.id, action: "campaign.affiliate_linked", entityType: "Campaign", entityId: campaignId, metadata: { affiliateCampaignId: offer.id, affiliateCampaignName: offer.name } });
  }
  invalidateDashboards();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "offers", ok: `Offre « ${offer.name} » rattachée.` });
}

/** Onglet Offres : retire une campagne Link Affi (les messages déjà publiés gardent leur lien). */
export async function removeOfferAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const offerId = z.string().min(1).parse(formData.get("affiliateCampaignId"));
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { affiliateCampaignIds: true } });
  if (!campaign) go("/campaigns", { error: "Campagne introuvable." });
  const next = jsonIds(campaign.affiliateCampaignIds).filter((id) => id !== offerId);
  await prisma.campaign.update({ where: { id: campaignId }, data: { affiliateCampaignIds: next } });
  await audit({ userId: user.id, action: "campaign.affiliate_unlinked", entityType: "Campaign", entityId: campaignId, metadata: { affiliateCampaignId: offerId } });
  invalidateDashboards();
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { tab: "offers", ok: "Offre retirée de la campagne." });
}
