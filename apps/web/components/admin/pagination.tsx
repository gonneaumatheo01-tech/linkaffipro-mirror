import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
 * Page en cours en orange (`aria-current="page"`) ; cibles de 32 px, 40 px sur téléphone.
 * Sur téléphone, une seule ligne : flèches (leur texte reste lu par les lecteurs d'écran) et « Page 2 sur 8 ».
 */
export function Pagination({
  page,
  pages,
  total,
  hrefFor,
  noun = "élément",
}: {
  page: number;
  pages: number;
  total?: number;
  hrefFor: (page: number) => string;
  noun?: string;
}) {
  const totalLabel = total !== undefined ? `${fmtNum(total)} ${noun}${total > 1 ? "s" : ""}` : null;
  if (pages <= 1)
    return totalLabel ? (
      <p className="mt-3 text-note text-muted-foreground">{totalLabel} · page 1 / 1</p>
    ) : null;
  const numbers = pageWindow(page, pages);
  const base =
    "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md border px-2.5 text-body tabular-nums max-md:size-10 max-md:px-0";
  const linkCls = `${base} border-border bg-surface text-foreground hover:bg-muted`;
  const currentCls = `${base} border-brand bg-brand font-semibold text-brand-foreground`;
  const disabledCls = `${base} border-border text-muted-foreground opacity-60`;
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <span className="text-note text-muted-foreground">
        {totalLabel}
        <span className="max-md:hidden">
          {totalLabel ? " · " : ""}page {page} / {pages}
        </span>
      </span>
      <div className="flex flex-nowrap items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={linkCls} rel="prev">
            <ChevronLeft aria-hidden className="size-4" />
            <span className="max-md:sr-only">Précédent</span>
          </Link>
        ) : (
          <span className={disabledCls} aria-disabled="true">
            <ChevronLeft aria-hidden className="size-4" />
            <span className="max-md:sr-only">Précédent</span>
          </span>
        )}
        {numbers.map((n, i) => (
          <span key={n} className="flex items-center gap-1 max-md:hidden">
            {i > 0 && numbers[i - 1]! < n - 1 ? (
              <span aria-hidden className="px-1 text-muted-foreground">
                …
              </span>
            ) : null}
            {n === page ? (
              <span className={currentCls} aria-current="page">
                <span className="sr-only">Page </span>
                {n}
              </span>
            ) : (
              <Link href={hrefFor(n)} className={linkCls} aria-label={`Page ${n}`}>
                {n}
              </Link>
            )}
          </span>
        ))}
        <span aria-current="page" className="px-2 text-body whitespace-nowrap tabular-nums md:hidden">
          Page {page} sur {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={linkCls} rel="next">
            <span className="max-md:sr-only">Suivant</span>
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : (
          <span className={disabledCls} aria-disabled="true">
            <span className="max-md:sr-only">Suivant</span>
            <ChevronRight aria-hidden className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
