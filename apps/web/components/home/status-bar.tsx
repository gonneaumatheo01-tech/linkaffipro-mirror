import Link from "next/link";
import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { statusParts, type StatusBar as StatusBarData } from "@/lib/home/status";

/**
 * Barre d'état en haut de l'accueil : verte « Tout va bien · 3 bots en ligne · Link Affi synchronisé il y a 2 min »,
 * orange « N points à voir » avec la liste des points sinon, et un lien vers Réglages → État du système (ADMIN).
 */
export function StatusBar({
  bar,
  now,
  isAdmin,
}: {
  bar: StatusBarData;
  now: Date;
  isAdmin: boolean;
}) {
  const [head, bots, sync] = statusParts(bar, now);
  const Icon = bar.ok ? CircleCheck : TriangleAlert;
  return (
    <section
      aria-label="État du site"
      data-state={bar.ok ? "ok" : "warning"}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3",
        bar.ok ? "border-success/25 bg-success-soft" : "border-warning/30 bg-warning-soft",
      )}
    >
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
        <Icon
          aria-hidden
          className={cn("mt-0.5 size-5 shrink-0", bar.ok ? "text-success" : "text-warning")}
        />
        <div className="min-w-0">
          <p className="text-body text-foreground">
            <strong className={cn("font-semibold", bar.ok ? "text-success" : "text-warning")}>
              {head}
            </strong>
            <span aria-hidden className="text-muted-foreground">
              {" "}
              ·{" "}
            </span>
            <span className="sr-only">, </span>
            {bots}
            <span aria-hidden className="text-muted-foreground">
              {" "}
              ·{" "}
            </span>
            <span className="sr-only">, </span>
            {sync}
          </p>
          {bar.issues.length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-note text-foreground">
              {bar.issues.map((i) => (
                <li key={i.key} className="flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                  {i.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {isAdmin ? (
        <Link
          href="/settings/status"
          className="ml-8 inline-flex min-h-8 items-center gap-1 rounded-md text-note font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:min-h-10 sm:ml-auto"
        >
          Voir l&apos;état du système
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : null}
    </section>
  );
}
