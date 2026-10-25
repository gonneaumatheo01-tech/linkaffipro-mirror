/**
 * Phase 34, lot C : cœurs de la fiche campagne (`app/(admin)/campaigns/actions.ts`), de l'assistant « Nouvelle
 * campagne » (`campaigns/new/actions.ts`) et du mini-tutoriel des affiliés (`campaigns/affiliates/actions.ts`).
 * Code repris tel quel des actions serveur (mêmes validations, mêmes messages, même journal + `via`) ; les actions ne
 * font plus que lire le formulaire, appeler le cœur et rediriger.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit, Prisma } from "@linkaffipro/db";
import type { SiteOpActor } from "@linkaffipro/agents";
import { levelKey } from "@/lib/campaigns/match";
import { createCampaignEntryLink } from "@/lib/campaigns/entry-links";
import { jsonIds } from "@/lib/campaigns/attribution";
import { keepInactiveChannels } from "@/lib/campaigns/channels";
import { findImportedShellByName, mergeImportedCampaign } from "@/lib/campaigns/merge";
import { campaignCostScope } from "@/lib/campaigns/cost-scope";
import { refreshCampaignStats } from "@/lib/campaigns/refresh";
import { isImportedShell } from "@/lib/campaigns/ad-link";
import {
  findOfferByKey,
  parseLinkAffiReference,
  parseWizardPayload,
  planAds,
  UNKNOWN_KEY_MESSAGE,
  type WizardStepKey,
} from "@/lib/campaigns/wizard";
import { dismissTutorial } from "@/lib/affiliates/tutorial";
import { env } from "@/lib/env";
import {
  DELETE_ADMIN_ONLY,
  done,
  doneTo,
  fail,
  failTo,
  forbidden,
  isPartial,
  joinNames,
  list,
  preview,
  str,
  toFormData,
  viaArg,
  withVia,
  type Core,
  type CoreResult,
} from "./common";
import {
  campaignCandidates,
  channelCandidates,
  offerCandidates,
  pickCandidate,
  resolveInto,
  resolveManyInto,
  trackingLinkCandidates,
} from "./resolve";

const PAGE = (id: string) => `/campaigns/${id}`;

/** Campagne donnée par son nom (Kevin) → `campaignId`. */
async function withCampaign(input: Record<string, unknown>): Promise<CoreResult | null> {
  const r = await resolveInto(input, "campaignId", "campaign", "la campagne", campaignCandidates);
  return r.ok ? null : fail(r.error, null, { code: r.code });
}

function campaignIdOf(input: Record<string, unknown>): string | null {
  const id = str(input.campaignId).trim();
  return id || null;
}

const NOT_FOUND = () => failTo("/campaigns", "Campagne introuvable.", {}, { code: "not_found" });

// ---------------------------------------------------------------------------------------------------------------
// Modifier la campagne
// ---------------------------------------------------------------------------------------------------------------

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

export const CAMPAIGN_FORM_ERROR =
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

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Kevin ne dit que ce qui change : les autres champs du formulaire reprennent la valeur enregistrée. */
async function fillCampaignForm(input: Record<string, unknown>, id: string): Promise<boolean> {
  const c = await prisma.campaign.findUnique({
    where: { id },
    select: {
      name: true,
      adPlatform: true,
      vertical: true,
      status: true,
      budgetDaily: true,
      notes: true,
      startAt: true,
      endAt: true,
      connectionId: true,
      channelIds: true,
    },
  });
  if (!c) return false;
  const current: Record<string, unknown> = {
    name: c.name,
    adPlatform: c.adPlatform ?? "",
    vertical: c.vertical ?? "",
    status: c.status,
    budgetDaily: c.budgetDaily === null ? "" : String(c.budgetDaily),
    notes: c.notes ?? "",
    startAt: day(c.startAt),
    endAt: day(c.endAt),
    connectionId: c.connectionId ?? "",
    channelIds: jsonIds(c.channelIds),
  };
  for (const [k, v] of Object.entries(current)) if (!(k in input)) input[k] = v;
  return true;
}

/**
 * Vue d'ensemble → « Modifier la campagne » : nom, plateforme, univers, statut, budget, dates, canaux, compte pub
 * connecté, notes. Changer de compte détache la campagne pub suivie (identifiant externe) : le nouveau compte la
 * retrouvera par son nom, ou elle se rattache depuis l'onglet Pubs.
 */
