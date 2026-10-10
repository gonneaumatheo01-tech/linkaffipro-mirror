/** Règles pures de la synchro des pubs : regroupement des lignes, clés de niveau, fenêtres de dates. Testé. */
import type { AdInsightRow } from "@linkaffipro/connectors";

export type ApplyReport = {
  rows: number;
  written: number;
  skipped: number;
  unknownCurrencies: string[];
  created: { campaigns: number; adSets: number; ads: number };
  linked: number;
};

export type Grouped = {
  campaigns: Array<{ externalId: string; name: string }>;
  adSets: Array<{ key: string; campaignExternalId: string; externalId: string; name: string }>;
  ads: Array<{ key: string; adSetKey: string; externalId: string; name: string }>;
};

/** Entités distinctes présentes dans les lignes (le dernier nom vu gagne). */
export function groupRows(rows: AdInsightRow[]): Grouped {
  const campaigns = new Map<string, string>();
  const adSets = new Map<string, { campaignExternalId: string; externalId: string; name: string }>();
  const ads = new Map<string, { adSetKey: string; externalId: string; name: string }>();
  for (const r of rows) {
    if (!r.campaignExternalId) continue;
    campaigns.set(r.campaignExternalId, r.campaignName || r.campaignExternalId);
    if (r.adSetExternalId) {
      const key = `${r.campaignExternalId}/${r.adSetExternalId}`;
      adSets.set(key, { campaignExternalId: r.campaignExternalId, externalId: r.adSetExternalId, name: r.adSetName || r.adSetExternalId });
      if (r.adExternalId) ads.set(`${key}/${r.adExternalId}`, { adSetKey: key, externalId: r.adExternalId, name: r.adName || r.adExternalId });
    }
  }
  return {
    campaigns: [...campaigns].map(([externalId, name]) => ({ externalId, name })),
    adSets: [...adSets].map(([key, v]) => ({ key, ...v })),
    ads: [...ads].map(([key, v]) => ({ key, ...v })),
  };
}

export function levelKeyOf(level: { adId?: string | null; adSetId?: string | null; campaignId?: string | null }): string {
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

/** Fenêtre de dates (AAAA-MM-JJ, UTC) selon le mode : 3 jours, 28 jours, 90 jours, jusqu'à aujourd'hui inclus. */
export function windowFor(mode: SyncMode, now = new Date()): { from: string; to: string } {
  const days = mode === "backfill" ? 90 : mode === "full" ? 28 : 3;
  const to = dayKey(now);
  const from = dayKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  return { from, to };
}

/** Découpe une plage en tranches de `maxDays` jours (limite par requête de certaines plateformes). */
export function splitRange(range: { from: string; to: string }, maxDays: number): Array<{ from: string; to: string }> {
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
export function modeFor(c: { backfilledAt: Date | null; nextFullSyncAt: Date | null }, now = new Date()): SyncMode {
  if (!c.backfilledAt) return "backfill";
  if (!c.nextFullSyncAt || c.nextFullSyncAt <= now) return "full";
  return "recent";
}

/** Prochaine resynchro longue : le lendemain à 03:00 UTC (≈ 5 h Paris). */
export function nextFullSync(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 3, 0, 0));
  return d;
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Un jeton est à renouveler s'il expire dans moins de 7 jours. */
export function needsRefresh(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return !!expiresAt && expiresAt.getTime() - now.getTime() < 7 * 86_400_000;
}
