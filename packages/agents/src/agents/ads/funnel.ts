/**
 * Entonnoir d'une pub (pur) : impression → clic pub → visite → entrée Telegram → clic offre → inscription → premier
 * dépôt, taux de passage à chaque étape, et goulot : l'étape dont le taux est le plus en dessous de la valeur du milieu
 * des pubs comparables (même univers). Pas de goulot sans assez de pubs à comparer ni sans passage mesurable.
 */
import type { AdsMetrics } from "../../ads/contracts";
import { median } from "./metrics";

export const FUNNEL_STEPS = [
  { key: "impressions", label: "Impressions" },
  { key: "adClicks", label: "Clics pub" },
  { key: "landingVisits", label: "Visites" },
  { key: "telegramJoins", label: "Entrées Telegram" },
  { key: "offerClicks", label: "Clics sur l'offre" },
  { key: "registrations", label: "Inscriptions" },
  { key: "ftds", label: "Premiers dépôts" },
] as const satisfies readonly { key: keyof AdsMetrics; label: string }[];

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]["key"];
export const FUNNEL_LABELS = Object.fromEntries(FUNNEL_STEPS.map((s) => [s.key, s.label])) as Record<FunnelStepKey, string>;

/** Pubs comparables minimum pour désigner un goulot. */
export const BOTTLENECK_MIN_PEERS = 3;
/** Passages minimum à l'étape précédente pour qu'un taux compte (évite « 1 sur 2 »). */
export const BOTTLENECK_MIN_BASE = 20;

export type FunnelRate = { key: FunnelStepKey; label: string; value: number; /** % gardé depuis l'étape d'avant. */ rate: number | null };

/**
 * Taux de passage. Une étape sans base (0 à l'étape d'avant, ou chiffre absent : pas de connecteur, donc ni
 * impressions ni clics pub) prend sa base à la dernière étape non nulle, pour que l'entonnoir reste lisible.
 */
export function funnelRates(m: Pick<AdsMetrics, FunnelStepKey>): FunnelRate[] {
  const out: FunnelRate[] = [];
  let base: number | null = null;
  for (const s of FUNNEL_STEPS) {
    const value = m[s.key];
    const rate = base !== null && base > 0 ? Math.round((value / base) * 1000) / 10 : null;
    out.push({ key: s.key, label: s.label, value, rate });
    if (value > 0) base = value;
  }
  return out;
}

function measurable(rates: readonly FunnelRate[]): Map<FunnelStepKey, number> {
  const out = new Map<FunnelStepKey, number>();
  for (let i = 1; i < rates.length; i++) {
    const prev = rates.slice(0, i).reverse().find((r) => r.value > 0);
    const r = rates[i]!;
    if (r.rate !== null && prev && prev.value >= BOTTLENECK_MIN_BASE) out.set(r.key, r.rate);
  }
  return out;
}

/** Goulot d'une pub parmi ses pubs comparables (`peers` : la pub comprise ou non). */
export function bottleneckOf(row: Pick<AdsMetrics, FunnelStepKey>, peers: ReadonlyArray<Pick<AdsMetrics, FunnelStepKey>>): FunnelStepKey | null {
  if (peers.length < BOTTLENECK_MIN_PEERS) return null;
  const mine = measurable(funnelRates(row));
  const peerRates = peers.map((p) => measurable(funnelRates(p)));
  let worst: { key: FunnelStepKey; gap: number } | null = null;
  for (const [key, rate] of mine) {
    const values = peerRates.map((p) => p.get(key)).filter((v): v is number => typeof v === "number");
    if (values.length < BOTTLENECK_MIN_PEERS) continue;
    const mid = median(values);
    if (!mid || mid <= 0 || rate >= mid) continue;
    const gap = (mid - rate) / mid;
    if (!worst || gap > worst.gap) worst = { key, gap };
  }
  return worst?.key ?? null;
}
