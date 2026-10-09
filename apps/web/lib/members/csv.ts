/** Génération CSV (séparateur point-virgule, compatible Excel français), avec échappement. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const parisDate = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});
const parisDay = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Europe/Paris" });

/** Date et heure en Europe/Paris pour les exports (« 09/10/2026 14:05 ») ; chaîne vide si absente. */
export function csvDate(d: Date | null | undefined): string {
  return d ? parisDate.format(d) : "";
}

/** Jour seul en Europe/Paris (« 09/10/2026 ») ; chaîne vide si absent. */
export function csvDay(d: Date | null | undefined): string {
  return d ? parisDay.format(d) : "";
}

/** Nombre décimal au format français (virgule), vide si absent. */
export function csvNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toFixed(digits).replace(".", ",");
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(";"), ...rows.map((r) => r.map(csvEscape).join(";"))];
  // BOM UTF-8 pour qu'Excel reconnaisse les accents.
  return `﻿${lines.join("\r\n")}\r\n`;
}
