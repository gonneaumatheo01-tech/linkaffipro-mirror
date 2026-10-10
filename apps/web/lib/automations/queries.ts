/**
 * Lectures en base des écrans Relances automatiques (lecture seule). Le compteur des cartes suit la définition de
 * `counter.ts` ; les clics d'offre suivent la règle du moteur (identifiant de suivi, hors robots).
 */
import { prisma } from "@linkaffipro/db";
import { groupLanguages } from "@/lib/members/query";
import { getTagRegistry } from "@/lib/members/tags";
import { counterSince, weeklyCounters, type RuleCounter } from "./counter";

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
    prisma.bot.findMany({
      where: { isActive: true },
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
