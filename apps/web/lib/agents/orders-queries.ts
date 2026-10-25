/**
 * Lectures de la page Agents → Ordres (phase 33) et de l'encart de la fiche canal : ordres (`TeamOrder`), leurs
 * missions, leur réglage temporaire (`ChannelPlanOverride`), les noms des canaux, catégories et personas cités, la
 * chronologie (journal `Event` et actions du site `AuditLog`). Lecture seule, rien n'appelle une IA.
 */
import { prisma } from "@linkaffipro/db";
import { parisDayKey } from "@/lib/posts/time";
import { MISSION_SELECT, missionView, type MissionView } from "./queries";
import {
  missionCounts,
  orderCostCents,
  orderPeriod,
  ordersWhere,
  parseImpossible,
  parsePlan,
  parseProgress,
  progressFigures,
  type ImpossibleView,
  type MissionCounts,
  type OrderFilters,
  type OverrideRow,
  type PeriodView,
  type PlanView,
  type ProgressView,
  type TimelineAudit,
  type TimelineEvent,
} from "./orders";

export const ORDERS_SHOWN = 200;

export type OrderListRow = {
  id: string;
  number: number;
  status: string;
  kind: string;
  teamKey: string;
  asIfTeamKey: string | null;
  requestText: string;
  createdAt: Date;
  mode: PlanView["mode"];
  channels: string[];
  test: boolean;
  period: PeriodView;
  figures: { planned: number; done: number; failed: number; waiting: number };
  costCents: number;
};

const OVERRIDE_SELECT = {
  id: true,
  channelId: true,
  teamKey: true,
  fromDay: true,
  toDay: true,
  postsPerDay: true,
  picksPerDay: true,
  betCategoryId: true,
  themes: true,
  mix: true,
  format: true,
  windowStart: true,
  windowEnd: true,
  personaId: true,
  isTest: true,
  closedAt: true,
} as const;

async function channelTitles(ids: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set(ids)];
  if (list.length === 0) return new Map();
  const rows = await prisma.channel.findMany({ where: { id: { in: list } }, select: { id: true, title: true } });
  return new Map(rows.map((c) => [c.id, c.title]));
}

/** Canaux visés par un ordre : ceux du plan, sinon ceux de ses réglages temporaires. */
function channelIdsOf(plan: PlanView, overrides: ReadonlyArray<{ channelId: string }>): string[] {
  const ids = plan.scope?.kind === "channels" ? plan.scope.channelIds : [];
  return [...new Set([...ids, ...overrides.map((o) => o.channelId)])];
}

export async function loadOrdersList(filters: OrderFilters): Promise<{ rows: OrderListRow[]; total: number }> {
  const where = ordersWhere(filters);
  const [orders, total] = await Promise.all([
    prisma.teamOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: ORDERS_SHOWN,
      select: {
        id: true,
        number: true,
        status: true,
        kind: true,
        teamKey: true,
        requestText: true,
        interpretation: true,
        progress: true,
        startsAt: true,
        endsAt: true,
        costCents: true,
        createdAt: true,
        missions: { select: { status: true, costCents: true } },
        overrides: { select: { channelId: true, isTest: true } },
      },
    }),
    prisma.teamOrder.count({ where }),
  ]);
  const plans = orders.map((o) => parsePlan(o.interpretation));
  const titles = await channelTitles(orders.flatMap((o, i) => channelIdsOf(plans[i]!, o.overrides)));
  const rows = orders.map((o, i): OrderListRow => {
    const plan = plans[i]!;
    const ids = channelIdsOf(plan, o.overrides);
    return {
      id: o.id,
      number: o.number,
      status: String(o.status),
      kind: String(o.kind),
      teamKey: o.teamKey,
      asIfTeamKey: plan.asIfTeamKey,
      requestText: o.requestText,
      createdAt: o.createdAt,
      mode: plan.mode,
      channels: ids.map((id) => titles.get(id) ?? "canal retiré"),
      test: plan.scope?.kind === "test" || o.overrides.some((x) => x.isTest),
      period: orderPeriod(plan, o.startsAt, o.endsAt, parisDayKey),
      figures: progressFigures(parseProgress(o.progress), missionCounts(o.missions.map((m) => String(m.status)))),
      costCents: orderCostCents(o.costCents, o.missions.map((m) => m.costCents)),
    };
  });
  return { rows, total };
}

export type OrderDetail = {
  id: string;
  number: number;
  status: string;
  kind: string;
  teamKey: string;
  requestText: string;
  recap: string;
  createdAt: Date;
  updatedAt: Date;
  startsAt: Date | null;
  endsAt: Date | null;
  createdByName: string | null;
  fromTelegram: boolean;
  plan: PlanView;
  impossible: ImpossibleView[];
  progress: ProgressView;
  counts: MissionCounts;
  period: PeriodView;
  costCents: number;
  missions: MissionView[];
  overrides: OverrideRow[];
  /** Univers de chaque canal cité (pour dire « travaillé comme un canal … »). */
  channelTeams: Map<string, string | null>;
  names: { channels: Map<string, string>; categories: Map<string, string>; personas: Map<string, string> };
  events: TimelineEvent[];
  audits: TimelineAudit[];
};

const VERTICAL_TEAM: Record<string, string> = { DATING: "dating", CASINO: "casino", SPORTS: "sports" };

