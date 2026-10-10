/**
 * Rattachement d'une campagne pub importée (créée par la synchro d'un compte Meta / TikTok connecté) à une de nos
 * campagnes : la campagne pub devient la structure de l'onglet Pubs de notre campagne.
 *
 * Dans une seule transaction : coûts CSV et saisis de notre campagne retirés pour les jours que l'API couvre déjà dans
 * la campagne pub (priorité de l'API, sinon la dépense de ces jours compterait deux fois ; voir `cost-scope.ts`),
 * groupes (et donc pubs) déplacés (noms rendus uniques), coûts déplacés (niveau
 * « campagne » réécrit, doublons du même jour et de même source remplacés par ceux de la campagne pub), statistiques
 * journalières de la coquille supprimées ou rattachées (le recalcul complet les reconstruit), liens d'entrée et
 * liens traqués déplacés, identifiant externe + compte + plateforme copiés sur notre campagne (repère « linked »),
 * coquille supprimée. Puis une ligne d'AuditLog. Le recalcul des statistiques est demandé par l'appelant.
 */
import { prisma, audit } from "@linkaffipro/db";
import { isImportedShell, linkedAdLink, pickShellByName } from "./ad-link";
import { API_OVERRIDDEN_SOURCES, campaignCostScope } from "./cost-scope";

