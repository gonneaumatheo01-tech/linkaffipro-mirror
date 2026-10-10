import Link from "next/link";

/** Onglets du Journal : actions de l'équipe (AuditLog) ou événements des bots et des membres (Event). */
export function ViewTabs({ view }: { view: "actions" | "events" }) {
  const tabs = [
    { key: "actions", label: "Actions de l'équipe", href: "/journal" },
    { key: "events", label: "Événements", href: "/journal/events" },
  ] as const;
  return (
    <nav aria-label="Vues du journal" className="mb-4 flex flex-wrap items-center gap-2 border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === view ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.key === view ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
