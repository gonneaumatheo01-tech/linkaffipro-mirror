import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { FilterChips } from "@/components/admin/filter-chips";
import { PageHeader } from "@/components/admin/page-header";
import { PeriodSelect } from "@/components/admin/period-select";
import { StatCard } from "@/components/admin/stat-card";
import { BarList } from "@/components/charts/bar-list";
import { STAT_GRID_PHONE } from "@/components/dashboard/cells";
import { ConversationsNav } from "@/components/conversations/conversations-nav";
import { ConversationStatsTable } from "@/components/conversations/stats-table";
import { buttonVariants } from "@/components/ui/button";
import { loadAssistantConfig } from "@/lib/assistant/config";
import { monthCostEur } from "@/lib/assistant/usage";
import { comparableVariation } from "@/lib/dashboard/display";
import { fmtMoney, fmtNum } from "@/lib/format";
import {
  aiCostText,
  CONVERSATION_UNIVERSE_LABELS,
  CONVERSATION_UNIVERSES,
  pctText,
} from "@/lib/conversations/labels";
import { capShare, parseStatsUniverse, statsParams } from "@/lib/conversations/stats";
import { hasAnyConversation, loadConversationStats } from "@/lib/conversations/stats-queries";
import {
  parseCompare,
  periodLabelWithDates,
  periodParams,
  previousPeriod,
  resolvePeriod,
} from "@/lib/periods";
import { requireUser } from "@/lib/session";
import { statusLabel } from "@/lib/status-badges";
import { universeClasses } from "@/lib/universe";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Chiffres des conversations" };
export const dynamic = "force-dynamic";

/**
 * Chiffres de l'assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 6), sur la période
 * choisie (sélecteur commun, comparaison possible) et l'univers choisi (phase 25 : Tous, Rencontres, Casino, Paris
 * sportifs, par la persona) : cinq cartes (conversations, taux de réponse, liens ouverts,
 * inscriptions, coût de l'IA du mois sur le plafond), le parcours étape par étape (barres), puis les tableaux par
 * univers (sans filtre d'univers), par persona et par source du /start (détail au clic) ; export CSV (mêmes filtres). Définitions : `lib/conversations/stats.ts`.
 * Administrateurs et managers.
 */
