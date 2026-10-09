/** Indicateurs de rentabilité d'une pub (fonctions pures). */

export type CampaignTotals = {
  spend: number;
  members: number;
  registrations: number;
  ftds: number;
  revenue: number;
  entryClicks?: number;
};

export type CampaignMetrics = CampaignTotals & {
  cpl: number | null;
  cpa: number | null;
  costPerFtd: number | null;
  roas: number | null;
  profit: number;
};

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function computeMetrics(t: CampaignTotals): CampaignMetrics {
  return {
    ...t,
    cpl: ratio(t.spend, t.members),
    cpa: ratio(t.spend, t.registrations),
    costPerFtd: ratio(t.spend, t.ftds),
    roas: ratio(t.revenue, t.spend),
    profit: t.revenue - t.spend,
  };
}

export function fmtEur(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
}

export function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}
