"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { BrandLogo } from "./brand-logo";
import { NAV_ICONS } from "./nav-icons";
import { NAV, activeHref, navSections, type NavItem } from "./nav-logic";

// Compatibilité : ces éléments vivaient ici avant d'avoir leur propre fichier.
export { BrandLogo } from "./brand-logo";
export { NAV_ICONS } from "./nav-icons";
export { NAV, type NavItem } from "./nav-logic";

/** Tablette (768 à 1023 px) : la barre de menu est réduite à un rail d'icônes (mêmes seuils que md: et lg:). */
const RAIL_QUERY = "(width >= 48rem) and (width < 64rem)";

function subscribeRail(onChange: () => void) {
  const query = window.matchMedia(RAIL_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Le rail d'icônes est-il affiché ? (sert seulement à l'infobulle de survol ; `false` au rendu serveur). */
function useRail(): boolean {
  return useSyncExternalStore(
    subscribeRail,
    () => window.matchMedia(RAIL_QUERY).matches,
    () => false,
  );
}

function SidebarLink({ item, active, rail }: { item: NavItem; active: boolean; rail: boolean }) {
  const Icon = NAV_ICONS[item.icon];
  const name = item.soon ? `${item.label} (bientôt)` : item.label;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={name}
      title={rail ? name : undefined}
      className={cn(
        "relative flex h-10 items-center justify-center rounded-lg text-body transition-colors lg:h-9 lg:justify-start lg:gap-3 lg:px-3",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
        active
          ? "bg-night-hover font-medium text-night-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
          : "text-night-muted hover:bg-night-hover hover:text-night-foreground",
      )}
    >
      <Icon aria-hidden className={cn("size-5 lg:size-4", active ? "text-brand" : undefined)} />
      <span aria-hidden className="hidden flex-1 truncate lg:block">
        {item.label}
      </span>
      {item.soon ? (
        <span
          aria-hidden
          className="hidden rounded-full border border-sidebar-border px-1.5 text-note text-night-muted lg:inline"
        >
          bientôt
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Barre de menu : fond nuit, logo en haut, entrées principales, puis Réglages et Aide en bas, séparés.
 * Entrée active : texte blanc, fond nuit éclairci, trait orange à gauche. Reste visible pendant le défilement
 * (collée en haut, hauteur de l'écran).
 * - ordinateur (à partir de 1024 px) : barre complète de 240 px, icône et libellé ;
 * - tablette (768 à 1023 px) : rail de 64 px, icônes seules (nom lu par les lecteurs d'écran, infobulle au survol) ;
 * - téléphone : cachée, remplacée par `BottomNav`.
 * La zone sûre de gauche (encoche d'un iPhone en paysage) s'ajoute à la largeur.
 */
export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const rail = useRail();
  const { main, bottom } = navSections(NAV, isAdmin);
  const current = activeHref(pathname, [...main, ...bottom]);
  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col bg-night pl-[env(safe-area-inset-left)] text-night-muted md:flex md:w-[calc(4rem+env(safe-area-inset-left))] lg:w-[calc(15rem+env(safe-area-inset-left))]">
      <Link
        href="/"
        aria-label="LinkAffi Pro, accueil"
        title={rail ? "LinkAffi Pro, accueil" : undefined}
        className="flex h-14 shrink-0 items-center justify-center gap-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand lg:justify-start lg:px-5"
      >
        <BrandLogo size={32} />
        <span
          aria-hidden
          className="hidden text-body font-semibold tracking-tight text-night-foreground lg:inline"
        >
          LinkAffi Pro
        </span>
      </Link>
      <nav
        aria-label="Menu principal"
        className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3"
      >
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {main.map((item) => (
            <li key={item.href}>
              <SidebarLink item={item} active={current === item.href} rail={rail} />
            </li>
          ))}
        </ul>
        {bottom.length > 0 ? (
          <ul className="mt-3 space-y-0.5 border-t border-sidebar-border pt-3">
            {bottom.map((item) => (
              <li key={item.href}>
                <SidebarLink item={item} active={current === item.href} rail={rail} />
              </li>
            ))}
          </ul>
        ) : null}
      </nav>
      <p className="hidden shrink-0 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-note text-night-muted lg:block">
        Heure affichée : heure de Paris
      </p>
    </aside>
  );
}
