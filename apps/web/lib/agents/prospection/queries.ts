/**
 * Phase 31 — lectures Prisma de la page Agents → Prospection (tableau, avancement, fiche, offres, sources,
 * dictionnaires, réglages). Lecture seule ; toujours avec la condition de région visible (`prospectWhere` /
 * `visibleRegionWhere`) : un canal hors Europe n'est ni montré ni compté.
 */
import { PROSPECTION_SETTINGS } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { DICT_ADDITIONS_KEY, DICT_PROPOSALS_KEY, additionsOf, dictView, proposalsOf, type DictView, type DictProposal } from "./dict";
import { prospectOrderBy, prospectWhere, visibleRegionWhere, type ProspectFilters } from "./filters";
import { PIPELINE_COLUMNS, pipelineSummary, type PipelineSummary } from "./pipeline";
import { SETTINGS_KEYS, readProspectionSettings, type ProspectionSettings } from "./settings";
import { DISCOVERY_SOURCES, SOURCE_TYPES_OF, activePause, nextDiscoveryAt, pausesOf, sourceOfType, sourceStatus } from "./sources";
import type { ProspectSourceState } from "@/lib/status-badges";

/** Lignes du tableau au plus (l'export va jusqu'à `EXPORT_MAX`). */
export const TABLE_MAX = 200;
export const EXPORT_MAX = 5000;

const S = PROSPECTION_SETTINGS;

export async function loadSettingRows(keys: readonly string[]): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [...keys] } }, select: { key: true, value: true } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function loadProspectionSettings(): Promise<ProspectionSettings> {
  return readProspectionSettings(await loadSettingRows(SETTINGS_KEYS));
}

/** Périmètre des pays (`prospection.countries_scope`). */
export async function loadScope(): Promise<string[]> {
  return (await loadProspectionSettings()).countriesScope;
}

export const tableSelect = {
  id: true,
  username: true,
  channelUrl: true,
  title: true,
  kind: true,
  tier: true,
  score: true,
  vertical: true,
  region: true,
  countries: true,
  language: true,
  subscribers: true,
  medianViews: true,
  viewRate: true,
  postsPerDay: true,
  competitiveState: true,
  brands: true,
  monetization: true,
  contactConfidence: true,
  bestContact: true,
  status: true,
  sourceType: true,
  statusChangedAt: true,
  discoveredAt: true,
  updatedAt: true,
  tierReason: true,
  snoozedUntil: true,
} as const;

export type ProspectTableRow = Awaited<ReturnType<typeof loadProspectTable>>["rows"][number];

export async function loadProspectTable(filters: ProspectFilters, scope: readonly string[], take = TABLE_MAX) {
  const where = prospectWhere(filters, scope);
  const [rows, total] = await Promise.all([
    prisma.prospect.findMany({ where, orderBy: prospectOrderBy(filters.sort), take, select: tableSelect }),
    prisma.prospect.count({ where }),
  ]);
  return { rows, total };
}

/** Comptes de l'en-tête (visibles seulement). */
export async function loadProspectionCounts(scope: readonly string[]) {
  const visible = visibleRegionWhere(scope);
  const [byStatus, byTier, offers, pendingProposals] = await Promise.all([
    prisma.prospect.groupBy({ by: ["status"], where: visible, _count: { _all: true } }),
    prisma.prospect.groupBy({ by: ["tier"], where: { AND: [visible, { status: "QUALIFIED" }] }, _count: { _all: true } }),
    prisma.affiliateOffer.count({ where: { isActive: true } }),
    prisma.setting.findUnique({ where: { key: DICT_PROPOSALS_KEY }, select: { value: true } }),
  ]);
  const status = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<string, number>;
  const tiers = Object.fromEntries(byTier.map((r) => [r.tier ?? "?", r._count._all])) as Record<string, number>;
  const total = Object.values(status).reduce((a, b) => a + b, 0);
  return {
    total,
    status,
    tiers,
    toContact: status.QUALIFIED ?? 0,
    inProgress: (status.CONTACTED ?? 0) + (status.RESPONDED ?? 0) + (status.NEGOTIATING ?? 0),
    signed: (status.SIGNED ?? 0) + (status.ACTIVE ?? 0),
    activeOffers: offers,
    pendingProposals: proposalsOf(pendingProposals?.value).filter((p) => p.status === "PENDING").length,
  };
}

