/**
 * Indicateurs de rentabilité d'une campagne (fonctions pures). Définition unique (phase 10, @linkaffipro/core) :
 * gains = nos commissions (CPA nette + part de revshare) − dépense pub ; retour sur dépense pub = commissions ÷
 * dépense. Les dépôts et le revenu net (argent du casino) restent des indicateurs de volume, jamais additionnés.
 */
import { commissionsOf, commissionsRoas, gainsOf } from "@linkaffipro/core";

export type CampaignTotals = {
  spend: number;
  members: number;
  registrations: number;
  ftds: number;
  /** Revenu net (NGR) des joueurs rattachés : volume, n'entre pas dans les gains. */
  revenue: number;
  /** Commissions CPA nettes (créditées − annulées, chacune à son jour réel), en euros. */
  cpaCommissions?: number;
  /** Part de revshare de nos offres (agrégat Link Affi par offre et par jour), en euros. */
  revshareCommissions?: number;
  /** Clics sur les liens goolink d'entrée (pubs), hors robots. */
  entryClicks?: number;
  /** Clics « offre » depuis le bot (avec sub-ID). */
  offerClicks?: number;
  /** Dépôts (nombre) et montant déposé (€) sur la période. */
  deposits?: number;
  depositAmount?: number;
};

export type CampaignMetrics = CampaignTotals & {
  cpl: number | null;
  cpa: number | null;
  costPerFtd: number | null;
  /** Commissions = CPA nette + part de revshare. */
  commissions: number;
  /** Retour sur dépense pub = commissions ÷ dépense (null sans dépense). */
  roas: number | null;
  /** Gains = commissions − dépense pub. */
  gains: number;
};

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function computeMetrics(t: CampaignTotals): CampaignMetrics {
  const commissions = commissionsOf(t.cpaCommissions ?? 0, t.revshareCommissions ?? 0);
  return {
    ...t,
    cpl: ratio(t.spend, t.members),
    cpa: ratio(t.spend, t.registrations),
    costPerFtd: ratio(t.spend, t.ftds),
    commissions,
    roas: commissionsRoas(commissions, t.spend),
    gains: gainsOf(commissions, t.spend),
  };
}

export function fmtEur(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
}

/** Ratio en français, deux décimales (« 2,50× ») ; « — » si absent. */
export function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  // Vrai signe moins (commissions négatives après une annulation) ; jamais « −0,00× ».
  const s = n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "negative",
  });
  return `${s.replace(/^-/, "\u2212")}×`;
}
