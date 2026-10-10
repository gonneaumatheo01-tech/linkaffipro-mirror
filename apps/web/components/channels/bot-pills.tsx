import { StatusPill } from "@/components/admin/status-pill";

/**
 * Nos bots administrateurs d'un canal, en pastilles « @nom » ; « Aucun bot » en rouge s'il n'y en a pas
 * (le canal ne peut alors ni accepter les demandes ni écrire aux membres).
 */
export function BotPills({ admins, max = 2 }: { admins: string[]; max?: number }) {
  if (admins.length === 0)
    return (
      <StatusPill tone="danger" title="Aucun de nos bots n'est administrateur de ce canal">
        Aucun bot
      </StatusPill>
    );
  const shown = admins.slice(0, max);
  const more = admins.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((u) => (
        <StatusPill key={u} tone="neutral">
          @{u}
        </StatusPill>
      ))}
      {more > 0 ? (
        <StatusPill
          tone="muted"
          dot={false}
          title={admins
            .slice(max)
            .map((u) => `@${u}`)
            .join(", ")}
        >
          +{more}
        </StatusPill>
      ) : null}
    </span>
  );
}
