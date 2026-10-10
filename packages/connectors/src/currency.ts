/**
 * Conversion des dépenses en EUR. Les taux sont « combien d'unités de la devise pour 1 EUR »
 * (même convention que la table `currency_rates` de Link Affi : base EUR = 1).
 */
export type Rates = Record<string, number>;

export const DEFAULT_RATES: Rates = { EUR: 1 };

export function normalizeCurrency(code: string | null | undefined): string {
  return (code ?? "EUR").trim().toUpperCase() || "EUR";
}

/** Convertit un montant vers l'EUR ; renvoie `null` si le taux est inconnu (la ligne est alors signalée, pas inventée). */
export function toEur(amount: number, currency: string | null | undefined, rates: Rates): number | null {
  const code = normalizeCurrency(currency);
  if (code === "EUR") return round2(amount);
  const rate = rates[code];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return round2(amount / rate);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fusionne des taux (saisie manuelle prioritaire sur les taux importés). */
export function mergeRates(imported: Rates | null | undefined, manual: Rates | null | undefined): Rates {
  const out: Rates = { ...DEFAULT_RATES };
  for (const [k, v] of Object.entries(imported ?? {})) if (Number.isFinite(v) && v > 0) out[normalizeCurrency(k)] = v;
  for (const [k, v] of Object.entries(manual ?? {})) if (Number.isFinite(v) && v > 0) out[normalizeCurrency(k)] = v;
  out.EUR = 1;
  return out;
}

/** Lit un JSON de taux tolérant (`{ USD: 1.08 }` ou `[{ currency, rate }]`). */
export function parseRates(value: unknown): Rates {
  const out: Rates = {};
  if (Array.isArray(value)) {
    for (const row of value) {
      const r = row as { currency?: unknown; rate?: unknown };
      const rate = Number(r.rate);
      if (typeof r.currency === "string" && Number.isFinite(rate) && rate > 0) out[normalizeCurrency(r.currency)] = rate;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const rate = Number(v);
      if (Number.isFinite(rate) && rate > 0) out[normalizeCurrency(k)] = rate;
    }
  }
  return out;
}
