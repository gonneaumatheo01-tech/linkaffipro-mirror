/**
 * Phase 32 — lectures Prisma des pages avancées de la Prospection (alertes, réseaux, valeur, affiliés signés,
 * attribution des sources, recherche par compte réel, compléments de la fiche). Lecture seule ; toujours avec la
 * condition de région visible : un canal hors Europe n'est ni montré ni compté.
 */
import { ACCOUNT_SEARCH, CALIBRATION_SOURCE, VALUE_DEFAULTS } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import {
  MUTED_KINDS_KEY,
  VALUE_STATUSES,
  accountSearchState,
  alertStatusesOf,
  attribution,
  calibrationProposals,
  mutedKindsOf,
  parseValueEstimate,
  pipelineValue,
  type AlertFilters,
} from "./advanced";
import { countryList } from "./display";
import { visibleRegionWhere } from "./filters";
import { loadSettingRows } from "./queries";

export const ALERTS_MAX = 200;

const prospectLite = { id: true, title: true, username: true, channelUrl: true, status: true, tier: true, watchMuted: true } as const;

export async function loadAlerts(filters: AlertFilters, scope: readonly string[]) {
  const visible = visibleRegionWhere(scope);
  const statuses = alertStatusesOf(filters);
  const where = {
    prospect: visible,
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.family ? { family: filters.family } : {}),
    ...(statuses ? { status: { in: statuses } } : {}),
  };
  const [rows, total, byStatus, mutedRow, mutedChannels] = await Promise.all([
    prisma.prospectAlert.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: ALERTS_MAX, include: { prospect: { select: prospectLite } } }),
    prisma.prospectAlert.count({ where }),
    prisma.prospectAlert.groupBy({ by: ["status"], where: { prospect: visible }, _count: { _all: true } }),
    prisma.setting.findUnique({ where: { key: MUTED_KINDS_KEY }, select: { value: true } }),
    prisma.prospect.findMany({ where: { AND: [visible, { watchMuted: true }] }, select: prospectLite, orderBy: { title: "asc" }, take: 100 }),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<string, number>;
  return { rows, total, counts, mutedKinds: mutedKindsOf(mutedRow?.value), mutedChannels };
}
export type AlertsData = Awaited<ReturnType<typeof loadAlerts>>;
export type AlertRow = AlertsData["rows"][number];

/** Alertes à voir (nouvelles ou envoyées par Kevin), pour la pastille de la sous-navigation. */
export async function loadOpenAlertsCount(scope: readonly string[]): Promise<number> {
  return prisma.prospectAlert.count({ where: { status: { in: ["NEW", "SENT"] }, prospect: visibleRegionWhere(scope) } });
}

const memberSelect = { id: true, title: true, username: true, channelUrl: true, status: true, tier: true, medianViews: true, subscribers: true, countries: true, vertical: true, valueEstimate: true } as const;

export async function loadNetworks(scope: readonly string[]) {
  const visible = visibleRegionWhere(scope);
  const nets = await prisma.prospectNetwork.findMany({
    where: { members: { some: visible } },
    orderBy: [{ totalReach: "desc" }, { id: "asc" }],
    take: 100,
    include: { members: { where: visible, select: memberSelect, orderBy: [{ medianViews: { sort: "desc", nulls: "last" } }, { id: "asc" }] } },
  });
  return nets.map((n) => {
    const values = n.members.map((m) => parseValueEstimate(m.valueEstimate)).filter((e) => e !== null);
    const value = values.length ? { low: values.reduce((a, e) => a + e.low, 0), base: values.reduce((a, e) => a + e.base, 0), high: values.reduce((a, e) => a + e.high, 0), count: values.length } : null;
    return { ...n, value };
  });
}
export type NetworkRow = Awaited<ReturnType<typeof loadNetworks>>[number];

const VALUE_MAX = 3000;
export const VALUE_TABLE_MAX = 100;

