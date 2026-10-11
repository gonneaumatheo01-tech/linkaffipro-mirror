import Link from "next/link";
import { RefreshCw, UserPlus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { EmptyState } from "@/components/admin/empty-state";
import { RequestCard } from "@/components/channels/request-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  acceptanceText,
  appliedRuleText,
  appliedRuleView,
  membershipProvenance,
  sourceChannelIdsOf,
} from "@/lib/channels/provenance-display";
import {
  OPEN_REQUEST_STATUSES,
  memberHandle,
  memberName,
  requestNext,
} from "@/lib/channels/requests";
import { channelTabHref } from "@/lib/channels/tabs";
import { fmtDate, fmtNum } from "@/lib/format";
import { approveMembershipAction, declineMembershipAction } from "../actions";

/** Demandes montrées au plus (les plus récentes). */
const MAX_REQUESTS = 200;

/**
 * Onglet « Demandes » (pensé d'abord pour le téléphone) : une carte par demande en cours, avec « Accepter » et
 * « Refuser » en boutons de 40 px. Les demandes programmées sont acceptées toutes seules à l'heure prévue.
 * Chaque carte dit d'où vient la personne, la règle appliquée et la date d'acceptation prévue (phase 11 ; demandes
 * plus anciennes : provenance déduite de leur lien, règle relue en base).
 */
export async function RequestsTab({ channelId, now }: { channelId: string; now: Date }) {
  const requests = await prisma.membership.findMany({
    where: { channelId, status: { in: [...OPEN_REQUEST_STATUSES] } },
    orderBy: { requestedAt: "desc" },
    take: MAX_REQUESTS,
    include: {
      member: { select: { firstName: true, lastName: true, username: true, telegramUserId: true } },
      // Provenance et règle des demandes d'avant la phase 11 (relues depuis leur lien et leur règle).
      inviteLink: {
        select: { id: true, kind: true, sourceChannelId: true, adPlatform: true, name: true },
      },
      approvalRule: {
        select: {
          scope: true,
          isDefault: true,
          label: true,
          mode: true,
          delaySeconds: true,
          gateMode: true,
          gateChannelIds: true,
        },
      },
    },
  });
  const sourceIds = sourceChannelIdsOf(requests);
  const titles = sourceIds.length
    ? Object.fromEntries(
        (
          await prisma.channel.findMany({
            where: { id: { in: sourceIds } },
            select: { id: true, title: true },
          })
        ).map((c) => [c.id, c.title]),
      )
    : {};
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
        {/* Téléphone : passé à la ligne, le bouton discret est aligné sur la marge (sans son retrait intérieur). */}
        <Link
          href={channelTabHref(channelId, "requests")}
          className={cn(buttonVariants({ variant: "ghost" }), "max-md:-ml-3.5 max-md:h-10")}
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
              provenance: membershipProvenance(r, titles).label,
              rule: appliedRuleText(appliedRuleView(r)),
              acceptance: acceptanceText(r, now),
              requestedAt: fmtDate(r.requestedAt),
              lastError: r.lastError,
            }}
          />
        ))}
      </ul>
    </div>
  );
}
