import { StatusPill } from "@/components/admin/status-pill";
import { fmtNum } from "@/lib/format";

/** État d'un canal en pastilles : actif ou non, demandes en cours, canal de test, médiathèque. */
export function ChannelStatePills({
  channel,
}: {
  channel: { isActive: boolean; isTest: boolean; isMediaLibrary: boolean; pending?: number };
}) {
  const pending = channel.pending ?? 0;
  return (
    <span className="flex flex-wrap gap-1">
      {channel.isActive ? (
        <StatusPill tone="success">Actif</StatusPill>
      ) : (
        <StatusPill tone="muted">Inactif</StatusPill>
      )}
      {pending > 0 ? (
        <StatusPill tone="warning">
          {fmtNum(pending)} demande{pending > 1 ? "s" : ""}
        </StatusPill>
      ) : null}
      {channel.isTest ? <StatusPill tone="info">Test</StatusPill> : null}
      {channel.isMediaLibrary ? <StatusPill tone="neutral">Médiathèque</StatusPill> : null}
    </span>
  );
}
