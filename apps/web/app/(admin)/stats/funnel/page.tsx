import type { Metadata } from "next";
import { TrendingDown } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { Funnel } from "@/components/dashboard/funnel";
import { StatsTop } from "@/components/dashboard/stats-top";
import { biggestDrop, fmtPercent, funnelLabel } from "@/lib/dashboard/display";
import { loadFunnel } from "@/lib/dashboard/daily";
import { loadStatsOptions } from "@/lib/dashboard/stats-options";
import { funnelDimension, funnelScopeLabel, parseStatsFilters } from "@/lib/dashboard/stats-pages";

export const metadata: Metadata = { title: "Statistiques · Parcours" };

export default async function StatsFunnelPage({ searchParams }: PageProps<"/stats/funnel">) {
  const sp = await searchParams;
  const f = parseStatsFilters(sp);
  const dim = funnelDimension(f);
  const [options, data] = await Promise.all([
    loadStatsOptions(),
    loadFunnel(dim, f.period, f.compare),
  ]);
  const scope = funnelScopeLabel(f, {
    campaign: options.campaigns.find((c) => c.id === f.campaignId)?.name,
    channel: options.channels.find((c) => c.id === f.channelId)?.title,
  });
  const empty = data.steps.every((s) => s.value === 0);
  const drop = biggestDrop(data.steps);
  const several = [f.campaignId, f.channelId, f.vertical].filter(Boolean).length > 1;

  return (
    <>
      <StatsTop
        page="funnel"
        filters={f}
        options={options}
        sp={sp}
        channelHelp="Montre le parcours d'un seul canal (si aucune campagne n'est choisie)."
      />

      <section
        aria-labelledby="funnel-title"
        className="rounded-xl border border-border bg-card p-4 md:p-5"
      >
        <div className="mb-4">
          <h2 id="funnel-title" className="text-title text-foreground">
            {scope}
          </h2>
          <p className="text-body text-muted-foreground">
            {several
              ? "Un seul filtre à la fois : la campagne d'abord, sinon le canal, sinon l'univers."
              : "Chaque ligne : le nombre de personnes et la part gardée depuis l'étape d'avant."}
          </p>
        </div>

        {empty ? (
          <EmptyState
            title="Aucune donnée sur cette période"
            description="Le parcours se remplit dès qu'une pub reçoit des clics ou qu'un canal reçoit des demandes d'adhésion."
            action={{ href: "/campaigns/links", label: "Créer un lien de pub", variant: "outline" }}
          />
        ) : (
          <>
            {drop ? (
              <p className="mb-5 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-body text-warning">
                <TrendingDown aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  La plus grosse perte : entre « {funnelLabel(drop.from).label} » et «{" "}
                  {funnelLabel(drop.to).label} », {fmtPercent(drop.loss)} des personnes
                  s&apos;arrêtent.
                </span>
              </p>
            ) : null}
            <Funnel steps={data.steps} previous={data.previous?.steps ?? null} />
          </>
        )}
      </section>
      <p className="mt-3 text-note text-muted-foreground">
        Les dépôts peuvent dépasser les premiers dépôts : un joueur peut déposer plusieurs fois.
      </p>
    </>
  );
}
