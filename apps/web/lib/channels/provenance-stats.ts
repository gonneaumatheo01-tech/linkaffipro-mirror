import { provenanceOfLink, type ProvenanceLink } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";

/**
 * Statistiques d'un canal selon la provenance (fiche canal → onglet « Membres », phase 11) : pour les 30 derniers
 * jours, d'où viennent les demandes (bouton « canal à rejoindre » de chacun de nos canaux, chaque lien de partage,
 * pubs TikTok / Meta / autres, autres liens), combien sont acceptées et combien de personnes repartent dans les
 * 7 jours qui suivent leur entrée.
 *
 * Une demande appartient à la provenance de son lien d'invitation (`provenanceOfLink`, la règle du bot) : le lien d'une
 * demande ne change pas, la provenance enregistrée par le bot est la même. Comptage en base (une ligne par lien).
 */

/** Période des statistiques (jours glissants). */
export const PROVENANCE_STATS_DAYS = 30;
/** Fenêtre des départs comptés après l'entrée. */
export const LEFT_WITHIN_DAYS = 7;

/** Comptes d'un lien d'invitation (null : sans lien suivi) sur la période. */
export type LinkCounts = {
  inviteLinkId: string | null;
  requests: number;
  accepted: number;
  /** Départs (de leur plein gré) dans les 7 jours qui suivent l'entrée. */
  left7: number;
};

export type StatsLink = ProvenanceLink & { name: string; isActive?: boolean };

export type ProvenanceStatsRow = {
  key: string;
  label: string;
  requests: number;
  accepted: number;
  left7: number;
};

type Bucket = { key: string; label: string };

/** Provenance d'un lien, regroupée comme dans les statistiques. */
export function bucketOf(
  link: StatsLink | null | undefined,
  titles: Readonly<Record<string, string>> = {},
): Bucket {
  const p = provenanceOfLink(link ?? null);
  switch (p.type) {
    case "GATE": {
      const t = p.sourceChannelId ? titles[p.sourceChannelId] : undefined;
      return {
        key: `gate:${p.sourceChannelId ?? "?"}`,
        label: t
          ? `Bouton « canal à rejoindre » de « ${t} »`
          : "Bouton « canal à rejoindre » d'un de nos canaux",
      };
    }
    case "SHARE":
      return { key: `share:${link!.id}`, label: `Lien de partage « ${link!.name} »` };
    case "AD":
      return p.adPlatform === "TIKTOK"
        ? { key: "ad:TIKTOK", label: "Pubs TikTok" }
        : p.adPlatform === "META"
          ? { key: "ad:META", label: "Pubs Meta" }
          : { key: "ad:OTHER", label: "Autres pubs" };
    default:
      return { key: "other", label: "Autres liens" };
  }
}

/**
 * Lignes des statistiques : comptes regroupés par provenance, les plus nombreuses d'abord (« Autres liens » en
 * dernier) ; les liens de partage actifs du canal sont montrés même sans demande (on voit qu'ils ne servent pas).
 */
export function provenanceStatsRows(input: {
  counts: readonly LinkCounts[];
  links: ReadonlyMap<string, StatsLink>;
  titles?: Readonly<Record<string, string>>;
  /** Liens de partage actifs du canal (montrés même à zéro). */
  shareLinks?: readonly StatsLink[];
}): ProvenanceStatsRow[] {
  const titles = input.titles ?? {};
  const rows = new Map<string, ProvenanceStatsRow>();
  const add = (b: Bucket, c: Omit<LinkCounts, "inviteLinkId">) => {
    const row = rows.get(b.key) ?? { ...b, requests: 0, accepted: 0, left7: 0 };
    row.requests += c.requests;
    row.accepted += c.accepted;
    row.left7 += c.left7;
    rows.set(b.key, row);
  };
  for (const c of input.counts)
    add(bucketOf(c.inviteLinkId ? input.links.get(c.inviteLinkId) : null, titles), c);
  for (const l of input.shareLinks ?? [])
    if (l.isActive !== false) add(bucketOf(l, titles), { requests: 0, accepted: 0, left7: 0 });
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.key === "other") - Number(b.key === "other") ||
      b.requests - a.requests ||
      b.accepted - a.accepted ||
      a.label.localeCompare(b.label, "fr"),
  );
}

