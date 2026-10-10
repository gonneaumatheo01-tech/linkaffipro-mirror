import Link from "next/link";
import { CalendarDays, LayoutGrid, List } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type MessagesView = "calendar" | "list" | "templates";

const TABS: Array<{ view: MessagesView; label: string; icon: React.ReactNode }> = [
  { view: "calendar", label: "Calendrier", icon: <CalendarDays aria-hidden /> },
  { view: "list", label: "Liste", icon: <List aria-hidden /> },
  { view: "templates", label: "Modèles", icon: <LayoutGrid aria-hidden /> },
];

/**
 * Choix de la vue (Calendrier, Liste, Modèles) en commutateur sobre : la vue choisie est blanche sur fond gris
 * (pas d'orange : le seul bouton orange de la page reste « Programmer un message »).
 */
export function ViewTabs({
  current,
  hrefs,
}: {
  current: MessagesView;
  hrefs: Record<MessagesView, string>;
}) {
  return (
    <nav aria-label="Vue des messages" className="w-full sm:w-auto">
      <ul className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 sm:inline-grid">
        {TABS.map((t) => {
          const active = t.view === current;
          return (
            <li key={t.view}>
              <Link
                href={hrefs[t.view]}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md px-3 text-body font-medium whitespace-nowrap transition-colors max-md:h-10 [&_svg]:size-4",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "bg-surface text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-surface/60 hover:text-foreground",
                )}
              >
                {t.icon}
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