export const updateCampaign: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const id = campaignIdOf(input);
  if (!id) return NOT_FOUND();
  const channels = await resolveManyInto(input, "channelIds", "channels", "le canal", channelCandidates);
  if (!channels.ok) return fail(channels.error, null, { code: channels.code });
  if (isPartial(actor) && !(await fillCampaignForm(input, id))) return NOT_FOUND();
  const data = campaignData(toFormData(input));
  if (!data) return failTo(PAGE(id), CAMPAIGN_FORM_ERROR);
  const current = await prisma.campaign.findUnique({
    where: { id },
    select: { channelIds: true, connectionId: true, externalCampaignId: true },
  });
  if (!current) return NOT_FOUND();
  let adPlatform = data.adPlatform;
  if (data.connectionId && data.connectionId !== current.connectionId) {
    const conn = await prisma.adAccountConnection.findFirst({
      where: { id: data.connectionId, status: "ACTIVE" },
      select: { platform: true, name: true },
    });
    if (!conn)
      return failTo(
        PAGE(id),
        "Ce compte publicitaire n'est plus connecté : choisissez-en un autre (Réglages → Connexions) ou « sans compte ».",
      );
    if (adPlatform && adPlatform !== conn.platform)
      return failTo(
        PAGE(id),
        `Le compte « ${conn.name} » est un compte ${conn.platform === "META" ? "Meta" : conn.platform === "TIKTOK" ? "TikTok" : "publicitaire"} : choisissez cette plateforme, ou un autre compte.`,
      );
    adPlatform = conn.platform;
  }
  const connectionChanged = data.connectionId !== current.connectionId;
  const channelIds = await nextChannelIds(data.channelIds, current.channelIds);
  if (opts.dryRun)
    return preview(
      `Campagne « ${data.name} » : statut ${data.status}, ${channelIds.length} canal${channelIds.length > 1 ? "aux" : ""}${data.budgetDaily !== null ? `, budget ${data.budgetDaily} € par jour` : ""}${connectionChanged ? ", compte pub changé" : ""}.`,
    );
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
    userId: actor.userId,
    action: "campaign.updated",
    entityType: "Campaign",
    entityId: id,
    metadata: withVia(actor, {
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
    }),
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
          userId: actor.userId,
          matchedByName: true,
          ...viaArg(actor),
        });
        byName = { name: r.platformName };
      } catch (err) {
        byNameError = err instanceof Error ? err.message : "rattachement impossible";
      }
  }
  await refreshCampaignStats();
  revalidatePath("/campaigns");
  if (byNameError)
    return failTo(
      PAGE(id),
      `Campagne enregistrée, mais la campagne pub du même nom n'a pas pu être reprise : ${byNameError} Réessayez depuis l'onglet Pubs (« Rattacher une campagne pub importée »).`,
      {},
      { code: "unavailable" },
    );
  return doneTo(
    PAGE(id),
    byName
      ? `Campagne enregistrée. La campagne pub « ${byName.name} » (même nom, déjà importée du compte) a été reprise : ses groupes, pubs et dépenses sont dans l'onglet Pubs.`
      : "Campagne enregistrée.",
    {},
    { campaignId: id },
  );
};

// ---------------------------------------------------------------------------------------------------------------
// Groupes et pubs
// ---------------------------------------------------------------------------------------------------------------

/** Groupe donné par son nom dans la campagne (Kevin) → `adSetId`. */
async function withAdSet(input: Record<string, unknown>, campaignId: string): Promise<CoreResult | null> {
  if (str(input.adSetId) || !str(input.adSet)) return null;
  const sets = await prisma.adSet.findMany({ where: { campaignId }, select: { id: true, name: true } });
  const r = pickCandidate(
    str(input.adSet),
    sets.map((s) => ({ id: s.id, label: s.name, names: [s.name] })),
    "le groupe",
  );
  if (!r.ok) return fail(r.error, null, { code: r.code });
  input.adSetId = r.id;
  return null;
}

/** Pub donnée par son nom dans la campagne (Kevin) → `adId`. */
async function withAd(input: Record<string, unknown>, campaignId: string): Promise<CoreResult | null> {
  if (str(input.adId) || !str(input.ad)) return null;
  const ads = await prisma.ad.findMany({
    where: { adSet: { campaignId } },
    select: { id: true, name: true, adSet: { select: { name: true } } },
  });
  const r = pickCandidate(
    str(input.ad),
    ads.map((a) => ({ id: a.id, label: `${a.name} (${a.adSet.name})`, names: [a.name] })),
    "la pub",
  );
  if (!r.ok) return fail(r.error, null, { code: r.code });
  input.adId = r.id;
  return null;
}

/** Lien d'entrée donné par son nom ou son adresse courte (Kevin) → `inviteLinkId`. */
async function withEntryLink(input: Record<string, unknown>): Promise<CoreResult | null> {
  if (str(input.inviteLinkId) || !str(input.link)) return null;
  const r = pickCandidate(str(input.link), await trackingLinkCandidates(), "le lien");
  if (!r.ok) return fail(r.error, null, { code: r.code });
  const t = await prisma.trackingLink.findUnique({ where: { id: r.id }, select: { inviteLinkId: true } });
  if (!t?.inviteLinkId) return fail("Ce lien n'est pas un lien d'entrée Telegram.", null);
  input.inviteLinkId = t.inviteLinkId;
  return null;
}

export const addAdSet: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  const name = str(input.name).trim();
  if (!name) return failTo(PAGE(campaignId), "Donnez un nom au groupe.", { tab: "ads" });
  const DUP = "Un groupe porte déjà ce nom dans cette campagne : choisissez-en un autre.";
  if (opts.dryRun) {
    const dup = await prisma.adSet.findFirst({ where: { campaignId, name }, select: { id: true } });
    if (dup) return failTo(PAGE(campaignId), DUP, { tab: "ads" }, { code: "conflict" });
    return preview(`Nouveau groupe « ${name} » dans la campagne.`);
  }
  try {
    const s = await prisma.adSet.create({ data: { campaignId, name } });
    await audit({
      userId: actor.userId,
      action: "adset.created",
      entityType: "AdSet",
      entityId: s.id,
      metadata: withVia(actor, { name }),
    });
  } catch {
    return failTo(PAGE(campaignId), DUP, { tab: "ads" }, { code: "conflict" });
  }
  revalidatePath(PAGE(campaignId));
  return doneTo(PAGE(campaignId), `Groupe « ${name} » ajouté.`, { tab: "ads" });
};

/** Retire un lien d'entrée (et son lien goolink) de la campagne : il redevient un lien libre (Campagnes → Tous les liens). */
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

/** Vérifie qu'un lien d'entrée peut aller sur la pub (mêmes refus que le rattachement). */
async function checkAttach(adId: string | null, inviteLinkId: string): Promise<string | null> {
  const link = await prisma.inviteLink.findUnique({
    where: { id: inviteLinkId },
    include: { ad: { select: { id: true } } },
  });
  if (!link) return "Ce lien d'entrée est introuvable.";
  if (link.ad && link.ad.id !== adId)
    return "Ce lien est déjà rattaché à une autre pub précise : détachez-le d'abord.";
  return null;
}

