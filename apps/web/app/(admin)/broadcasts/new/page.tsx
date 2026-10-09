import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { loadBroadcastOptions } from "@/lib/broadcasts/queries";
import { toParisLocalInput } from "@/lib/posts/time";
import { BroadcastForm } from "../broadcast-form";
import { createBroadcastAction } from "../actions";

export const metadata: Metadata = { title: "Nouvel envoi" };

function defaultScheduleTime(): Date {
  return new Date(Math.ceil((Date.now() + 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
}

export default async function NewBroadcastPage({ searchParams }: PageProps<"/broadcasts/new">) {
  const sp = await searchParams;
  const options = await loadBroadcastOptions();
  return (
    <>
      <PageHeader title="Nouvel envoi groupé" description="Choisissez le bot, les destinataires, le message, puis envoyez ou programmez." />
      <Flash ok={sp.ok} error={sp.error} />
      {options.bots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun bot actif.</p>
      ) : (
        <form action={createBroadcastAction}>
          <BroadcastForm options={options} defaultScheduledAt={toParisLocalInput(defaultScheduleTime())} />
        </form>
      )}
    </>
  );
}
