/**
 * Phase 32, chantier A — historique des mesures d'un prospect (`ProspectSnapshot`, 26 points au plus).
 *
 * - `snapshotPointOf` : ligne en base → point lu par `diff.ts` ;
 * - `baselinePointOf` : premier point tiré de la fiche (lecture complète de la phase 31) quand aucun historique
 *   n'existe ; seules les marques repérables par le code (dictionnaire, liens) y entrent, pour ne pas voir « lâchée »
 *   une marque que seule l'IA avait devinée ;
 * - `compactionPlan` (pur) : au-delà de 26 points, les deux plus anciens sont fusionnés (moyennes pondérées, marques
 *   réunies, date du plus ancien gardée pour la fenêtre de 30 jours), jusqu'à revenir à 26.
 * Aucun texte de post n'entre dans un point : marques (nom, intensité, date), chiffres, contact.
 */
import { findBrand } from "../dict";
import type { ContactConfidence, ProspectTier } from "../contract";
import { WATCH_LIMITS, type SnapshotPoint } from "../contract-advanced";
import { objectOf } from "../score/settings";

export type SnapshotBrand = SnapshotPoint["brands"][number];

export type SnapshotRow = {
  id: string;
  prospectId: string;
  takenAt: Date;
  subscribers: number | null;
  medianViews: number | null;
  viewRate: number | null;
  postsPerDay: number | null;
  brands: unknown;
  competitiveState: string | null;
  bestContact: string | null;
  contactConfidence: ContactConfidence | string;
  sellsAds: boolean;
  marketplace: boolean;
  lastPostAt: Date | null;
  tier: ProspectTier | null;
  score: number | null;
  merged: number;
};

const INTENSITIES = new Set(["HEAVY", "MEDIUM", "LIGHT"]);

/** Marques d'un champ JSON (fiche ou point) : `{ brand, intensity, lastSeenAt }` seulement. */
export function brandsOf(v: unknown, opts: { codeDetectableOnly?: boolean } = {}): SnapshotBrand[] {
  if (!Array.isArray(v)) return [];
  const out: SnapshotBrand[] = [];
  for (const raw of v) {
    const b = objectOf(raw);
    if (typeof b.brand !== "string" || !b.brand.trim()) continue;
    if (opts.codeDetectableOnly && !findBrand(b.brand) && !(typeof b.links === "number" && b.links > 0)) continue;
    out.push({
      brand: b.brand,
      intensity: (INTENSITIES.has(String(b.intensity)) ? b.intensity : "LIGHT") as SnapshotBrand["intensity"],
      lastSeenAt: typeof b.lastSeenAt === "string" ? b.lastSeenAt : null,
    });
  }
  return out;
}

export function snapshotPointOf(row: SnapshotRow): SnapshotPoint {
  return {
    takenAt: row.takenAt,
    subscribers: row.subscribers,
    medianViews: row.medianViews,
    viewRate: row.viewRate,
    postsPerDay: row.postsPerDay,
    brands: brandsOf(row.brands),
    competitiveState: row.competitiveState,
    bestContact: row.bestContact,
    sellsAds: !!row.sellsAds,
    marketplace: !!row.marketplace,
    lastPostAt: row.lastPostAt,
    tier: row.tier,
    score: row.score,
  };
}

export type BaselineSource = {
  subscribers: number | null;
  medianViews: number | null;
  viewRate: number | null;
  postsPerDay: number | null;
  brands: unknown;
  competitiveState: string | null;
  bestContact: string | null;
  monetization: unknown;
  lastPostAt: Date | null;
  tier: ProspectTier | null;
  score: number | null;
  lastRequalifiedAt?: Date | null;
  lastEnrichedAt?: Date | null;
  enrichedAt?: Date | null;
  discoveredAt?: Date | null;
};

/** Premier point tiré de la fiche du prospect (lecture de la phase 31). */
export function baselinePointOf(p: BaselineSource, fallbackAt: Date): SnapshotPoint {
  const mon = objectOf(p.monetization);
  return {
    takenAt: p.lastRequalifiedAt ?? p.lastEnrichedAt ?? p.enrichedAt ?? p.discoveredAt ?? fallbackAt,
    subscribers: p.subscribers,
    medianViews: p.medianViews,
    viewRate: p.viewRate,
    postsPerDay: p.postsPerDay,
    brands: brandsOf(p.brands, { codeDetectableOnly: true }),
    competitiveState: p.competitiveState,
    bestContact: p.bestContact,
    sellsAds: mon.sellsAds === true,
    marketplace: typeof mon.marketplaceListing === "string" && !!mon.marketplaceListing,
    lastPostAt: p.lastPostAt,
    tier: p.tier,
    score: p.score,
  };
}

