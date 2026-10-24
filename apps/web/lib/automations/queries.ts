/**
 * Lectures en base des écrans Relances automatiques (lecture seule). Le compteur des cartes suit la définition de
 * `counter.ts` ; les clics d'offre suivent la règle du moteur (identifiant de suivi, hors robots).
 */
import { prisma } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { groupLanguages } from "@/lib/members/query";
import { getTagRegistry } from "@/lib/members/tags";
import { counterSince, weeklyCounters, type RuleCounter } from "./counter";
import { ruleResults, type RuleResults } from "./results";

export type NameMaps = {
  channels: Record<string, string>;
  campaigns: Record<string, string>;
  categories: Record<string, string>;
};

/** Noms des canaux, campagnes et catégories (libellés des filtres et des blocs). */
export async function loadNames(): Promise<NameMaps> {
  const [channels, campaigns, categories] = await Promise.all([
    prisma.channel.findMany({ select: { id: true, title: true } }),
    prisma.campaign.findMany({ select: { id: true, name: true } }),
    prisma.messageCategory.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    channels: Object.fromEntries(channels.map((c) => [c.id, c.title])),
    campaigns: Object.fromEntries(campaigns.map((c) => [c.id, c.name])),
    categories: Object.fromEntries(categories.map((c) => [c.id, c.name])),
  };
}

/**
 * Compteur « envoyé à N personnes cette semaine, M ont cliqué » de chaque relance (voir `counter.ts`) : exécutions
 * modifiées pendant les 7 derniers jours (un envoi met toujours l'exécution à jour), puis clics d'offre de ces membres
 * sur la même fenêtre ; le tri fin (date de l'envoi, clic après l'envoi, essais exclus) est fait par `weeklyCounters`.
 */
export async function loadRuleCounters(
  ruleIds: readonly string[],
  now = new Date(),
): Promise<Record<string, RuleCounter>> {
  if (ruleIds.length === 0) return {};
  const since = counterSince(now);
  const runs = await prisma.automationRun.findMany({
    where: { ruleId: { in: [...ruleIds] }, updatedAt: { gte: since } },
    select: { ruleId: true, memberId: true, context: true, log: true },
  });
  const memberIds = [...new Set(runs.map((r) => r.memberId))];
  const clicks = memberIds.length
    ? await prisma.click.findMany({
        where: {
          memberId: { in: memberIds },
          isBot: false,
          subId: { not: null },
          createdAt: { gte: since, lte: now },
        },
        select: { memberId: true, createdAt: true },
      })
    : [];
  return weeklyCounters(runs, clicks, now);
}

/**
 * Résultats de chaque relance (définitions dans `results.ts`) : messages remis rattachés à la relance, clics de ses
 * boutons Offre par des membres qui l'avaient reçue pour de vrai (les essais « Tester sur moi » utilisent le même lien
 * et ne comptent pas), joueurs venus de ces clics et leurs commissions. Lecture seule. Les premiers envois ne sont lus
 * que pour les membres qui ont cliqué (peu nombreux, contrairement aux destinataires).
 */
export async function loadRuleResults(
  ruleIds: readonly string[],
): Promise<Record<string, RuleResults>> {
  if (ruleIds.length === 0) return {};
  const ids = [...ruleIds];
  const [sent, clicks, players] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ["automationRuleId"],
      where: { automationRuleId: { in: ids }, kind: "AUTOMATION", status: "SENT" },
      _count: { _all: true },
    }),
    prisma.click.findMany({
      where: {
        isBot: false,
        memberId: { not: null },
        trackingLink: { automationRuleId: { in: ids } },
      },
      select: {
        memberId: true,
        createdAt: true,
        trackingLink: { select: { automationRuleId: true } },
      },
    }),
    prisma.player.findMany({
      where: { click: { trackingLink: { automationRuleId: { in: ids } } } },
      select: {
        ftdAt: true,
        click: {
          select: {
            memberId: true,
            createdAt: true,
            trackingLink: { select: { automationRuleId: true } },
          },
        },
        events: { where: { type: { in: ["CPA", "CPA_REVERSAL"] } }, select: { amount: true } },
      },
    }),
  ]);
  const clickMembers = [
    ...new Set(
      [...clicks.map((c) => c.memberId), ...players.map((p) => p.click?.memberId ?? null)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  const firstSends = clickMembers.length
    ? await prisma.outboundMessage.groupBy({
        by: ["automationRuleId", "memberId"],
        where: {
          automationRuleId: { in: ids },
          memberId: { in: clickMembers },
          kind: "AUTOMATION",
          status: "SENT",
        },
        _min: { queuedAt: true },
      })
    : [];
  return ruleResults(ids, {
    sent: sent.flatMap((s) =>
      s.automationRuleId ? [{ ruleId: s.automationRuleId, count: s._count._all }] : [],
    ),
    firstSends: firstSends.flatMap((f) =>
      f.automationRuleId && f._min.queuedAt
        ? [{ ruleId: f.automationRuleId, memberId: f.memberId, at: f._min.queuedAt }]
        : [],
    ),
    clicks: clicks.flatMap((c) =>
      c.trackingLink.automationRuleId
        ? [{ ruleId: c.trackingLink.automationRuleId, memberId: c.memberId, at: c.createdAt }]
        : [],
    ),
    players: players.flatMap((p) => {
      const ruleId = p.click?.trackingLink.automationRuleId;
      if (!p.click || !ruleId) return [];
      return [
        {
          ruleId,
          clickMemberId: p.click.memberId,
          clickAt: p.click.createdAt,
          ftdAt: p.ftdAt,
          commissionEvents: p.events.map((e) => Number(e.amount ?? 0)),
        },
      ];
    }),
  });
}

/** Migration qui rattache les messages à leur relance (phase 10) : sa date est le début des résultats par relance. */
const RESULTS_MIGRATION = "%\\_phase10\\_gains\\_relances";

/**
 * Date à partir de laquelle les messages sont rattachés à leur relance (fin de la migration de la phase 10, lue dans
 * la table des migrations) ; null si inconnue. Voir `resultsSince` (results.ts).
 */
export async function loadResultsTrackingStart(): Promise<Date | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null }>>`
      SELECT finished_at FROM "_prisma_migrations"
      WHERE migration_name LIKE ${RESULTS_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at ASC LIMIT 1`;
    return rows[0]?.finished_at ?? null;
  } catch {
    return null;
  }
}

