import { Activity, Bot, Cpu, DatabaseBackup, Globe, RefreshCw, TriangleAlert } from "lucide-react";
import { StatusPill } from "@/components/admin/status-pill";
import { Term } from "@/components/admin/help-tip";
import { cn } from "@/components/ui/cn";
import type { HealthTile, HealthTileKey } from "@/lib/status/health";

const ICONS: Record<HealthTileKey, typeof Activity> = {
  site: Globe,
  worker: Cpu,
  backup: DatabaseBackup,
  bots: Bot,
  sync: RefreshCw,
  alerts: TriangleAlert,
};

/**
 * Six tuiles « en un coup d'œil » de Réglages → État du système : icône, nom (terme technique au survol), pastille
 * d'état et une phrase. Deux colonnes sur téléphone, trois puis six sur ordinateur. Composant serveur.
 */
export function HealthTiles({
  tiles,
  className,
}: {
  tiles: readonly HealthTile[];
  className?: string;
}) {
  return (
    <ul className={cn("grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6", className)}>
      {tiles.map((t) => {
        const Icon = ICONS[t.key];
        return (
          <li
            key={t.key}
            data-tile={t.key}
            data-tone={t.state.tone}
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4"
          >
            <span className="flex items-center gap-2 text-note font-medium text-muted-foreground">
              <Icon aria-hidden className="size-4 shrink-0" />
              <Term term={t.term}>{t.label}</Term>
            </span>
            <StatusPill tone={t.state.tone} title={t.state.title}>
              {t.state.label}
            </StatusPill>
            <span className="text-note text-muted-foreground">{t.detail}</span>
          </li>
        );
      })}
    </ul>
  );
}