/** « 12 demandes », « 1 demande », « 0 demande ». */
export function requestsText(n: number): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? "demandes" : "demande"}`;
}

/** Part en pourcentage entier (« 83 % ») ; null sans base. */
export function share(part: number, total: number): string | null {
  if (total <= 0) return null;
  return `${Math.round((part / total) * 100)} %`;
}

/** Précision sous le nombre de demandes : « 10 acceptées (83 %) · 1 départ dans les 7 jours (10 %) ». */
export function outcomeText(
  row: Pick<ProvenanceStatsRow, "requests" | "accepted" | "left7">,
): string {
  if (row.requests === 0) return "aucune demande sur la période";
  const n = (v: number) => v.toLocaleString("fr-FR");
  const acc = share(row.accepted, row.requests);
  const accepted = `${n(row.accepted)} ${row.accepted > 1 ? "acceptées" : "acceptée"}${acc ? ` (${acc})` : ""}`;
  if (row.accepted === 0) return accepted;
  const left = share(row.left7, row.accepted);
  const gone =
    row.left7 === 0
      ? "aucun départ dans les 7 jours"
      : `${n(row.left7)} ${row.left7 > 1 ? "départs" : "départ"} dans les 7 jours${left ? ` (${left})` : ""}`;
  return `${accepted} · ${gone}`;
}

export type ProvenanceStats = {
  since: Date;
  rows: ProvenanceStatsRow[];
  totals: { requests: number; accepted: number; left7: number };
};

/**
 * Lit les statistiques par provenance d'un canal sur les 30 derniers jours : un comptage par lien d'invitation en base
 * (demandes, acceptées, départs dans les 7 jours), puis les liens et les titres des canaux d'origine.
 * Acceptée : acceptée par un bot ou à la main, ou entrée dans le canal. Départ : départ volontaire (pas une
 * exclusion) au plus 7 jours après l'entrée (ou l'acceptation).
 */
export async function loadProvenanceStats(
  channelId: string,
  now: Date = new Date(),
  days = PROVENANCE_STATS_DAYS,
): Promise<ProvenanceStats> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const counts = await prisma.$queryRaw<LinkCounts[]>`
    SELECT "inviteLinkId",
      COUNT(*)::int AS "requests",
      COUNT(*) FILTER (
        WHERE "approvedAt" IS NOT NULL OR "joinedAt" IS NOT NULL
          OR "status" IN ('APPROVED', 'LEFT', 'KICKED')
      )::int AS "accepted",
      COUNT(*) FILTER (
        WHERE "status" = 'LEFT' AND "leftAt" IS NOT NULL
          AND "leftAt" <= COALESCE("joinedAt", "approvedAt", "requestedAt") + ${LEFT_WITHIN_DAYS}::int * interval '1 day'
      )::int AS "left7"
    FROM "Membership"
    WHERE "channelId" = ${channelId} AND "requestedAt" >= ${since}
    GROUP BY "inviteLinkId"`;
  const ids = counts.map((c) => c.inviteLinkId).filter((id): id is string => !!id);
  const linkRows = await prisma.inviteLink.findMany({
    where: { OR: [{ id: { in: ids } }, { channelId, kind: "SHARE", isActive: true }] },
    select: {
      id: true,
      kind: true,
      sourceChannelId: true,
      adPlatform: true,
      name: true,
      isActive: true,
    },
  });
  const links = new Map(linkRows.map((l) => [l.id, l]));
  const sourceIds = [
    ...new Set(linkRows.map((l) => l.sourceChannelId).filter((id): id is string => !!id)),
  ];
  const titles = sourceIds.length
    ? Object.fromEntries(
        (
          await prisma.channel.findMany({
            where: { id: { in: sourceIds } },
            select: { id: true, title: true },
          })
        ).map((c) => [c.id, c.title]),
      )
    : {};
  const rows = provenanceStatsRows({
    counts,
    links,
    titles,
    shareLinks: linkRows.filter((l) => l.kind === "SHARE" && l.isActive),
  });
  const totals = counts.reduce(
    (t, c) => ({
      requests: t.requests + c.requests,
      accepted: t.accepted + c.accepted,
      left7: t.left7 + c.left7,
    }),
    { requests: 0, accepted: 0, left7: 0 },
  );
  return { since, rows, totals };
}
