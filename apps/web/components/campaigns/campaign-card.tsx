import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MiniTrend } from "@/components/admin/stat-card";
import { UniverseDot } from "@/components/admin/universe-dot";
import { campaignSummary, gainsTone, groupMoney, groupMoneyDigits } from "@/lib/campaigns/cards";
import { campaignVariations } from "@/lib/campaigns/display";
import type { CampaignRow } from "@/lib/campaigns/queries";
import { hasTrend } from "@/lib/campaigns/trend";
import { fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";
import { CampaignFigure } from "./campaign-figure";

/**
 * Carte d'une campagne (page Campagnes) : univers, statut, nom, contexte (plateforme, canaux, liens, offres), puis
 * dépensé, membres, premiers dépôts et gains de la période (commissions − dépense pub), et la mini-courbe des membres par
 * jour.
 * Toute la carte mène à la fiche (lien « étiré » sur le nom : le nom accessible du lien reste court) ; avec la
 * comparaison, chaque chiffre porte sa variation (une hausse de la dépense est défavorable).
 * `moneyDigits` : précision commune des montants de la grille (`groupMoneyDigits` sur toutes les cartes affichées),
 * pour que « 1 813 € » ne côtoie pas « 558,14 € » ; par défaut, celle des montants de la carte.
 */
export function CampaignCard({
  row,
  href,
  platformLabel,
  compare,
  membersTrend,
  moneyDigits,
}: {
  row: CampaignRow;
  href: string;
  platformLabel: string | null;
  compare: boolean;
  /** Membres acceptés par jour sur la période (statistiques journalières). */
  membersTrend?: number[];
  moneyDigits?: 0 | 2;
}) {
  const m = row.metrics;
  const digits = moneyDigits ?? groupMoneyDigits([m.spend, m.gains]);
  // Règle commune des cartes : « nouveau » quand la période précédente valait 0, rien si les deux valent 0.
  const v = compare && row.previous ? campaignVariations(m, row.previous) : compare ? {} : null;
  const variation = (k: keyof CampaignRow["metrics"]) =>
    v ? (v[k] ?? ({ kind: "unknown" } as const)) : undefined;
  // Période d'avant en perte : pas de pourcentage, la valeur d'avant à la place (même règle que les Statistiques).
  const before = compare && row.previous ? groupMoney(row.previous.gains, digits) : null;
  const tone = gainsTone(m.gains);
  return (
    <article
      data-slot="campaign-card"
      className="group/card relative flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand/50 hover:bg-brand-soft/30 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <UniverseDot
              universe={row.vertical}
              withLabel
              className="text-note text-muted-foreground"
            />
            <StatusBadge kind="campaign" value={row.status} />
          </div>
          <h2 className="text-body font-semibold text-foreground">
            <Link
              href={href}
              className="line-clamp-2 outline-none after:absolute after:inset-0 after:rounded-xl"
            >
              {row.name}
            </Link>
          </h2>
          <p className="truncate text-note text-muted-foreground">
            {campaignSummary({
              platformLabel,
              channels: row.channels.length,
              links: row.links,
              offers: row.offers,
            })}
          </p>
        </div>
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover/card:translate-x-0.5"
        />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <CampaignFigure
          label="Dépensé"
          value={groupMoney(m.spend, digits)}
          variation={variation("spend")}
          favorable="down"
        />
        <CampaignFigure
          label="Membres"
          value={fmtNum(m.members)}
          variation={variation("members")}
        />
        <CampaignFigure
          label="Premiers dépôts"
          term="FTD"
          value={fmtNum(m.ftds)}
          variation={variation("ftds")}
        />
        <CampaignFigure
          label="Gains"
          value={groupMoney(m.gains, digits)}
          valueTone={tone}
          variation={variation("gains")}
          before={before}
        />
      </dl>
      {hasTrend(membersTrend) ? (
        <div className="mt-auto flex items-center gap-3 border-t border-border pt-3 text-note text-muted-foreground">
          <MiniTrend values={membersTrend} />
          <span>Membres par jour</span>
        </div>
      ) : null}
    </article>
  );
}
