/**
 * Phase 35 : cote affichée par un site → cote décimale EXACTE (règle 4 : aucune cote inventée, interpolée ou
 * rapprochée). Format donné par la recette (`mapping.oddsFormat`) : décimal (« 2,10 », « 2.1 », 2.1), fractionnaire
 * (« 11/10 » → 2,1 ; « EVS » / « evens » → 2), américain (« +110 » → 2,1 ; « -125 » → 1,8). Arrondi à 4 décimales
 * seulement pour effacer le bruit des nombres à virgule (5/6 → 1,8333) : deux lectures d'une même cote donnent
 * toujours le même nombre. Illisible, hors bornes (≤ 1 ou > 1000) ou suspendue (« - », « SUSP ») : null.
 */
export type OddsFormat = "decimal" | "fractional" | "american";

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
const ok = (v: number): number | null => (Number.isFinite(v) && v > 1 && v <= 1000 ? round4(v) : null);

function numberOf(raw: string): number | null {
  const t = raw.replace(/\s+/g, "").replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Une cote lue (texte ou nombre) dans le format du site → décimale ; null si illisible. Pur. */
export function toDecimalOdds(raw: unknown, format: OddsFormat): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (format === "american") return americanOf(raw);
    return format === "decimal" ? ok(raw) : null;
  }
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (format === "fractional") {
    if (/^(evs|evens|even|ev)$/i.test(t)) return 2;
    const m = /^(\d{1,4})\s*\/\s*(\d{1,4})$/.exec(t);
    if (!m || Number(m[2]) === 0) return null;
    return ok(1 + Number(m[1]) / Number(m[2]));
  }
  if (format === "american") {
    const n = numberOf(t);
    return n === null ? null : americanOf(n);
  }
  const n = numberOf(t);
  return n === null ? null : ok(n);
}

function americanOf(n: number): number | null {
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return ok(n > 0 ? 1 + n / 100 : 1 + 100 / -n);
}

/** Deux cotes identiques (tolérance 0, après l'arrondi de lecture). */
export function sameOddsExact(a: number, b: number): boolean {
  return round4(a) === round4(b);
}

/** Lignes identiques (null = sans ligne). */
export function sameLine(a: number | null | undefined, b: number | null | undefined): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null || y === null) return x === y;
  return Math.abs(x - y) < 1e-9;
}
