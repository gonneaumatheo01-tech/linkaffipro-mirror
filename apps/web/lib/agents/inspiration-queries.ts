/**
 * Lectures de la page Agents → Inspiration (phase 27) et de l'encart « Inspiré de » de la fiche d'un canal. Lecture
 * seule : aucune action ici, aucun texte de post du canal de référence n'est renvoyé (seulement ses caractéristiques).
 */
import type { AgentsDeps, ChannelComparison, InspirationAnalysis } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import type { ExperimentView } from "./algo/experiments";
import type { RecommendationView } from "./algo/recommendations";
import {
  analysisView,
  parseComparisons,
  parseStoredAnalysis,
  rawMeasures,
  recCounts,
  referenceName,
  stringList,
  styleProfileView,
  type AnalysisView,
  type RawMeasures,
  type RawPost,
  type RecCounts,
  type StyleProfileView,
} from "./inspiration";
import type { InspirationEngine } from "./inspiration-engine";

export type ChannelRef = { id: string; title: string };

export type ReferenceRow = {
  id: string;
  username: string | null;
  title: string | null;
  via: string;
  universe: string;
  status: string;
  unavailableReason: string | null;
  postCount: number;
  lastReadAt: Date | null;
  nextReadAt: Date | null;
  createdAt: Date;
  targets: ChannelRef[];
  profileVersion: number | null;
  recs: RecCounts;
};

const REF_SELECT = {
  id: true,
  username: true,
  title: true,
  telegramChatId: true,
  via: true,
  universe: true,
  targetChannelIds: true,
  status: true,
  unavailableReason: true,
  accountId: true,
  postCount: true,
  lastReadAt: true,
  nextReadAt: true,
  createdAt: true,
} as const;

async function channelTitles(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.channel.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, title: true } });
  return new Map(rows.map((c) => [c.id, c.title]));
}

function targetsOf(json: unknown, titles: Map<string, string>): ChannelRef[] {
  return stringList(json).map((id) => ({ id, title: titles.get(id) ?? "Canal supprimé" }));
}

