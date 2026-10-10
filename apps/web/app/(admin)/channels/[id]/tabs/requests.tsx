import Link from "next/link";
import { RefreshCw, UserPlus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { EmptyState } from "@/components/admin/empty-state";
import { RequestCard } from "@/components/channels/request-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  OPEN_REQUEST_STATUSES,
  memberHandle,
  memberName,
  requestNext,
  sourceLabel,
} from "@/lib/channels/requests";
import { channelTabHref } from "@/lib/channels/tabs";
import { fmtDate, fmtNum } from "@/lib/format";
import { statusLabel } from "@/lib/status-badges";
import { approveMembershipAction, declineMembershipAction } from "../actions";

/** Demandes montrées au plus (les plus récentes). */
const MAX_REQUESTS = 200;

/**
 * Onglet « Demandes » (pensé d'abord pour le téléphone) : une carte par demande en cours, avec « Accepter » et
 * « Refuser » en boutons de 40 px. Les demandes programmées sont acceptées toutes seules à l'heure prévue.
 */
export async function RequestsTab({ channelId, now }: { channelId: string; now: Date }) {
  const requests = await prisma.membership.findMany({
    where: { channelId, status: { in: [...OPEN_REQUEST_STATUSES] } },
    orderBy: { requestedAt: "desc" },
    take: MAX_REQUESTS,
    include: {
      member: { select: { firstName: true, lastName: true, username: true, telegramUserId: true } },
    },
  });
  if (requests.length === 0)
    return (
      <EmptyState
        icon={<UserPlus />}
        title="Aucune demande en attente"
        description="Les personnes qui demandent à rejoindre ce canal apparaîtront ici. Partagez un lien d'entrée pour en recevoir."
        action={{ href: "/campaigns/links", label: "Voir les liens", variant: "outline" }}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-muted-foreground">
          <span className="font-semibold text-foreground">
            {fmtNum(requests.length)} demande{requests.length > 1 ? "s" : ""} en cours
          </span>
          {requests.length >= MAX_REQUESTS ? " (les plus récentes)" : ""}. Les demandes programmées
          sont acceptées toutes seules à l&apos;heure prévue.
        </p>
        <Link
          href={channelTabHref(channelId, "requests")}
          className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
        >
          <RefreshCw aria-hidden />
          Actualiser
        </Link>
      </div>
      <ul
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        aria-label="Demandes en cours"
      >
        {requests.map((r) => (
          <RequestCard
            key={r.id}
            channelId={channelId}
            approveAction={approveMembershipAction}
            declineAction={declineMembershipAction}
            request={{
              id: r.id,
              name: memberName(r.member),
              handle: memberHandle(r.member),
              telegramUserId: r.member.telegramUserId.toString(),
              status: r.status,
              next: requestNext(r.status, r.approveAt, now),
              source: sourceLabel(r.source, (p) => statusLabel("adPlatform", p)),
              requestedAt: fmtDate(r.requestedAt),
              lastError: r.lastError,
            }}
          />
        ))}
      </ul>
    </div>
  );
}
