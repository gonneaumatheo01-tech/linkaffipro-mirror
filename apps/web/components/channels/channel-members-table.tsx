"use client";

import Link from "next/link";
import type { MembershipStatus } from "@linkaffipro/db";
import { DataTable, type DataTableRow } from "@/components/admin/data-table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { StatusBadge, statusLabel } from "@/lib/status-badges";

export type ChannelMemberRow = {
  /** Identifiant de l'adhésion. */
  id: string;
  memberId: string;
  name: string;
  username: string | null;
  status: MembershipStatus;
  source: string;
  /** Dates déjà formatées (heure de Paris), « — » si absente. */
  requestedAt: string;
  approvedAt: string;
  joinedAt: string;
  leftAt: string;
};

function Detail({ m }: { m: ChannelMemberRow }) {
  const lines: Array<[string, string]> = [
    ["Origine", m.source],
    ["Demande", m.requestedAt],
    ["Acceptation", m.approvedAt],
    ["Entrée dans le canal", m.joinedAt],
    ["Départ", m.leftAt],
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="membership" value={m.status} />
        {m.username ? <span className="text-body text-muted-foreground">@{m.username}</span> : null}
      </div>
      <dl className="space-y-3">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-border pb-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/members/${m.memberId}`} className={cn(buttonVariants(), "w-full max-md:h-10")}>
        Ouvrir la fiche du membre
      </Link>
    </div>
  );
}

/** Membres d'un canal (onglet « Membres ») : 5 colonnes, détail des dates et de l'origine au clic. */
export function ChannelMembersTable({ rows }: { rows: ChannelMemberRow[] }) {
  const data: DataTableRow<ChannelMemberRow>[] = rows.map((m) => ({
    id: m.id,
    data: m,
    detailTitle: m.name,
    cells: {
      name: (
        <span className="flex flex-col">
          <span>{m.name}</span>
          {m.username ? (
            <span className="text-note font-normal text-muted-foreground">@{m.username}</span>
          ) : null}
        </span>
      ),
      status: <StatusBadge kind="membership" value={m.status} />,
      source: m.source,
      approvedAt: m.approvedAt,
      leftAt: m.leftAt,
    },
    sortValues: {
      name: m.name.toLocaleLowerCase("fr"),
      status: statusLabel("membership", m.status),
    },
  }));
  return (
    <DataTable
      label="Membres du canal"
      columns={[
        { key: "name", header: "Membre", className: "min-w-40 whitespace-normal" },
        { key: "status", header: "Statut" },
        { key: "source", header: "Origine", hideOnMobile: true, className: "whitespace-normal" },
        { key: "approvedAt", header: "Accepté le", hideOnMobile: true },
        { key: "leftAt", header: "Parti le", hideOnMobile: true },
      ]}
      rows={data}
      renderDetail={(r) => (r.data ? <Detail m={r.data} /> : null)}
      empty={{
        title: "Aucun membre accepté pour l'instant",
        description: "Dès qu'une demande est acceptée, la personne apparaît ici avec son origine.",
      }}
    />
  );
}
