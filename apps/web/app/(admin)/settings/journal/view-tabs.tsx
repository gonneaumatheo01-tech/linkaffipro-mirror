import Link from "next/link";
import { cn } from "@/components/ui/cn";

/**
 * Onglets du Journal : actions de l'équipe (AuditLog) ou activité des bots et des membres (Event). Liens (chaque vue
 * a son adresse) ; l'onglet actif est souligné d'orange, comme le menu.
 */
export function ViewTabs({ view }: { view: "actions" | "events" }) {
  const tabs = [
    { key: "actions", label: "Actions de l'équipe", href: "/settings/journal" },
    { key: "events", label: "Bots et membres", href: "/settings/journal/events" },
  ] as const;
  return (
    <nav aria-label="Vues du journal" className="mb-6 border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-x-2">
        {tabs.map((t) => {
          const active = t.key === view;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center border-b-2 px-3 text-body focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-brand font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
