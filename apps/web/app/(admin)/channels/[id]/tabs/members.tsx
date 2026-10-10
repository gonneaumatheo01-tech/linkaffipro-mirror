import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { ChannelMembersTable } from "@/components/channels/channel-members-table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { MEMBER_STATUSES, memberName, sourceLabel } from "@/lib/channels/requests";
import { fmtDate, fmtNum } from "@/lib/format";
import { statusLabel } from "@/lib/status-badges";

/** Membres montrés au plus (les plus récents) ; la liste complète est dans Membres. */
const MAX_MEMBERS = 500;

/** Onglet « Membres » : membres acceptés, partis ou exclus, en tableau de 5 colonnes avec le détail au clic. */
export async function MembersTab({ channelId, present }: { channelId: string; present: number }) {
  const members = await prisma.membership.findMany({
    where: { channelId, status: { in: [...MEMBER_STATUSES] } },
    orderBy: [{ approvedAt: "desc" }, { requestedAt: "desc" }],
    take: MAX_MEMBERS,
    include: { member: { select: { id: true, firstName: true, lastName: true, username: true } } },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-muted-foreground">
          <span className="font-semibold text-foreground">
            {fmtNum(present)} membre{present > 1 ? "s" : ""} présent{present > 1 ? "s" : ""}
          </span>
          {members.length >= MAX_MEMBERS ? ` · les ${fmtNum(MAX_MEMBERS)} derniers ci-dessous` : ""}
          . Seules les personnes entrées depuis qu&apos;un de nos bots gère ce canal sont suivies.
          Cliquez sur une ligne pour voir son origine et ses dates.
        </p>
        <Link
          href={`/members?channelId=${encodeURIComponent(channelId)}`}
          className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
        >
          Voir dans Membres
        </Link>
      </div>
      <ChannelMembersTable
        rows={members.map((m) => ({
          id: m.id,
          memberId: m.member.id,
          name: memberName(m.member),
          username: m.member.username,
          status: m.status,
          source: sourceLabel(m.source, (p) => statusLabel("adPlatform", p)),
          requestedAt: fmtDate(m.requestedAt),
          approvedAt: fmtDate(m.approvedAt),
          joinedAt: fmtDate(m.joinedAt),
          leftAt: fmtDate(m.leftAt),
        }))}
      />
    </div>
  );
}