export type PipelineCard = { id: string; title: string; username: string | null; channelUrl: string; tier: string | null; score: number | null; statusChangedAt: Date | null };

export async function loadPipeline(filters: ProspectFilters, scope: readonly string[], now: Date): Promise<{ summary: PipelineSummary; cards: Record<string, PipelineCard[]> }> {
  const where = { AND: [prospectWhere(filters, scope, { ignoreStatus: true }), { status: { in: [...PIPELINE_COLUMNS] } }] };
  const rows = await prisma.prospect.findMany({
    where,
    select: { id: true, title: true, username: true, channelUrl: true, tier: true, score: true, status: true, statusChangedAt: true, discoveredAt: true, contactedAt: true, respondedAt: true, signedAt: true },
    orderBy: [{ score: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    take: EXPORT_MAX,
  });
  const cards: Record<string, PipelineCard[]> = {};
  for (const r of rows) {
    const list = (cards[r.status] ??= []);
    if (list.length < 8) list.push({ id: r.id, title: r.title, username: r.username, channelUrl: r.channelUrl, tier: r.tier, score: r.score, statusChangedAt: r.statusChangedAt });
  }
  return { summary: pipelineSummary(rows, now), cards };
}

export async function loadProspect(id: string, scope: readonly string[]) {
  const p = await prisma.prospect.findFirst({
    where: { AND: [{ id }, visibleRegionWhere(scope)] },
    include: {
      contacts: { orderBy: [{ confidence: "desc" }, { createdAt: "asc" }] },
      notes: { orderBy: { createdAt: "desc" }, take: 100 },
      events: { orderBy: { createdAt: "desc" }, take: 200 },
      matchedOffer: { select: { id: true, brand: true, dealTypes: true, isActive: true } },
    },
  });
  if (!p) return null;
  const from = p.discoveredFromId
    ? await prisma.prospect.findFirst({ where: { AND: [{ id: p.discoveredFromId }, visibleRegionWhere(scope)] }, select: { id: true, title: true, username: true, channelUrl: true } })
    : null;
  return { ...p, discoveredFrom: from };
}
export type ProspectDetail = NonNullable<Awaited<ReturnType<typeof loadProspect>>>;

export async function loadOffers() {
  const offers = await prisma.affiliateOffer.findMany({ orderBy: [{ isActive: "desc" }, { brand: "asc" }] });
  const matched = await prisma.prospect.groupBy({ by: ["matchedOfferId"], where: { matchedOfferId: { in: offers.map((o) => o.id) }, region: { not: "NON_EU" } }, _count: { _all: true } });
  const counts = Object.fromEntries(matched.map((m) => [m.matchedOfferId ?? "", m._count._all]));
  return offers.map((o) => ({ ...o, matchedCount: (counts[o.id] as number | undefined) ?? 0 }));
}
export type OfferRow = Awaited<ReturnType<typeof loadOffers>>[number];

export type SourceRow = {
  key: string;
  state: ProspectSourceState;
  pausedUntil: Date | null;
  pauseReason: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastErrors: string[];
  runs30d: number;
  found30d: number;
  new30d: number;
  duplicates30d: number;
  tiers: Record<string, number>;
  prospects: number;
};

const errorsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).filter(Boolean) : []);

