/**
 * Phase 32, chantier A — Veilleur : changements détectés entre deux relectures (section 1 du prompt). Code pur, sans
 * IA, sans base : l'historique (`ProspectSnapshot`, du plus ancien au plus récent) et le point du jour entrent, les
 * alertes (`DetectedAlert`) et les signaux de faux à ajouter sortent.
 *
 * Changements et seuils (`WATCH_LIMITS`) :
 * - `AFFILIATE_DROPPED` : marque vue HEAVY / MEDIUM, absente du point du jour (et du texte des posts lus), dont la
 *   dernière apparition date de 14 jours ou plus ; le canal poste encore (sinon c'est un silence, pas un abandon de
 *   marque). Empreinte avec la date de dernière apparition : une seule alerte par abandon.
 * - `NEW_AFFILIATE` : marque HEAVY / MEDIUM jamais vue dans l'historique ; `AFFILIATE_SWITCHED` si, en même temps, une
 *   marque HEAVY / MEDIUM du point précédent a disparu (« il vient de signer ailleurs »).
 * - `GROWTH_SPIKE` : sur environ 30 jours (point de référence âgé de 21 à 45 jours, le plus proche de 30), abonnés
 *   +30 % ou vues médianes +40 %. Abonnés +30 % sans que les vues suivent (moins de la moitié de la hausse des
 *   abonnés) → suspicion d'achat d'abonnés : `fakeFlags += GROWTH_SPIKE`, AUCUNE alerte positive.
 * - `DECLINE` : vues médianes −30 % sur la même fenêtre.
 * - `WENT_SILENT` : aucun post depuis 21 jours (empreinte avec la date du dernier post : une alerte par silence) ;
 *   chez un affilié signé, c'est `AFFILIATE_SILENT` (famille « affiliés »).
 * - `STARTED_SELLING_ADS` / `MARKETPLACE_LISTED` : passage de non à oui.
 * - `CONTACT_CHANGED` : meilleur contact nouveau, disparu ou différent.
 * - `TIER_UP` / `TIER_DOWN` : niveau changé après le nouveau score.
 * Chez un affilié signé (SIGNED / ACTIVE), les changements de marque et de niveau ne sont pas signalés ici : le suivi des
 * affiliés (`affiliates-watch.ts`) s'en charge avec la preuve.
 */
import { brandToken, findBrand } from "../dict";
import type { FakeFlag, ProspectStatus, ProspectTier } from "../contract";
import { WATCH_LIMITS, type DetectedAlert, type ProspectAlertFamily, type ProspectAlertKind, type SnapshotPoint } from "../contract-advanced";

const DAY = 86_400_000;

/** Statuts « en cours avec le client » (prévenir avant de relancer). */
export const WATCH_PIPELINE_STATUSES: readonly ProspectStatus[] = ["CONTACTED", "RESPONDED", "NEGOTIATING"];
/** Affiliés signés : suivi des liens et de la conformité. */
export const WATCH_SIGNED_STATUSES: readonly ProspectStatus[] = ["SIGNED", "ACTIVE"];

/** Changements « une seule fois par objet » (l'empreinte porte une date) : jamais répétés, même après 14 jours. */
export const ONCE_PER_KEY_KINDS: ReadonlySet<ProspectAlertKind> = new Set(["AFFILIATE_DROPPED", "WENT_SILENT", "AFFILIATE_SILENT", "NEW_AFFILIATE", "AFFILIATE_SWITCHED"]);

const TIER_RANK: Record<ProspectTier, number> = { A: 0, B: 1, C: 2, D: 3 };

/** Famille d'une alerte (ordre du message du matin), selon son type et le statut du prospect. */
export function familyOf(kind: ProspectAlertKind, status: ProspectStatus | string): ProspectAlertFamily {
  switch (kind) {
    case "AFFILIATE_NOT_POSTING":
    case "AFFILIATE_PUSHES_COMPETITOR":
    case "AFFILIATE_RISKY_CLAIM":
    case "AFFILIATE_SILENT":
      return "affiliate";
    case "AFFILIATE_DROPPED":
    case "GROWTH_SPIKE":
    case "STARTED_SELLING_ADS":
    case "MARKETPLACE_LISTED":
    case "TIER_UP":
      return "opportunity";
    case "WENT_SILENT":
    case "NEW_AFFILIATE":
    case "AFFILIATE_SWITCHED":
    case "CONTACT_CHANGED":
      return WATCH_PIPELINE_STATUSES.includes(status as ProspectStatus) ? "pipeline" : "info";
    default:
      return "info";
  }
}

/** Clé stable d'une marque (dictionnaire, sinon jeton du nom). */
export function brandKeyOf(name: string): string {
  return findBrand(name)?.key ?? `ai:${brandToken(name)}`;
}

