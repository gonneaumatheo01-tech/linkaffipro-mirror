/**
 * Règles pures du DataTable (tri, accessibilité, nombre de colonnes), sans React : testées à part.
 */

/** Une page montre au plus 5 colonnes ; le reste va dans le volet de détail. */
export const MAX_COLUMNS = 5;

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection } | null;
export type SortValue = string | number | bigint | boolean | Date | null | undefined;

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

function isEmpty(v: SortValue): boolean {
  return (
    v === null ||
    v === undefined ||
    v === "" ||
    (typeof v === "number" && Number.isNaN(v)) ||
    (v instanceof Date && Number.isNaN(v.getTime()))
  );
}

function rank(v: Exclude<SortValue, null | undefined>): number {
  if (typeof v === "number" || typeof v === "bigint") return 0;
  if (v instanceof Date) return 1;
  if (typeof v === "boolean") return 2;
  return 3;
}

/** Compare deux valeurs non vides : nombres, dates, booléens, textes (ordre français, naturel, sans accents). */
export function compareSortValues(
  a: Exclude<SortValue, null | undefined>,
  b: Exclude<SortValue, null | undefined>,
): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const x = a as number | bigint;
    const y = b as number | bigint;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (ra === 1) return (a as Date).getTime() - (b as Date).getTime();
  if (ra === 2) return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * Trie une copie des lignes. Tri stable (les égalités gardent l'ordre d'origine) ;
 * les valeurs vides (null, undefined, "", NaN) restent à la fin dans les deux sens.
 */
export function sortRows<T>(
  rows: readonly T[],
  getValue: (row: T) => SortValue,
  direction: SortDirection,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: getValue(row) }))
    .sort((p, q) => {
      const pe = isEmpty(p.value);
      const qe = isEmpty(q.value);
      if (pe || qe) return pe === qe ? p.index - q.index : pe ? 1 : -1;
      const c = compareSortValues(
        p.value as Exclude<SortValue, null | undefined>,
        q.value as Exclude<SortValue, null | undefined>,
      );
      return c !== 0 ? sign * c : p.index - q.index;
    })
    .map((x) => x.row);
}

/** Premier sens de tri d'une colonne : chiffres (alignés à droite) du plus grand au plus petit. */
export function firstDirection(col: {
  align?: "left" | "right";
  sortFirst?: SortDirection;
}): SortDirection {
  return col.sortFirst ?? (col.align === "right" ? "desc" : "asc");
}

/** Clic sur un en-tête : premier sens → sens inverse → ordre d'origine. */
export function nextSort(current: SortState, key: string, first: SortDirection = "asc"): SortState {
  if (!current || current.key !== key) return { key, direction: first };
  if (current.direction === first) return { key, direction: first === "asc" ? "desc" : "asc" };
  return null;
}

/** Valeur de l'attribut `aria-sort` d'un en-tête. */
export function ariaSort(state: SortState, key: string): "ascending" | "descending" | "none" {
  if (!state || state.key !== key) return "none";
  return state.direction === "asc" ? "ascending" : "descending";
}

/** Cellule « valeur absente » (« — » de `fmtMoney`, `fmtPct`, `fmtDate`…) : triée avec les vides, à la fin. */
const PLACEHOLDER = /^[\s\u00a0\u202f]*[—–-]?[\s\u00a0\u202f]*$/;

/** Espaces des nombres français : espace, insécable (avant « € »), fine insécable (milliers). */
const SP = "[\\s\\u00a0\\u202f]";
const FORMATTED_NUMBER = new RegExp(
  `^${SP}*([+\\-−])?${SP}*(\\d{1,3}(?:${SP}\\d{3})+|\\d+)(?:[.,](\\d+))?${SP}*(%|€|\\$US|US\\$|\\$|£|[A-Z]{3})?${SP}*$`,
  "u",
);

/**
 * Nombre affiché à la française (`fmtNum`, `fmtMoney`, `fmtPct`) : « 12 345 », « 1 234,50 € », « −15,3 % »,
 * « +12 % », « 1 234,50 $US ». Renvoie null pour tout autre texte (« Canal 2 », « 12 / 40 », « 3 j »).
 */
export function parseFormattedNumber(text: string): number | null {
  const m = FORMATTED_NUMBER.exec(text);
  if (!m) return null;
  const [, sign, int, dec] = m;
  const n = Number(`${int!.replace(/\D/g, "")}${dec ? `.${dec}` : ""}`);
  if (!Number.isFinite(n)) return null;
  return sign === "-" || sign === "−" ? -n : n;
}

const FR_DATE = /^(\d{2})\/(\d{2})\/(\d{4})(?:[\s\u00a0\u202f,]+(\d{2}):(\d{2}))?$/;

/** Date affichée par `fmtDate` (« 09/10/2026 14:05 » ou « 09/10/2026 ») ; null si ce n'en est pas une. */
export function parseFormattedDate(text: string): Date | null {
  const m = FR_DATE.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y, h = "0", mi = "0"] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
  // Refuse les dates impossibles (31/02) au lieu de les décaler au mois suivant.
  if (date.getUTCDate() !== Number(d) || date.getUTCMonth() !== Number(mo) - 1) return null;
  return date;
}

/**
 * Valeur de tri par défaut d'une cellule : nombre, date ou booléen tels quels ; un texte au format français
 * (« 1 234 € », « 15,3 % », « 09/10/2026 14:05 ») est relu comme nombre ou date ; « — » compte comme vide ;
 * un nœud React n'a pas de valeur (passez `sortValues`).
 */
export function cellSortValue(cell: unknown): SortValue {
  if (typeof cell === "string") {
    if (PLACEHOLDER.test(cell)) return null;
    return parseFormattedNumber(cell) ?? parseFormattedDate(cell) ?? cell;
  }
  if (
    typeof cell === "number" ||
    typeof cell === "bigint" ||
    typeof cell === "boolean" ||
    cell instanceof Date
  )
    return cell;
  return null;
}

/**
 * Avertissement (développement) : une colonne de chiffres (alignée à droite) dont une cellule n'est ni un nombre,
 * ni un nombre formaté, ni « — » ne se trie pas comme on l'attend (texte « 12 / 40 » ou nœud React).
 */
export function numericColumnWarning(header: string, cells: readonly unknown[]): string | null {
  for (const cell of cells) {
    if (cell === null || cell === undefined || cell === false) continue;
    const v = cellSortValue(cell);
    if (typeof v === "string" || (v === null && typeof cell === "object")) {
      const sample = typeof cell === "string" ? ` (« ${cell} »)` : "";
      return `DataTable : la colonne de chiffres « ${header} » contient une cellule qui ne se trie pas comme un nombre${sample}. Passez sortValues pour cette colonne.`;
    }
  }
  return null;
}

/** Message d'avertissement (développement) quand un tableau dépasse 5 colonnes. */
export function columnCountWarning(count: number): string | null {
  if (count <= MAX_COLUMNS) return null;
  return `DataTable : ${count} colonnes (maximum ${MAX_COLUMNS}). Rangez les autres dans le volet de détail (renderDetail / detail).`;
}
