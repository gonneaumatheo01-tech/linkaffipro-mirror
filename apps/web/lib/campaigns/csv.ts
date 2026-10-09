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

/** Interprète une date « 2026-10-09 », « 09/10/2026 », « 10/09/2026 » (si plateforme META : mois/jour), « 2026-10-09 00:00:00 ». */
export function parseCsvDate(value: string, platform: "TIKTOK" | "META" | "OTHER" = "OTHER"): string | null {
  const v = value.trim().slice(0, 10);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim());
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3];
    // Meta exporte en mois/jour/année sur les comptes en anglais ; sinon jour/mois/année.
    const monthFirst = platform === "META" ? a <= 12 && !(b <= 12 && a > 12) : a > 12 ? false : b > 12;
    const [day, month] = monthFirst ? [b, a] : [a, b];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

/** Nombre depuis « 1 234,56 », « 1,234.56 », « 12.5 », « € 12 ». */
export function parseCsvNumber(value: string): number {
  let v = value.replace(/[^\d,.\-]/g, "");
  if (v === "" || v === "-") return 0;
  if (v.includes(",") && v.includes(".")) {
    v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (v.includes(",")) {
    const parts = v.split(",");
    v = parts.length === 2 && parts[1]!.length !== 3 ? v.replace(",", ".") : v.replace(/,/g, "");
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type CostRow = { date: string; campaign: string; adset: string; ad: string; spend: number; impressions: number; clicks: number; currency: string | null };

/** Convertit les lignes brutes en lignes de coût typées ; renvoie aussi les erreurs par ligne. */
export function toCostRows(table: CsvTable, map: ColumnMap, platform: "TIKTOK" | "META" | "OTHER"): { rows: CostRow[]; errors: string[] } {
  const rows: CostRow[] = [];
  const errors: string[] = [];
  if (map.date === undefined || map.spend === undefined) {
    errors.push("Colonnes « date » et « dépense » introuvables.");
    return { rows, errors };
  }
  table.rows.forEach((r, i) => {
    const date = parseCsvDate(r[map.date!] ?? "", platform);
    if (!date) {
      errors.push(`Ligne ${i + 2} : date illisible « ${r[map.date!] ?? ""} »`);
      return;
    }
    const get = (f: CostField) => (map[f] !== undefined ? (r[map[f]!] ?? "").trim() : "");
    const campaign = get("campaign");
    if (!campaign && !get("adset") && !get("ad")) return; // ligne de total
    rows.push({
      date,
      campaign,
      adset: get("adset"),
      ad: get("ad"),
      spend: parseCsvNumber(get("spend")),
      impressions: Math.round(parseCsvNumber(get("impressions"))),
      clicks: Math.round(parseCsvNumber(get("clicks"))),
      currency: get("currency") || null,
    });
  });
  return { rows, errors };
}
