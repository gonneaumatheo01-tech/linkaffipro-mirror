import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { groupTabs, SETTINGS_GROUPS, type SettingsGroupKey } from "./group-nav-logic";

/**
 * Onglets d'un regroupement de Réglages (« Catégories et étiquettes », « Alertes et rapports ») : un lien vers
 * chaque page du groupe, la page ouverte soulignée d'orange (comme le Journal). À placer sous le `PageHeader`.
 * Téléphone : deux onglets côte à côte, libellé sur deux lignes au besoin (cibles d'au moins 44 px).
 */
export function SettingsGroupNav({
  group,
  current,
  className,
}: {
  group: SettingsGroupKey;
  current: string;
  className?: string;
}) {
  const tabs = groupTabs(group, current);
  return (
    <nav
      aria-label={SETTINGS_GROUPS[group].label}
      className={cn("mb-6 border-b border-border", className)}
    >
      <ul className="-mb-px grid grid-cols-2 gap-x-2 md:flex md:flex-wrap">
        {tabs.map((t) => (
          <li key={t.key} className="min-w-0">
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 w-full items-center justify-center border-b-2 px-3 py-1 text-center text-body leading-tight md:min-h-10 md:w-auto md:whitespace-nowrap",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                t.active
                  ? "border-brand font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