/**
 * Rattache un lien d'entrée (et son lien goolink) à une pub précise, et les marque comme liens de la campagne.
 * Si la pub avait déjà un autre lien, celui-ci quitte la campagne (campagne remise à vide).
 */
async function attachLink(
  adId: string,
  inviteLinkId: string,
  campaignId: string,
  actor: SiteOpActor,
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
    userId: actor.userId,
    action: "ad.link_attached",
    entityType: "Ad",
    entityId: adId,
    metadata: withVia(actor, {
      inviteLinkId,
      trackingLinkId,
      replacedInviteLinkId: previous?.inviteLinkId ?? null,
    }),
  });
}

export const addAd: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  const other = (await withAdSet(input, campaignId)) ?? (await withEntryLink(input));
  if (other) return other;
  const adSetId = str(input.adSetId).trim();
  if (!adSetId) return failTo(PAGE(campaignId), "Choisissez le groupe de la pub.", { tab: "ads" });
  const name = str(input.name).trim();
  const inviteLinkId = str(input.inviteLinkId);
  if (!name) return failTo(PAGE(campaignId), "Donnez un nom à la pub précise.", { tab: "ads" });
  if (opts.dryRun) {
    if (inviteLinkId) {
      const refused = await checkAttach(null, inviteLinkId);
      if (refused) return failTo(PAGE(campaignId), refused, { tab: "ads" });
    }
    return preview(`Nouvelle pub précise « ${name} »${inviteLinkId ? " avec son lien d'entrée" : ""}.`);
  }
  try {
    const ad = await prisma.ad.create({ data: { adSetId, name } });
    await audit({
      userId: actor.userId,
      action: "ad.created",
      entityType: "Ad",
      entityId: ad.id,
      metadata: withVia(actor, { name }),
    });
    if (inviteLinkId) await attachLink(ad.id, inviteLinkId, campaignId, actor);
  } catch (err) {
    return failTo(PAGE(campaignId), err instanceof Error ? err.message : "Création impossible.", {
      tab: "ads",
    });
  }
  if (inviteLinkId) await refreshCampaignStats();
  revalidatePath(PAGE(campaignId));
  return doneTo(PAGE(campaignId), `Pub précise « ${name} » ajoutée.`, { tab: "ads" });
};

export const attachLinkToAd: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  const other = (await withAd(input, campaignId)) ?? (await withEntryLink(input));
  if (other) return other;
  const adId = str(input.adId).trim();
  if (!adId) return failTo(PAGE(campaignId), "Pub introuvable.", { tab: "ads" }, { code: "not_found" });
  // Kevin : détacher se demande explicitement (`detach`), jamais par un lien oublié.
  if (isPartial(actor) && !("inviteLinkId" in input) && input.detach !== true)
    return fail("Indiquez le lien d'entrée à rattacher à la pub (ou demandez à le détacher).", null, {
      field: "link",
    });
  const inviteLinkId = input.detach === true ? "" : str(input.inviteLinkId);
  if (opts.dryRun) {
    if (inviteLinkId) {
      const refused = await checkAttach(adId, inviteLinkId);
      if (refused) return failTo(PAGE(campaignId), refused, { tab: "ads" });
    }
    return preview(
      inviteLinkId
        ? "Le lien d'entrée sera rattaché à la pub précise (et à la campagne)."
        : "Le lien de la pub sera détaché : il ne fera plus partie de la campagne.",
    );
  }
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
        userId: actor.userId,
        action: "ad.link_detached",
        entityType: "Ad",
        entityId: adId,
        metadata: withVia(actor, {
          inviteLinkId: ad?.inviteLinkId ?? null,
          trackingLinkId: ad?.trackingLinkId ?? null,
        }),
      });
    } else await attachLink(adId, inviteLinkId, campaignId, actor);
  } catch (err) {
    return failTo(PAGE(campaignId), err instanceof Error ? err.message : "Rattachement impossible.", {
      tab: "ads",
    });
  }
  await refreshCampaignStats();
  revalidatePath(PAGE(campaignId));
  return doneTo(
    PAGE(campaignId),
    inviteLinkId
      ? "Lien rattaché à la pub précise."
      : "Lien détaché : il ne fait plus partie de la campagne.",
    { tab: "ads" },
  );
};

// ---------------------------------------------------------------------------------------------------------------
// Dépense saisie à la main
// ---------------------------------------------------------------------------------------------------------------