const strong = (i: string) => i === "HEAVY" || i === "MEDIUM";
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const growth = (from: number | null, to: number | null) => (from !== null && to !== null && from > 0 ? (to - from) / from : null);
const normContact = (c: string | null) => (c ? c.trim().toLowerCase() : null);

/** Point de référence de la fenêtre de 30 jours : âgé de 21 à 45 jours, le plus proche de 30. */
export function referencePoint(history: readonly SnapshotPoint[], now: Date): SnapshotPoint | null {
  const target = WATCH_LIMITS.windowDays;
  let best: SnapshotPoint | null = null;
  let bestGap = Infinity;
  for (const s of history) {
    const age = (now.getTime() - s.takenAt.getTime()) / DAY;
    if (age < target - 9 || age > target + 15) continue;
    const gap = Math.abs(age - target);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

export type GrowthCheck = {
  kind: "spike" | "suspect" | "decline" | null;
  subsGrowth: number | null;
  viewsGrowth: number | null;
  reference: SnapshotPoint | null;
};

/** Hausse, hausse suspecte (vues qui ne suivent pas) ou baisse sur ~30 jours. Pur. */
export function growthCheck(history: readonly SnapshotPoint[], current: SnapshotPoint, now: Date): GrowthCheck {
  const reference = referencePoint(history, now);
  if (!reference) return { kind: null, subsGrowth: null, viewsGrowth: null, reference: null };
  const subsGrowth = growth(reference.subscribers, current.subscribers);
  const viewsGrowth = growth(reference.medianViews, current.medianViews);
  const out = { subsGrowth, viewsGrowth, reference };
  if (subsGrowth !== null && subsGrowth >= WATCH_LIMITS.growthSubsPct) {
    if (viewsGrowth === null) return { kind: null, ...out };
    if (viewsGrowth < subsGrowth / 2 && viewsGrowth < WATCH_LIMITS.growthViewsPct) return { kind: "suspect", ...out };
    return { kind: "spike", ...out };
  }
  if (viewsGrowth !== null && viewsGrowth >= WATCH_LIMITS.growthViewsPct) return { kind: "spike", ...out };
  if (viewsGrowth !== null && viewsGrowth <= -WATCH_LIMITS.declineViewsPct) return { kind: "decline", ...out };
  return { kind: null, ...out };
}

export type DiffInput = {
  /** Points précédents, du plus ancien au plus récent (sans le point du jour). */
  history: readonly SnapshotPoint[];
  current: SnapshotPoint;
  now: Date;
  status: ProspectStatus | string;
  /** Nombre de posts lus ce jour (0 : aperçu fermé ou vide → pas de jugement sur les marques). */
  postsRead: number;
  /** Texte des posts lus, en minuscules (mémoire seulement) : une marque citée n'est pas « lâchée ». */
  corpus?: string | null;
};

export type DiffResult = { alerts: DetectedAlert[]; fakeFlags: FakeFlag[] };

/** Tous les changements entre l'historique et le point du jour. Pur. */
export function diffSnapshots(input: DiffInput): DiffResult {
  const { history, current, now, status } = input;
  const alerts: DetectedAlert[] = [];
  const fakeFlags: FakeFlag[] = [];
  if (!history.length) return { alerts, fakeFlags };
  const prev = history[history.length - 1]!;
  const signed = WATCH_SIGNED_STATUSES.includes(status as ProspectStatus);
  const push = (kind: ProspectAlertKind, dedupeKey: string, strength: number, data: Record<string, unknown>, evidence: string | null = null) =>
    alerts.push({ kind, family: familyOf(kind, status), dedupeKey, strength: clamp(strength), data, evidence });
  const corpus = input.corpus?.toLowerCase() ?? null;
  const daysSincePost = current.lastPostAt ? Math.floor((now.getTime() - current.lastPostAt.getTime()) / DAY) : null;
  const silent = daysSincePost !== null && daysSincePost >= WATCH_LIMITS.silentDays;

  // Marques (prospects, pas les affiliés signés).
  if (!signed && input.postsRead > 0) {
    const currentKeys = new Map(current.brands.map((b) => [brandKeyOf(b.brand), b]));
    const seen = new Map<string, { brand: string; intensity: string; lastSeen: string | null; strongEver: boolean }>();
    for (const s of history)
      for (const b of s.brands) {
        const key = brandKeyOf(b.brand);
        const prevSeen = seen.get(key);
        const last = [prevSeen?.lastSeen ?? null, b.lastSeenAt ?? dayOf(s.takenAt)].filter((x): x is string => !!x).sort().pop() ?? null;
        seen.set(key, { brand: b.brand, intensity: strong(b.intensity) ? b.intensity : (prevSeen?.intensity ?? b.intensity), lastSeen: last, strongEver: (prevSeen?.strongEver ?? false) || strong(b.intensity) });
      }
    const cited = (name: string) => !!corpus && corpus.includes(name.toLowerCase());

    // Nouvelles marques fortes, et marques fortes du point précédent qui ont disparu.
    const fresh = current.brands.filter((b) => strong(b.intensity) && !seen.has(brandKeyOf(b.brand)));
    const gone = prev.brands.filter((b) => strong(b.intensity) && !currentKeys.has(brandKeyOf(b.brand)) && !cited(b.brand));
    const switchedFrom = new Set<string>();
    for (const b of fresh) {
      const from = gone[0];
      if (from) {
        switchedFrom.add(brandKeyOf(from.brand));
        push("AFFILIATE_SWITCHED", `AFFILIATE_SWITCHED:${brandKeyOf(from.brand)}>${brandKeyOf(b.brand)}`, 65 + (b.intensity === "HEAVY" ? 10 : 0), { from: from.brand, to: b.brand, intensity: b.intensity });
      } else push("NEW_AFFILIATE", `NEW_AFFILIATE:${brandKeyOf(b.brand)}`, 50 + (b.intensity === "HEAVY" ? 10 : 0), { brand: b.brand, intensity: b.intensity });
    }

    // Marque forte lâchée depuis 14 jours ou plus (le canal poste encore).
    if (!silent && current.lastPostAt)
      for (const [key, s] of seen) {
        if (!s.strongEver || currentKeys.has(key) || switchedFrom.has(key) || cited(s.brand) || !s.lastSeen) continue;
        const days = Math.floor((now.getTime() - Date.parse(s.lastSeen)) / DAY);
        if (days < WATCH_LIMITS.droppedAfterDays || days > 120) continue;
        push("AFFILIATE_DROPPED", `AFFILIATE_DROPPED:${key}:${s.lastSeen}`, 75 + (s.intensity === "HEAVY" ? 15 : 5) + Math.min(10, (days - WATCH_LIMITS.droppedAfterDays) / 3), {
          brand: s.brand,
          intensity: s.intensity,
          lastSeenAt: s.lastSeen,
          days,
        });
      }
  }

  // Croissance et baisse sur ~30 jours.
  const g = growthCheck(history, current, now);
  if (g.reference) {
    const days = Math.round((now.getTime() - g.reference.takenAt.getTime()) / DAY);
    const data = {
      days,
      subscribersFrom: g.reference.subscribers,
      subscribersTo: current.subscribers,
      viewsFrom: g.reference.medianViews,
      viewsTo: current.medianViews,
      subsGrowth: g.subsGrowth === null ? null : Math.round(g.subsGrowth * 1000) / 1000,
      viewsGrowth: g.viewsGrowth === null ? null : Math.round(g.viewsGrowth * 1000) / 1000,
    };
    if (g.kind === "suspect") fakeFlags.push("GROWTH_SPIKE");
    else if (g.kind === "spike") push("GROWTH_SPIKE", "GROWTH_SPIKE", 60 + Math.min(30, Math.max(g.subsGrowth ?? 0, g.viewsGrowth ?? 0) * 50), data);
    else if (g.kind === "decline") push("DECLINE", "DECLINE", 35 + Math.min(25, Math.abs(g.viewsGrowth ?? 0) * 40), data);
  }

  // Silence.
  if (silent && current.lastPostAt) {
    const kind: ProspectAlertKind = signed ? "AFFILIATE_SILENT" : "WENT_SILENT";
    push(kind, `${kind}:${dayOf(current.lastPostAt)}`, (signed ? 70 : WATCH_PIPELINE_STATUSES.includes(status as ProspectStatus) ? 60 : 40) + Math.min(10, (daysSincePost! - WATCH_LIMITS.silentDays) / 3), {
      days: daysSincePost,
      lastPostAt: dayOf(current.lastPostAt),
    });
  }

  // Ouvertures nouvelles.
  if (!prev.sellsAds && current.sellsAds) push("STARTED_SELLING_ADS", "STARTED_SELLING_ADS", 55, {});
  if (!prev.marketplace && current.marketplace) push("MARKETPLACE_LISTED", "MARKETPLACE_LISTED", 55, {});

  // Contact.
  const a = normContact(prev.bestContact);
  const b = normContact(current.bestContact);
  if (a !== b && (a || b)) push("CONTACT_CHANGED", `CONTACT_CHANGED:${a ?? "-"}>${b ?? "-"}`, b ? 45 : 35, { from: prev.bestContact, to: current.bestContact });

  // Niveau (prospects seulement).
  if (!signed && prev.tier && current.tier && prev.tier !== current.tier) {
    const up = TIER_RANK[current.tier] < TIER_RANK[prev.tier];
    push(up ? "TIER_UP" : "TIER_DOWN", `${up ? "TIER_UP" : "TIER_DOWN"}:${current.tier}`, up ? 50 + (current.tier === "A" ? 10 : 0) : 30, { from: prev.tier, to: current.tier, scoreFrom: prev.score, scoreTo: current.score });
  }
  return { alerts, fakeFlags };
}
