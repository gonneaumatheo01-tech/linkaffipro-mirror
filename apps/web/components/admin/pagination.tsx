import Link from "next/link";
import { fmtNum } from "@/lib/format";

/** Taille de page commune à toutes les listes longues. */
export const PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined>;

/** Lit un numéro de page (entier ≥ 1) depuis les paramètres d'URL. */
export function pageOf(sp: SearchParams, key = "page"): number {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Nombre de pages pour un total donné (au moins 1). */
export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** Décalage SQL d'une page. */
export function pageSkip(page: number, size = PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * size;
}

/**
 * Lien vers une page en conservant tous les autres paramètres d'URL (filtres, onglet…).
 * La page 1 n'est pas écrite dans l'URL pour garder des liens propres.
 */
export function pageHref(pathname: string, sp: SearchParams, page: number, key = "page"): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) p.append(k, item);
  }
  if (page > 1) p.set(key, String(page));
  const s = p.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/** Numéros de page à afficher : première, dernière et deux de chaque côté de la page courante. */
export function pageWindow(page: number, pages: number): number[] {
  const set = new Set<number>([1, pages]);
  for (let i = page - 2; i <= page + 2; i++) if (i >= 1 && i <= pages) set.add(i);
  return [...set].sort((a, b) => a - b);
}

/**
 * Pagination simple (serveur) : « Précédent », quelques numéros, « Suivant ».
 * `hrefFor` construit le lien d'une page en conservant les filtres courants (voir `pageHref`).
 */
export function Pagination({ page, pages, total, hrefFor, noun = "élément" }: { page: number; pages: number; total?: number; hrefFor: (page: number) => string; noun?: string }) {
  const totalText = total !== undefined ? `${fmtNum(total)} ${noun}${total > 1 ? "s" : ""} · ` : "";
  if (pages <= 1) return total !== undefined ? <p className="mt-3 text-xs text-muted-foreground">{totalText}page 1 / 1</p> : null;
  const numbers = pageWindow(page, pages);
  const linkCls = "rounded-md border px-2 py-1 hover:bg-muted";
  const disabledCls = "rounded-md border px-2 py-1 text-muted-foreground/50";
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-xs text-muted-foreground">
        {totalText}page {page} / {pages}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {page > 1 ? <Link href={hrefFor(page - 1)} className={linkCls}>← Précédent</Link> : <span className={disabledCls}>← Précédent</span>}
        {numbers.map((n, i) => (
          <span key={n} className="flex items-center gap-1">
            {i > 0 && numbers[i - 1]! < n - 1 ? <span className="px-1 text-muted-foreground">…</span> : null}
            {n === page ? <span className="rounded-md bg-primary px-2 py-1 text-primary-foreground">{n}</span> : <Link href={hrefFor(n)} className={linkCls}>{n}</Link>}
          </span>
        ))}
        {page < pages ? <Link href={hrefFor(page + 1)} className={linkCls}>Suivant →</Link> : <span className={disabledCls}>Suivant →</span>}
      </div>
    </nav>
  );
}
