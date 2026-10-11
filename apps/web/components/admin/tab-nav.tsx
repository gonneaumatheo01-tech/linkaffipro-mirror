import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { ScrollFade } from "./scroll-fade";
import { ScrollToCurrent } from "./scroll-to-current";
import {
  tabCount,
  tabItemClass,
  tabLinkClass,
  tabListClass,
  tabNavBorderClass,
  tabShortLabel,
  type TabNavColumns,
  type TabNavItem,
  type TabNavPhoneLayout,
} from "./tab-nav-logic";

export type { TabNavColumns, TabNavItem, TabNavPhoneLayout } from "./tab-nav-logic";

/**
 * Barre d'onglets partagée (liens : chaque onglet a son adresse), sous le `PageHeader` ou juste avant lui.
 * Onglet ouvert marqué `aria-current="page"` et souligné d'orange ; ordinateur : onglets soulignés, la rangée défile
 * si la fenêtre est étroite. Téléphone (`phone`) : `scroll` (une rangée qui défile) ou `grid` (boutons de 44 px sur
 * `columns` colonnes, tous visibles). Quand la rangée défile, un dégradé sur le bord montre qu'il reste des onglets
 * (`ScrollFade`) et l'onglet ouvert est ramené au centre (`ScrollToCurrent`). Jamais de bouton orange.
 * Composant serveur (utilisable aussi depuis un composant client) ; règles dans `tab-nav-logic.ts`.
 */
export function TabNav({
  label,
  items,
  current,
  phone = "scroll",
  columns = 2,
  className,
}: {
  /** Nom de la navigation pour les lecteurs d'écran (« Onglets de la campagne »). */
  label: string;
  items: readonly TabNavItem[];
  /** Clé de l'onglet ouvert. */
  current: string;
  /** Présentation sur téléphone : rangée qui défile (par défaut) ou grille de boutons. */
  phone?: TabNavPhoneLayout;
  /** Colonnes de la grille du téléphone. */
  columns?: TabNavColumns;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("mb-6", tabNavBorderClass(phone), className)}>
      <ScrollFade>
        <ScrollToCurrent currentKey={current} className={tabListClass(phone, columns)}>
          {items.map((t) => {
            const active = t.key === current;
            const short = tabShortLabel(t);
            const count = tabCount(t);
            return (
              <li key={t.key} className={tabItemClass(phone)}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={t.ariaLabel}
                  className={tabLinkClass(phone, active)}
                >
                  {short ? (
                    <>
                      <span className="min-w-0 md:hidden">{short}</span>
                      <span className="max-md:hidden">{t.label}</span>
                    </>
                  ) : (
                    t.label
                  )}
                  {count !== null ? (
                    <span
                      aria-hidden
                      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-warning-soft px-1.5 text-note font-semibold text-warning tabular-nums"
                    >
                      {fmtNum(count)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ScrollToCurrent>
      </ScrollFade>
    </nav>
  );
}
