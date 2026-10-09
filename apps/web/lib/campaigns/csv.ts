/**
 * Lecture de fichiers CSV exportés par TikTok Ads Manager et Meta Ads Manager (fonctions pures).
 * Séparateurs `,` `;` et tabulation, guillemets doubles (avec `""` échappé), BOM UTF-8.
 */

export type CsvTable = { headers: string[]; rows: string[][]; separator: string };

/** Détecte le séparateur sur la première ligne (celui qui donne le plus de colonnes). */
export function detectSeparator(firstLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const sep of candidates) {
    const count = splitLine(firstLine, sep).length;
    if (count > bestCount) {
      best = sep;
      bestCount = count;
    }
  }
  return best;
}

/** Découpe une ligne en champs en respectant les guillemets. */
export function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** Parse un CSV complet. Les lignes vides sont ignorées. */
export function parseCsv(text: string, maxRows = 50_000): CsvTable {
  let src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  // Regroupe les lignes coupées à l'intérieur de guillemets.
  const lines: string[] = [];
  let buf = "";
  let quotes = 0;
  for (const raw of src.split("\n")) {
    buf = buf ? `${buf}\n${raw}` : raw;
    quotes += (raw.match(/"/g) ?? []).length;
    if (quotes % 2 === 0) {
      lines.push(buf);
      buf = "";
      quotes = 0;
    }
  }
  if (buf) lines.push(buf);
  src = "";
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return { headers: [], rows: [], separator: "," };
  const separator = detectSeparator(nonEmpty[0]!);
  const headers = splitLine(nonEmpty[0]!, separator).map((h) => h.replace(/^﻿/, ""));
  const rows = nonEmpty.slice(1, 1 + maxRows).map((l) => splitLine(l, separator));
  return { headers, rows, separator };
}

export type CostField = "date" | "campaign" | "adset" | "ad" | "spend" | "impressions" | "clicks" | "currency";

/** Synonymes d'en-têtes (TikTok Ads Manager, Meta Ads Manager, exports FR/EN), en minuscules, sans accents. */
const SYNONYMS: Record<CostField, string[]> = {
  date: ["date", "day", "jour", "reporting starts", "date de debut des rapports", "time", "date (by day)", "stat time (day)", "stat_time_day", "date de debut", "debut des rapports"],
  campaign: ["campaign name", "campaign", "nom de la campagne", "campagne", "campaign_name"],
  adset: ["ad set name", "adset name", "ad group name", "adgroup name", "ad group", "nom de l'ensemble de publicites", "ensemble de publicites", "nom du groupe d'annonces", "groupe d'annonces", "adgroup_name", "ad set"],
  ad: ["ad name", "ad", "nom de la publicite", "publicite", "ad_name", "nom de l'annonce", "annonce", "creative name"],
  spend: ["amount spent", "amount spent (eur)", "amount spent (usd)", "cost", "spend", "total cost", "montant depense", "montant depense (eur)", "depense", "cout", "cout total", "cost (eur)", "cost (usd)", "montant"],
  impressions: ["impressions", "impression", "impr."],
  clicks: ["clicks", "clics", "link clicks", "clicks (all)", "clics sur un lien", "clics (tous)", "clic", "clicks (destination)", "clics (destination)"],
  currency: ["currency", "devise", "account currency", "devise du compte"],
};

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim();
}

export type ColumnMap = Partial<Record<CostField, number>>;

/** Trouve l'indice de colonne de chaque champ utile (correspondance exacte d'abord, puis « contient »). */
export function detectColumns(headers: string[]): ColumnMap {
  const norm = headers.map(normalizeHeader);
  const map: ColumnMap = {};
  for (const field of Object.keys(SYNONYMS) as CostField[]) {
    const syns = SYNONYMS[field];
    let idx = norm.findIndex((h) => syns.includes(h));
    if (idx < 0) idx = norm.findIndex((h) => syns.some((s) => s.length > 3 && h.includes(s)) && !(field !== "spend" && h.includes("cost per")));
    if (idx >= 0 && !Object.values(map).includes(idx)) map[field] = idx;
  }
  return map;
}

export type Platform = "TIKTOK" | "META" | "OTHER";
export const PLATFORM_NAMES: Record<Platform, string> = { TIKTOK: "TikTok Ads Manager", META: "Meta Ads Manager", OTHER: "CSV générique" };

/** Marqueurs d'en-têtes propres à chaque plateforme (normalisés), avec un poids : 2 = très distinctif, 1 = indice. */
const PLATFORM_MARKERS: Record<Exclude<Platform, "OTHER">, Array<[marker: string, weight: number]>> = {
  TIKTOK: [
    ["ad group name", 2], ["ad group id", 2], ["nom du groupe d'annonces", 2], ["stat time (day)", 2], ["date (by day)", 2],
    ["clicks (destination)", 2], ["clics (destination)", 2], ["cpc (destination)", 2], ["ctr (destination)", 2], ["conversions", 1],
    ["cost per conversion", 1], ["cost", 1], ["cout", 1], ["cpm", 1], ["video views", 1], ["campaign id", 1], ["ad id", 1], ["by day", 1],
  ],
  META: [
    ["reporting starts", 2], ["reporting ends", 2], ["debut des rapports", 2], ["fin des rapports", 2], ["ad set name", 2], ["ad set id", 2],
    ["nom de l'ensemble de publicites", 2], ["amount spent", 2], ["montant depense", 2], ["link clicks", 2], ["clics sur un lien", 2],
    ["cpm (cost per 1,000 impressions)", 2], ["results", 1], ["resultats", 1], ["reach", 1], ["couverture", 1], ["frequency", 1], ["repetition", 1],
    ["cost per result", 1], ["ad delivery", 1], ["diffusion de la publicite", 1], ["ad set budget", 1], ["attribution setting", 1],
  ],
};

export type PlatformDetection = { platform: Platform; confidence: number; matched: string[] };

/**
 * Devine la plateforme d'origine d'après les en-têtes. Score par plateforme = somme des poids des marqueurs trouvés ;
 * confiance de 30 à 99 selon l'écart entre les deux scores. Sous 2 points : CSV générique (confiance selon que date et
 * dépense sont reconnues).
 */
export function detectPlatform(headers: string[]): PlatformDetection {
  const norm = headers.map(normalizeHeader);
  const score = (platform: Exclude<Platform, "OTHER">) => {
    const matched: string[] = [];
    let total = 0;
    for (const [marker, weight] of PLATFORM_MARKERS[platform]) {
      const hit = norm.find((h) => h === marker || (marker.length >= 5 && h.startsWith(marker)));
      if (hit !== undefined) {
        matched.push(headers[norm.indexOf(hit)] ?? marker);
        total += weight;
      }
    }
    return { total, matched };
  };
  const tiktok = score("TIKTOK");
  const meta = score("META");
  const [best, other, platform] = tiktok.total >= meta.total ? [tiktok, meta, "TIKTOK" as const] : [meta, tiktok, "META" as const];
  if (best.total < 2) {
    const cols = detectColumns(headers);
    return { platform: "OTHER", confidence: cols.date !== undefined && cols.spend !== undefined ? 50 : 20, matched: [] };
  }
  const confidence = Math.max(30, Math.min(99, Math.round(((best.total - other.total) / 8) * 100)));
  return { platform, confidence, matched: best.matched };
}

export type DateFormat = "auto" | "dmy" | "mdy" | "ymd";
export const DATE_FORMAT_LABELS: Record<DateFormat, string> = { auto: "Automatique", dmy: "JJ/MM/AAAA (France)", mdy: "MM/JJ/AAAA (États-Unis)", ymd: "AAAA-MM-JJ" };

/**
 * Devine le format des dates d'une colonne : ISO → `ymd` ; sinon jour/mois si un premier nombre dépasse 12, mois/jour si
 * c'est le deuxième ; indécidable → mois/jour pour Meta (comptes en anglais), jour/mois sinon.
 */
export function detectDateFormat(samples: string[], platform: Platform = "OTHER"): DateFormat {
  const vals = samples.map((v) => v.trim()).filter(Boolean);
  if (vals.length === 0) return "auto";
  if (vals.every((v) => /^\d{4}[-/]\d{2}[-/]\d{2}/.test(v))) return "ymd";
  let firstOver = false;
  let secondOver = false;
  for (const v of vals) {
    const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(v);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver = true;
    if (Number(m[2]) > 12) secondOver = true;
  }
  if (firstOver && !secondOver) return "dmy";
  if (secondOver && !firstOver) return "mdy";
  return platform === "META" ? "mdy" : "dmy";
}

/**
 * Interprète une date « 2026-10-09 », « 2026/10/09 », « 09/10/2026 », « 09.10.2026 », « 10/09/2026 » (mois/jour si
 * `format` = `mdy`, ou si plateforme META en mode automatique), « 2026-10-09 00:00:00 ». Renvoie `AAAA-MM-JJ` ou null.
 */
export function parseCsvDate(value: string, platform: Platform = "OTHER", format: DateFormat = "auto"): string | null {
  const v = value.trim();
  let m = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(v);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3];
    let monthFirst: boolean;
    if (format === "mdy") monthFirst = true;
    else if (format === "dmy") monthFirst = false;
    // Automatique : Meta exporte en mois/jour/année sur les comptes en anglais ; sinon jour/mois/année ; un nombre > 12 tranche.
    else monthFirst = platform === "META" ? a <= 12 && !(b <= 12 && a > 12) : a > 12 ? false : b > 12;
    const [day, month] = monthFirst ? [b, a] : [a, b];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export type NumberFormat = "auto" | "fr" | "en";
export const NUMBER_FORMAT_LABELS: Record<NumberFormat, string> = { auto: "Automatique", fr: "1 234,56 (virgule décimale)", en: "1,234.56 (point décimal)" };

/**
 * Devine le format des nombres d'une colonne : si une valeur porte virgule et point, le dernier séparateur est la
 * décimale ; une virgule suivie d'autre chose que 3 chiffres est une décimale (fr) ; un point suivi d'autre chose que
 * 3 chiffres est une décimale (en) ; sinon indécidable (`auto`).
 */
export function detectNumberFormat(samples: string[]): NumberFormat {
  let fr = 0;
  let en = 0;
  for (const raw of samples) {
    const v = raw.replace(/[^\d,.\-]/g, "");
    if (!v) continue;
    const lc = v.lastIndexOf(",");
    const ld = v.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) {
      if (lc > ld) fr++;
      else en++;
    } else if (lc >= 0) {
      if (v.length - lc - 1 !== 3 || v.split(",").length > 2) fr++;
    } else if (ld >= 0) {
      if (v.length - ld - 1 !== 3 || v.split(".").length > 2) en++;
    }
  }
  if (fr > en) return "fr";
  if (en > fr) return "en";
  return "auto";
}

