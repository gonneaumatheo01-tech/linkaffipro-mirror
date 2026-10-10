"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, audit, Prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";
import { isImportedShell } from "@/lib/campaigns/ad-link";
import { createCampaignEntryLink } from "@/lib/campaigns/entry-links";
import { findImportedShellByName, mergeImportedCampaign } from "@/lib/campaigns/merge";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import {
  parseWizardPayload,
  planAds,
  UNKNOWN_KEY_MESSAGE,
  type WizardStepKey,
} from "@/lib/campaigns/wizard";

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

/** Jeton d'idempotence de l'assistant, mémorisé 24 h dans `Setting` (une ligne par création). */
const TOKEN_PREFIX = "campaign.wizard.";
const TOKEN_TTL_MS = 24 * 3_600_000;

/**
 * Réserve le jeton : la première requête l'écrit ; une seconde (double clic, renvoi du formulaire) trouve la ligne et
 * renvoie vers la campagne déjà créée au lieu d'en créer une seconde avec de nouvelles invitations Telegram.
 */
async function reserveToken(requestId: string): Promise<void> {
  const key = `${TOKEN_PREFIX}${requestId}`;
  await prisma.setting
    .deleteMany({
      where: {
        key: { startsWith: TOKEN_PREFIX },
        updatedAt: { lt: new Date(Date.now() - TOKEN_TTL_MS) },
      },
    })
    .catch(() => undefined);
  try {
    await prisma.setting.create({
      data: { key, value: { status: "pending", at: new Date().toISOString() } },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const existing = await prisma.setting.findUnique({ where: { key } });
    const campaignId = (existing?.value as { campaignId?: unknown } | null)?.campaignId;
    if (typeof campaignId === "string")
      redirect(
        `/campaigns/${campaignId}?${new URLSearchParams({ tab: "links", ok: "Cette campagne a déjà été créée (un seul clic suffit) : la voici." })}`,
      );
    redirect(
      `/campaigns?${new URLSearchParams({ error: "Création déjà en cours : patientez quelques secondes puis rechargez la page." })}`,
    );
  }
}

async function settleToken(requestId: string | null, campaignId: string | null): Promise<void> {
  if (!requestId) return;
  const key = `${TOKEN_PREFIX}${requestId}`;
  if (campaignId)
    await prisma.setting
      .update({ where: { key }, data: { value: { campaignId, at: new Date().toISOString() } } })
      .catch(() => undefined);
  else await prisma.setting.delete({ where: { key } }).catch(() => undefined);
}

/**
 * Création d'une campagne par l'assistant : campagne + offres + canaux (+ campagne pub importée du compte choisi, s'il
 * y en a une), puis « Groupe 1 » avec une pub précise et un lien d'entrée (goolink + invitation Telegram avec demande
 * d'adhésion sur le canal d'entrée choisi) par pub demandée. Si Telegram refuse un lien, la campagne reste créée et
 * l'erreur est affichée sur sa fiche (onglet Liens). Un double envoi ne crée jamais deux campagnes (jeton).
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
    d.affiliateCampaignIds.length
      ? prisma.affiliateCampaign.findMany({
          where: { id: { in: d.affiliateCampaignIds }, isActive: true },
          select: { id: true, name: true },
        })
      : [],
    d.channelIds.length
      ? prisma.channel.findMany({
          where: { id: { in: d.channelIds }, isActive: true },
          select: { id: true, title: true },
        })
      : [],
  ]);
  if (offers.length !== d.affiliateCampaignIds.length) fail("offers", UNKNOWN_KEY_MESSAGE, raw);
  if (channels.length !== d.channelIds.length)
    fail(
      "channels",
      "Un des canaux cochés n'existe plus ou est désactivé : vérifiez la sélection.",
      raw,
    );
  if (d.connectionId) {
    const conn = await prisma.adAccountConnection.findFirst({
      where: {
        id: d.connectionId,
        status: "ACTIVE",
        ...(d.adPlatform ? { platform: d.adPlatform } : {}),
      },
      select: { id: true },
    });
    if (!conn)
      fail(
        "ads",
        "Ce compte publicitaire n'est plus connecté : choisissez-en un autre ou laissez « sans compte ».",
        raw,
      );
  }
  if (d.importedCampaignId) {
    const shell = await prisma.campaign.findUnique({
      where: { id: d.importedCampaignId },
      select: {
        connectionId: true,
        externalCampaignId: true,
        adExternalIds: true,
        affiliateCampaignIds: true,
        channelIds: true,
      },
    });
    if (!shell || shell.connectionId !== d.connectionId || !isImportedShell(shell))
      fail(
        "ads",
        "Cette campagne pub n'est plus disponible pour ce compte (déjà rattachée ?) : choisissez-en une autre ou « aucune ».",
        raw,
      );
  }
  const entryChannel = d.entryChannelId ? channels.find((c) => c.id === d.entryChannelId) : null;
  if (d.adCount > 0 && !entryChannel)
    fail("ads", "Choisissez le canal d'entrée des pubs parmi les canaux cochés.", raw);

  if (d.requestId) await reserveToken(d.requestId);

  let campaign: { id: string };
  try {
    campaign = await prisma.campaign.create({
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
  } catch (err) {
    await settleToken(d.requestId, null);
    throw err;
  }
  await settleToken(d.requestId, campaign.id);
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
      entryChannelId: d.entryChannelId,
      adPlatform: d.adPlatform,
      connectionId: d.connectionId,
      importedCampaignId: d.importedCampaignId,
      adCount: d.adCount,
      budgetDaily: d.budgetDaily,
      startAt: d.startAt,
      endAt: d.endAt,
      viaWizard: true,
    },
  });

  let mergeError: string | null = null;
  // Rapprochement par le nom : compte choisi, « aucune » campagne pub choisie, mais la campagne pub du même nom est
  // déjà importée de ce compte (cas courant : la synchro importe tout dès la connexion) → elle est reprise.
  let byName: { id: string; name: string } | null = null;
  if (d.connectionId && !d.importedCampaignId)
    byName = await findImportedShellByName(d.connectionId, d.name).catch(() => null);
  const shellId = d.importedCampaignId ?? byName?.id ?? null;
  if (shellId) {
    try {
      await mergeImportedCampaign({
        targetId: campaign.id,
        shellId,
        userId: user.id,
        ...(byName ? { matchedByName: true } : {}),
      });
    } catch (err) {
      mergeError = err instanceof Error ? err.message : "rattachement impossible";
      byName = null;
    }
  }

  let createdLinks = 0;
  let linkError: string | null = null;
  if (d.adCount > 0 && d.adPlatform && entryChannel) {
    for (const p of planAds(d.name, d.adCount)) {
      try {
        await createCampaignEntryLink({
          campaignId: campaign.id,
          campaignName: d.name,
          channelId: entryChannel.id,
          platform: d.adPlatform,
          adName: p.adName,
          linkName: p.linkName,
          userId: user.id,
        });
        createdLinks++;
      } catch (err) {
        if (isRedirect(err)) throw err;
        linkError = err instanceof Error ? err.message : "création du lien impossible";
        break;
      }
    }
  }

  await refreshCampaignStats();
  revalidatePath("/campaigns");
  const q = new URLSearchParams({ tab: "links" });
  if (linkError || mergeError)
    q.set(
      "error",
      [
        linkError
          ? `Campagne créée, mais ${createdLinks} lien${createdLinks > 1 ? "s" : ""} sur ${d.adCount} : ${linkError} Vous pouvez réessayer avec « Ajouter un lien d'entrée ».`
          : null,
        mergeError
          ? `Campagne créée, mais la campagne pub importée n'a pas pu être reprise : ${mergeError} Réessayez depuis l'onglet Pubs (« Rattacher une campagne pub importée »).`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  else
    q.set(
      "ok",
      (createdLinks > 0
        ? `Campagne créée avec ${createdLinks} lien${createdLinks > 1 ? "s" : ""} d'entrée vers « ${entryChannel?.title ?? ""} » : copiez chaque adresse ci-dessous dans la pub correspondante.`
        : "Campagne créée. Ajoutez ses pubs et ses liens d'entrée quand vous voulez.") +
        (byName
          ? ` La campagne pub « ${byName.name} » (même nom, déjà importée du compte) a été reprise : ses groupes, pubs et dépenses sont dans l'onglet Pubs.`
          : ""),
    );
  redirect(`/campaigns/${campaign.id}?${q.toString()}`);
}