/** Noms des groupes déplacés, rendus uniques dans la campagne cible (« Groupe 1 (2) »). */
export function planAdSetNames(
  targetNames: readonly string[],
  moving: ReadonlyArray<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  const taken = new Set(targetNames.map((n) => n.toLowerCase()));
  return moving.map((s) => {
    let name = s.name;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${s.name} (${i})`;
    taken.add(name.toLowerCase());
    return { id: s.id, name };
  });
}

const select = {
  id: true,
  name: true,
  externalCampaignId: true,
  adExternalIds: true,
  affiliateCampaignIds: true,
  channelIds: true,
  connectionId: true,
  adPlatform: true,
  adSets: { select: { id: true, name: true } },
} as const;

export type MergeResult = { adSets: number; costs: number; platformName: string };

/**
 * Campagne pub importée libre du compte `connectionId` qui porte le même nom que notre campagne (voir
 * `pickShellByName`), ou null. `exceptId` : notre campagne elle-même, exclue.
 */
export async function findImportedShellByName(
  connectionId: string,
  name: string,
  exceptId?: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await prisma.campaign.findMany({
    where: {
      connectionId,
      externalCampaignId: { not: null },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: {
      id: true,
      name: true,
      externalCampaignId: true,
      adExternalIds: true,
      affiliateCampaignIds: true,
      channelIds: true,
    },
  });
  const hit = pickShellByName(name, rows.filter(isImportedShell));
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** Fond la campagne pub importée `shellId` dans notre campagne `targetId` (voir l'en-tête). Lève une erreur lisible. */
export async function mergeImportedCampaign(input: {
  targetId: string;
  shellId: string;
  userId: string;
  /** Rattachement fait par le rapprochement des noms (assistant, fiche), pas par un choix explicite. */
  matchedByName?: boolean;
}): Promise<MergeResult> {
  const { targetId, shellId } = input;
  if (targetId === shellId)
    throw new Error("Choisissez une autre campagne pub que la campagne elle-même.");
  const [target, shell] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: targetId }, select }),
    prisma.campaign.findUnique({ where: { id: shellId }, select }),
  ]);
  if (!target) throw new Error("Campagne introuvable.");
  if (!shell || !isImportedShell(shell))
    throw new Error(
      "Cette campagne pub n'est plus une campagne pub importée libre (déjà rattachée, ou elle a des offres ou des canaux).",
    );
  if (target.externalCampaignId && target.externalCampaignId !== shell.externalCampaignId)
    throw new Error(
      "Cette campagne suit déjà une autre campagne pub : une campagne ne suit qu'une seule campagne pub TikTok ou Meta.",
    );

  const adSets = planAdSetNames(
    target.adSets.map((s) => s.name),
    shell.adSets,
  );
  const shellKey = `campaign:${shellId}`;
  const targetKey = `campaign:${targetId}`;
  const shellCampaignCosts = await prisma.adCost.findMany({
    where: { levelKey: shellKey },
    select: { id: true, date: true, source: true },
  });
  const conflicts = shellCampaignCosts.length
    ? await prisma.adCost.findMany({
        where: {
          levelKey: targetKey,
          OR: shellCampaignCosts.map((c) => ({ date: c.date, source: c.source })),
        },
        select: { id: true },
      })
    : [];
  // Priorité de l'API : jours couverts par la campagne pub (tous niveaux), puis nos coûts CSV / saisis de ces jours.
  const apiDays = await prisma.adCost.findMany({
    where: { source: "API", OR: campaignCostScope(shellId) },
    select: { date: true },
    distinct: ["date"],
  });
  const overridden = apiDays.length
    ? await prisma.adCost.findMany({
        where: {
          source: { in: [...API_OVERRIDDEN_SOURCES] },
          date: { in: apiDays.map((d) => d.date) },
          OR: campaignCostScope(targetId),
        },
        select: { id: true, spend: true, source: true },
      })
    : [];
  const overriddenSpend =
    Math.round(overridden.reduce((sum, c) => sum + Number(c.spend), 0) * 100) / 100;

  await prisma.$transaction([
    // D'abord, tant que seuls nos propres coûts sont dans notre campagne.
    ...(overridden.length
      ? [prisma.adCost.deleteMany({ where: { id: { in: overridden.map((c) => c.id) } } })]
      : []),
    ...adSets.map((s) =>
      prisma.adSet.update({ where: { id: s.id }, data: { campaignId: targetId, name: s.name } }),
    ),
    ...(conflicts.length
      ? [prisma.adCost.deleteMany({ where: { id: { in: conflicts.map((c) => c.id) } } })]
      : []),
    prisma.adCost.updateMany({
      where: { levelKey: shellKey },
      data: { levelKey: targetKey, campaignId: targetId },
    }),
    prisma.adCost.updateMany({ where: { campaignId: shellId }, data: { campaignId: targetId } }),
    prisma.dailyStat.deleteMany({ where: { dimension: shellKey } }),
    prisma.dailyStat.updateMany({ where: { campaignId: shellId }, data: { campaignId: targetId } }),
    prisma.inviteLink.updateMany({
      where: { campaignId: shellId },
      data: { campaignId: targetId },
    }),
    prisma.trackingLink.updateMany({
      where: { campaignId: shellId },
      data: { campaignId: targetId },
    }),
    prisma.campaign.delete({ where: { id: shellId } }),
    prisma.campaign.update({
      where: { id: targetId },
      data: {
        externalCampaignId: shell.externalCampaignId,
        connectionId: shell.connectionId,
        adPlatform: shell.adPlatform,
        adExternalIds: linkedAdLink(shell.name),
      },
    }),
  ]);
  await audit({
    userId: input.userId,
    action: "campaign.ad_campaign_attached",
    entityType: "Campaign",
    entityId: targetId,
    metadata: {
      importedCampaignId: shellId,
      importedCampaignName: shell.name,
      externalCampaignId: shell.externalCampaignId,
      connectionId: shell.connectionId,
      adPlatform: shell.adPlatform,
      adSets: adSets.length,
      replacedCosts: conflicts.length,
      replacedByApiCosts: overridden.length,
      replacedByApiSpend: overriddenSpend,
      replacedByApiSources: [...new Set(overridden.map((c) => c.source))],
      ...(input.matchedByName ? { matchedByName: true } : {}),
    },
  });
  return { adSets: adSets.length, costs: shellCampaignCosts.length, platformName: shell.name };
}