/** Nombre depuis « 1 234,56 », « 1,234.56 », « 1.234,56 », « 12.5 », « € 12 » ; `format` lève l'ambiguïté de « 1,234 ». */
export function parseCsvNumber(value: string, format: NumberFormat = "auto"): number {
  let v = value.replace(/[^\d,.\-]/g, "");
  if (v === "" || v === "-") return 0;
  if (format === "fr") v = v.replace(/\./g, "").replace(/,/g, ".");
  else if (format === "en") v = v.replace(/,/g, "");
  else if (v.includes(",") && v.includes(".")) {
    v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (v.includes(",")) {
    const parts = v.split(",");
    v = parts.length === 2 && parts[1]!.length !== 3 ? v.replace(",", ".") : v.replace(/,/g, "");
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Une valeur de dépense « vide » : rien, un tiret ou un symbole monétaire seul. */
function isBlankNumber(value: string): boolean {
  return value.replace(/[^\d]/g, "") === "";
}

export type CostRow = { date: string; campaign: string; adset: string; ad: string; spend: number; impressions: number; clicks: number; currency: string | null };

export type SkipReason = "date_invalid" | "spend_empty" | "spend_invalid" | "no_name";
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  date_invalid: "date illisible",
  spend_empty: "montant vide",
  spend_invalid: "montant illisible",
  no_name: "ligne de total ou sans nom de pub",
};
/** Ligne ignorée : numéro dans le fichier (l'en-tête est la ligne 1), raison, valeur en cause. */
export type SkippedRow = { line: number; reason: SkipReason; value: string };

export type CostParseOptions = { numberFormat?: NumberFormat; dateFormat?: DateFormat };

/**
 * Convertit les lignes brutes en lignes de coût typées. `errors` : messages lisibles (colonnes manquantes, lignes en
 * erreur) ; `skipped` : chaque ligne ignorée avec sa raison, pour le rapport d'import.
 */
export function toCostRows(table: CsvTable, map: ColumnMap, platform: Platform, opts: CostParseOptions = {}): { rows: CostRow[]; errors: string[]; skipped: SkippedRow[] } {
  const rows: CostRow[] = [];
  const errors: string[] = [];
  const skipped: SkippedRow[] = [];
  if (map.date === undefined || map.spend === undefined) {
    errors.push("Colonnes « date » et « dépense » introuvables.");
    return { rows, errors, skipped };
  }
  const nf = opts.numberFormat ?? "auto";
  const df = opts.dateFormat ?? "auto";
  table.rows.forEach((r, i) => {
    const line = i + 2;
    const rawDate = r[map.date!] ?? "";
    const date = parseCsvDate(rawDate, platform, df);
    if (!date) {
      errors.push(`Ligne ${line} : date illisible « ${rawDate} »`);
      skipped.push({ line, reason: "date_invalid", value: rawDate });
      return;
    }
    const get = (f: CostField) => (map[f] !== undefined ? (r[map[f]!] ?? "").trim() : "");
    const campaign = get("campaign");
    if (!campaign && !get("adset") && !get("ad")) {
      skipped.push({ line, reason: "no_name", value: "" });
      return;
    }
    const rawSpend = get("spend");
    if (rawSpend === "") {
      skipped.push({ line, reason: "spend_empty", value: "" });
      return;
    }
    if (isBlankNumber(rawSpend)) {
      errors.push(`Ligne ${line} : montant illisible « ${rawSpend} »`);
      skipped.push({ line, reason: "spend_invalid", value: rawSpend });
      return;
    }
    rows.push({
      date,
      campaign,
      adset: get("adset"),
      ad: get("ad"),
      spend: parseCsvNumber(rawSpend, nf),
      impressions: Math.round(parseCsvNumber(get("impressions"), nf)),
      clicks: Math.round(parseCsvNumber(get("clicks"), nf)),
      currency: get("currency") || null,
    });
  });
  return { rows, errors, skipped };
}

/** Résumé des lignes ignorées par raison, trié par nombre décroissant. */
export function skippedSummary(skipped: SkippedRow[]): Array<{ reason: SkipReason; label: string; count: number }> {
  const counts = new Map<SkipReason, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts.entries()].map(([reason, count]) => ({ reason, label: SKIP_REASON_LABELS[reason], count })).sort((a, b) => b.count - a.count);
}

/** Phrase du rapport d'import : « 12 lignes importées, 3 ignorées (2 : date illisible, 1 : montant vide) ». */
export function importReportText(imported: number, skipped: SkippedRow[], failed = 0): string {
  const parts = [`${imported} ligne${imported > 1 ? "s" : ""} importée${imported > 1 ? "s" : ""}`];
  if (skipped.length) parts.push(`${skipped.length} ignorée${skipped.length > 1 ? "s" : ""} (${skippedSummary(skipped).map((s) => `${s.count} : ${s.label}`).join(", ")})`);
  if (failed) parts.push(`${failed} en erreur à l'enregistrement`);
  return parts.join(", ");
}

/** Lignes du rapport conservées dans l'historique (`ImportBatch.errors`), une par ligne ignorée. */
export function skippedToReportLines(skipped: SkippedRow[]): string[] {
  return skipped.map((s) => `Ligne ${s.line} : ${SKIP_REASON_LABELS[s.reason]}${s.value ? ` « ${s.value} »` : ""}`);
}

/** Correspondance mémorisée par plateforme (`Setting` `import.costs.mapping.<plateforme>`) : champ → nom d'en-tête. */
export type SavedMapping = Partial<Record<CostField, string>>;

export function mappingToSaved(headers: string[], map: ColumnMap): SavedMapping {
  const out: SavedMapping = {};
  for (const [field, idx] of Object.entries(map) as Array<[CostField, number]>) {
    const h = headers[idx];
    if (h !== undefined) out[field] = h;
  }
  return out;
}

/**
 * Applique une correspondance mémorisée aux en-têtes d'un nouveau fichier (comparaison normalisée). Renvoie null si
 * les colonnes date et dépense n'y sont pas retrouvées : la détection automatique reprend alors la main.
 */
export function applySavedMapping(headers: string[], saved: SavedMapping | null | undefined): ColumnMap | null {
  if (!saved) return null;
  const norm = headers.map(normalizeHeader);
  const map: ColumnMap = {};
  for (const [field, header] of Object.entries(saved) as Array<[CostField, string]>) {
    const idx = norm.indexOf(normalizeHeader(header));
    if (idx >= 0 && !Object.values(map).includes(idx)) map[field] = idx;
  }
  return map.date !== undefined && map.spend !== undefined ? map : null;
}

/** Valeurs d'une colonne (jusqu'à `n` lignes) pour la détection des formats. */
export function columnSamples(table: CsvTable, idx: number | undefined, n = 50): string[] {
  if (idx === undefined) return [];
  return table.rows.slice(0, n).map((r) => r[idx] ?? "").filter((v) => v.trim() !== "");
}
