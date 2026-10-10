/** Règles pures de la synchro des pubs : regroupement des lignes, clés de niveau, fenêtres de dates. Testé. */
import type { AdInsightRow } from "@linkaffipro/connectors";

export type ApplyReport = {
  rows: number;
  written: number;
  skipped: number;
  unknownCurrencies: string[];
  created: { campaigns: number; adSets: number; ads: number };
  linked: number;
  /** Campagnes pub reprises par une de nos campagnes (même compte, même nom) au lieu d'un doublon. */
  adopted: number;
  /** Lignes de coûts CSV ou saisies retirées car l'API couvre désormais le même jour de la même campagne. */
  replacedCosts: number;
};

/**
 * Tous les niveaux de coûts d'une campagne (filtre `AdCost`) : la campagne elle-même, ses groupes et ses pubs (une
 * saisie au niveau d'une pub n'a pas toujours `campaignId`). Même périmètre que les totaux de la page Campagnes.
 */
export function campaignCostScope(campaignId: string) {
  return [{ campaignId }, { adSet: { campaignId } }, { ad: { adSet: { campaignId } } }];
}

export type Grouped = {
  campaigns: Array<{ externalId: string; name: string }>;
  adSets: Array<{ key: string; campaignExternalId: string; externalId: string; name: string }>;
  ads: Array<{ key: string; adSetKey: string; externalId: string; name: string }>;
};

/** Entités distinctes présentes dans les lignes (le dernier nom vu gagne). */
export function groupRows(rows: AdInsightRow[]): Grouped {
  const campaigns = new Map<string, string>();
  const adSets = new Map<
    string,
    { campaignExternalId: string; externalId: string; name: string }
  >();
  const ads = new Map<string, { adSetKey: string; externalId: string; name: string }>();
  for (const r of rows) {
    if (!r.campaignExternalId) continue;
    campaigns.set(r.campaignExternalId, r.campaignName || r.campaignExternalId);
    if (r.adSetExternalId) {
      const key = `${r.campaignExternalId}/${r.adSetExternalId}`;
      adSets.set(key, {
        campaignExternalId: r.campaignExternalId,
        externalId: r.adSetExternalId,
        name: r.adSetName || r.adSetExternalId,
      });
      if (r.adExternalId)
        ads.set(`${key}/${r.adExternalId}`, {
          adSetKey: key,
          externalId: r.adExternalId,
          name: r.adName || r.adExternalId,
        });
    }
  }
  return {
    campaigns: [...campaigns].map(([externalId, name]) => ({ externalId, name })),
    adSets: [...adSets].map(([key, v]) => ({ key, ...v })),
    ads: [...ads].map(([key, v]) => ({ key, ...v })),
  };
}

export function levelKeyOf(level: {
  adId?: string | null;
  adSetId?: string | null;
  campaignId?: string | null;
}): string {
  if (level.adId) return `ad:${level.adId}`;
  if (level.adSetId) return `adset:${level.adSetId}`;
  return `campaign:${level.campaignId}`;
}

export function normalizeAdName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type SyncMode = "recent" | "full" | "backfill";

/** Nombre de jours couverts par un mode : 3 (horaire), 28 (nuit), 90 (historique à la connexion). */
export function windowDays(mode: SyncMode): number {
  return mode === "backfill" ? 90 : mode === "full" ? 28 : 3;
}

/** Fenêtre de dates (AAAA-MM-JJ, UTC) selon le mode : 3 jours, 28 jours, 90 jours, jusqu'à aujourd'hui inclus. */
export function windowFor(mode: SyncMode, now = new Date()): { from: string; to: string } {
  const days = windowDays(mode);
  const to = dayKey(now);
  const from = dayKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  return { from, to };
}

/** Découpe une plage en tranches de `maxDays` jours (limite par requête de certaines plateformes). */
export function splitRange(
  range: { from: string; to: string },
  maxDays: number,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let start = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (start <= end) {
    const stop = new Date(Math.min(end.getTime(), start.getTime() + (maxDays - 1) * 86_400_000));
    out.push({ from: dayKey(start), to: dayKey(stop) });
    start = new Date(stop.getTime() + 86_400_000);
  }
  return out;
}

