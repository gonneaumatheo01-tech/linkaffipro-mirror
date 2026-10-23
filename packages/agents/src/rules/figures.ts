/**
 * Chiffres d'une offre (règle pure, phase 22) : un post qui parle d'un montant, d'un pourcentage, d'un multiplicateur
 * ou d'un nombre de tours gratuits ne peut citer qu'un chiffre écrit dans la fiche de l'offre. Sans fiche, aucun
 * chiffre de ce genre n'est permis. Même principe que l'assistante de conversation : la fiche est la seule source.
 */
import { stripHtml } from "@linkaffipro/core";

const UNIT = String.raw`(?:%|€|\$|£|eur\b|euros?\b|usd\b|x\b|fois\b|tours?\b|free ?spins?\b|spins?\b|freespins?\b|tours? gratuits?\b|cashback\b)`;
// Nombre (« 1 000 », « 1.000 », « 50,5 ») suivi d'une unité, ou multiplicateur « x2 » / « ×100 ».
const FIGURE_RE = new RegExp(String.raw`(?:[x×]\s?(\d+(?:[.,]\d+)?)\b)|(?:(\d{1,3}(?:[ \u00a0.]\d{3})+|\d+(?:[.,]\d+)?)\s?${UNIT})`, "giu");
const NUMBER_RE = /\d{1,3}(?:[ \u00a0.]\d{3})+|\d+(?:[.,]\d+)?/g;

function norm(n: string): string {
  const t = n.replace(/[\s\u00a0]/g, "");
  // « 1.000 » (milliers) → « 1000 » ; « 50,5 » → « 50.5 ».
  const thousands = /^\d{1,3}(?:\.\d{3})+$/.test(t);
  return (thousands ? t.replace(/\./g, "") : t.replace(",", ".")).replace(/^0+(?=\d)/, "");
}

/** Chiffres d'offre cités par le texte (normalisés, sans doublon). */
export function offerFiguresIn(html: string): string[] {
  const text = stripHtml(html).toLowerCase();
  const out: string[] = [];
  for (const m of text.matchAll(FIGURE_RE)) {
    const n = norm(m[1] ?? m[2] ?? "");
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Chiffres cités par le texte qui n'apparaissent pas dans la fiche de l'offre (`facts` null = pas de fiche). */
export function inventedFigures(html: string, facts: string | null | undefined): string[] {
  const allowed = new Set([...(facts ?? "").matchAll(NUMBER_RE)].map((m) => norm(m[0])));
  return offerFiguresIn(html).filter((n) => !allowed.has(n));
}
