/** Génération CSV (séparateur point-virgule, compatible Excel français), avec échappement. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(";"), ...rows.map((r) => r.map(csvEscape).join(";"))];
  // BOM UTF-8 pour qu'Excel reconnaisse les accents.
  return `﻿${lines.join("\r\n")}\r\n`;
}
