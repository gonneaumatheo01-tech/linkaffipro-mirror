/**
 * Chiffres d'une offre (règle pure, phase 22) : un post qui parle d'un montant, d'un pourcentage, d'un multiplicateur,
 * d'un nombre de tours gratuits ou d'une durée ne peut citer qu'un chiffre écrit dans la fiche de l'offre AVEC la même
 * unité (« 100 % » dans la fiche ne permet pas « 100 spins », « 7 jours » ne permet pas « 7 € »). Sans fiche, aucun
 * chiffre de ce genre n'est permis. Même principe que l'assistante de conversation : la fiche est la seule source.
 */
import { stripHtml } from "@linkaffipro/core";

/** Unités reconnues → unité normalisée (comparaison des couples nombre + unité). */
const UNIT_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ["%", String.raw`%|pour ?cent\b|percent\b|por ?ciento\b|por ?cento\b|prozent\b|per ?cento\b`],
  ["brl", String.raw`r\$|reais\b|real\b|brl\b`],
  ["eur", String.raw`€|eur\b|euros?\b`],
  ["usd", String.raw`\$|usd\b|dollars?\b|d[oó]lares\b`],
  ["gbp", String.raw`£|gbp\b|livres?\b|pounds?\b`],
  [
    "spins",
    String.raw`tours? gratuits?\b|free ?spins?\b|freespins?\b|spins?\b|tours?\b|fs\b|giros?(?: gr[aá]tis)?\b|rodadas?(?: gr[aá]tis)?\b|freispiele?\b|giri(?: gratis)?\b`,
  ],
  ["days", String.raw`jours?\b|days?\b|d[ií]as?\b|tage?n?\b|giorni\b`],
  ["x", String.raw`x(?![\p{L}\p{N}])|×|fois\b|times\b|veces\b|vezes\b|mal\b|volte\b`],
  ["cashback", String.raw`cashback\b`],
];
const UNIT_AFTER = UNIT_GROUPS.map(([, re]) => `(?:${re})`).join("|");
/** Nombre : « 1 000 », « 1.000 », « 1,000 » (virgule + 3 chiffres = milliers), « 50,5 », « 1,000.50 ». */
const NUM = String.raw`\d{1,3}(?:[ \u00a0.,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d+)?`;
const FIGURE_RE = new RegExp(
  [
    // Symbole avant le nombre : « €500 », « $1,000 », « R$ 500 ».
    String.raw`(?<before>r\$|[€$£])\s?(?<nb>${NUM})`,
    // Multiplicateur avant : « x2 », « ×100 ».
    String.raw`(?<![\p{L}\p{N}])[x×]\s?(?<nx>\d+(?:[.,]\d+)?)(?![\p{N}])`,
    // Nombre puis unité : « 200 € », « 50 FS », « 7 jours », « 35x ».
    String.raw`(?<![\p{N}.,])(?<na>${NUM})\s?(?<after>${UNIT_AFTER})`,
  ].join("|"),
  "giu",
);
const UNIT_TESTS = UNIT_GROUPS.map(([unit, re]) => [unit, new RegExp(`^(?:${re})`, "iu")] as const);

function unitOf(raw: string): string {
  const u = raw.toLowerCase();
  return UNIT_TESTS.find(([, re]) => re.test(u))?.[0] ?? u;
}

/** Nombre normalisé : séparateurs de milliers retirés, virgule décimale → point, « 200,00 » → « 200 ». */
export function normalizeNumber(n: string): string {
  const t = n.replace(/[\s\u00a0]/g, "");
  let v: string;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(t)) v = t.replace(/[.,]/g, "");
  else if (/^\d{1,3}(?:[.,]\d{3})+[.,]\d{1,2}$/.test(t))
    v = `${t.slice(0, -3).replace(/[.,]/g, "")}${t.slice(-3).replace(",", ".")}`;
  else v = t.replace(",", ".");
  const num = Number(v);
  return Number.isFinite(num) ? String(num) : v;
}

export type OfferFigure = { value: string; unit: string };

/** Couples (nombre, unité) d'offre cités par un texte, sans doublon. */
export function offerFigureCouples(textOrHtml: string): OfferFigure[] {
  const text = stripHtml(textOrHtml).toLowerCase();
  const out: OfferFigure[] = [];
  for (const m of text.matchAll(FIGURE_RE)) {
    const g = m.groups ?? {};
    const raw = g.nb ?? g.nx ?? g.na;
    if (!raw) continue;
    const unit = g.before ? unitOf(g.before) : g.nx ? "x" : unitOf(g.after ?? "");
    const value = normalizeNumber(raw);
    if (!out.some((f) => f.value === value && f.unit === unit)) out.push({ value, unit });
  }
  return out;
}

/** Chiffres d'offre cités par le texte (normalisés, sans doublon). */
export function offerFiguresIn(html: string): string[] {
  return [...new Set(offerFigureCouples(html).map((f) => f.value))];
}

/**
 * Chiffres cités par le texte qui n'apparaissent pas dans la fiche de l'offre avec la même unité (`facts` null = pas
 * de fiche). Rend les nombres normalisés, sans doublon.
 */
export function inventedFigures(html: string, facts: string | null | undefined): string[] {
  const allowed = new Set(offerFigureCouples(facts ?? "").map((f) => `${f.value}|${f.unit}`));
  const out: string[] = [];
  for (const f of offerFigureCouples(html))
    if (!allowed.has(`${f.value}|${f.unit}`) && !out.includes(f.value)) out.push(f.value);
  return out;
}
