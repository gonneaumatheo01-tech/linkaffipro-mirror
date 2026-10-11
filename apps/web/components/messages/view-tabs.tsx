import Link from "next/link";
import { CalendarDays, LayoutGrid, List, Sticker } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type MessagesView = "calendar" | "list" | "templates";
/** Onglet de la barre : une vue de la page Messages, ou la bibliothèque des emojis animés. */
export type MessagesTab = MessagesView | "emojis";

/** Adresse de la bibliothèque des emojis animés (phase 12), quatrième vue des Messages. */
export const EMOJIS_VIEW_HREF = "/messages/emojis";

const TABS: Array<{ view: MessagesTab; label: string; icon: React.ReactNode }> = [
  { view: "calendar", label: "Calendrier", icon: <CalendarDays aria-hidden /> },
  { view: "list", label: "Liste", icon: <List aria-hidden /> },
  { view: "templates", label: "Modèles", icon: <LayoutGrid aria-hidden /> },
  { view: "emojis", label: "Emojis animés", icon: <Sticker aria-hidden /> },
];

/**
 * Choix de la vue (Calendrier, Liste, Modèles, Emojis animés) en commutateur sobre : la vue choisie est blanche sur
 * fond gris (pas d'orange : le seul bouton orange de la page reste celui de l'en-tête). Sur téléphone, deux par
 * ligne. « Emojis animés » mène à la bibliothèque de l'équipe (`/messages/emojis`) si `hrefs.emojis` n'est pas donné.
 */
export function ViewTabs({
  current,
  hrefs,
}: {
  current: MessagesTab;
  hrefs: Record<MessagesView, string> & { emojis?: string };
}) {
  const href = (v: MessagesTab) => (v === "emojis" ? (hrefs.emojis ?? EMOJIS_VIEW_HREF) : hrefs[v]);
  return (
    <nav aria-label="Vue des messages" className="w-full sm:w-auto">
      <ul className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:inline-grid sm:grid-cols-4">
        {TABS.map((t) => {
          const active = t.view === current;
          return (
            <li key={t.view}>
              <Link
                href={href(t.view)}
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