const costSchema = z.object({
  campaignId: z.string().min(1),
  level: z.string().regex(/^(campaign|adset|ad):.+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.string().trim(),
  impressions: z.string().trim(),
  clicks: z.string().trim(),
});

/** Saisie manuelle d'une dépense pour un jour (remplace la valeur manuelle existante du même jour). */
export const addManualCost: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  if (isPartial(actor)) {
    // Kevin : « 150 € hier sur la campagne X » (niveau campagne par défaut ; groupe ou pub par leur nom).
    const campaignId = campaignIdOf(input);
    if (campaignId && !str(input.level)) {
      const other = (await withAdSet(input, campaignId)) ?? (await withAd(input, campaignId));
      if (other) return other;
      input.level = str(input.adId)
        ? `ad:${str(input.adId)}`
        : str(input.adSetId)
          ? `adset:${str(input.adSetId)}`
          : `campaign:${campaignId}`;
    }
    for (const k of ["impressions", "clicks"]) if (!(k in input)) input[k] = "";
    if (typeof input.spend === "number") input.spend = String(input.spend);
  }
  const fields: Record<string, string> = {};
  for (const k of ["campaignId", "level", "date", "spend", "impressions", "clicks"])
    if (k in input) fields[k] = str(input[k]);
  const parsed = costSchema.safeParse(fields);
  if (!parsed.success)
    return failTo("/campaigns", "Saisie incomplète : vérifiez le jour et la dépense.");
  const d = parsed.data;
  const spend = Number(d.spend.replace(",", "."));
  if (!Number.isFinite(spend) || spend < 0)
    return failTo(PAGE(d.campaignId), "Le montant doit être un nombre positif (ex. 42,50).", {
      tab: "ads",
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
    return failTo(
      PAGE(d.campaignId),
      `Le ${d.date}, les dépenses de cette campagne arrivent déjà de TikTok / Meta (API) : la saisie manuelle n'est pas nécessaire, l'API a priorité.`,
      { tab: "ads" },
      { code: "conflict" },
    );
  if (opts.dryRun)
    return preview(
      `Dépense de ${spend.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € le ${d.date} (${kind === "ad" ? "pub précise" : kind === "adset" ? "groupe" : "campagne"}), saisie à la main.`,
    );
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
    userId: actor.userId,
    action: "adcost.manual",
    entityType: "Campaign",
    entityId: d.campaignId,
    metadata: withVia(actor, { level: key, date: d.date, spend }),
  });
  // Une dépense ancienne sort de la fenêtre du recalcul horaire (3 jours) : recalcul complet.
  await refreshCampaignStats();
  revalidatePath(PAGE(d.campaignId));
  return doneTo(PAGE(d.campaignId), `Dépense du ${d.date} enregistrée.`, { tab: "ads" });
};

// ---------------------------------------------------------------------------------------------------------------
// Liens d'entrée, canaux, offres
// ---------------------------------------------------------------------------------------------------------------

const PLATFORMS = ["TIKTOK", "META", "OTHER"] as const;

/** Onglet Liens : ajoute une pub précise et son lien d'entrée (goolink + invitation Telegram) à la campagne. */
export const addEntryLink: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const ch = await resolveInto(input, "channelId", "channel", "le canal", channelCandidates);
  if (!ch.ok) return fail(ch.error, null, { code: ch.code });
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  const channelId = str(input.channelId);
  const adName = str(input.adName).trim();
  const adSetName = str(input.adSetName).trim();
  const platformRaw = str(input.platform).toUpperCase();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      name: true,
      adPlatform: true,
      adSets: { select: { _count: { select: { ads: true } } } },
    },
  });
  if (!campaign) return NOT_FOUND();
  if (!channelId)
    return failTo(PAGE(campaignId), "Choisissez le canal que ce lien doit ouvrir.", { tab: "links" });
  const platform = (PLATFORMS as readonly string[]).includes(platformRaw)
    ? (platformRaw as (typeof PLATFORMS)[number])
    : (campaign.adPlatform ?? "OTHER");
  const count = campaign.adSets.reduce((n, s) => n + s._count.ads, 0);
  const finalAdName = adName || `Pub ${count + 1}`;
  if (opts.dryRun)
    return preview(
      `Nouveau lien d'entrée « ${finalAdName} » (${platform === "TIKTOK" ? "TikTok" : platform === "META" ? "Meta" : "autre"}) dans la campagne « ${campaign.name} » : invitation Telegram avec demande d'adhésion.`,
    );
  try {
    const r = await createCampaignEntryLink({
      campaignId,
      campaignName: campaign.name,
      channelId,
      platform,
      adName: finalAdName,
      adSetName: adSetName || undefined,
      userId: actor.userId,
      ...viaArg(actor),
    });
    if (!campaign.adPlatform)
      await prisma.campaign.update({ where: { id: campaignId }, data: { adPlatform: platform } });
    await refreshCampaignStats();
    revalidatePath(PAGE(campaignId));
    const url = `${env.trackingBaseUrl}/${r.trackingLink.slug}`;
    const r2 = doneTo(
      PAGE(campaignId),
      `Lien d'entrée « ${r.trackingLink.label} » créé : copiez son adresse dans la pub.`,
      { tab: "links" },
      { url, slug: r.trackingLink.slug, label: r.trackingLink.label },
    );
    if (r2.ok && actor.via !== "WEB") r2.message = `${r2.message} Adresse : ${url}`;
    return r2;
  } catch (err) {
    return failTo(
      PAGE(campaignId),
      err instanceof Error ? err.message : "Création du lien impossible.",
      { tab: "links" },
      { code: "unavailable" },
    );
  }
};

/** Onglet Canaux : enregistre les canaux cochés (les canaux désactivés déjà rattachés sont conservés). */
export const updateCampaignChannels: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { channelIds: true },
  });
  if (!campaign) return NOT_FOUND();
  let checked = [...new Set(list(input.channelIds))];
  if (isPartial(actor) && input.channels !== undefined) {
    // Kevin : « ajoute / retire le canal X » (mode) ou la liste complète (par défaut).
    const tmp: Record<string, unknown> = { channels: input.channels };
    const r = await resolveManyInto(tmp, "channelIds", "channels", "le canal", channelCandidates);
    if (!r.ok) return fail(r.error, null, { code: r.code });
    const asked = list(tmp.channelIds);
    const mode = str(input.mode);
    const cur = jsonIds(campaign.channelIds);
    checked =
      mode === "add"
        ? [...new Set([...cur, ...asked])]
        : mode === "remove"
          ? cur.filter((c) => !asked.includes(c))
          : [...new Set([...checked, ...asked])];
  }
  const channelIds = await nextChannelIds(checked, campaign.channelIds);
  if (opts.dryRun)
    return preview(`La campagne aura ${channelIds.length} canal${channelIds.length > 1 ? "aux" : ""}.`);
  await prisma.campaign.update({ where: { id: campaignId }, data: { channelIds } });
  await audit({
    userId: actor.userId,
    action: "campaign.channels_updated",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: withVia(actor, { channelIds }),
  });
  await refreshCampaignStats();
  revalidatePath(PAGE(campaignId));
  return doneTo(
    PAGE(campaignId),
    `${channelIds.length} canal${channelIds.length > 1 ? "aux" : ""} enregistré${channelIds.length > 1 ? "s" : ""}.`,
    { tab: "channels" },
  );
};

