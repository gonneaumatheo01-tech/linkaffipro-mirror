import Link from "next/link";
import {
  ChevronRight,
  Clapperboard,
  Database,
  Megaphone,
  Send,
  type LucideIcon,
} from "lucide-react";
import { StatusPill } from "@/components/admin/status-pill";
import { cn } from "@/components/ui/cn";
import type { CardState } from "@/lib/status/settings-cards";

const ICONS = {
  linkaffi: Database,
  meta: Megaphone,
  tiktok: Clapperboard,
  telegram: Send,
} as const;

export type ConnectionTile = {
  key: keyof typeof ICONS;
  href: string;
  label: string;
  /** Une phrase : ce que la connexion apporte. */
  description: string;
  state?: CardState;
};

/**
 * Tuiles des quatre connexions (Réglages → Connexions) : icône, nom, une phrase, pastille d'état ; toute la tuile est
 * un lien vers la page de la connexion. Composant serveur.
 */
export function ConnectionTiles({
  tiles,
  className,
}: {
  tiles: readonly ConnectionTile[];
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {tiles.map((t) => {
        const Icon: LucideIcon = ICONS[t.key];
        return (
          <li key={t.key} className="min-w-0">
            <Link
              href={t.href}
              className="group/tile flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink"
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 font-semibold text-foreground">{t.label}</span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/tile:translate-x-0.5"
                />
              </span>
              <span className="text-note text-muted-foreground">{t.description}</span>
              {t.state ? (
                <StatusPill tone={t.state.tone} title={t.state.title} className="mt-auto">
                  {t.state.label}
                </StatusPill>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