export default async function ConversationsStatsPage({
  searchParams,
}: PageProps<"/conversations/stats">) {
  const me = await requireUser();
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const compare = parseCompare(sp.compare);
  const universe = parseStatsUniverse(sp.universe);
  const [stats, previous, any, config, monthCost] = await Promise.all([
    loadConversationStats(period, { universe }),
    compare ? loadConversationStats(previousPeriod(period), { universe }) : Promise.resolve(null),
    hasAnyConversation(),
    loadAssistantConfig(),
    monthCostEur(),
  ]);
  const periodText = periodLabelWithDates(period);
  const t = stats.total;
  const p = previous?.total ?? null;
  const v = (k: "conversations" | "linksOpened" | "registrations") =>
    p ? comparableVariation(t[k], p[k]) : undefined;
  const share = capShare(monthCost, config.monthlyCapEur);
  const exportHref = `/conversations/stats/export?${statsParams(periodParams(period), universe).toString()}`;
  const universeHref = (u: typeof universe) =>
    `/conversations/stats?${statsParams(periodParams(period, compare), u).toString()}`;
  const universeChips = [
    { key: "all", label: "Tous", href: universeHref(""), selected: universe === "" },
    ...CONVERSATION_UNIVERSES.map((u) => ({
      key: u,
      label: CONVERSATION_UNIVERSE_LABELS[u],
      href: universeHref(u),
      selected: universe === u,
      icon: <span aria-hidden className={cn("size-2 rounded-full", universeClasses(u).dot)} />,
    })),
  ];
  // Par univers : seulement sans filtre d'univers, et s'il y a plus d'un regroupement à comparer.
  const showByUniverse = universe === "" && stats.byUniverse.length > 1;
  const top = Math.max(1, stats.journey[0]?.count ?? 0);

  return (
    <>
      <ConversationsNav current="stats" />
      <PageHeader
        title="Chiffres des conversations"
        description="Ce que rapportent les conversations, de la première réponse jusqu'au premier dépôt."
        secondaryActions={
          any ? (
            <Link
              href={exportHref}
              prefetch={false}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <Download aria-hidden />
              Exporter
            </Link>
          ) : null
        }
      />
      {!any ? (
        <EmptyState
          icon={<BarChart3 />}
          title="Pas encore de conversation"
          description={
            config.activation === "off"
              ? "L'assistante est désactivée : elle ne répond à personne. Les chiffres apparaîtront dès les premières conversations."
              : "Les chiffres apparaîtront dès qu'une personne écrira au bot de l'assistante."
          }
          action={
            config.activation === "off" && me.role === "ADMIN"
              ? { href: "/settings/assistant", label: "Ouvrir Réglages → IA de conversation" }
              : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          <div className="space-y-2">
            <PeriodSelect period={period} compare={compare} extra={{ universe }} />
            <FilterChips label="Univers" chips={universeChips} />
            <p className="text-note text-muted-foreground">
              {periodText}. Conversations et réponses : les conversations commencées sur la période.
              Liens, inscriptions, premiers dépôts et coût : comptés le jour où ils ont eu lieu
              (dates réelles de Link Affi pour les inscriptions et les premiers dépôts).
            </p>
          </div>

          <div
            className={cn(
              "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5",
              STAT_GRID_PHONE,
            )}
          >
            <StatCard
              label="Conversations"
              value={fmtNum(t.conversations)}
              variation={v("conversations")}
              hint={
                t.toHandle > 0
                  ? `Commencées sur la période · ${fmtNum(t.toHandle)} encore à traiter`
                  : "Commencées sur la période"
              }
            />
            <StatCard
              label="Taux de réponse"
              value={pctText(t.replyRate)}
              hint={
                p && p.replyRate !== null
                  ? `${fmtNum(t.replies)} réponses · avant : ${pctText(p.replyRate)}`
                  : `${fmtNum(t.replies)} conversation${t.replies > 1 ? "s" : ""} avec une réponse`
              }
            />
            <StatCard
              label="Liens ouverts"
              value={fmtNum(t.linksOpened)}
              variation={v("linksOpened")}
              hint={`sur ${fmtNum(t.linksSent)} lien${t.linksSent > 1 ? "s" : ""} de l'offre envoyé${t.linksSent > 1 ? "s" : ""}`}
            />
            <StatCard
              label="Inscriptions"
              value={fmtNum(t.registrations)}
              variation={v("registrations")}
              hint={`${fmtNum(t.ftds)} premier${t.ftds > 1 ? "s" : ""} dépôt${t.ftds > 1 ? "s" : ""}${
                t.costPerRegistration !== null
                  ? ` · ${aiCostText(t.costPerRegistration)} d'IA par inscription`
                  : ""
              }`}
            />
            <StatCard
              label="Coût de l'IA ce mois-ci"
              value={aiCostText(monthCost)}
              hint={
                share === null
                  ? "Plafond à 0 € : aucune réponse"
                  : `sur ${fmtMoney(config.monthlyCapEur, "EUR", { digits: 0 })} de plafond (${pctText(share, 0)})`
              }
            />
          </div>

          <section aria-labelledby="conv-journey" className="space-y-3">
            <div>
              <h2 id="conv-journey" className="text-title text-foreground">
                Parcours, étape par étape
              </h2>
              <p className="text-note text-muted-foreground">
                Combien des conversations commencées sur la période sont arrivées à chaque étape, de
                l&apos;accueil jusqu&apos;à l&apos;inscription.
              </p>
            </div>
            {t.conversations === 0 ? (
              <p className="text-body text-muted-foreground">
                Aucune conversation commencée sur la période.
              </p>
            ) : (
              <BarList
                label="Parcours des conversations, étape par étape"
                max={top}
                items={stats.journey.map((s) => ({
                  key: s.stage,
                  label: statusLabel("conversationStage", s.stage),
                  value: s.count,
                  valueText: fmtNum(s.count),
                  note: s.share === null ? null : `${pctText(s.share)} des conversations`,
                }))}
              />
            )}
          </section>

          {showByUniverse ? (
            <section aria-labelledby="conv-by-universe" className="space-y-3">
              <div>
                <h2 id="conv-by-universe" className="text-title text-foreground">
                  Par univers
                </h2>
                <p className="text-note text-muted-foreground">
                  L&apos;univers de la persona qui a répondu : Rencontres, Casino ou Paris sportifs.
                </p>
              </div>
              <ConversationStatsTable
                label="Chiffres par univers"
                nameHeader="Univers"
                rows={stats.byUniverse}
                periodText={periodText}
                empty={{
                  title: "Rien sur la période",
                  description:
                    "Aucune conversation, aucun lien et aucune inscription sur cette période.",
                }}
              />
            </section>
          ) : null}

          <section aria-labelledby="conv-by-persona" className="space-y-3">
            <h2 id="conv-by-persona" className="text-title text-foreground">
              Par persona
            </h2>
            <ConversationStatsTable
              label="Chiffres par persona"
              nameHeader="Persona"
              rows={stats.byPersona}
              periodText={periodText}
              empty={{
                title: "Rien sur la période",
                description:
                  "Aucune conversation, aucun lien et aucune inscription sur cette période.",
              }}
            />
          </section>

          <section aria-labelledby="conv-by-source" className="space-y-3">
            <div>
              <h2 id="conv-by-source" className="text-title text-foreground">
                Par source
              </h2>
              <p className="text-note text-muted-foreground">
                La source, c&apos;est le mot ajouté après /start dans le lien du bot (une pub, une
                page, un canal). « Sans source » : la personne a seulement appuyé sur Démarrer.
              </p>
            </div>
            <ConversationStatsTable
              label="Chiffres par source"
              nameHeader="Source"
              rows={stats.bySource}
              periodText={periodText}
              empty={{
                title: "Rien sur la période",
                description:
                  "Aucune conversation, aucun lien et aucune inscription sur cette période.",
              }}
            />
          </section>
          <p className="text-note text-muted-foreground">
            Sous les conversations : le taux de réponse. Sous les liens ouverts : les liens envoyés.
            Sous les inscriptions : les premiers dépôts. Cliquez sur une ligne pour tous ses
            chiffres.
          </p>
        </div>
      )}
    </>
  );
}
