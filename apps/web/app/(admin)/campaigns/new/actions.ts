"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { invalidateDashboards } from "@/lib/dashboard/cache";
import { createCampaignEntryLink } from "@/lib/campaigns/entry-links";
import { parseWizardPayload, planAds, UNKNOWN_KEY_MESSAGE, type WizardStepKey } from "@/lib/campaigns/wizard";

function isRedirect(err: unknown): boolean {
  return (err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT") ?? false;
}

/** Retour à l'assistant, sur l'étape fautive, avec la saisie conservée. */
function fail(step: WizardStepKey, message: string, draft: unknown): never {
  const p = new URLSearchParams({ error: message, step });
  try {
    p.set("draft", JSON.stringify(draft));
  } catch {
    /* saisie illisible : on repart de zéro */
  }
  redirect(`/campaigns/new?${p.toString()}`);
}

function dayToDate(day: string | null): Date | null {
  return day ? new Date(`${day}T00:00:00.000Z`) : null;
}

/**
 * Création d'une campagne par l'assistant : campagne + offres + canaux, puis « Groupe 1 » avec une pub précise et un
 * lien d'entrée (goolink + invitation Telegram avec demande d'adhésion sur le premier canal coché) par pub demandée.
 * Si Telegram refuse un lien, la campagne reste créée et l'erreur est affichée sur sa fiche (onglet Liens).
 */
export async function createCampaignWizardAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  let raw: unknown = {};
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    raw = {};
  }
  const parsed = parseWizardPayload(raw);
  if (!parsed.ok) fail(parsed.error.step, parsed.error.message, raw);
  const d = parsed.data;

  const [offers, channels] = await Promise.all([
    d.affiliateCampaignIds.length ? prisma.affiliateCampaign.findMany({ where: { id: { in: d.affiliateCampaignIds }, isActive: true }, select: { id: true, name: true } }) : [],
    d.channelIds.length ? prisma.channel.findMany({ where: { id: { in: d.channelIds }, isActive: true }, select: { id: true, title: true } }) : [],
  ]);
  if (offers.length !== d.affiliateCampaignIds.length) fail("offers", UNKNOWN_KEY_MESSAGE, raw);
  if (channels.length !== d.channelIds.length) fail("channels", "Un des canaux cochés n'existe plus ou est désactivé : vérifiez la sélection.", raw);
  if (d.connectionId) {
    const conn = await prisma.adAccountConnection.findFirst({ where: { id: d.connectionId, status: "ACTIVE", ...(d.adPlatform ? { platform: d.adPlatform } : {}) }, select: { id: true } });
    if (!conn) fail("ads", "Ce compte publicitaire n'est plus connecté : choisissez-en un autre ou laissez « sans compte ».", raw);
  }

  const campaign = await prisma.campaign.create({
    data: {
      name: d.name,
      vertical: d.vertical,
      channelIds: d.channelIds,
      affiliateCampaignIds: d.affiliateCampaignIds,
      adPlatform: d.adPlatform,
      connectionId: d.connectionId,
      budgetDaily: d.budgetDaily,
      startAt: dayToDate(d.startAt),
      endAt: dayToDate(d.endAt),
      status: "ACTIVE",
      notes: d.notes,
    },
    select: { id: true },
  });
  await audit({
    userId: user.id,
    action: "campaign.created",
    entityType: "Campaign",
    entityId: campaign.id,
    metadata: {
      name: d.name,
      vertical: d.vertical,
      offers: offers.map((o) => ({ id: o.id, name: o.name })),
      channels: channels.map((c) => ({ id: c.id, title: c.title })),
      adPlatform: d.adPlatform,
      connectionId: d.connectionId,
      adCount: d.adCount,
      budgetDaily: d.budgetDaily,
      startAt: d.startAt,
      endAt: d.endAt,
      viaWizard: true,
    },
  });

  let createdLinks = 0;
  let linkError: string | null = null;
  if (d.adCount > 0 && d.adPlatform && d.channelIds[0]) {
    const channelId = d.channelIds[0];
    for (const p of planAds(d.name, d.adCount)) {
      try {
        await createCampaignEntryLink({ campaignId: campaign.id, campaignName: d.name, channelId, platform: d.adPlatform, adName: p.adName, linkName: p.linkName, userId: user.id });
        createdLinks++;
      } catch (err) {
        if (isRedirect(err)) throw err;
        linkError = err instanceof Error ? err.message : "création du lien impossible";
        break;
      }
    }
  }

  invalidateDashboards();
  revalidatePath("/campaigns");
  const q = new URLSearchParams({ tab: "links" });
  if (linkError)
    q.set(
      "error",
      `Campagne créée, mais ${createdLinks} lien${createdLinks > 1 ? "s" : ""} sur ${d.adCount} : ${linkError} Vous pouvez réessayer avec « Ajouter un lien d'entrée ».`,
    );
  else
    q.set(
      "ok",
      createdLinks > 0
        ? `Campagne créée avec ${createdLinks} lien${createdLinks > 1 ? "s" : ""} d'entrée : copiez chaque adresse ci-dessous dans la pub correspondante.`
        : "Campagne créée. Ajoutez ses pubs et ses liens d'entrée quand vous voulez.",
    );
  redirect(`/campaigns/${campaign.id}?${q.toString()}`);
}
