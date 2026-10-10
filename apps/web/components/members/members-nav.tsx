import Link from "next/link";
import { cn } from "@/components/ui/cn";

export type MembersSection = "list" | "broadcasts" | "automations";

/** Les trois rubriques de Membres. */
export const MEMBERS_SECTIONS: Array<{ key: MembersSection; href: string; label: string }> = [
  { key: "list", href: "/members", label: "Liste des membres" },
  { key: "broadcasts", href: "/members/broadcasts", label: "Écrire à un groupe" },
  { key: "automations", href: "/members/automations", label: "Relances automatiques" },
];

/**
 * Sous-navigation de la rubrique Membres, en haut des trois pages : Liste, Écrire à un groupe, Relances automatiques.
 * Ordinateur : onglets soulignés (rubrique ouverte soulignée d'orange) ; téléphone : trois boutons d'au moins 44 px
 * côte à côte, libellé complet sur deux lignes, sans défilement. Pas de bouton orange : le seul de la page reste celui
 * du `PageHeader`. À placer avant le `PageHeader` : `<MembersNav current="broadcasts" />`.
 */
export function MembersNav({
  current,
  className,
}: {
  current: MembersSection;
  className?: string;
}) {
  return (
    <nav
      aria-label="Rubriques Membres"
      className={cn("mb-6 md:border-b md:border-border", className)}
    >
      <ul className="grid grid-cols-3 gap-2 md:-mb-px md:flex md:gap-1">
        {MEMBERS_SECTIONS.map((s) => {
          const active = s.key === current;
          return (
            <li key={s.key} className="min-w-0">
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex w-full items-center justify-center text-center text-body leading-tight transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  // Téléphone : bouton bordé, deux lignes au besoin ; ordinateur : onglet souligné, une ligne.
                  "min-h-11 rounded-lg border px-2 py-1 md:h-10 md:min-h-0 md:w-auto md:rounded-none md:border-x-0 md:border-t-0 md:border-b-2 md:px-3 md:py-0 md:whitespace-nowrap",
                  active
                    ? "border-brand bg-brand-soft font-semibold text-foreground md:bg-transparent"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground md:border-transparent md:bg-transparent md:hover:border-border",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
