import { UserPlus } from "lucide-react";
import { prisma, type MembershipStatus } from "@linkaffipro/db";
import { EmptyState } from "@/components/admin/empty-state";
import { RequestsBoard } from "@/components/channels/request-card";
import { RequestFunnel } from "@/components/channels/request-funnel";
import {
  acceptanceText,
  appliedRuleText,
  appliedRuleView,
  membershipProvenance,
  landingPageIdsOf,
  sourceChannelIdsOf,
} from "@/lib/channels/provenance-display";
import { landingPageNames } from "@/lib/landing/queries";
import {
  OPEN_REQUEST_STATUSES,
  REQUESTS_SHOWN_MAX,
  isQueuedForApproval,
  memberHandle,
  memberName,
  requestFilterCounts,
  requestFilterStatuses,
  requestFiltersToTopUp,
  requestNext,
  requestNextNote,
} from "@/lib/channels/requests";
import {
  REQUEST_FUNNEL_DEFAULT,
  channelsWithRequiredGates,
  funnelView,
  loadChannelRequestFunnels,
} from "@/lib/channels/request-funnel";
import { channelTabHref } from "@/lib/channels/tabs";
import { fmtDate } from "@/lib/format";
import {
  approveAllRequestsAction,
  approveMembershipAction,
  declineMembershipAction,
} from "../actions";

const requestInclude = {
  member: {
    select: { firstName: true, lastName: true, username: true, telegramUserId: true },
  },
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
} as const;

/**
 * Demandes en cours d'un canal pour l'onglet : les `max` plus récentes, tous statuts confondus, plus les `max` plus
 * récentes de chaque filtre qui n'y serait pas complet (un filtre aux demandes toutes plus anciennes ne doit jamais
 * montrer « Aucune demande » alors que sa pastille en compte) ; de la plus récente à la plus ancienne. Nombres exacts
 * de chaque filtre (toute la liste en base).
 */
export async function loadOpenRequests(channelId: string, max: number = REQUESTS_SHOWN_MAX) {
  const orderBy = [{ requestedAt: "desc" as const }, { id: "desc" as const }];
  const [recent, byStatus] = await Promise.all([
    prisma.membership.findMany({
      where: { channelId, status: { in: [...OPEN_REQUEST_STATUSES] } },
      orderBy,
      take: max,
      include: requestInclude,
    }),
    prisma.membership.groupBy({
      by: ["status"],
      where: { channelId, status: { in: [...OPEN_REQUEST_STATUSES] } },
      _count: { _all: true },
    }),
  ]);
  const counts = requestFilterCounts(
    Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])) as Partial<
      Record<MembershipStatus, number>
    >,
  );
  const topUp = requestFiltersToTopUp(
    recent.map((r) => r.status),
    counts,
    max,
  );
  if (topUp.length === 0) return { requests: recent, counts };
  const more = await Promise.all(
    topUp.map((f) =>
      prisma.membership.findMany({
        where: { channelId, status: { in: requestFilterStatuses(f) } },
        orderBy,
        take: max,
        include: requestInclude,
      }),
    ),
  );
  const byId = new Map(recent.map((r) => [r.id, r]));
  for (const r of more.flat()) if (!byId.has(r.id)) byId.set(r.id, r);
  const requests = [...byId.values()].sort(
    (a, b) =>
      b.requestedAt.getTime() - a.requestedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  return { requests, counts };
}

/**
 * Onglet « Demandes » (pensé d'abord pour le téléphone) : une carte par demande en cours, avec « Accepter » et
 * « Refuser » en boutons de 40 px. Les demandes programmées sont acceptées toutes seules à l'heure prévue.
 * Chaque carte dit d'où vient la personne, la règle appliquée et la date d'acceptation prévue (phase 11 ; demandes
 * plus anciennes : provenance déduite de leur lien, règle relue en base).
 * Phase 14 : filtre par statut (`?status=`) avec le nombre exact de chaque filtre, « Tout accepter » sur la liste
 * filtrée (`RequestsBoard`) ; chaque filtre montre ses 200 demandes les plus récentes (`loadOpenRequests`).
 */
export async function RequestsTab({ channelId, now }: { channelId: string; now: Date }) {
  const [{ requests, counts }, funnels, requiredGates] = await Promise.all([
    loadOpenRequests(channelId),
    loadChannelRequestFunnels(channelId, now),
    // Conseil de l'avertissement « bot bloqué » : passer en « Proposés » seulement si des canaux sont obligatoires.
    channelsWithRequiredGates([channelId]),
  ]);
  const sourceIds = sourceChannelIdsOf(requests);
  // Pages d'atterrissage (phase 15) : nom actuel d'une page renommée.
  const pageNames = await landingPageNames(landingPageIdsOf(requests));
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
  return (
    <div className="space-y-6">
      {funnels.some((f) => f.data.totals.requests > 0) ? (
        <section
          aria-labelledby="request-funnel-title"
          className="space-y-4 rounded-xl border border-border bg-surface p-4 md:p-5"
        >
          <div>
            <h2 id="request-funnel-title" className="text-title text-foreground">
              Parcours des demandes
            </h2>
            <p className="mt-0.5 text-note text-muted-foreground">
              Les demandes reçues sur la période et ce qu&apos;elles sont devenues depuis : accueil,
              blocages, canaux rejoints, acceptées, parties.
            </p>
          </div>
          <RequestFunnel
            periods={funnels.map((f) => ({
              key: f.key,
              label: f.label,
              view: funnelView(f.data, null, { requiredGates }),
            }))}
            defaultKey={REQUEST_FUNNEL_DEFAULT}
            welcomeHref={`${channelTabHref(channelId, "sequences")}&open=JOIN_REQUEST#JOIN_REQUEST`}
          />
        </section>
      ) : null}
      {counts.all === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title="Aucune demande en attente"
          description="Les personnes qui demandent à rejoindre ce canal apparaîtront ici. Partagez un lien d'entrée pour en recevoir."
          action={{ href: "/campaigns/links", label: "Voir les liens", variant: "outline" }}
        />
      ) : (
        <RequestsBoard
          channelId={channelId}
          counts={counts}
          asOf={now.toISOString()}
          approveAction={approveMembershipAction}
          declineAction={declineMembershipAction}
          approveAllAction={approveAllRequestsAction}
          items={requests.map((r) => {
            // « Tout accepter » : en cours d'acceptation ; l'heure enregistrée n'est qu'une heure de secours.
            const queued = isQueuedForApproval(r);
            return {
              id: r.id,
              name: memberName(r.member),
              handle: memberHandle(r.member),
              telegramUserId: r.member.telegramUserId.toString(),
              status: r.status,
              next: requestNext(r.status, r.approveAt, now, queued),
              nextNote: requestNextNote(r.status),
              provenance: membershipProvenance(r, titles, pageNames).label,
              rule: appliedRuleText(appliedRuleView(r)),
              acceptance: queued ? null : acceptanceText(r, now),
              requestedAt: fmtDate(r.requestedAt),
              lastError: r.lastError,
            };
          })}
        />
      )}
    </div>
  );
}
