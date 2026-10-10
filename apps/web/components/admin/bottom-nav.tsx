"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Ellipsis, XIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { NAV_ICONS } from "./nav-icons";
import { NAV, activeHref, mobileNav, type NavItem } from "./nav-logic";

/** Trait orange de l'onglet actif (en haut de l'onglet). */
const ACTIVE_TAB =
  "text-night-foreground before:absolute before:top-0 before:inset-x-4 before:h-[3px] before:rounded-b-full before:bg-brand";

const TAB =
  "relative flex h-14 w-full flex-col items-center justify-center gap-1 px-1 text-note transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand";

function MoreLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = NAV_ICONS[item.icon];
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-12 items-center gap-3 rounded-lg px-3 text-body transition-colors",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
        active
          ? "bg-night-hover font-medium text-night-foreground before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
          : "text-night-muted hover:bg-night-hover hover:text-night-foreground",
      )}
    >
      <Icon aria-hidden className={cn("size-5", active ? "text-brand" : undefined)} />
      <span className="flex-1">{item.label}</span>
    </Link>
  );
}

/**
 * Barre du bas sur téléphone (< 768 px) : Accueil, Messages, Membres, Campagnes, puis « Plus » qui ouvre un volet
 * avec toutes les autres rubriques (Réglages et Aide en dernier). Fond nuit comme la barre de menu de l'ordinateur,
 * onglet actif en blanc avec un trait orange. Respecte les zones sûres iOS (barre d'accueil en bas, encoche sur les côtés).
 * Le contenu de la page réserve la place de la barre (padding bas dans app/(admin)/layout.tsx).
 */
export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { primary, more } = mobileNav(NAV, isAdmin);
  const current = activeHref(pathname, [...primary, ...more]);
  const moreActive = more.some((i) => i.href === current);
  const moreMain = more.filter((i) => i.section === "main");
  const moreBottom = more.filter((i) => i.section === "bottom");
  const close = () => setOpen(false);

  // Fenêtre élargie au-delà du téléphone pendant que le volet est ouvert : on le ferme (la barre disparaît).
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 48rem)");
    const onChange = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open]);

  return (
    <nav
      aria-label="Menu principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-night pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:hidden"
    >
      <ul className="flex">
        {primary.map((item) => {
          const active = current === item.href;
          const Icon = NAV_ICONS[item.mobileIcon ?? item.icon];
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(TAB, active ? ACTIVE_TAB : "text-night-muted")}
              >
                <Icon aria-hidden className={cn("size-5", active ? "text-brand" : undefined)} />
                <span className={cn("max-w-full truncate", active ? "font-medium" : undefined)}>
                  {item.mobileLabel ?? item.label}
                </span>
              </Link>
            </li>
          );
        })}
        {more.length > 0 ? (
          <li className="min-w-0 flex-1">
            <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
              <DialogPrimitive.Trigger
                className={cn(TAB, moreActive || open ? ACTIVE_TAB : "text-night-muted")}
                aria-label="Plus de rubriques"
              >
                <Ellipsis
                  aria-hidden
                  className={cn("size-5", moreActive ? "text-brand" : undefined)}
                />
                <span className={moreActive ? "font-medium" : undefined}>Plus</span>
              </DialogPrimitive.Trigger>
              <DialogPrimitive.Portal>
                <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-night/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 md:hidden" />
                <DialogPrimitive.Popup
                  data-slot="bottom-nav-more"
                  className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-sidebar-border bg-night pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-night-muted outline-none transition-transform duration-200 ease-out data-ending-style:translate-y-full data-starting-style:translate-y-full md:hidden"
                >
                  <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
                    <DialogPrimitive.Title className="text-body font-semibold text-night-foreground">
                      Toutes les rubriques
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Close
                      aria-label="Fermer"
                      className="-mr-2 flex size-10 items-center justify-center rounded-lg text-night-muted hover:bg-night-hover hover:text-night-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                    >
                      <XIcon aria-hidden className="size-5" />
                    </DialogPrimitive.Close>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                    <ul className="space-y-0.5">
                      {moreMain.map((item) => (
                        <li key={item.href}>
                          <MoreLink item={item} active={current === item.href} onNavigate={close} />
                        </li>
                      ))}
                    </ul>
                    {moreBottom.length > 0 ? (
                      <ul
                        className={cn(
                          "space-y-0.5",
                          moreMain.length > 0
                            ? "mt-2 border-t border-sidebar-border pt-2"
                            : undefined,
                        )}
                      >
                        {moreBottom.map((item) => (
                          <li key={item.href}>
                            <MoreLink
                              item={item}
                              active={current === item.href}
                              onNavigate={close}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </DialogPrimitive.Popup>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
