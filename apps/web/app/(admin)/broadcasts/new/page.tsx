import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { loadBroadcastOptions } from "@/lib/broadcasts/queries";
import { toParisLocalInput } from "@/lib/posts/time";
import { BroadcastForm } from "../broadcast-form";
import { createBroadcastAction } from "../actions";
import { getTagRegistry } from "@/lib/members/tags";

export const metadata: Metadata = { title: "Nouvel envoi" };

function defaultScheduleTime(): Date {
  return new Date(Math.ceil((Date.now() + 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
}

export default async function NewBroadcastPage({ searchParams }: PageProps<"/broadcasts/new">) {
  const sp = await searchParams;
  const options = await loadBroadcastOptions();
  return (
    <>
      <PageHeader
        title="Nouvel envoi groupé"
        description="Choisissez le bot, les destinataires et le message, puis enregistrez en brouillon, programmez ou envoyez."
        help="Conseil : enregistrez d'abord en brouillon et envoyez-vous un test depuis la page de l'envoi avant de lancer l'envoi réel."
      />
      <Flash ok={sp.ok} error={sp.error} />
      {options.bots.length === 0 ? (
        <EmptyState
          title="Aucun bot actif."
          description="Un envoi groupé part depuis un bot Telegram. Activez ou ajoutez un bot pour commencer."
          action={{ href: "/bots", label: "Voir les bots" }}
        />
      ) : (
        <form action={createBroadcastAction}>
          <BroadcastForm options={{ ...options, tags: await getTagRegistry() }}
            defaultScheduledAt={toParisLocalInput(defaultScheduleTime())}
          />
        </form>
      )}
    </>
  );
}
