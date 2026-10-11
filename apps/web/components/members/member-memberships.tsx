import Link from "next/link";
import { UniverseDot } from "@/components/admin/universe-dot";
import { OPEN_REQUEST_STATUSES } from "@/lib/channels/requests";
import { channelTabHref } from "@/lib/channels/tabs";
import { StatusBadge } from "@/lib/status-badges";

const OPEN: ReadonlySet<string> = new Set(OPEN_REQUEST_STATUSES);

export type MemberMembershipItem = {
  id: string;
  channelId: string;
  channelTitle: string;
  universe: string | null;
  status: string;
  /** « Venu de « Tir Cadré » (canal obligatoire) » (phase 11). */
  provenance: string;
  /** Règle appliquée puis date d'acceptation : « règle : 1 jour · acceptation prévue le 12 oct. à 10 h 14 ». */
  detail: string | null;
  /** Date de la demande, déjà formatée (heure de Paris). */
  requestedAt: string;
};

/**
 * Demandes et canaux d'un membre (fiche membre) : une ligne par demande, de la plus récente à la plus ancienne :
 * le canal (lien vers ses demandes en cours, ou vers ses membres), l'état, d'où il vient, la règle appliquée et la
 * date d'acceptation prévue ou faite.
 * Composant serveur, pensé d'abord pour le téléphone (le canal et l'état passent à la ligne au besoin).
 */
export function MemberMemberships({
  items,
  more,
}: {
  items: MemberMembershipItem[];
  /** Demandes plus anciennes non montrées (elles restent dans la chronologie). */
  more: number;
}) {
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border">
        {items.map((m) => (
          <li key={m.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Link
                href={channelTabHref(m.channelId, OPEN.has(m.status) ? "requests" : "members")}
                className="inline-flex min-w-0 items-center gap-2 font-medium break-words underline-offset-4 hover:underline max-md:min-h-10"
              >
                <UniverseDot universe={m.universe} />
                {m.channelTitle}
              </Link>
              <StatusBadge kind="membership" value={m.status} />
            </div>
            <p className="text-note break-words text-muted-foreground">
              <span className="text-foreground">{m.provenance}</span>
              {m.detail ? ` · ${m.detail}` : ""}
            </p>
            <p className="text-note text-muted-foreground">Demandé le {m.requestedAt}</p>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="text-note text-muted-foreground">
          Et {more.toLocaleString("fr-FR")} demande{more > 1 ? "s" : ""} plus ancienne
          {more > 1 ? "s" : ""} : voir la chronologie.
        </p>
      ) : null}
    </div>
  );
}