/** Onglet Offres : ajoute une campagne Link Affi (choisie dans la liste ou collée sous forme de lien linkaffi.me/go/<clé>). */
export const addOffer: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const off = await resolveInto(input, "affiliateCampaignId", "offer", "l'offre", offerCandidates);
  if (!off.ok) return fail(off.error, null, { code: off.code });
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  const chosen = str(input.affiliateCampaignId).trim();
  const pasted = str(input.reference).trim();
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { affiliateCampaignIds: true },
  });
  if (!campaign) return NOT_FOUND();
  let offer: { id: string; name: string } | null = null;
  if (chosen)
    offer = await prisma.affiliateCampaign.findFirst({
      where: { id: chosen, isActive: true },
      select: { id: true, name: true },
    });
  else if (pasted) {
    const key = parseLinkAffiReference(pasted);
    if (!key)
      return failTo(
        PAGE(campaignId),
        "Collez un lien de la forme https://linkaffi.me/go/<clé> ou la clé seule.",
        { tab: "offers" },
      );
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
    return failTo(
      PAGE(campaignId),
      "Choisissez une offre dans la liste ou collez un lien d'offre.",
      { tab: "offers" },
    );
  if (!offer) return failTo(PAGE(campaignId), UNKNOWN_KEY_MESSAGE, { tab: "offers" }, { code: "not_found" });
  const current = jsonIds(campaign.affiliateCampaignIds);
  if (opts.dryRun)
    return preview(
      current.includes(offer.id)
        ? `L'offre « ${offer.name} » est déjà rattachée à la campagne.`
        : `L'offre « ${offer.name} » sera rattachée à la campagne.`,
    );
  if (!current.includes(offer.id)) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { affiliateCampaignIds: [...current, offer.id] },
    });
    await audit({
      userId: actor.userId,
      action: "campaign.affiliate_linked",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: withVia(actor, { affiliateCampaignId: offer.id, affiliateCampaignName: offer.name }),
    });
  }
  await refreshCampaignStats();
  revalidatePath(PAGE(campaignId));
  return doneTo(PAGE(campaignId), `Offre « ${offer.name} » rattachée.`, { tab: "offers" });
};

/** Onglet Offres : retire une campagne Link Affi (les boutons déjà publiés passent à une autre offre de la campagne). */
export const removeOffer: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const off = await resolveInto(input, "affiliateCampaignId", "offer", "l'offre", offerCandidates);
  if (!off.ok) return fail(off.error, null, { code: off.code });
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  const offerId = str(input.affiliateCampaignId).trim();
  if (!offerId)
    return failTo(PAGE(campaignId), "Choisissez l'offre à retirer.", { tab: "offers" });
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { affiliateCampaignIds: true },
  });
  if (!campaign) return NOT_FOUND();
  const next = jsonIds(campaign.affiliateCampaignIds).filter((id) => id !== offerId);
  if (opts.dryRun) return preview(`L'offre${off.label ? ` « ${off.label} »` : ""} sera retirée de la campagne.`);
  await prisma.campaign.update({ where: { id: campaignId }, data: { affiliateCampaignIds: next } });
  await audit({
    userId: actor.userId,
    action: "campaign.affiliate_unlinked",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: withVia(actor, { affiliateCampaignId: offerId }),
  });
  await refreshCampaignStats();
  revalidatePath(PAGE(campaignId));
  return doneTo(PAGE(campaignId), "Offre retirée de la campagne.", { tab: "offers" });
};

/** Onglet Pubs : « Rattacher une campagne pub importée » (voir lib/campaigns/merge.ts). */
export const attachImportedCampaign: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const imp = await resolveInto(input, "importedCampaignId", "imported", "la campagne pub importée", campaignCandidates);
  if (!imp.ok) return fail(imp.error, null, { code: imp.code });
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  const importedId = str(input.importedCampaignId);
  if (!importedId)
    return failTo(PAGE(campaignId), "Choisissez la campagne pub importée à rattacher.", { tab: "ads" });
  if (opts.dryRun) {
    const shell = await prisma.campaign.findUnique({
      where: { id: importedId },
      select: {
        name: true,
        connectionId: true,
        externalCampaignId: true,
        adExternalIds: true,
        affiliateCampaignIds: true,
        channelIds: true,
      },
    });
    if (importedId === campaignId)
      return failTo(PAGE(campaignId), "Choisissez une autre campagne pub que la campagne elle-même.", { tab: "ads" });
    if (!shell || !isImportedShell(shell))
      return failTo(
        PAGE(campaignId),
        "Cette campagne pub n'est plus une campagne pub importée libre (déjà rattachée, ou elle a des offres ou des canaux).",
        { tab: "ads" },
      );
    return preview(
      `La campagne pub « ${shell.name} » (groupes, pubs et dépenses) sera reprise dans cette campagne.`,
    );
  }
  try {
    const r = await mergeImportedCampaign({
      targetId: campaignId,
      shellId: importedId,
      userId: actor.userId,
      ...viaArg(actor),
    });
    await refreshCampaignStats();
    revalidatePath("/campaigns");
    return doneTo(
      PAGE(campaignId),
      `Campagne pub « ${r.platformName} » rattachée : ses groupes, pubs et dépenses sont maintenant dans cette campagne.`,
      { tab: "ads" },
    );
  } catch (err) {
    return failTo(PAGE(campaignId), err instanceof Error ? err.message : "Rattachement impossible.", {
      tab: "ads",
    });
  }
};

