/** Un nombre écrit en texte (« -12,50 », « +3 », « 1e3 ») : jamais une formule, laissé intact. */
const NUMERIC_TEXT = /^[-+]?(\d+([.,]\d*)?|[.,]\d+)(e[-+]?\d+)?$/i;
/** Début d'une formule pour Excel ou LibreOffice (injection de formule à l'ouverture du fichier). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Génération CSV (séparateur point-virgule, compatible Excel français), avec échappement. Un texte qui commence par
 * = + - @ (ou une tabulation, un retour chariot) et n'est pas un nombre est préfixé d'une apostrophe : ouvert dans
 * Excel, il reste du texte au lieu de s'exécuter comme une formule (prénoms Telegram, noms venus de Link Affi…).
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_START.test(s) && !NUMERIC_TEXT.test(s)) s = `'${s}`;
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