export async function loadSources(scope: readonly string[], now: Date) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [settings, pausesRow, runs, lastRuns, tierRows] = await Promise.all([
    loadProspectionSettings(),
    prisma.setting.findUnique({ where: { key: S.sourcePauses.key }, select: { value: true } }),
    prisma.prospectSourceRun.findMany({ orderBy: { started: "desc" }, take: 60 }),
    prisma.prospectSourceRun.groupBy({ by: ["sourceType"], where: { started: { gte: since } }, _count: { _all: true }, _sum: { found: true, newCount: true, duplicates: true }, _max: { started: true } }),
    prisma.prospect.groupBy({ by: ["sourceType", "tier"], where: visibleRegionWhere(scope), _count: { _all: true } }),
  ]);
  const pauses = pausesOf(pausesRow?.value);
  const enabled = settings.bools.enabled !== false;
  // Les journaux portent le type de source (DIRECTORY…) ou la clé du Sourceur (directories…) : on accepte les deux.
  const keyOf = (t: string) => sourceOfType(t) ?? ((DISCOVERY_SOURCES as readonly string[]).includes(t) ? t : null);
  const lastBySource = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    const k = keyOf(r.sourceType);
    if (k && !lastBySource.has(k)) lastBySource.set(k, r);
  }
  const rows: SourceRow[] = DISCOVERY_SOURCES.map((key) => {
    const paused = activePause(pauses, key, now);
    const last = lastBySource.get(key) ?? null;
    const agg = lastRuns.filter((g) => keyOf(g.sourceType) === key);
    const tiers: Record<string, number> = {};
    let prospects = 0;
    for (const t of tierRows)
      if ((SOURCE_TYPES_OF[key] ?? []).includes(t.sourceType)) {
        tiers[t.tier ?? "?"] = (tiers[t.tier ?? "?"] ?? 0) + t._count._all;
        prospects += t._count._all;
      }
    const lastErrors = errorsOf(last?.errors);
    return {
      key,
      state: sourceStatus({ enabled, paused, lastRunErrors: lastErrors.length }),
      pausedUntil: paused ? new Date(paused.until) : null,
      pauseReason: paused?.reason || null,
      nextRunAt: !enabled || key === "manual" ? null : nextDiscoveryAt(now, paused ? new Date(paused.until) : null),
      lastRunAt: last?.started ?? null,
      lastErrors,
      runs30d: agg.reduce((a, g) => a + g._count._all, 0),
      found30d: agg.reduce((a, g) => a + (g._sum.found ?? 0), 0),
      new30d: agg.reduce((a, g) => a + (g._sum.newCount ?? 0), 0),
      duplicates30d: agg.reduce((a, g) => a + (g._sum.duplicates ?? 0), 0),
      tiers,
      prospects,
    };
  });
  // Pauses posées sur autre chose qu'une source entière (un annuaire précis) : montrées à part.
  const otherPauses = Object.entries(pauses)
    .filter(([k]) => !(DISCOVERY_SOURCES as readonly string[]).includes(k) && Date.parse(pauses[k]!.until) > now.getTime())
    .map(([k, p]) => ({ key: k, until: new Date(p.until), reason: p.reason }));
  return { rows, runs: runs.slice(0, 30), enabled, otherPauses };
}
export type SourcesData = Awaited<ReturnType<typeof loadSources>>;

/** Dictionnaires du dépôt (lus par les fonctions de l'équipe) + ajouts validés + propositions. */
export async function loadDictionaries(): Promise<{ view: DictView; proposals: DictProposal[] }> {
  const [agents, rows] = await Promise.all([import("@linkaffipro/agents"), loadSettingRows([DICT_ADDITIONS_KEY, DICT_PROPOSALS_KEY])]);
  const additions = additionsOf(rows[DICT_ADDITIONS_KEY]);
  const view = dictView({ brands: agents.brandsDict(), patterns: agents.affiliatePatterns(), contactLabels: agents.contactLabels() }, additions);
  const proposals = proposalsOf(rows[DICT_PROPOSALS_KEY]).sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  return { view, proposals };
}
