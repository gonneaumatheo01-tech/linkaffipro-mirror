"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { levelKey } from "@/lib/campaigns/match";

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
});

function campaignData(formData: FormData) {
  const parsed = campaignSchema.safeParse({
    name: formData.get("name") ?? "",
    adPlatform: formData.get("adPlatform") ?? "",
    vertical: formData.get("vertical") ?? "",
    status: formData.get("status") ?? "DRAFT",
    budgetDaily: formData.get("budgetDaily") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return null;
  const d = parsed.data;
  const budget = d.budgetDaily === "" ? null : Number(d.budgetDaily.replace(",", "."));
  const channelIds = formData.getAll("channelIds").map(String).filter(Boolean);
  return {
    name: d.name,
    adPlatform: d.adPlatform === "" ? null : d.adPlatform,
    vertical: isVertical(d.vertical) ? d.vertical : null,
    status: d.status,
    budgetDaily: budget !== null && Number.isFinite(budget) && budget >= 0 ? budget : null,
    notes: d.notes || null,
    channelIds: channelIds as unknown as Prisma.InputJsonValue,
  };
}

export async function createCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const data = campaignData(formData);
  if (!data) go("/campaigns/new", { error: "Formulaire invalide : le nom est obligatoire." });
  const c = await prisma.campaign.create({ data });
  await audit({ userId: user.id, action: "campaign.created", entityType: "Campaign", entityId: c.id, metadata: { name: c.name } });
  revalidatePath("/campaigns");
  go(`/campaigns/${c.id}`, { ok: "Pub créée. Ajoutez ses groupes et ses pubs, puis rattachez les liens d'entrée." });
}

export async function updateCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get("campaignId"));
  const data = campaignData(formData);
  if (!data) go(`/campaigns/${id}`, { error: "Formulaire invalide : le nom est obligatoire." });
  await prisma.campaign.update({ where: { id }, data });
  await audit({ userId: user.id, action: "campaign.updated", entityType: "Campaign", entityId: id, metadata: { name: data.name, status: data.status } });
  revalidatePath("/campaigns");
  go(`/campaigns/${id}`, { ok: "Pub enregistrée." });
}

export async function addAdSetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) go(`/campaigns/${campaignId}`, { error: "Nom du groupe obligatoire." });
  try {
    const s = await prisma.adSet.create({ data: { campaignId, name } });
    await audit({ userId: user.id, action: "adset.created", entityType: "AdSet", entityId: s.id, metadata: { name } });
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, { error: "Un groupe porte déjà ce nom dans cette pub." });
  }
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { ok: `Groupe « ${name} » ajouté.` });
}

export async function addAdAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const adSetId = z.string().min(1).parse(formData.get("adSetId"));
  const name = String(formData.get("name") ?? "").trim();
  const inviteLinkId = String(formData.get("inviteLinkId") ?? "");
  if (!name) go(`/campaigns/${campaignId}`, { error: "Nom de la pub obligatoire." });
  try {
    const ad = await prisma.ad.create({ data: { adSetId, name } });
    await audit({ userId: user.id, action: "ad.created", entityType: "Ad", entityId: ad.id, metadata: { name } });
    if (inviteLinkId) await attachLink(ad.id, inviteLinkId, user.id);
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, { error: err instanceof Error ? err.message : "Création impossible." });
  }
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { ok: `Pub « ${name} » ajoutée.` });
}

/** Rattache un lien d'entrée (et son lien goolink) à une pub précise. */
async function attachLink(adId: string, inviteLinkId: string, userId: string): Promise<void> {
  const link = await prisma.inviteLink.findUnique({ where: { id: inviteLinkId }, include: { ad: { select: { id: true } }, trackingLinks: { where: { kind: "AD_ENTRY" }, select: { id: true }, take: 1 } } });
  if (!link) throw new Error("Lien introuvable.");
  if (link.ad && link.ad.id !== adId) throw new Error("Ce lien est déjà rattaché à une autre pub.");
  const trackingLinkId = link.trackingLinks[0]?.id ?? null;
  await prisma.ad.update({ where: { id: adId }, data: { inviteLinkId, trackingLinkId } });
  await audit({ userId, action: "ad.link_attached", entityType: "Ad", entityId: adId, metadata: { inviteLinkId, trackingLinkId } });
}

export async function attachLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.string().min(1).parse(formData.get("campaignId"));
  const adId = z.string().min(1).parse(formData.get("adId"));
  const inviteLinkId = String(formData.get("inviteLinkId") ?? "");
  try {
    if (!inviteLinkId) {
      await prisma.ad.update({ where: { id: adId }, data: { inviteLinkId: null, trackingLinkId: null } });
      await audit({ userId: user.id, action: "ad.link_detached", entityType: "Ad", entityId: adId });
    } else await attachLink(adId, inviteLinkId, user.id);
  } catch (err) {
    if (isRedirect(err)) throw err;
    go(`/campaigns/${campaignId}`, { error: err instanceof Error ? err.message : "Rattachement impossible." });
  }
  revalidatePath(`/campaigns/${campaignId}`);
  go(`/campaigns/${campaignId}`, { ok: inviteLinkId ? "Lien rattaché à la pub." : "Lien détaché." });
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
  if (!parsed.success) go("/campaigns", { error: "Saisie invalide." });
  const d = parsed.data;
  const spend = Number(d.spend.replace(",", "."));
  if (!Number.isFinite(spend) || spend < 0) go(`/campaigns/${d.campaignId}`, { error: "Montant invalide." });
  const [kind, id] = d.level.split(":") as [string, string];
  const level = kind === "ad" ? { adId: id } : kind === "adset" ? { adSetId: id } : { campaignId: id };
  const key = levelKey(level);
  const date = new Date(`${d.date}T00:00:00.000Z`);
  await prisma.adCost.upsert({
    where: { levelKey_date_source: { levelKey: key, date, source: "MANUAL" } },
    create: { ...level, levelKey: key, date, spend, impressions: Number(d.impressions) || 0, clicks: Number(d.clicks) || 0, source: "MANUAL" },
    update: { spend, impressions: Number(d.impressions) || 0, clicks: Number(d.clicks) || 0 },
  });
  await audit({ userId: user.id, action: "adcost.manual", entityType: "Campaign", entityId: d.campaignId, metadata: { level: key, date: d.date, spend } });
  revalidatePath(`/campaigns/${d.campaignId}`);
  go(`/campaigns/${d.campaignId}`, { ok: `Dépense du ${d.date} enregistrée.` });
}
