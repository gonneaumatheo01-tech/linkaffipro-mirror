import Link from "next/link";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { ChannelMembersTable } from "@/components/channels/channel-members-table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { loadChannelMembersPage } from "@/lib/channels/queries";
import { memberName, membersSummary, sourceHint, sourceLabel } from "@/lib/channels/requests";
import { fmtDate } from "@/lib/format";
import { statusLabel } from "@/lib/status-badges";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Onglet « Membres » : membres acceptés, partis ou exclus, en tableau de 5 colonnes avec le détail au clic, 50 par
 * page. L'en-tête compte les présents, puis les partis et les exclus (la liste les montre tous). Canal sans membre :
 * l'état vide seul, sans phrase ni bouton inutiles.
 */
export async function MembersTab({ channelId, sp }: { channelId: string; sp: SearchParams }) {
  const data = await loadChannelMembersPage(channelId, pageOf(sp));
  const table = (
    <ChannelMembersTable
      rows={data.rows.map((m) => ({
        id: m.id,
        memberId: m.member.id,
        name: memberName(m.member),
        username: m.member.username,
        status: m.status,
        source: sourceLabel(m.source, (p) => statusLabel("adPlatform", p)),
        sourceHint: sourceHint(m.source),
        requestedAt: fmtDate(m.requestedAt),
        approvedAt: fmtDate(m.approvedAt),
        joinedAt: fmtDate(m.joinedAt),
        leftAt: fmtDate(m.leftAt),
      }))}
    />
  );
  if (data.total === 0) return table;
  const pageLinks = { ...sp, ok: undefined, error: undefined };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-muted-foreground">
          <span className="font-semibold text-foreground">{membersSummary(data)}</span>. Seules les
          personnes entrées depuis qu&apos;un de nos bots gère ce canal sont suivies. Cliquez sur
          une ligne pour voir son origine et ses dates.
        </p>
        <Link
          href={`/members?channelId=${encodeURIComponent(channelId)}`}
          className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
        >
          Voir dans Membres
        </Link>
      </div>
      {table}
      <Pagination
        page={data.page}
        pages={data.pages}
        total={data.total}
        noun="membre"
        hrefFor={(p) => pageHref(`/channels/${channelId}`, pageLinks, p)}
      />
    </div>
  );
}
