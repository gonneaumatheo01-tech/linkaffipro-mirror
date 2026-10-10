/**
 * Applique les lignes de rapport d'un compte publicitaire connecté aux campagnes (onglet Pubs de la page Campagnes) :
 * campagnes pub, groupes et pubs créés ou mis à jour par identifiant externe, coûts journaliers `AdCost`
 * (source API, dépense convertie en EUR, original conservé), rattachement automatique d'une pub
 * à un lien d'entrée de même nom (le lien entre alors aussi dans la campagne). Logique pure testée dans `plan.ts`,
 * écriture ici.
 *
 * L'API a priorité sur les coûts CSV et saisis : pour chaque jour d'une campagne qui reçoit des coûts API, les lignes
 * CSV et MANUAL du même jour (tous niveaux de la campagne) sont retirées, avec un événement `ads.costs_replaced_by_api`.
 * Sinon une campagne qui avait des coûts CSV avant d'être rattachée (ou adoptée) compterait deux fois sa dépense.
 *
 * Une campagne pub encore inconnue est d'abord proposée à nos campagnes : si une de nos campagnes est rattachée à
 * ce compte (assistant ou fiche) sans campagne pub, et porte le même nom, elle l'adopte (identifiant externe posé)
 * au lieu d'un doublon « importé ». Sinon la synchro crée une campagne pub importée (repère `source: "sync"`),
 * à rattacher ensuite depuis l'onglet Pubs d'une de nos campagnes. Le nom d'une de nos campagnes n'est jamais
 * remplacé par celui de la plateforme.
 */
import { prisma, recordEvent } from "@linkaffipro/db";
import { toEur, type AdInsightRow, type Rates } from "@linkaffipro/connectors";
import { logger } from "../logger";
import {
  adLinkAfterSync,
  campaignCostScope,
  groupRows,
  levelKeyOf,
  normalizeAdName,
  pickAdoptableCampaign,
  readAdLink,
  shouldRenameFromPlatform,
  type ApplyReport,
} from "./plan";

type Connection = {
  id: string;
  platform: "META" | "TIKTOK" | "OTHER";
  currency: string;
  name: string;
};