export async function loadValues(scope: readonly string[]) {
  const visible = visibleRegionWhere(scope);
  const [rows, calibrations, proposalsRaw, lastApplied, settings] = await Promise.all([
    prisma.prospect.findMany({
      where: { AND: [visible, { status: { in: [...VALUE_STATUSES] } }] },
      select: { id: true, title: true, username: true, channelUrl: true, status: true, tier: true, vertical: true, countries: true, contentType: true, valueEstimate: true, networkId: true },
      take: VALUE_MAX,
    }),
    prisma.prospectCalibration.findMany({ orderBy: [{ source: "desc" }, { segment: "asc" }], take: 200 }),
    prisma.recommendation.findMany({
      where: { source: CALIBRATION_SOURCE, status: "PROPOSED" },
      select: { id: true, targetId: true, field: true, before: true, after: true, evidence: true, expectedGain: true, createdAt: true },
      take: 50,
    }),
    prisma.recommendation.findFirst({
      where: { source: CALIBRATION_SOURCE, status: "APPLIED" },
      orderBy: { appliedAt: "desc" },
      select: { id: true, appliedAt: true, field: true, targetId: true },
    }),
    loadSettingRows([VALUE_DEFAULTS.arpuMonth.key]),
  ]);
  const valued = rows
    .map((r) => ({ ...r, estimate: parseValueEstimate(r.valueEstimate) }))
    .filter((r) => r.estimate !== null)
    .sort((a, b) => b.estimate!.base - a.estimate!.base || a.id.localeCompare(b.id));
  const arpu = settings[VALUE_DEFAULTS.arpuMonth.key];
  return {
    pipeline: pipelineValue(rows),
    top: valued.slice(0, VALUE_TABLE_MAX),
    valuedCount: valued.length,
    anyCalibrated: calibrations.some((c) => c.source === "calibrated"),
    calibrations,
    proposals: calibrationProposals(proposalsRaw),
    lastApplied,
    arpuMonth: typeof arpu === "number" && arpu > 0 ? arpu : null,
  };
}
export type ValuesData = Awaited<ReturnType<typeof loadValues>>;

export const AFFILIATE_STATUSES = ["SIGNED", "ACTIVE", "CHURNED"] as const;

export async function loadAffiliates(scope: readonly string[]) {
  const rows = await prisma.prospect.findMany({
    where: { AND: [visibleRegionWhere(scope), { status: { in: [...AFFILIATE_STATUSES] } }] },
    orderBy: [{ signedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      username: true,
      channelUrl: true,
      status: true,
      tier: true,
      signedAt: true,
      dealType: true,
      dealTerms: true,
      valueEstimate: true,
      linkAffiAffiliateId: true,
      linkAffiLinkedAt: true,
      linkAffiAskCount: true,
      results: { orderBy: { month: "desc" }, take: 6 },
      alerts: { where: { kind: { startsWith: "AFFILIATE_" }, status: { not: "MUTED" } }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  return rows.map((r) => ({ ...r, estimate: parseValueEstimate(r.valueEstimate) }));
}
export type AffiliateRow = Awaited<ReturnType<typeof loadAffiliates>>[number];

/** Attribution par source et par pays (canaux lus et notés seulement), et état de la recherche par compte réel. */
export async function loadAttribution(scope: readonly string[]) {
  const rows = await prisma.prospect.findMany({
    where: visibleRegionWhere(scope),
    select: { sourceType: true, tier: true, status: true, signedAt: true, countries: true },
    take: 20_000,
  });
  return {
    bySource: attribution(rows.map((r) => ({ key: r.sourceType, tier: r.tier, status: r.status, signedAt: r.signedAt }))),
    byCountry: attribution(rows.map((r) => ({ key: countryList(r.countries)[0] ?? null, tier: r.tier, status: r.status, signedAt: r.signedAt }))),
  };
}
export type AttributionData = Awaited<ReturnType<typeof loadAttribution>>;

export async function loadAccountSearch(now: Date) {
  const rows = await loadSettingRows([ACCOUNT_SEARCH.enabled.key, ACCOUNT_SEARCH.offeredKey, ACCOUNT_SEARCH.countersKey]);
  return accountSearchState({ enabled: rows[ACCOUNT_SEARCH.enabled.key], offered: rows[ACCOUNT_SEARCH.offeredKey], counters: rows[ACCOUNT_SEARCH.countersKey] }, now);
}

/** Compléments de la fiche : historique des mesures, réseau, alertes récentes, résultats réels. */
export async function loadProspectExtras(id: string, networkId: string | null, scope: readonly string[]) {
  const [snapshots, network, alerts, results] = await Promise.all([
    prisma.prospectSnapshot.findMany({ where: { prospectId: id }, orderBy: { takenAt: "asc" }, take: 26, select: { takenAt: true, subscribers: true, medianViews: true, tier: true, score: true } }),
    networkId
      ? prisma.prospectNetwork.findUnique({
          where: { id: networkId },
          select: { id: true, name: true, mainContact: true, totalReach: true, origin: true, status: true, members: { where: visibleRegionWhere(scope), select: { id: true, title: true, username: true, channelUrl: true } } },
        })
      : Promise.resolve(null),
    prisma.prospectAlert.findMany({ where: { prospectId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.affiliateResult.findMany({ where: { prospectId: id }, orderBy: { month: "desc" }, take: 6 }),
  ]);
  return { snapshots, network, alerts, results };
}
export type ProspectExtras = Awaited<ReturnType<typeof loadProspectExtras>>;