/** Données d'écriture d'un point (`ProspectSnapshot.create`). */
export function snapshotData(prospectId: string, p: SnapshotPoint, contactConfidence: ContactConfidence | string = "NONE", merged = 1): Record<string, unknown> {
  return {
    prospectId,
    takenAt: p.takenAt,
    subscribers: p.subscribers,
    medianViews: p.medianViews,
    viewRate: p.viewRate,
    postsPerDay: p.postsPerDay,
    brands: JSON.parse(JSON.stringify(p.brands)),
    competitiveState: p.competitiveState,
    bestContact: p.bestContact,
    contactConfidence,
    sellsAds: p.sellsAds,
    marketplace: p.marketplace,
    lastPostAt: p.lastPostAt,
    tier: p.tier,
    score: p.score,
    merged,
  };
}

const RANK: Record<string, number> = { HEAVY: 3, MEDIUM: 2, LIGHT: 1 };

function weighted(a: number | null, wa: number, b: number | null, wb: number, round: boolean): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  const v = (a * wa + b * wb) / (wa + wb);
  return round ? Math.round(v) : Math.round(v * 1000) / 1000;
}

/** Fusion de deux points voisins (`older` puis `newer`) : date du plus ancien, état du plus récent. Pur. */
export function mergeSnapshotRows(older: SnapshotRow, newer: SnapshotRow): Omit<SnapshotRow, "id" | "prospectId"> {
  const wa = Math.max(1, older.merged);
  const wb = Math.max(1, newer.merged);
  const brands = new Map<string, SnapshotBrand>();
  for (const b of [...brandsOf(older.brands), ...brandsOf(newer.brands)]) {
    const k = b.brand.toLowerCase();
    const prev = brands.get(k);
    if (!prev) brands.set(k, { ...b });
    else
      brands.set(k, {
        brand: prev.brand,
        intensity: (RANK[b.intensity] ?? 0) > (RANK[prev.intensity] ?? 0) ? b.intensity : prev.intensity,
        lastSeenAt: [prev.lastSeenAt, b.lastSeenAt].filter((x): x is string => !!x).sort().pop() ?? null,
      });
  }
  return {
    takenAt: older.takenAt,
    subscribers: weighted(older.subscribers, wa, newer.subscribers, wb, true),
    medianViews: weighted(older.medianViews, wa, newer.medianViews, wb, true),
    viewRate: weighted(older.viewRate, wa, newer.viewRate, wb, false),
    postsPerDay: weighted(older.postsPerDay, wa, newer.postsPerDay, wb, false),
    brands: [...brands.values()],
    competitiveState: newer.competitiveState,
    bestContact: newer.bestContact,
    contactConfidence: newer.contactConfidence,
    sellsAds: newer.sellsAds,
    marketplace: newer.marketplace,
    lastPostAt: newer.lastPostAt ?? older.lastPostAt,
    tier: newer.tier,
    score: newer.score,
    merged: wa + wb,
  };
}

export type CompactionPlan = { update: Array<{ id: string; data: Omit<SnapshotRow, "id" | "prospectId"> }>; deleteIds: string[] };

/** Au-delà de `max` points, fusionne les deux plus anciens jusqu'à revenir à `max`. Pur. */
export function compactionPlan(rows: readonly SnapshotRow[], max: number = WATCH_LIMITS.maxSnapshots): CompactionPlan {
  const list = [...rows].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime()).map((r) => ({ ...r }));
  const deleteIds: string[] = [];
  const touched = new Set<string>();
  while (list.length > max && list.length >= 2) {
    const [older, newer] = list as [SnapshotRow, SnapshotRow];
    const merged = mergeSnapshotRows(older, newer);
    list.splice(0, 2, { ...merged, id: older.id, prospectId: older.prospectId });
    deleteIds.push(newer.id);
    touched.delete(newer.id);
    touched.add(older.id);
  }
  const update = list.filter((r) => touched.has(r.id)).map(({ id, prospectId: _p, ...data }) => (void _p, { id, data }));
  return { update, deleteIds };
}