export type EditorOptions = {
  /** Canaux actifs, avec leur univers (pastille de couleur). */
  channels: Array<{ id: string; title: string; vertical: string | null }>;
  campaigns: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  bots: Array<{ id: string; username: string; vertical: string }>;
  media: Array<{ id: string; filename: string }>;
  tags: string[];
  /** Langues de nos membres (code court, nombre de membres), les plus parlées d'abord. */
  languages: Array<{ code: string; count: number }>;
};

/**
 * Choix proposés dans les formulaires (canaux actifs et leur univers, campagnes, catégories, bots actifs, médias
 * récents, étiquettes, langues des membres comme dans « Écrire à un groupe »).
 */
export async function loadEditorOptions(): Promise<EditorOptions> {
  const [channels, campaigns, categories, bots, media, tags, langs] = await Promise.all([
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, vertical: true },
    }),
    prisma.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.messageCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    // Jamais un bot assistant de conversation (phase 17) : il n'écrit qu'aux personnes qui lui parlent.
    prisma.bot.findMany({
      where: ACTIVE_CHANNEL_BOT_WHERE,
      orderBy: { name: "asc" },
      select: { id: true, username: true, vertical: true },
    }),
    prisma.mediaAsset.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, filename: true },
    }),
    getTagRegistry().catch(() => []),
    prisma.member.groupBy({
      by: ["languageCode"],
      where: { anonymizedAt: null, languageCode: { not: null } },
      _count: { _all: true },
    }),
  ]);
  return {
    channels: channels.map((c) => ({
      id: c.id,
      title: c.title,
      vertical: c.vertical ? String(c.vertical) : null,
    })),
    campaigns,
    categories,
    bots: bots.map((b) => ({ id: b.id, username: b.username, vertical: String(b.vertical) })),
    media,
    tags: tags.map((t) => t.name),
    languages: groupLanguages(
      langs.map((l) => ({ code: l.languageCode ?? "", count: l._count._all })),
    ),
  };
}
