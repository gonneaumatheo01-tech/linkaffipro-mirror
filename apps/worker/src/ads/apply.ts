/**
 * Applique les lignes de rapport d'un compte publicitaire connecté au module Pubs :
 * campagnes, groupes et pubs créés ou mis à jour par identifiant externe, coûts journaliers `AdCost`
 * (source API, dépense convertie en EUR, original conservé), rattachement automatique d'une pub
 * à un lien d'entrée de même nom. Logique pure testée dans `plan.ts`, écriture ici.
 */
import { prisma } from "@linkaffipro/db";
import { toEur, type AdInsightRow, type Rates } from "@linkaffipro/connectors";
import { logger } from "../logger";
import { groupRows, levelKeyOf, normalizeAdName, type ApplyReport } from "./plan";

type Connection = { id: string; platform: "META" | "TIKTOK" | "OTHER"; currency: string; name: string };

export async function applyInsights(connection: Connection, rows: AdInsightRow[], rates: Rates): Promise<ApplyReport> {
  const report: ApplyReport = { rows: rows.length, written: 0, skipped: 0, unknownCurrencies: [], created: { campaigns: 0, adSets: 0, ads: 0 }, linked: 0 };
  const groups = groupRows(rows);
  const campaignIds = new Map<string, string>();
  const adSetIds = new Map<string, string>();
  const adIds = new Map<string, string>();

  for (const g of groups.campaigns) {
    const existing =
      (await prisma.campaign.findFirst({ where: { connectionId: connection.id, externalCampaignId: g.externalId }, select: { id: true, name: true } })) ??
      (await prisma.campaign.findFirst({ where: { adPlatform: connection.platform, externalCampaignId: g.externalId, connectionId: null }, select: { id: true, name: true } }));
    if (existing) {
      if (existing.name !== g.name) await prisma.campaign.update({ where: { id: existing.id }, data: { name: g.name, connectionId: connection.id } });
      else await prisma.campaign.update({ where: { id: existing.id }, data: { connectionId: connection.id } });
      campaignIds.set(g.externalId, existing.id);
      continue;
    }
    const created = await prisma.campaign.create({
      data: { name: g.name, adPlatform: connection.platform, externalCampaignId: g.externalId, connectionId: connection.id, currency: connection.currency, status: "ACTIVE" },
      select: { id: true },
    });
    campaignIds.set(g.externalId, created.id);
    report.created.campaigns++;
  }

  for (const g of groups.adSets) {
    const campaignId = campaignIds.get(g.campaignExternalId);
    if (!campaignId) continue;
    const existing =
      (await prisma.adSet.findFirst({ where: { campaignId, externalId: g.externalId }, select: { id: true, name: true } })) ??
      (await prisma.adSet.findFirst({ where: { campaignId, name: g.name, externalId: null }, select: { id: true, name: true } }));
    if (existing) {
      if (existing.name !== g.name) await prisma.adSet.update({ where: { id: existing.id }, data: { name: g.name, externalId: g.externalId } }).catch(() => undefined);
      else await prisma.adSet.update({ where: { id: existing.id }, data: { externalId: g.externalId } });
      adSetIds.set(g.key, existing.id);
      continue;
    }
    const created = await prisma.adSet.create({ data: { campaignId, name: await uniqueName("adSet", { campaignId }, g.name), externalId: g.externalId }, select: { id: true } });
    adSetIds.set(g.key, created.id);
    report.created.adSets++;
  }

  for (const g of groups.ads) {
    const adSetId = adSetIds.get(g.adSetKey);
    if (!adSetId) continue;
    const existing =
      (await prisma.ad.findFirst({ where: { adSetId, externalId: g.externalId }, select: { id: true, name: true, inviteLinkId: true } })) ??
      (await prisma.ad.findFirst({ where: { adSetId, name: g.name, externalId: null }, select: { id: true, name: true, inviteLinkId: true } }));
    let adId: string;
    let inviteLinkId: string | null;
    if (existing) {
      adId = existing.id;
      inviteLinkId = existing.inviteLinkId;
      if (existing.name !== g.name) await prisma.ad.update({ where: { id: adId }, data: { name: g.name, externalId: g.externalId } }).catch(() => undefined);
      else await prisma.ad.update({ where: { id: adId }, data: { externalId: g.externalId } });
    } else {
      const created = await prisma.ad.create({ data: { adSetId, name: await uniqueName("ad", { adSetId }, g.name), externalId: g.externalId }, select: { id: true } });
      adId = created.id;
      inviteLinkId = null;
      report.created.ads++;
    }
    adIds.set(g.key, adId);
    if (!inviteLinkId && (await autoLink(adId, g.name, connection.platform))) report.linked++;
  }

  // Coûts journaliers : une ligne = (niveau, jour, source API).
  for (const r of rows) {
    const campaignId = campaignIds.get(r.campaignExternalId);
    if (!campaignId) {
      report.skipped++;
      continue;
    }
    const adSetId = r.adSetExternalId ? adSetIds.get(`${r.campaignExternalId}/${r.adSetExternalId}`) ?? null : null;
    const adId = r.adExternalId && adSetId ? adIds.get(`${r.campaignExternalId}/${r.adSetExternalId}/${r.adExternalId}`) ?? null : null;
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
      create: { levelKey, date, source: "API", campaignId, adSetId, adId, spend: eur, spendOriginal: r.spend, currency: (r.currency ?? "EUR").toUpperCase(), impressions: r.impressions, clicks: r.clicks },
      update: { spend: eur, spendOriginal: r.spend, currency: (r.currency ?? "EUR").toUpperCase(), impressions: r.impressions, clicks: r.clicks, campaignId, adSetId, adId },
    });
    report.written++;
  }
  if (report.unknownCurrencies.length) logger.warn({ connection: connection.name, currencies: report.unknownCurrencies }, "devises sans taux : lignes ignorées (saisir un taux dans Réglages → Connecteurs)");
  return report;
}

/** Évite les collisions de noms (contrainte unique par parent) : suffixe « (2) », « (3) »… */
async function uniqueName(kind: "adSet" | "ad", parent: { campaignId?: string; adSetId?: string }, name: string): Promise<string> {
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? name : `${name} (${i})`;
    const taken =
      kind === "adSet"
        ? await prisma.adSet.findFirst({ where: { campaignId: parent.campaignId!, name: candidate }, select: { id: true } })
        : await prisma.ad.findFirst({ where: { adSetId: parent.adSetId!, name: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${name} (${Date.now()})`;
}

/** Rattache la pub au lien d'entrée libre dont le nom (ou le nom de pub déclaré) correspond. */
async function autoLink(adId: string, adName: string, platform: "META" | "TIKTOK" | "OTHER"): Promise<boolean> {
  const wanted = normalizeAdName(adName);
  if (!wanted) return false;
  const candidates = await prisma.inviteLink.findMany({
    where: { kind: "AD_ENTRY", ad: null, OR: [{ adPlatform: platform }, { adPlatform: null }] },
    select: { id: true, name: true, adName: true, trackingLinks: { where: { kind: "AD_ENTRY" }, select: { id: true }, take: 1 } },
    take: 500,
  });
  const link = candidates.find((c) => normalizeAdName(c.adName ?? "") === wanted) ?? candidates.find((c) => normalizeAdName(c.name) === wanted);
  if (!link) return false;
  await prisma.ad.update({ where: { id: adId }, data: { inviteLinkId: link.id, trackingLinkId: link.trackingLinks[0]?.id ?? null } });
  return true;
}
