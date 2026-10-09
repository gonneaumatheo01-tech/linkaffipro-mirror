/** Indicateurs dérivés, deltas, entonnoir et cohortes — fonctions pures, testées. */

export type StatTotals = {
  requests: number; approved: number; joined: number; left: number; entryClicks: number; offerClicks: number;
  registrations: number; ftds: number; deposits: number; depositAmount: number; ngr: number; spend: number;
};

export const EMPTY_TOTALS: StatTotals = { requests: 0, approved: 0, joined: 0, left: 0, entryClicks: 0, offerClicks: 0, registrations: 0, ftds: 0, deposits: 0, depositAmount: 0, ngr: 0, spend: 0 };

export function addTotals(a: StatTotals, b: Partial<StatTotals>): StatTotals {
  const out = { ...a };
  for (const k of Object.keys(EMPTY_TOTALS) as (keyof StatTotals)[]) out[k] = round2(out[k] + Number(b[k] ?? 0));
  return out;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Derived = { cpl: number | null; cpa: number | null; costPerFtd: number | null; roas: number | null; profit: number };

/** Coût par membre (CPL = dépense / entrées), par inscription (CPA), par FTD, ROAS = NGR / dépense, bénéfice = NGR − dépense. null si non calculable. */
export function derive(t: StatTotals): Derived {
  const ratio = (num: number, den: number) => (den > 0 ? round2(num / den) : null);
  return {
    cpl: ratio(t.spend, t.joined),
    cpa: ratio(t.spend, t.registrations),
    costPerFtd: ratio(t.spend, t.ftds),
    roas: ratio(t.ngr, t.spend),
    profit: round2(t.ngr - t.spend),
  };
}

/** Variation en % entre deux valeurs ; null si la précédente est nulle. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type FunnelStep = { key: string; label: string; value: number; /** % conservé par rapport à l'étape précédente (null pour la première). */ rate: number | null; /** % perdu par rapport à l'étape précédente. */ loss: number | null };

export const FUNNEL_STEPS: Array<{ key: keyof StatTotals; label: string }> = [
  { key: "entryClicks", label: "Clics pub" },
  { key: "requests", label: "Demandes" },
  { key: "approved", label: "Acceptés" },
  { key: "joined", label: "Entrés" },
  { key: "offerClicks", label: "Clics offres" },
  { key: "registrations", label: "Inscriptions" },
  { key: "ftds", label: "FTD" },
  { key: "deposits", label: "Dépôts" },
];

/** Entonnoir avec taux de passage et pertes entre étapes consécutives. */
export function funnel(t: StatTotals): FunnelStep[] {
  const out: FunnelStep[] = [];
  let prev: number | null = null;
  for (const s of FUNNEL_STEPS) {
    const value = t[s.key];
    const rate = prev === null ? null : prev > 0 ? Math.round((value / prev) * 1000) / 10 : null;
    out.push({ key: s.key, label: s.label, value, rate, loss: rate === null ? null : Math.round((100 - rate) * 10) / 10 });
    prev = value;
  }
  return out;
}

export type CohortMemberInput = { memberId: string; arrivedAt: Date; registeredAt: Date | null; ftdAt: Date | null; deposits: Array<{ at: Date; amount: number }>; ngr: number };
export type CohortRow = { week: string; members: number; registered: number; ftd: number; deposits7: number; deposits30: number; ltv: number };

/** Lundi (Paris) de la semaine d'une date, clé AAAA-MM-JJ. */
export function weekKey(d: Date): string {
  const fmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const dow = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].indexOf(parts.weekday ?? "lun.");
  const back = dow < 0 ? 0 : dow;
  const monday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - back * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/** Cohortes par semaine d'arrivée : inscrits, FTD, dépôts cumulés à J+7 / J+30 (depuis l'arrivée), LTV = NGR cumulé / membres. */
export function cohorts(members: CohortMemberInput[]): CohortRow[] {
  const rows = new Map<string, CohortRow & { ngrTotal: number }>();
  for (const m of members) {
    const key = weekKey(m.arrivedAt);
    let r = rows.get(key);
    if (!r) {
      r = { week: key, members: 0, registered: 0, ftd: 0, deposits7: 0, deposits30: 0, ltv: 0, ngrTotal: 0 };
      rows.set(key, r);
    }
    r.members += 1;
    if (m.registeredAt) r.registered += 1;
    if (m.ftdAt) r.ftd += 1;
    const t0 = m.arrivedAt.getTime();
    for (const d of m.deposits) {
      const age = d.at.getTime() - t0;
      if (age <= 7 * 86_400_000) r.deposits7 = round2(r.deposits7 + d.amount);
      if (age <= 30 * 86_400_000) r.deposits30 = round2(r.deposits30 + d.amount);
    }
    r.ngrTotal += m.ngr;
  }
  return [...rows.values()]
    .map(({ ngrTotal, ...r }) => ({ ...r, ltv: r.members > 0 ? round2(ngrTotal / r.members) : 0 }))
    .sort((a, b) => b.week.localeCompare(a.week));
}

export type HourRow = { hour: number; posts: number; clicks: number; clicksPerPost: number };

/** Meilleurs horaires d'envoi : clics par message, par heure Paris d'envoi. */
export function bestHours(posts: Array<{ sentAt: Date; clicks: number }>): HourRow[] {
  const hourFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false });
  const map = new Map<number, { posts: number; clicks: number }>();
  for (const p of posts) {
    const h = Number(hourFmt.format(p.sentAt).replace(/\D/g, "")) % 24;
    const r = map.get(h) ?? { posts: 0, clicks: 0 };
    r.posts += 1;
    r.clicks += p.clicks;
    map.set(h, r);
  }
  return [...map.entries()]
    .map(([hour, r]) => ({ hour, posts: r.posts, clicks: r.clicks, clicksPerPost: r.posts > 0 ? round2(r.clicks / r.posts) : 0 }))
    .sort((a, b) => b.clicksPerPost - a.clicksPerPost || a.hour - b.hour);
}
