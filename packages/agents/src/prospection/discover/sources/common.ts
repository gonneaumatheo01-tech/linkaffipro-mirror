/**
 * Phase 31, chantier A (Sourceur) : types et outils communs des sources de découverte.
 */
import type { Candidate } from "../../contract";
import { ProspectFetchError } from "../polite";

/** Ce que rend une source avant le dédoublonnage. */
export type SourceFindResult = {
  candidates: Candidate[];
  errors: string[];
  /** La source (ou toutes ses sous-sources) est en pause : rien de plus n'a été lu. */
  paused: boolean;
  pausedUntil: Date | null;
  /** Résumé du passage pour le journal (`ProspectSourceRun.sourceDetail`). */
  detail: string | null;
};

export function emptyFind(detail: string | null = null): SourceFindResult {
  return { candidates: [], errors: [], paused: false, pausedUntil: null, detail };
}

/**
 * Nombre affiché par un annuaire : « 2 091 922 », « 12.3K », « 953K », « 1,2 M », « 12 345 subscribers », « 1,234,567 ».
 * Illisible → null.
 */
export function parseCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/\u00a0|\u202f/g, " ").trim();
  const m = s.match(/(\d[\d\s.,']*)\s*([kKmM]|тыс|млн)?(?![A-Za-zА-Яа-я])/);
  if (!m) return null;
  let num = m[1]!.trim().replace(/\s|'/g, "");
  const suffix = (m[2] ?? "").toLowerCase();
  const mult = suffix === "k" || suffix === "тыс" ? 1e3 : suffix === "m" || suffix === "млн" ? 1e6 : 1;
  if (mult > 1) num = num.replace(",", ".");
  else if (/^\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, "");
  else num = num.replace(",", ".");
  const n = Number(num);
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

/** Texte d'un fragment HTML (balises retirées, espaces resserrés). */
export function htmlText(fragment: string | null | undefined): string {
  return (fragment ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Message d'erreur court et sans contenu de page. */
export function errorText(err: unknown): string {
  if (err instanceof ProspectFetchError) return err.message;
  return String((err as Error)?.message ?? err).slice(0, 160);
}

/** Langues prises à leur tour dans une liste selon le jour (rotation des gabarits). */
export function rotate<T>(list: readonly T[], offset: number, count: number): T[] {
  if (!list.length) return [];
  const out: T[] = [];
  for (let i = 0; i < Math.min(count, list.length); i++) out.push(list[(offset + i) % list.length]!);
  return out;
}

/** Jour depuis l'époque (rotation stable sur une journée). */
export function dayNumber(at: Date): number {
  return Math.floor(at.getTime() / 86_400_000);
}