export async function loadOrderDetail(id: string): Promise<OrderDetail | null> {
  const o = await prisma.teamOrder.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      kind: true,
      teamKey: true,
      requestText: true,
      recap: true,
      interpretation: true,
      impossible: true,
      progress: true,
      startsAt: true,
      endsAt: true,
      createdById: true,
      chatId: true,
      costCents: true,
      createdAt: true,
      updatedAt: true,
      missions: { orderBy: { createdAt: "asc" }, take: 300, select: MISSION_SELECT },
      overrides: { orderBy: [{ fromDay: "asc" }, { createdAt: "asc" }], select: OVERRIDE_SELECT },
    },
  });
  if (!o) return null;
  const plan = parsePlan(o.interpretation);
  const missions = o.missions.map(missionView);
  const overrides = o.overrides as OverrideRow[];

  const channelIds = new Set([...channelIdsOf(plan, overrides), ...missions.flatMap((m) => (m.channelId ? [m.channelId] : []))]);
  const categoryIds = new Set<string>();
  const personaIds = new Set<string>();
  if (plan.categoryId) categoryIds.add(plan.categoryId);
  for (const ov of overrides) {
    if (ov.betCategoryId) categoryIds.add(ov.betCategoryId);
    if (ov.personaId) personaIds.add(ov.personaId);
  }
  const collect = (params: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(params)) {
      const vals = Array.isArray(v) ? v : [v];
      for (const x of vals) {
        if (typeof x !== "string") continue;
        if (k === "channelId" || k === "channelIds") channelIds.add(x);
        if (k === "categoryId" || k === "betCategoryId") categoryIds.add(x);
        if (k === "personaId") personaIds.add(x);
      }
    }
  };
  for (const s of plan.steps) collect(s.params);
  for (const r of plan.resolved) collect({ [r.key]: r.value });

  const [channels, categories, personas, user, events, audits] = await Promise.all([
    channelIds.size
      ? prisma.channel.findMany({ where: { id: { in: [...channelIds] } }, select: { id: true, title: true, vertical: true } })
      : Promise.resolve([]),
    categoryIds.size
      ? prisma.betCategory.findMany({ where: { id: { in: [...categoryIds] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    personaIds.size ? prisma.persona.findMany({ where: { id: { in: [...personaIds] } }, select: { id: true, name: true } }) : Promise.resolve([]),
    o.createdById ? prisma.user.findUnique({ where: { id: o.createdById }, select: { name: true } }).catch(() => null) : Promise.resolve(null),
    prisma.event.findMany({
      // Fenêtre de l'ordre (index sur la date) et type d'ordre d'abord : le journal est gros, l'ordre court.
      where: {
        occurredAt: { gte: new Date(o.createdAt.getTime() - 60_000) },
        type: { contains: "order" },
        payload: { path: ["orderId"], equals: o.id },
      },
      orderBy: { occurredAt: "asc" },
      take: 200,
      select: { type: true, occurredAt: true, payload: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: "TeamOrder", entityId: o.id },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { action: true, createdAt: true, metadata: true, user: { select: { name: true } } },
    }),
  ]);

  return {
    id: o.id,
    number: o.number,
    status: String(o.status),
    kind: String(o.kind),
    teamKey: o.teamKey,
    requestText: o.requestText,
    recap: o.recap,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    createdByName: user?.name ?? null,
    fromTelegram: Boolean(o.chatId),
    plan,
    impossible: parseImpossible(o.impossible),
    progress: parseProgress(o.progress),
    counts: missionCounts(missions.map((m) => m.status)),
    period: orderPeriod(plan, o.startsAt, o.endsAt, parisDayKey),
    costCents: orderCostCents(o.costCents, missions.map((m) => m.costCents)),
    missions,
    overrides,
    channelTeams: new Map(channels.map((c) => [c.id, VERTICAL_TEAM[String(c.vertical)] ?? null])),
    names: {
      channels: new Map(channels.map((c) => [c.id, c.title])),
      categories: new Map(categories.map((c) => [c.id, c.name])),
      personas: new Map(personas.map((p) => [p.id, p.name])),
    },
    events: events.map((e) => ({ type: e.type, occurredAt: e.occurredAt, payload: e.payload })),
    audits: audits.map((a) => ({ action: a.action, createdAt: a.createdAt, metadata: a.metadata, userName: a.user?.name ?? null })),
  };
}

export type ChannelOrderOverride = { id: string; orderId: string; orderNumber: number; orderStatus: string; toDay: string; teamKey: string; isTest: boolean };

/** Réglages temporaires actifs aujourd'hui (jour de Paris) sur un canal, ordres arrêtés ou finis exclus. */
export async function loadChannelOrderOverrides(channelId: string, now: Date): Promise<ChannelOrderOverride[]> {
  const today = parisDayKey(now);
  const rows = await prisma.channelPlanOverride.findMany({
    where: {
      channelId,
      closedAt: null,
      fromDay: { lte: today },
      toDay: { gte: today },
      order: { status: { in: ["RUNNING", "BLOCKED"] } },
    },
    orderBy: { toDay: "desc" },
    select: { id: true, orderId: true, toDay: true, teamKey: true, isTest: true, order: { select: { number: true, status: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    orderNumber: r.order.number,
    orderStatus: String(r.order.status),
    toDay: r.toDay,
    teamKey: r.teamKey,
    isTest: r.isTest,
  }));
}
