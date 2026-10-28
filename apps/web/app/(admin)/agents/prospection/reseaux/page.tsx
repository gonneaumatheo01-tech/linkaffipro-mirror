import type { Metadata } from "next";
import { AgentsNav } from "@/components/agents/agents-nav";
import { NetworksView } from "@/components/agents/prospection/networks-view";
import { ProspectionNav } from "@/components/agents/prospection/prospection-nav";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { NETWORKS_PATH } from "@/lib/agents/prospection/advanced";
import { loadNetworks, loadOpenAlertsCount } from "@/lib/agents/prospection/advanced-queries";
import { loadScope } from "@/lib/agents/prospection/queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Agents · Prospection · Réseaux" };
export const dynamic = "force-dynamic";

/** Agents → Prospection → Réseaux (phase 32) : canaux tenus par la même personne, preuves, regrouper et séparer. */
export default async function ProspectionNetworksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = await loadScope();
  const [pending, networks, open] = await Promise.all([loadPendingCounts(), loadNetworks(scope), loadOpenAlertsCount(scope)]);
  return (
    <>
      <AgentsNav current="prospection" isAdmin={user.role === "ADMIN"} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Réseaux de canaux"
        description="Les canaux tenus par la même personne, regroupés pour négocier un seul accord. L'équipe regroupe sur des preuves (même contact, même signature, même groupe de discussion…) ; vous pouvez regrouper ou séparer."
        help="Écrivez à Kevin : « réseau de @nom », « @a et @b c'est la même personne », « sépare @nom »."
      />
      <ProspectionNav current="reseaux" openAlerts={open} />
      <Flash ok={sp.ok} error={sp.error} />
      <NetworksView networks={networks} back={NETWORKS_PATH} />
    </>
  );
}