// ---------------------------------------------------------------------------------------------------------------
// Suppressions (ADMIN)
// ---------------------------------------------------------------------------------------------------------------

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
export const deleteAd: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  if (actor.role !== "ADMIN")
    return forbidden(DELETE_ADMIN_ONLY, {
      path: PAGE(campaignId),
      params: { tab: "ads", error: DELETE_ADMIN_ONLY },
    });
  const other = await withAd(input, campaignId);
  if (other) return other;
  const adId = str(input.adId);
  const ad = adId
    ? await prisma.ad.findFirst({
        where: { id: adId, adSet: { campaignId } },
        select: {
          id: true,
          name: true,
          inviteLinkId: true,
          trackingLinkId: true,
          adSet: { select: { name: true } },
        },
      })
    : null;
  if (!ad) return failTo(PAGE(campaignId), "Pub introuvable.", { tab: "ads" }, { code: "not_found" });
  if (opts.dryRun)
    return preview(`Suppression de la pub « ${ad.name} » (groupe « ${ad.adSet.name} »).`, {
      impact: "Ses dépenses propres sont supprimées ; son lien d'entrée reste dans la campagne, avec ses membres, clics et joueurs.",
    });
  await prisma.$transaction([
    ...keepLinksInCampaignOps(campaignId, [ad]),
    prisma.ad.delete({ where: { id: ad.id } }),
  ]);
  await audit({
    userId: actor.userId,
    action: "ad.deleted",
    entityType: "Ad",
    entityId: ad.id,
    metadata: withVia(actor, {
      name: ad.name,
      adSet: ad.adSet.name,
      campaignId,
      inviteLinkId: ad.inviteLinkId,
    }),
  });
  await refreshCampaignStats();
  revalidatePath(PAGE(campaignId));
  return doneTo(PAGE(campaignId), `Pub « ${ad.name} » supprimée.`, { tab: "ads" });
};

/** Onglet Pubs : supprime un groupe et ses pubs précises (ADMIN). Leurs liens d'entrée restent dans la campagne. */
export const deleteAdSet: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  if (actor.role !== "ADMIN")
    return forbidden(DELETE_ADMIN_ONLY, {
      path: PAGE(campaignId),
      params: { tab: "ads", error: DELETE_ADMIN_ONLY },
    });
  const other = await withAdSet(input, campaignId);
  if (other) return other;
  const adSetId = str(input.adSetId);
  const adSet = adSetId
    ? await prisma.adSet.findFirst({
        where: { id: adSetId, campaignId },
        select: {
          id: true,
          name: true,
          _count: { select: { ads: true } },
          ads: { select: { inviteLinkId: true, trackingLinkId: true } },
        },
      })
    : null;
  if (!adSet) return failTo(PAGE(campaignId), "Groupe introuvable.", { tab: "ads" }, { code: "not_found" });
  if (opts.dryRun)
    return preview(`Suppression du groupe « ${adSet.name} » et de ses ${adSet._count.ads} pub(s).`, {
      impact: `${adSet._count.ads} pub(s) et leurs dépenses propres supprimées ; leurs liens d'entrée restent dans la campagne.`,
    });
  await prisma.$transaction([
    ...keepLinksInCampaignOps(campaignId, adSet.ads),
    prisma.adSet.delete({ where: { id: adSet.id } }),
  ]);
  await audit({
    userId: actor.userId,
    action: "adset.deleted",
    entityType: "AdSet",
    entityId: adSet.id,
    metadata: withVia(actor, { name: adSet.name, campaignId, ads: adSet._count.ads }),
  });
  await refreshCampaignStats();
  revalidatePath(PAGE(campaignId));
  return doneTo(PAGE(campaignId), `Groupe « ${adSet.name} » supprimé.`, { tab: "ads" });
};

/**
 * Vue d'ensemble : supprime la campagne (ADMIN). Groupes, pubs, coûts et statistiques de la campagne sont supprimés ;
 * ses liens d'entrée et liens traqués restent (Campagnes → Tous les liens) mais ne sont plus rattachés à une campagne ; les membres,
 * clics et joueurs sont conservés.
 */
export const deleteCampaign: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const resolved = await withCampaign(input);
  if (resolved) return resolved;
  const campaignId = campaignIdOf(input);
  if (!campaignId) return NOT_FOUND();
  if (actor.role !== "ADMIN")
    return forbidden(DELETE_ADMIN_ONLY, { path: PAGE(campaignId), params: { error: DELETE_ADMIN_ONLY } });
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
  if (!campaign) return NOT_FOUND();
  if (opts.dryRun)
    return preview(`Suppression de la campagne « ${campaign.name} ».`, {
      impact: `${campaign._count.adSets} groupe(s) de pubs, leurs pubs, dépenses et statistiques supprimés ; ${campaign._count.trackingLinks} lien(s) gardés sans campagne ; membres, clics et joueurs conservés.`,
    });
  await prisma.campaign.delete({ where: { id: campaignId } });
  await audit({
    userId: actor.userId,
    action: "campaign.deleted",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: withVia(actor, {
      name: campaign.name,
      externalCampaignId: campaign.externalCampaignId,
      connectionId: campaign.connectionId,
      affiliateCampaignIds: jsonIds(campaign.affiliateCampaignIds),
      channelIds: jsonIds(campaign.channelIds),
      adSets: campaign._count.adSets,
      inviteLinks: campaign._count.inviteLinks,
      trackingLinks: campaign._count.trackingLinks,
    }),
  });
  await refreshCampaignStats();
  revalidatePath("/campaigns");
  return doneTo("/campaigns", `Campagne « ${campaign.name} » supprimée.`);
};