export async function applyInsights(
  connection: Connection,
  rows: AdInsightRow[],
  rates: Rates,
): Promise<ApplyReport> {
  const report: ApplyReport = {
    rows: rows.length,
    written: 0,
    skipped: 0,
    unknownCurrencies: [],
    created: { campaigns: 0, adSets: 0, ads: 0 },
    linked: 0,
    adopted: 0,
    replacedCosts: 0,
  };
  const groups = groupRows(rows);
  const campaignIds = new Map<string, string>();
  const adSetIds = new Map<string, string>();
  const adIds = new Map<string, string>();

  const campaignSelect = {
    id: true,
    name: true,
    adExternalIds: true,
    affiliateCampaignIds: true,
    channelIds: true,
  } as const;
  for (const g of groups.campaigns) {
    const existing =
      (await prisma.campaign.findFirst({
        where: { connectionId: connection.id, externalCampaignId: g.externalId },
        select: campaignSelect,
      })) ??
      (await prisma.campaign.findFirst({
        where: {
          adPlatform: connection.platform,
          externalCampaignId: g.externalId,
          connectionId: null,
        },
        select: campaignSelect,
      }));
    if (existing) {
      const rename = shouldRenameFromPlatform(existing, g.name);
      await prisma.campaign.update({
        where: { id: existing.id },
        data: {
          ...(rename ? { name: g.name } : {}),
          connectionId: connection.id,
          adExternalIds: adLinkAfterSync(readAdLink(existing.adExternalIds), g.name, existing),
        },
      });
      campaignIds.set(g.externalId, existing.id);
      continue;
    }
    // Une de nos campagnes, rattachée à ce compte mais pas encore à une campagne pub, au même nom : on l'adopte.
    const candidates = await prisma.campaign.findMany({
      where: { connectionId: connection.id, externalCampaignId: null },
      select: { id: true, name: true },
    });
    const adopt = pickAdoptableCampaign(g.name, candidates);
    if (adopt) {
      await prisma.campaign.update({
        where: { id: adopt.id },
        data: {
          externalCampaignId: g.externalId,
          adPlatform: connection.platform,
          adExternalIds: { source: "linked", platformName: g.name },
        },
      });
      await recordEvent({
        type: "ads.campaign_adopted",
        payload: {
          campaignId: adopt.id,
          connectionId: connection.id,
          externalCampaignId: g.externalId,
          platformName: g.name,
        },
      });
      campaignIds.set(g.externalId, adopt.id);
      report.adopted++;
      continue;
    }
    const created = await prisma.campaign.create({
      data: {
        name: g.name,
        adPlatform: connection.platform,
        externalCampaignId: g.externalId,
        connectionId: connection.id,
        currency: connection.currency,
        status: "ACTIVE",
        adExternalIds: { source: "sync", platformName: g.name },
      },
      select: { id: true },
    });
    campaignIds.set(g.externalId, created.id);
    report.created.campaigns++;
  }

  for (const g of groups.adSets) {
    const campaignId = campaignIds.get(g.campaignExternalId);
    if (!campaignId) continue;
    const existing =
      (await prisma.adSet.findFirst({
        where: { campaignId, externalId: g.externalId },
        select: { id: true, name: true },
      })) ??
      (await prisma.adSet.findFirst({
        where: { campaignId, name: g.name, externalId: null },
        select: { id: true, name: true },
      }));
    if (existing) {
      if (existing.name !== g.name)
        await prisma.adSet
          .update({ where: { id: existing.id }, data: { name: g.name, externalId: g.externalId } })
          .catch(() => undefined);
      else
        await prisma.adSet.update({
          where: { id: existing.id },
          data: { externalId: g.externalId },
        });
      adSetIds.set(g.key, existing.id);
      continue;
    }
    const created = await prisma.adSet.create({
      data: {
        campaignId,
        name: await uniqueName("adSet", { campaignId }, g.name),
        externalId: g.externalId,
      },
      select: { id: true },
    });
    adSetIds.set(g.key, created.id);
    report.created.adSets++;
  }

  const adSetCampaign = new Map(
    groups.adSets.map((g) => [g.key, campaignIds.get(g.campaignExternalId) ?? null]),
  );
  for (const g of groups.ads) {
    const adSetId = adSetIds.get(g.adSetKey);
    if (!adSetId) continue;
    const existing =
      (await prisma.ad.findFirst({
        where: { adSetId, externalId: g.externalId },
        select: { id: true, name: true, inviteLinkId: true },
      })) ??
      (await prisma.ad.findFirst({
        where: { adSetId, name: g.name, externalId: null },
        select: { id: true, name: true, inviteLinkId: true },
      }));
    let adId: string;
    let inviteLinkId: string | null;
    if (existing) {
      adId = existing.id;
      inviteLinkId = existing.inviteLinkId;
      if (existing.name !== g.name)
        await prisma.ad
          .update({ where: { id: adId }, data: { name: g.name, externalId: g.externalId } })
          .catch(() => undefined);
      else await prisma.ad.update({ where: { id: adId }, data: { externalId: g.externalId } });
    } else {
      const created = await prisma.ad.create({
        data: {
          adSetId,
          name: await uniqueName("ad", { adSetId }, g.name),
          externalId: g.externalId,
        },
        select: { id: true },
      });
      adId = created.id;
      inviteLinkId = null;
      report.created.ads++;
    }
    adIds.set(g.key, adId);
    const campaignId = adSetCampaign.get(g.adSetKey) ?? null;
    if (
      !inviteLinkId &&
      campaignId &&
      (await autoLink(adId, g.name, connection.platform, campaignId))
    )
      report.linked++;
  }

  // Coûts journaliers : une ligne = (niveau, jour, source API).
  const apiDays = new Map<string, Set<string>>();
  for (const r of rows) {
    const campaignId = campaignIds.get(r.campaignExternalId);
    if (!campaignId) {
      report.skipped++;
      continue;
    }
    const adSetId = r.adSetExternalId
      ? (adSetIds.get(`${r.campaignExternalId}/${r.adSetExternalId}`) ?? null)
      : null;
    const adId =
      r.adExternalId && adSetId
        ? (adIds.get(`${r.campaignExternalId}/${r.adSetExternalId}/${r.adExternalId}`) ?? null)
        : null;
    const eur = toEur(r.spend, r.currency, rates);
    if (eur === null) {
      report.skipped++;
      const code = (r.currency ?? "").toUpperCase();
      if (code && !report.unknownCurrencies.includes(code)) report.unknownCurrencies.push(code);
      continue;
    }
    const levelKey = levelKeyOf({ adId, adSetId, campaignId });
    const date = new Date(`${r.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      report.skipped++;
      continue;
    }
    await prisma.adCost.upsert({
      where: { levelKey_date_source: { levelKey, date, source: "API" } },
      create: {
        levelKey,
        date,
        source: "API",
        campaignId,
        adSetId,
        adId,
        spend: eur,
        spendOriginal: r.spend,
        currency: (r.currency ?? "EUR").toUpperCase(),
        impressions: r.impressions,
        clicks: r.clicks,
      },
      update: {
        spend: eur,
        spendOriginal: r.spend,
        currency: (r.currency ?? "EUR").toUpperCase(),
        impressions: r.impressions,
        clicks: r.clicks,
        campaignId,
        adSetId,
        adId,
      },
    });
    report.written++;
    const days = apiDays.get(campaignId) ?? new Set<string>();
    days.add(r.date);
    apiDays.set(campaignId, days);
  }
  for (const [campaignId, days] of apiDays)
    report.replacedCosts += await replaceCostsCoveredByApi(campaignId, [...days], connection.id);
  if (report.unknownCurrencies.length)
    logger.warn(
      { connection: connection.name, currencies: report.unknownCurrencies },
      "devises sans taux : lignes ignorées (saisir un taux dans Réglages → Connecteurs)",
    );
  return report;
}

/** Évite les collisions de noms (contrainte unique par parent) : suffixe « (2) », « (3) »… */
async function uniqueName(
  kind: "adSet" | "ad",
  parent: { campaignId?: string; adSetId?: string },
  name: string,
): Promise<string> {
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? name : `${name} (${i})`;
    const taken =
      kind === "adSet"
        ? await prisma.adSet.findFirst({
            where: { campaignId: parent.campaignId!, name: candidate },
            select: { id: true },
          })
        : await prisma.ad.findFirst({
            where: { adSetId: parent.adSetId!, name: candidate },
            select: { id: true },
          });
    if (!taken) return candidate;
  }
  return `${name} (${Date.now()})`;
}

/**
 * Priorité de l'API (voir l'en-tête) : retire les coûts CSV et saisis de la campagne aux jours (AAAA-MM-JJ) qui
 * viennent de recevoir des coûts API. Renvoie le nombre de lignes retirées.
 */
async function replaceCostsCoveredByApi(
  campaignId: string,
  days: string[],
  connectionId: string,
): Promise<number> {
  if (!days.length) return 0;
  const dupes = await prisma.adCost.findMany({
    where: {
      source: { in: ["CSV", "MANUAL"] },
      date: { in: days.map((d) => new Date(`${d}T00:00:00.000Z`)) },
      OR: campaignCostScope(campaignId),
    },
    select: { id: true, date: true, source: true, spend: true },
  });
  if (!dupes.length) return 0;
  await prisma.adCost.deleteMany({ where: { id: { in: dupes.map((d) => d.id) } } });
  const spend = Math.round(dupes.reduce((s, d) => s + Number(d.spend), 0) * 100) / 100;
  await recordEvent({
    type: "ads.costs_replaced_by_api",
    payload: {
      campaignId,
      connectionId,
      removed: dupes.length,
      spend,
      sources: [...new Set(dupes.map((d) => d.source))],
      days: [...new Set(dupes.map((d) => d.date.toISOString().slice(0, 10)))].sort(),
    },
  });
  logger.info(
    { campaignId, removed: dupes.length, spend },
    "coûts CSV / saisis remplacés par les coûts de l'API (mêmes jours)",
  );
  return dupes.length;
}

/**
 * Rattache la pub au lien d'entrée libre dont le nom (ou le nom de pub déclaré) correspond. Seuls les liens sans
 * campagne ou déjà dans la campagne de la pub sont candidats (jamais le lien d'une autre campagne) ; le lien rattaché
 * entre dans la campagne (`campaignId`), comme un rattachement fait à la main : il y reste si la pub est supprimée.
 */
async function autoLink(
  adId: string,
  adName: string,
  platform: "META" | "TIKTOK" | "OTHER",
  campaignId: string,
): Promise<boolean> {
  const wanted = normalizeAdName(adName);
  if (!wanted) return false;
  const candidates = await prisma.inviteLink.findMany({
    where: {
      kind: "AD_ENTRY",
      ad: null,
      OR: [{ adPlatform: platform }, { adPlatform: null }],
      AND: [{ OR: [{ campaignId: null }, { campaignId }] }],
    },
    select: {
      id: true,
      name: true,
      adName: true,
      trackingLinks: { where: { kind: "AD_ENTRY" }, select: { id: true }, take: 1 },
    },
    take: 500,
  });
  const link =
    candidates.find((c) => normalizeAdName(c.adName ?? "") === wanted) ??
    candidates.find((c) => normalizeAdName(c.name) === wanted);
  if (!link) return false;
  const trackingLinkId = link.trackingLinks[0]?.id ?? null;
  await prisma.$transaction([
    prisma.ad.update({ where: { id: adId }, data: { inviteLinkId: link.id, trackingLinkId } }),
    prisma.inviteLink.updateMany({
      where: { id: link.id, campaignId: null },
      data: { campaignId },
    }),
    ...(trackingLinkId
      ? [
          prisma.trackingLink.updateMany({
            where: { id: trackingLinkId, campaignId: null },
            data: { campaignId },
          }),
        ]
      : []),
  ]);
  return true;
}