/** Toutes les références (hors retirées), les plus récentes d'abord, avec leurs cibles et leurs propositions. */
export async function loadInspirationList(): Promise<ReferenceRow[]> {
  const refs = await prisma.referenceChannel.findMany({
    where: { removedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: REF_SELECT,
  });
  const ids = refs.map((r) => r.id);
  const [titles, profiles, recs] = await Promise.all([
    channelTitles(refs.flatMap((r) => stringList(r.targetChannelIds))),
    ids.length
      ? prisma.styleProfile.groupBy({ by: ["referenceChannelId"], where: { referenceChannelId: { in: ids } }, _max: { version: true } })
      : Promise.resolve([]),
    ids.length
      ? prisma.recommendation.groupBy({
          by: ["referenceChannelId", "status"],
          where: { source: "inspiration", referenceChannelId: { in: ids } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const version = new Map(profiles.map((p) => [p.referenceChannelId, p._max.version ?? null]));
  return refs.map(({ targetChannelIds, telegramChatId: _chat, accountId: _acc, ...r }) => ({
    ...r,
    via: String(r.via),
    status: String(r.status),
    targets: targetsOf(targetChannelIds, titles),
    profileVersion: version.get(r.id) ?? null,
    recs: recCounts(
      recs.filter((x) => x.referenceChannelId === r.id).map((x) => ({ status: String(x.status), n: x._count._all })),
    ),
  }));
}

export type ReferenceDetail = {
  ref: Omit<ReferenceRow, "recs" | "profileVersion"> & { telegramChatId: bigint | null; accountLabel: string | null };
  profile: StyleProfileView | null;
  profileStats: unknown;
  profileVersions: Map<string, number>;
  /** Canaux dont la Rédaction lit un profil de cette référence. */
  usedBy: ChannelRef[];
  recs: RecommendationView[];
  experiments: ExperimentView[];
  rawPosts: RawPost[];
};

const REC_SELECT = {
  id: true,
  teamKey: true,
  target: true,
  targetId: true,
  field: true,
  before: true,
  after: true,
  evidence: true,
  expectedGain: true,
  size: true,
  status: true,
  appliedAt: true,
  appliedBy: true,
  undoneAt: true,
  rejectedAt: true,
  weekStart: true,
  createdAt: true,
} as const;

/** Une référence et tout ce qui s'y rattache ; null si elle n'existe pas ou a été retirée. */
export async function loadInspirationDetail(id: string): Promise<ReferenceDetail | null> {
  const ref = await prisma.referenceChannel.findFirst({ where: { id, removedAt: null }, select: REF_SELECT });
  if (!ref) return null;
  const [profiles, recRows, posts, account] = await Promise.all([
    prisma.styleProfile.findMany({
      where: { referenceChannelId: id },
      orderBy: { version: "desc" },
      select: { id: true, version: true, createdAt: true, rules: true, description: true, examples: true, flagged: true, stats: true },
    }),
    prisma.recommendation.findMany({
      where: { source: "inspiration", referenceChannelId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: REC_SELECT,
    }),
    // Caractéristiques seulement : jamais le texte des posts du canal de référence.
    prisma.referencePost.findMany({
      where: { referenceChannelId: id },
      orderBy: { postedAt: "desc" },
      take: 400,
      select: { postedAt: true, length: true, mediaKind: true, views: true, hasLink: true, hasButton: true, hasVipCall: true, hasOdds: true },
    }),
    ref.accountId
      ? prisma.telegramUserAccount.findUnique({ where: { id: ref.accountId }, select: { label: true } })
      : Promise.resolve(null),
  ]);
  const profileIds = profiles.map((p) => p.id);
  const recIds = recRows.map((r) => r.id);
  const [plans, expRows] = await Promise.all([
    profileIds.length
      ? prisma.channelAgentPlan.findMany({
          where: { styleProfileId: { in: profileIds } },
          select: { id: true, channelId: true, channel: { select: { title: true } } },
        })
      : Promise.resolve([]),
    recIds.length
      ? prisma.experiment.findMany({
          where: { recommendationId: { in: recIds } },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            teamKey: true,
            channelId: true,
            personaId: true,
            kind: true,
            hypothesis: true,
            variants: true,
            metric: true,
            minSamples: true,
            status: true,
            startedAt: true,
            endsAt: true,
            closedAt: true,
            result: true,
            winner: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const targetIds = stringList(ref.targetChannelIds);
  // Les propositions visent un canal ou son plan ; les tests, un canal.
  const planTargets = recRows.filter((r) => r.target === "CHANNEL_PLAN").map((r) => r.targetId);
  const [titles, planRows] = await Promise.all([
    channelTitles([...targetIds, ...recRows.map((r) => r.targetId), ...expRows.flatMap((e) => (e.channelId ? [e.channelId] : []))]),
    planTargets.length
      ? prisma.channelAgentPlan.findMany({ where: { id: { in: planTargets } }, select: { id: true, channel: { select: { title: true } } } })
      : Promise.resolve([]),
  ]);
  const planTitle = new Map(planRows.map((p) => [p.id, p.channel.title]));
  const label = (target: string, targetId: string) =>
    titles.get(targetId) ?? planTitle.get(targetId) ?? (target === "TEAM_CONFIG" ? "Équipe" : "Introuvable");
  const latest = profiles[0] ?? null;
  const { targetChannelIds, accountId: _acc, ...rest } = ref;
  return {
    ref: {
      ...rest,
      via: String(ref.via),
      status: String(ref.status),
      targets: targetsOf(targetChannelIds, titles),
      accountLabel: account?.label ?? null,
    },
    profile: latest ? styleProfileView(latest) : null,
    profileStats: latest?.stats ?? null,
    profileVersions: new Map(profiles.map((p) => [p.id, p.version])),
    usedBy: plans.map((p) => ({ id: p.channelId, title: p.channel.title })),
    recs: recRows.map((r) => ({ ...r, status: String(r.status), appliedBy: r.appliedBy ? String(r.appliedBy) : null, targetLabel: label(r.target, r.targetId) })),
    experiments: expRows.map((e) => ({
      ...e,
      kind: String(e.kind),
      status: String(e.status),
      targetLabel: e.channelId ? (titles.get(e.channelId) ?? null) : null,
    })),
    rawPosts: posts,
  };
}

/**
 * Ce que montre le bloc « eux / nous » : l'analyse gardée avec le profil de style, sinon l'analyse calculée à
 * l'affichage par le moteur (si livré), sinon les mesures brutes des posts lus.
 */
export type ComparisonBlock =
  | { kind: "analysis"; source: "stored" | "computed"; analysis: AnalysisView; comparisons: ChannelComparison[] }
  | { kind: "raw"; raw: RawMeasures; tooFew: boolean };

export async function resolveComparison(input: {
  referenceId: string;
  universe: string;
  stats: unknown;
  targets: ChannelRef[];
  rawPosts: RawPost[];
  engine: InspirationEngine;
  deps: () => AgentsDeps;
}): Promise<ComparisonBlock> {
  const stored = parseStoredAnalysis(input.stats);
  const { engine } = input;
  const compareAll = async (analysis: InspirationAnalysis): Promise<ChannelComparison[]> => {
    if (!engine.compareWithChannel) return [];
    const deps = input.deps();
    const out: ChannelComparison[] = [];
    for (const t of input.targets) {
      try {
        const c = await engine.compareWithChannel(deps, analysis, t.id);
        out.push(...parseComparisons([{ ...c, channelTitle: c.channelTitle || t.title }]));
      } catch {
        // Un canal qui ne se compare pas n'empêche pas d'afficher les autres.
      }
    }
    return out;
  };
  if (stored) {
    let comparisons = stored.comparisons;
    if (comparisons.length === 0 && input.targets.length > 0) {
      const asAnalysis = {
        referenceChannelId: input.referenceId,
        universe: input.universe,
        ...stored.analysis,
      } as InspirationAnalysis;
      comparisons = await compareAll(asAnalysis).catch(() => []);
    }
    return { kind: "analysis", source: "stored", analysis: stored.analysis, comparisons };
  }
  if (engine.analyzeReference) {
    try {
      const a = await engine.analyzeReference(input.deps(), input.referenceId);
      if (!("tooFew" in a)) {
        return { kind: "analysis", source: "computed", analysis: analysisView(a), comparisons: await compareAll(a) };
      }
    } catch {
      // Repli sur les mesures brutes.
    }
  }
  const raw = rawMeasures(input.rawPosts);
  return { kind: "raw", raw, tooFew: raw.count < 20 };
}

export type ChannelInspiration = {
  id: string;
  name: string;
  status: string;
  /** La Rédaction de ce canal lit un profil de style de cette référence. */
  styleInUse: boolean;
  profileVersion: number | null;
};

/** Encart « Inspiré de » de la fiche d'un canal : profil lu par la Rédaction, ou référence qui vise ce canal. */
export async function loadChannelInspiration(channelId: string): Promise<ChannelInspiration[]> {
  const plan = await prisma.channelAgentPlan.findUnique({ where: { channelId }, select: { styleProfileId: true } });
  const profile = plan?.styleProfileId
    ? await prisma.styleProfile.findUnique({
        where: { id: plan.styleProfileId },
        select: { referenceChannelId: true, version: true },
      })
    : null;
  const refs = await prisma.referenceChannel.findMany({
    where: {
      removedAt: null,
      OR: [
        { targetChannelIds: { array_contains: [channelId] } },
        ...(profile ? [{ id: profile.referenceChannelId }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, username: true, title: true, status: true },
  });
  return refs
    .map((r) => {
      const inUse = profile?.referenceChannelId === r.id;
      return {
        id: r.id,
        name: referenceName(r),
        status: String(r.status),
        styleInUse: inUse,
        profileVersion: inUse ? (profile?.version ?? null) : null,
      };
    })
    .sort((a, b) => Number(b.styleInUse) - Number(a.styleInUse));
}
