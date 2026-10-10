import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { BroadcastWizard } from "@/components/broadcasts/broadcast-wizard";
import { segmentFromSearchParams } from "@/lib/broadcasts/group";
import { loadBroadcastOptions } from "@/lib/broadcasts/queries";
import { getTagRegistry } from "@/lib/members/tags";
import { toParisLocalInput } from "@/lib/posts/time";
import { createAndTestAction, createBroadcastAction } from "../actions";

export const metadata: Metadata = { title: "Écrire à un groupe" };

/** Proposition pour « Plus tard » : dans une heure, au quart d'heure suivant. */
function defaultScheduleTime(): Date {
  return new Date(Math.ceil((Date.now() + 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
}

/**
 * « Écrire à un groupe » : assistant en trois étapes (qui, quoi, quand). Le groupe peut arriver préparé depuis la
 * liste des membres (paramètres channelIds, membershipStatuses, spendLevels, inviteLinkIds, campaignIds, languages,
 * inactiveDays, tags, clickedCategoryIds).
 */
export default async function NewBroadcastPage({
  searchParams,
}: PageProps<"/members/broadcasts/new">) {
  const sp = await searchParams;
  const [options, tags] = await Promise.all([loadBroadcastOptions(), getTagRegistry()]);
  const prefill = segmentFromSearchParams(sp, {
    channelIds: options.channels.map((c) => c.id),
    campaignIds: options.campaigns.map((c) => c.id),
    inviteLinkIds: options.inviteLinks.map((l) => l.id),
    clickedCategoryIds: options.categories.map((c) => c.id),
  });
  return (
    <>
      <PageHeader
        backHref="/members/broadcasts"
        backLabel="Écrire à un groupe"
        title="Nouveau message à un groupe"
        description="Trois étapes : qui le reçoit, ce que dit le message, quand il part."
      />
      <Flash ok={sp.ok} error={sp.error} />
      {options.bots.length === 0 ? (
        <EmptyState
          icon={<Bot />}
          title="Aucun bot actif"
          description="Un message à un groupe part d'un bot Telegram. Activez ou ajoutez un bot pour commencer."
          action={{ href: "/settings/bots", label: "Voir les bots" }}
        />
      ) : (
        <BroadcastWizard
          action={createBroadcastAction}
          testAction={createAndTestAction}
          options={{ ...options, tags }}
          initialSegment={prefill.segment}
          prefill={{ carried: prefill.carried, dropped: prefill.dropped }}
          defaultScheduledAt={toParisLocalInput(defaultScheduleTime())}
          canRestore={Boolean(sp.error)}
        />
      )}
    </>
  );
}
