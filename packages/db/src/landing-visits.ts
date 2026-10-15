import { Prisma } from "@prisma/client";
import { prisma } from "./client";

export type LandingVisitsRow = {
  /** Lien LANDING que le bouton de la source affichait au moment de la visite. */
  inviteLinkId: string;
  /** Jour de la visite, heure de Paris (`AAAA-MM-JJ`). */
  day: string;
  visits: number;
};

/**
 * Visites humaines des pages d'atterrissage (phase 15), par lien d'invitation et par jour de Paris : une par visite
 * (`visitId`, premier affichage), robots exclus. Chaque visite est rattachée au lien que le bouton de sa source
 * affichait à ce moment-là : le dernier lien de la source créé avant la visite (la pub et la campagne d'un lien sont
 * figées à sa création, D9 : la visite compte pour la même pub que les demandes arrivées par ce lien). Un lien en trop
 * d'un passage concurrent n'a pas de source et n'est jamais retenu. Règle commune au worker (« Clics pub » des
 * statistiques journalières) et au site (chiffres d'une campagne).
 *
 * - `since` / `until` : période (`until` exclu, facultatif) ;
 * - `inviteLinkIds` : seulement les visites rattachées à ces liens (périmètre d'une campagne) ; sans cette option,
 *   les pages qui ont au moins un lien relié à une pub ou une campagne (l'appelant garde les liens qui l'intéressent).
 */
export async function landingVisitsByLink(opts: {
  since: Date;
  until?: Date;
  inviteLinkIds?: readonly string[];
}): Promise<LandingVisitsRow[]> {
  const ids = opts.inviteLinkIds ? [...new Set(opts.inviteLinkIds)] : null;
  if (ids && ids.length === 0) return [];
  const pages = ids
    ? Prisma.sql`SELECT il."landingPageId" FROM "InviteLink" il
        WHERE il."kind" = 'LANDING' AND il."landingPageId" IS NOT NULL AND il."id" = ANY(${ids}::text[])`
    : Prisma.sql`SELECT il."landingPageId" FROM "InviteLink" il
        WHERE il."kind" = 'LANDING' AND il."landingPageId" IS NOT NULL
          AND (il."landingAdId" IS NOT NULL OR il."campaignId" IS NOT NULL)`;
  const rows = await prisma.$queryRaw<LandingVisitsRow[]>(Prisma.sql`
    WITH v AS (
      SELECT DISTINCT ON (e."visitId") e."landingPageId" AS page, e."sourceKey" AS key, e."createdAt" AS at
      FROM "LandingEvent" e
      WHERE e."type" = 'VIEW'
        AND NOT e."isBot"
        AND e."createdAt" >= ${opts.since}
        ${opts.until ? Prisma.sql`AND e."createdAt" < ${opts.until}` : Prisma.empty}
        AND e."landingPageId" IN (${pages})
      ORDER BY e."visitId", e."createdAt"
    )
    SELECT l."id" AS "inviteLinkId",
           to_char((v.at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS "day",
           count(*)::int AS "visits"
    FROM v
    JOIN LATERAL (
      SELECT il."id" FROM "InviteLink" il
      WHERE il."kind" = 'LANDING' AND il."landingPageId" = v.page AND il."landingSource" = v.key
        AND il."createdAt" <= v.at
      ORDER BY il."createdAt" DESC, il."id" DESC
      LIMIT 1
    ) l ON true
    ${ids ? Prisma.sql`WHERE l."id" = ANY(${ids}::text[])` : Prisma.empty}
    GROUP BY 1, 2`);
  return rows.map((r) => ({ inviteLinkId: r.inviteLinkId, day: r.day, visits: Number(r.visits) }));
}
