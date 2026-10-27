import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentsNav } from "@/components/agents/agents-nav";
import { ProspectDetailView } from "@/components/agents/prospection/prospect-detail";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { PROSPECTION_PATH, channelName, safeProspectId } from "@/lib/agents/prospection/display";
import { loadProspect, loadProspectionSettings } from "@/lib/agents/prospection/queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents · Prospection · Fiche d'un canal" };
export const dynamic = "force-dynamic";

/** Fiche d'un canal trouvé par l'équipe Prospection (jamais un canal hors du périmètre de pays : page introuvable). */
export default async function ProspectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const [{ id: raw }, sp] = await Promise.all([params, searchParams]);
  const id = safeProspectId(raw);
  if (!id) notFound();
  const settings = await loadProspectionSettings();
  const [p, pending] = await Promise.all([loadProspect(id, settings.countriesScope), loadPendingCounts()]);
  if (!p) notFound();
  const isAdmin = user.role === "ADMIN";
  return (
    <>
      <AgentsNav current="prospection" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title={channelName(p)}
        description={p.username ? `@${p.username}` : undefined}
        backHref={PROSPECTION_PATH}
        backLabel="Prospection"
        help="Écrivez à Kevin « détail @nom » ou « pourquoi @nom est A ? » pour la même fiche dans Telegram."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <ProspectDetailView p={p} weights={settings.weights} isAdmin={isAdmin} now={new Date()} />
    </>
  );
}
