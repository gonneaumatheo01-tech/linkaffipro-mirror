const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});
const dateShortFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});
const dateShortYearFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Paris",
});
const numFmt = new Intl.NumberFormat("fr-FR");
const moneyFmts = new Map<string, Intl.NumberFormat>();
const relFmt = new Intl.RelativeTimeFormat("fr", { numeric: "always" });

/** Date et heure courtes en Europe/Paris (« 09/10/2026 14:05 ») ; « — » si absente. */
export function fmtDate(d: Date | null | undefined): string {
  return d ? dateFmt.format(d) : "—";
}

/** Date seule, sans l'heure (« 9 oct. » ou « 9 oct. 2025 » si une autre année), Europe/Paris. */
export function fmtDateShort(d: Date | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const sameYear =
    new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: "Europe/Paris" }).format(d) ===
    new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: "Europe/Paris" }).format(now);
  return (sameYear ? dateShortFmt : dateShortYearFmt).format(d);
}

/** Nombre entier avec séparateurs français (« 12 345 »). */
export function fmtNum(n: number | bigint): string {
  return numFmt.format(n);
}

/** Montant avec devise (« 1 234,50 € ») ; « — » si absent. */
export function fmtMoney(
  n: number | bigint | null | undefined,
  currency = "EUR",
  opts: { digits?: number } = {},
): string {
  if (n === null || n === undefined || (typeof n === "number" && !Number.isFinite(n))) return "—";
  const digits = opts.digits ?? 2;
  const key = `${currency}:${digits}`;
  let f = moneyFmts.get(key);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    moneyFmts.set(key, f);
  }
  return f.format(n);
}

/** Pourcentage à partir d'un ratio (0,153 → « 15,3 % ») ; « — » si le ratio est absent. */
export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
}

/** Durée relative en français (« il y a 3 min », « dans 2 h ») ; « — » si absente. */
export function fmtRelative(d: Date | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const diff = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return diff <= 0 ? "à l'instant" : "dans un instant";
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs)
      return relFmt
        .format(Math.round(diff / secs), unit)
        .replace("minutes", "min")
        .replace("minute", "min")
        .replace(" heures", " h")
        .replace(" heure", " h");
  }
  return relFmt.format(diff, "second");
}