// ---------------------------------------------------------------------------------------------------------------
// Assistant « Nouvelle campagne »
// ---------------------------------------------------------------------------------------------------------------

/** Retour à l'assistant, sur l'étape fautive, avec la saisie conservée. */
function wizardFail(step: WizardStepKey, message: string, draft: unknown, field?: string | null): CoreResult {
  const p: Record<string, string> = { error: message, step };
  try {
    p.draft = JSON.stringify(draft);
  } catch {
    /* saisie illisible : on repart de zéro */
  }
  return fail(message, { path: "/campaigns/new", params: p }, { field: field ?? step });
}

function dayToDate(d: string | null): Date | null {
  return d ? new Date(`${d}T00:00:00.000Z`) : null;
}

/** Jeton d'idempotence de l'assistant, mémorisé 24 h dans `Setting` (une ligne par création). */
const TOKEN_PREFIX = "campaign.wizard.";
const TOKEN_TTL_MS = 24 * 3_600_000;

/**
 * Réserve le jeton : la première requête l'écrit ; une seconde (double clic, renvoi du formulaire) trouve la ligne et
 * renvoie vers la campagne déjà créée au lieu d'en créer une seconde avec de nouvelles invitations Telegram.
 */
async function reserveToken(requestId: string): Promise<CoreResult | null> {
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
    return null;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const existing = await prisma.setting.findUnique({ where: { key } });
    const campaignId = (existing?.value as { campaignId?: unknown } | null)?.campaignId;
    if (typeof campaignId === "string")
      return doneTo(
        PAGE(campaignId),
        "Cette campagne a déjà été créée (un seul clic suffit) : la voici.",
        { tab: "links" },
        { campaignId },
      );
    return failTo(
      "/campaigns",
      "Création déjà en cours : patientez quelques secondes puis rechargez la page.",
      {},
      { code: "conflict" },
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
 * Kevin : « crée une campagne pour Celsius en France avec un CPA de 120 » → brouillon de l'assistant (mêmes champs) :
 * offres et canaux par leur nom, pays et rémunération notés dans les notes de la campagne (la campagne n'a pas de champ
 * pays ni CPA : la rémunération vient de Link Affi).
 */
async function wizardDraftFromWords(input: Record<string, unknown>): Promise<CoreResult | Record<string, unknown>> {
  const draft: Record<string, unknown> = {};
  for (const k of [
    "name",
    "vertical",
    "startAt",
    "endAt",
    "budgetDaily",
    "affiliateCampaignIds",
    "channelIds",
    "entryChannelId",
    "adPlatform",
    "connectionId",
    "importedCampaignId",
    "adCount",
    "notes",
    "requestId",
  ])
    if (input[k] !== undefined) draft[k] = input[k];
  const tmp: Record<string, unknown> = { ...draft, _offers: input.offers };
  const o2 = await resolveManyInto(tmp, "affiliateCampaignIds", "_offers", "l'offre", offerCandidates);
  if (!o2.ok) return fail(o2.error, null, { code: o2.code, field: "offers" });
  const tmp2: Record<string, unknown> = { channelIds: tmp.channelIds ?? [], _ch: input.channels };
  const c2 = await resolveManyInto(tmp2, "channelIds", "_ch", "le canal", channelCandidates);
  if (!c2.ok) return fail(c2.error, null, { code: c2.code, field: "channels" });
  const tmp3: Record<string, unknown> = { _e: input.entryChannel };
  const e2 = await resolveInto(tmp3, "entryChannelId", "_e", "le canal d'entrée", channelCandidates);
  if (!e2.ok) return fail(e2.error, null, { code: e2.code, field: "entryChannel" });
  const channelIds = list(tmp2.channelIds);
  const entry = str(tmp3.entryChannelId) || str(draft.entryChannelId);
  if (entry && !channelIds.includes(entry)) channelIds.push(entry);
  const extra = [
    str(input.country) ? `Pays : ${str(input.country)}` : "",
    input.cpa !== undefined && input.cpa !== null && input.cpa !== "" ? `CPA : ${str(input.cpa)} €` : "",
    input.revshare !== undefined && input.revshare !== null && input.revshare !== ""
      ? `Part du revenu : ${str(input.revshare)} %`
      : "",
  ].filter(Boolean);
  const notes = [str(draft.notes), extra.join(" · ")].filter(Boolean).join("\n");
  return {
    ...draft,
    affiliateCampaignIds: list(tmp.affiliateCampaignIds),
    channelIds,
    ...(entry ? { entryChannelId: entry } : {}),
    ...(typeof draft.adPlatform === "string" ? { adPlatform: draft.adPlatform.toUpperCase() } : {}),
    ...(notes ? { notes } : {}),
  };
}

/**
 * Création d'une campagne par l'assistant : campagne + offres + canaux (+ campagne pub importée du compte choisi, s'il
 * y en a une), puis « Groupe 1 » avec une pub précise et un lien d'entrée (goolink + invitation Telegram avec demande
 * d'adhésion sur le canal d'entrée choisi) par pub demandée. Si Telegram refuse un lien, la campagne reste créée et
 * l'erreur est affichée sur sa fiche (onglet Liens). Un double envoi ne crée jamais deux campagnes (jeton).
 */
export const createCampaignWizard: Core = async (input, actor, opts = {}) => {
  let raw: unknown = {};
  if (typeof input.payload === "string") {
    try {
      raw = JSON.parse(input.payload || "{}");
    } catch {
      raw = {};
    }
  } else if (input.payload && typeof input.payload === "object") raw = input.payload;
  else {
    const draft = await wizardDraftFromWords(input);
    if (draft.ok === false) return draft as CoreResult;
    raw = draft;
  }
  const parsed = parseWizardPayload(raw);
  if (!parsed.ok) return wizardFail(parsed.error.step, parsed.error.message, raw, parsed.error.field);
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
  if (offers.length !== d.affiliateCampaignIds.length)
    return wizardFail("offers", UNKNOWN_KEY_MESSAGE, raw);
  if (channels.length !== d.channelIds.length)
    return wizardFail(
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
      return wizardFail(
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
      return wizardFail(
        "ads",
        "Cette campagne pub n'est plus disponible pour ce compte (déjà rattachée ?) : choisissez-en une autre ou « aucune ».",
        raw,
      );
  }
  const entryChannel = d.entryChannelId ? channels.find((c) => c.id === d.entryChannelId) : null;
  if (d.adCount > 0 && !entryChannel)
    return wizardFail("ads", "Choisissez le canal d'entrée des pubs parmi les canaux cochés.", raw);

  if (opts.dryRun)
    return preview(
      [
        `Campagne « ${d.name} »${d.vertical ? ` (${d.vertical})` : ""}.`,
        offers.length ? `Offre(s) : ${joinNames(offers.map((o) => o.name))}.` : "Aucune offre Link Affi.",
        channels.length ? `Canaux : ${joinNames(channels.map((c) => c.title))}.` : "Aucun canal.",
        d.adCount > 0 && entryChannel
          ? `${d.adCount} lien(s) d'entrée ${d.adPlatform ?? ""} vers « ${entryChannel.title} ».`
          : "",
        d.notes ? `Notes : ${d.notes}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );

  if (d.requestId) {
    const reserved = await reserveToken(d.requestId);
    if (reserved) return reserved;
  }

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
    userId: actor.userId,
    action: "campaign.created",
    entityType: "Campaign",
    entityId: campaign.id,
    metadata: withVia(actor, {
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
    }),
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
        userId: actor.userId,
        ...(byName ? { matchedByName: true } : {}),
        ...viaArg(actor),
      });
    } catch (err) {
      mergeError = err instanceof Error ? err.message : "rattachement impossible";
      byName = null;
    }
  }

  let createdLinks = 0;
  let linkError: string | null = null;
  const urls: string[] = [];
  if (d.adCount > 0 && d.adPlatform && entryChannel) {
    for (const p of planAds(d.name, d.adCount)) {
      try {
        const r = await createCampaignEntryLink({
          campaignId: campaign.id,
          campaignName: d.name,
          channelId: entryChannel.id,
          platform: d.adPlatform,
          adName: p.adName,
          linkName: p.linkName,
          userId: actor.userId,
          ...viaArg(actor),
        });
        const slug = (r as { trackingLink?: { slug?: string } } | undefined)?.trackingLink?.slug;
        if (slug) urls.push(`${env.trackingBaseUrl}/${slug}`);
        createdLinks++;
      } catch (err) {
        linkError = err instanceof Error ? err.message : "création du lien impossible";
        break;
      }
    }
  }

  await refreshCampaignStats();
  revalidatePath("/campaigns");
  const params: Record<string, string> = { tab: "links" };
  const back = { path: PAGE(campaign.id), params };
  const data = { campaignId: campaign.id, links: urls };
  if (linkError || mergeError) {
    const error = [
      linkError
        ? `Campagne créée, mais ${createdLinks} lien${createdLinks > 1 ? "s" : ""} sur ${d.adCount} : ${linkError} Vous pouvez réessayer avec « Ajouter un lien d'entrée ».`
        : null,
      mergeError
        ? `Campagne créée, mais la campagne pub importée n'a pas pu être reprise : ${mergeError} Réessayez depuis l'onglet Pubs (« Rattacher une campagne pub importée »).`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    params.error = error;
    // La campagne existe : c'est une réussite partielle (Kevin le dit, avec la raison).
    return { ok: true, message: error, data, back };
  }
  const ok =
    (createdLinks > 0
      ? `Campagne créée avec ${createdLinks} lien${createdLinks > 1 ? "s" : ""} d'entrée vers « ${entryChannel?.title ?? ""} » : copiez chaque adresse ci-dessous dans la pub correspondante.`
      : "Campagne créée. Ajoutez ses pubs et ses liens d'entrée quand vous voulez.") +
    (byName
      ? ` La campagne pub « ${byName.name} » (même nom, déjà importée du compte) a été reprise : ses groupes, pubs et dépenses sont dans l'onglet Pubs.`
      : "");
  params.ok = ok;
  return done(
    actor.via !== "WEB" && urls.length ? `${ok} Adresses : ${urls.join(" ")}` : ok,
    back,
    data,
  );
};

// ---------------------------------------------------------------------------------------------------------------
// Mini-tutoriel « Affiliés sur vos canaux »
// ---------------------------------------------------------------------------------------------------------------

/**
 * « J'ai compris » du mini-tutoriel « Affiliés sur vos canaux » : il ne s'affiche plus pour cet utilisateur (il reste
 * accessible par « Mode d'emploi »). Journalisé comme les autres réglages de la visite guidée.
 */
export const dismissAffiliatesTutorial: Core = async (_input, actor, opts = {}) => {
  if (!actor.userId)
    return fail("Ce réglage est propre à un compte du site : aucun compte n'est lié à ce Telegram.", null, {
      code: "unavailable",
    });
  if (opts.dryRun) return preview("Le mini-tutoriel « Affiliés sur vos canaux » ne s'affichera plus pour ce compte.");
  await dismissTutorial(actor.userId);
  await audit({
    userId: actor.userId,
    action: "settings.affiliates_tutorial_hidden",
    entityType: "user",
    entityId: actor.userId,
    metadata: withVia(actor),
  });
  revalidatePath("/campaigns/affiliates");
  return done("Mini-tutoriel masqué.");
};
