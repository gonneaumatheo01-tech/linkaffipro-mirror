import Link from "next/link";
import { StatusPill } from "@/components/admin/status-pill";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdsCardFigures } from "@/lib/agents/ads/queries";
import { fmtDate, fmtNum } from "@/lib/format";

/**
 * Carte « Agent Ads » du tableau de bord du Grand Chef : il n'est pas une équipe (il ne publie rien et n'agit jamais
 * chez Meta ou TikTok), il conseille. Recommandations à décider, faites sur 30 jours, dernier rapport.
 */
export function AdsAgentCard({ figures }: { figures: AdsCardFigures }) {
  return (
    <article data-slot="ads-agent-card" className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="neutral">Conseille seulement</StatusPill>
          {figures.toDecide > 0 ? <StatusPill tone="warning">{figures.toDecide} à décider</StatusPill> : null}
        </div>
        <h2 className="text-title text-foreground">Agent Ads</h2>
        <p className="text-note text-muted-foreground">
          Rattaché au Grand Chef : il lit ce que coûtent et rapportent vos pubs, et vous dit quoi arrêter, augmenter ou
          tester. Il ne change jamais rien chez Meta ou TikTok.
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <div className="space-y-0.5">
          <dt className="text-note text-muted-foreground">À décider</dt>
          <dd className="text-title font-semibold tabular-nums text-foreground">{fmtNum(figures.toDecide)}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-note text-muted-foreground">Faites (30 jours)</dt>
          <dd className="text-title font-semibold tabular-nums text-foreground">{fmtNum(figures.done30d)}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-note text-muted-foreground">Dernier rapport</dt>
          <dd className="text-body text-foreground">{figures.lastReportAt ? fmtDate(figures.lastReportAt) : "Pas encore"}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Link href="/agents/ads" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
          Ouvrir l&apos;Agent Ads
        </Link>
      </div>
    </article>
  );
}
