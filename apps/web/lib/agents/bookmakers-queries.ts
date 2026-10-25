/**
 * Lectures de la page Agents → Bookmakers (phase 35) : sites, santé des 24 dernières heures, méthode de lecture
 * apprise active, dernières lectures, matchs du jour en cache (20 minutes), écart site ↔ autres bookmakers des paris
 * retenus, identifiants (présence seulement, jamais la valeur), battement du Mac. Aucune écriture, aucune file.
 */
import { prisma } from "@linkaffipro/db";
import { parisMidnightUtc } from "@/lib/periods";
import { parisDayKey } from "@/lib/posts/time";
import { macFresh, rate24h, type JobRow, type PickGapRow, type RecipeRow } from "./bookmakers";

/** Client réduit aux tables lues ici (les modèles de la phase 35 sont récents dans le client partagé). */
type Db = {
  bookmakerSite: { findMany(a: unknown): Promise<SiteRow[]> };
  bookmakerRecipe: { findMany(a: unknown): Promise<Array<RecipeRow & { siteKey: string }>> };
  bookmakerReadJob: { findMany(a: unknown): Promise<JobRow[]> };
  bookmakerEvent: { findMany(a: unknown): Promise<EventRow[]> };
  bettingPick: { findMany(a: unknown): Promise<Array<PickGapRow & { siteKey: string | null }>> };
  setting: {
    findMany(a: unknown): Promise<Array<{ key: string; value: unknown }>>;
    findUnique(a: unknown): Promise<{ value: unknown } | null>;
  };
};
const db = () => prisma as unknown as Db;

export type SiteRow = {
  key: string;
  label: string;
  baseUrl: string | null;
  providerHint: string | null;
  readTarget: string;
  isActive: boolean;
  status: string;
  statusReason: string | null;
  lastReadAt: Date | null;
  lastOkAt: Date | null;
};

export type EventRow = {
  siteKey: string;
  siteEventId: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
  marketsCount: number | null;
  fetchedAt: Date;
};

export type SiteView = {
  site: SiteRow;
  rate: { total: number; ratio: number | null };
  recipe: RecipeRow | null;
  jobs: JobRow[];
  events: EventRow[];
  picks: PickGapRow[];
  credentials: "site" | "default" | null;
};

export type BookmakersPage = {
  sites: SiteView[];
  mac: { alive: boolean; at: Date | null };
  commonCredentials: boolean;
};

const SECRET_PREFIX = "agents.secret.";
const COMMON_KEY = "providers.bookmakers.default.credentials";
const EVENTS_TTL_MS = 20 * 60_000;

export async function loadBookmakersPage(now: Date = new Date()): Promise<BookmakersPage> {
  const d = db();
  const dayStart = parisMidnightUtc(parisDayKey(now));
  const dayEnd = parisMidnightUtc(parisDayKey(new Date(dayStart.getTime() + 36 * 3600_000)));
  const sites = await d.bookmakerSite.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      key: true,
      label: true,
      baseUrl: true,
      providerHint: true,
      readTarget: true,
      isActive: true,
      status: true,
      statusReason: true,
      lastReadAt: true,
      lastOkAt: true,
    },
  });
  const keys = sites.map((s) => s.key);
  const [recipes, jobs, events, picks, settings, hb] = await Promise.all([
    d.bookmakerRecipe.findMany({
      where: { siteKey: { in: keys }, isActive: true },
      select: {
        siteKey: true,
        version: true,
        level: true,
        createdBy: true,
        createdAt: true,
        mapping: true,
      },
    }),
    d.bookmakerReadJob.findMany({
      where: { siteKey: { in: keys } },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: {
        id: true,
        siteKey: true,
        kind: true,
        target: true,
        status: true,
        result: true,
        createdAt: true,
        finishedAt: true,
      },
    }),
    d.bookmakerEvent.findMany({
      where: {
        siteKey: { in: keys },
        startsAt: { gte: now, lt: dayEnd },
        fetchedAt: { gte: new Date(now.getTime() - EVENTS_TTL_MS) },
      },
      orderBy: { startsAt: "asc" },
      take: 300,
      select: {
        siteKey: true,
        siteEventId: true,
        league: true,
        homeTeam: true,
        awayTeam: true,
        startsAt: true,
        marketsCount: true,
        fetchedAt: true,
      },
    }),
    d.bettingPick.findMany({
      where: {
        siteKey: { in: keys },
        createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      },
      orderBy: { kickoffAt: "desc" },
      take: 60,
      select: {
        id: true,
        siteKey: true,
        homeTeam: true,
        awayTeam: true,
        selectionLabel: true,
        marketLabel: true,
        odds: true,
        consensusOdds: true,
        kickoffAt: true,
      },
    }),
    d.setting.findMany({
      where: {
        key: {
          in: [
            ...keys.map((k) => `bookmakers.health.${k}`),
            ...keys.map((k) => `${SECRET_PREFIX}providers.bookmakers.${k}.login`),
            `${SECRET_PREFIX}${COMMON_KEY}`,
          ],
        },
      },
      select: { key: true, value: true },
    }),
    d.setting.findUnique({ where: { key: "bookmakers.mac.heartbeat" }, select: { value: true } }),
  ]);
  const byKey = new Map(settings.map((s) => [s.key, s.value]));
  const commonCredentials = byKey.has(`${SECRET_PREFIX}${COMMON_KEY}`);
  return {
    mac: macFresh(hb?.value ?? null, now),
    commonCredentials,
    sites: sites.map((site) => ({
      site,
      rate: rate24h(byKey.get(`bookmakers.health.${site.key}`) ?? null, now),
      recipe: recipes.find((r) => r.siteKey === site.key) ?? null,
      jobs: jobs.filter((j) => j.siteKey === site.key).slice(0, 8),
      events: events.filter((e) => e.siteKey === site.key),
      picks: picks.filter((p) => p.siteKey === site.key).slice(0, 8),
      credentials: byKey.has(`${SECRET_PREFIX}providers.bookmakers.${site.key}.login`)
        ? "site"
        : commonCredentials
          ? "default"
          : null,
    })),
  };
}