/** Quel mode exécuter pour une connexion : historique au premier passage, 28 jours une fois par nuit, sinon 3 jours. */
export function modeFor(
  c: { backfilledAt: Date | null; nextFullSyncAt: Date | null },
  now = new Date(),
): SyncMode {
  if (!c.backfilledAt) return "backfill";
  if (!c.nextFullSyncAt || c.nextFullSyncAt <= now) return "full";
  return "recent";
}

/** Prochaine resynchro longue : le lendemain à 03:00 UTC (≈ 5 h Paris). */
export function nextFullSync(now = new Date()): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 3, 0, 0),
  );
  return d;
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Un jeton est à renouveler s'il expire dans moins de 7 jours. */
export function needsRefresh(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return !!expiresAt && expiresAt.getTime() - now.getTime() < 7 * 86_400_000;
}

// ---------- Rattachement à nos campagnes ----------

/**
 * Repère porté par `Campaign.adExternalIds` (même lecture que `apps/web/lib/campaigns/ad-link.ts`) :
 * `source: "sync"` = campagne pub créée par la synchro ; `source: "linked"` = une de nos campagnes rattachée à une
 * campagne pub ; `platformName` = nom chez TikTok / Meta.
 */
export type AdCampaignLink = { source: "sync" | "linked"; platformName: string | null };

export function readAdLink(value: unknown): AdCampaignLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.source !== "sync" && v.source !== "linked") return null;
  return {
    source: v.source,
    platformName: typeof v.platformName === "string" ? v.platformName : null,
  };
}

/**
 * Repère à enregistrer après une synchro : on garde la source et on note le nom actuel chez la plateforme. Une
 * campagne que l'équipe a complétée (offres ou canaux) est une des nôtres : « linked », même si elle n'avait pas
 * encore de repère (campagne importée en phase 7) ou portait encore le repère « sync » ; son nom ne sera donc jamais
 * remplacé par celui de la plateforme.
 */
export function adLinkAfterSync(
  current: AdCampaignLink | null,
  platformName: string,
  campaign?: { affiliateCampaignIds: unknown; channelIds: unknown },
): AdCampaignLink {
  const ours =
    !!campaign && (idCount(campaign.affiliateCampaignIds) > 0 || idCount(campaign.channelIds) > 0);
  return { source: ours ? "linked" : (current?.source ?? "sync"), platformName };
}

function sameName(a: string): string {
  return a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Une de nos campagnes à adopter pour une campagne pub encore inconnue : parmi les campagnes du même compte connecté
 * sans campagne pub (`externalCampaignId` vide), celle dont le nom est le même (casse, accents et espaces ignorés).
 * Plusieurs candidates au même nom : ambigu, aucune adoption.
 */
export function pickAdoptableCampaign<T extends { id: string; name: string }>(
  platformName: string,
  candidates: T[],
): T | null {
  const wanted = sameName(platformName);
  if (!wanted) return null;
  const hits = candidates.filter((c) => sameName(c.name) === wanted);
  return hits.length === 1 ? hits[0]! : null;
}

function idCount(value: unknown): number {
  return Array.isArray(value) ? value.filter((x) => typeof x === "string" && x !== "").length : 0;
}

/**
 * Faut-il reprendre le nom de la plateforme ? Seulement pour une campagne pub importée par la synchro que l'équipe n'a
 * pas renommée (son nom est encore celui noté lors de la dernière synchro) et qui n'a toujours ni offre ni canal.
 * Jamais pour une de nos campagnes (rattachée, ou avec offres ou canaux). Ancienne campagne importée sans repère :
 * renommée tant qu'elle n'a ni offre ni canal.
 */
export function shouldRenameFromPlatform(
  c: { name: string; adExternalIds: unknown; affiliateCampaignIds: unknown; channelIds: unknown },
  platformName: string,
): boolean {
  if (!platformName || c.name === platformName) return false;
  // Offres ou canaux : une de nos campagnes, quel que soit son repère.
  if (idCount(c.affiliateCampaignIds) > 0 || idCount(c.channelIds) > 0) return false;
  const link = readAdLink(c.adExternalIds);
  if (link?.source === "linked") return false;
  if (link?.source === "sync") return link.platformName === null || link.platformName === c.name;
  return true;
}
