import type { Metadata } from "next";
import Link from "next/link";
import { Workflow } from "lucide-react";
import {
  AUTOMATION_TRIGGER_LABELS,
  graphForRule,
  summarizeGraph,
  type AutomationTriggerKey,
} from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { AutomationCard } from "@/components/automations/automation-card";
import { RuleStatusPill } from "@/components/automations/rule-status";
import { MembersNav } from "@/components/members/members-nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { groupRulesByCard } from "@/lib/automations/cards";
import { describeConditions } from "@/lib/automations/describe";
import { loadEditorOptions, loadNames, loadRuleCounters } from "@/lib/automations/queries";
import { fmtNum, fmtRelative } from "@/lib/format";
import { saveCardAction, testRuleOnMeAction, toggleRuleAction } from "./actions";

export const metadata: Metadata = { title: "Relances automatiques" };

/** Parcours en une phrase (liste « sur mesure »). */
function pathText(
  rule: { graph: unknown; actions: unknown },
  names: { channels: Record<string, string>; campaigns: Record<string, string> },
) {
  try {
    return summarizeGraph(graphForRule(rule), names);
  } catch {
    return "Parcours à corriger";
  }
}

/** Ce qui lance la relance, avec les mêmes mots que l'éditeur (« A quitté un canal »). */
const triggerText = (t: string) => AUTOMATION_TRIGGER_LABELS[t as AutomationTriggerKey] ?? t;

/** Activité de la semaine en une ligne (« 12 envois · 3 clics », « Jamais lancée »). */
function weekText(
  c: { sent: number; clicked: number } | undefined,
  lastRunAt: Date | null,
  now: Date,
): string {
  if (c?.sent)
    return `${fmtNum(c.sent)} envoi${c.sent > 1 ? "s" : ""} · ${fmtNum(c.clicked)} clic${c.clicked > 1 ? "s" : ""}`;
  return lastRunAt ? `Dernière fois ${fmtRelative(lastRunAt, now)}` : "Jamais lancée";
}

export default async function AutomationsPage({ searchParams }: PageProps<"/members/automations">) {
  const sp = await searchParams;
  const now = new Date();
  const [rules, names, options] = await Promise.all([
    prisma.automationRule.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] }),
    loadNames(),
    loadEditorOptions(),
  ]);
  const counters = await loadRuleCounters(
    rules.map((r) => r.id),
    now,
  );
  const { cards, custom } = groupRulesByCard(rules);
  const summary = (r: { id: string; name: string; isActive: boolean }) => ({
    id: r.id,
    name: r.name,
    isActive: r.isActive,
  });
  const active = rules.filter((r) => r.isActive).length;

  return (
    <>
      <MembersNav current="automations" />
      <PageHeader
        title="Relances automatiques"
        description="Des messages que le bot envoie seul, au bon moment, à chaque membre concerné."
        help={`${
          active === 0
            ? "Aucune relance activée"
            : `${fmtNum(active)} relance${active > 1 ? "s" : ""} activée${active > 1 ? "s" : ""}`
        }. Une relance est créée désactivée : réglez-la, testez-la sur vous, puis activez-la.`}
        secondaryActions={
          <Link
            href="/members/automations/new"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <Workflow aria-hidden />
            Créer une relance sur mesure (avancé)
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <section aria-labelledby="pretes" className="space-y-3">
        <div>
          <h2 id="pretes" className="text-body font-semibold text-foreground">
            Prêtes à l&apos;emploi
          </h2>
          <p className="text-note text-muted-foreground">
            Réglez le délai, le message et les canaux, puis activez.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {cards.map((c) => (
            <AutomationCard
              key={c.key}
              cardKey={c.key}
              rule={c.rule ? summary(c.rule) : null}
              settings={c.settings}
              others={c.others.map(summary)}
              counter={c.rule ? counters[c.rule.id] : undefined}
              channelNames={names.channels}
              options={{ channels: options.channels, bots: options.bots, media: options.media }}
              actions={{ save: saveCardAction, toggle: toggleRuleAction, test: testRuleOnMeAction }}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="sur-mesure" className="mt-8 space-y-3">
        <div>
          <h2 id="sur-mesure" className="text-body font-semibold text-foreground">
            Sur mesure
          </h2>
          <p className="text-note text-muted-foreground">
            Vos relances avec des conditions ou plusieurs étapes, faites dans l&apos;éditeur avancé.
          </p>
        </div>
        {custom.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="Aucune relance sur mesure"
            description="Pour un parcours avec des conditions (« a-t-il déposé ? ») et plusieurs étapes, utilisez l'éditeur avancé."
            action={{
              href: "/members/automations/new",
              label: "Créer une relance sur mesure",
              variant: "outline",
            }}
          />
        ) : (
          <DataTable
            label="Relances sur mesure"
            columns={[
              { key: "name", header: "Relance" },
              { key: "when", header: "Quand", hideOnMobile: true },
              { key: "path", header: "Parcours", hideOnMobile: true, sortable: false },
              { key: "status", header: "Statut", sortable: false, hideOnMobile: true },
              { key: "week", header: "Cette semaine", hideOnMobile: true, sortable: false },
            ]}
            rows={custom.map((r) => {
              const c = counters[r.id];
              return {
                id: r.id,
                href: `/members/automations/${r.id}`,
                cells: {
                  name: (
                    <span className="block min-w-0 whitespace-normal">
                      <span className="block font-medium break-words">{r.name}</span>
                      {/* Téléphone : la ligne devient une carte (déclencheur, statut et semaine dedans). */}
                      <span className="mt-1 block space-y-1 font-normal md:hidden">
                        <span className="block text-note text-muted-foreground">
                          {triggerText(r.trigger)}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <RuleStatusPill active={r.isActive} />
                          <span className="text-note">{weekText(c, r.lastRunAt, now)}</span>
                        </span>
                      </span>
                    </span>
                  ),
                  when: (
                    <span className="block min-w-0 whitespace-normal">
                      {triggerText(r.trigger)}
                      <span className="block text-note text-muted-foreground">
                        {describeConditions(r.conditions, names)}
                      </span>
                    </span>
                  ),
                  path: (
                    <span className="line-clamp-2 whitespace-normal text-note">
                      {pathText(r, names)}
                    </span>
                  ),
                  status: <RuleStatusPill active={r.isActive} />,
                  week: <span className="text-note">{weekText(c, r.lastRunAt, now)}</span>,
                },
                sortValues: { name: r.name },
              };
            })}
          />
        )}
      </section>
    </>
  );
}
