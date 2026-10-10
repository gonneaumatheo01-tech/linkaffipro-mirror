import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleX, Copy, PencilLine, Trash2, Workflow } from "lucide-react";
import {
  AUTOMATION_TRIGGER_LABELS,
  summarizeGraph,
  validateGraph,
  type AutomationTriggerKey,
} from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { RuleFlowView } from "@/components/automations/rule-flow-view";
import { RuleStatusPill } from "@/components/automations/rule-status";
import { RuleSwitch, TestOnMeButton } from "@/components/automations/rule-switch";
import { MembersNav } from "@/components/members/members-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { recognizeCard } from "@/lib/automations/cards";
import { counterSentence, isTestRun } from "@/lib/automations/counter";
import { describeConditions } from "@/lib/automations/describe";
import { draftToRaw, outlineDraft, ruleToDraft } from "@/lib/automations/flow";
import {
  logEntryLabel,
  nodeLabel,
  nodeStatsRows,
  ruleNodeStats,
  runLogWithNodes,
  runWhereText,
} from "@/lib/automations/journal";
import { loadNames, loadRuleCounters } from "@/lib/automations/queries";
import { fmtDate, fmtNum, fmtRelative } from "@/lib/format";
import { displayName } from "@/lib/members/query";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import {
  deleteRuleAction,
  duplicateRuleAction,
  testRuleOnMeAction,
  toggleRuleAction,
} from "../actions";

export const metadata: Metadata = { title: "Relance automatique" };

/** Exécutions lues pour le journal par bloc ; les plus récentes sont listées en dessous. */
const STATS_RUNS = 500;
const LISTED_RUNS = 50;

export default async function AutomationDetailPage({
  params,
  searchParams,
}: PageProps<"/members/automations/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const rule = await prisma.automationRule.findUnique({ where: { id } });
  if (!rule) notFound();
  const now = new Date();
  const [runs, names, counters] = await Promise.all([
    prisma.automationRun.findMany({
      where: { ruleId: id },
      orderBy: { createdAt: "desc" },
      take: STATS_RUNS,
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            anonymizedAt: true,
            telegramUserId: true,
          },
        },
      },
    }),
    loadNames(),
    loadRuleCounters([id], now),
  ]);
  const graphNames = { channels: names.channels, campaigns: names.campaigns };
  const linear = rule.graph === null;
  const { draft, readError } = ruleToDraft(rule);
  const graph = validateGraph(draftToRaw(draft)).graph;
  const stats = ruleNodeStats(runs, linear);
  const order = outlineDraft(draft, graphNames)
    .filter((i) => !i.repeat)
    .map((i) => i.id);
  const card = recognizeCard(rule);
  const counter = counters[id];
  // Même libellé que l'éditeur et les cartes (« A quitté un canal », « A déposé »).
  const triggerText =
    AUTOMATION_TRIGGER_LABELS[rule.trigger as AutomationTriggerKey] ?? rule.trigger;
  const filtersText = describeConditions(rule.conditions, names);
  const listed = runs.slice(0, LISTED_RUNS);
  // Comme la liste des membres : le nom, sinon @pseudo, sinon l'identifiant Telegram.
  const memberName = displayName;

  return (
    <>
      <MembersNav current="automations" />
      <PageHeader
        backHref="/members/automations"
        backLabel="Relances automatiques"
        title={rule.name}
        meta={
          <>
            <RuleStatusPill active={rule.isActive} />
            {card ? <StatusPill tone="brand">Prête à l&apos;emploi</StatusPill> : null}
          </>
        }
        description={`Quand : ${triggerText} · Pour : ${filtersText}`}
        help={
          rule.isActive
            ? "Cette relance part vers les vrais membres. Désactivez-la avant une modification importante."
            : "Relance désactivée : testez-la sur vous (compte Telegram lié dans Mon compte), puis activez-la."
        }
        secondaryActions={
          <>
            <RuleSwitch
              ruleId={rule.id}
              active={rule.isActive}
              title={rule.name}
              action={toggleRuleAction}
            />
            <TestOnMeButton ruleId={rule.id} action={testRuleOnMeAction} size="default" />
            <Link
              href={
                card ? `/members/automations#carte-${card}` : `/members/automations/${rule.id}/edit`
              }
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <PencilLine aria-hidden />
              Modifier
            </Link>
          </>
        }
      />
      <Flash
        ok={sp.ok}
        error={sp.error ?? (readError ? `Parcours à corriger : ${readError}` : undefined)}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Envoyé cette semaine"
          value={fmtNum(counter?.sent ?? 0)}
          hint={counterSentence(counter)}
        />
        <StatCard
          label="Ont cliqué après le message"
          value={fmtNum(counter?.clicked ?? 0)}
          hint="Clics sur une offre, 7 derniers jours."
        />
        <StatCard
          label="Exécutions depuis le début"
          value={fmtNum(rule.runs)}
          hint={rule.lastRunAt ? `Dernière ${fmtRelative(rule.lastRunAt, now)}` : "Jamais lancée"}
        />
      </div>

      <section aria-labelledby="parcours" className="mb-8 space-y-3">
        <div>
          <h2 id="parcours" className="text-body font-semibold text-foreground">
            Le parcours et ses passages
          </h2>
          <p className="text-note text-muted-foreground">
            {graph ? `${summarizeGraph(graph, graphNames)}.` : "Parcours à corriger."}{" "}
            {runs.length === 0
              ? "Aucune exécution pour l'instant."
              : runs.length >= STATS_RUNS
                ? `Passages comptés sur les ${fmtNum(STATS_RUNS)} dernières exécutions.`
                : "Passages comptés sur toutes les exécutions."}
          </p>
        </div>
        {graph ? (
          <div className="hidden md:block">
            <RuleFlowView
              graph={graph}
              names={graphNames}
              triggerText={triggerText}
              filtersText={filtersText}
              stats={stats}
            />
          </div>
        ) : null}
        {graph ? (
          <DataTable
            label="Passages par bloc"
            columns={[
              { key: "label", header: "Bloc", sortable: false },
              { key: "reached", header: "Passages", align: "right", sortable: false },
              { key: "branches", header: "Oui / non", hideOnMobile: true, sortable: false },
              {
                key: "waiting",
                header: "En attente",
                align: "right",
                hideOnMobile: true,
                sortable: false,
              },
              { key: "failed", header: "Erreurs", align: "right", sortable: false },
            ]}
            rows={nodeStatsRows(graph, stats, order, graphNames).map((r) => ({
              id: r.id,
              cells: {
                label: <span className="whitespace-normal">{r.label}</span>,
                reached: fmtNum(r.reached),
                branches: r.type === "condition" ? `${fmtNum(r.yes)} / ${fmtNum(r.no)}` : "—",
                waiting: fmtNum(r.waiting),
                failed: r.failed ? (
                  <span className="font-medium text-danger">{fmtNum(r.failed)}</span>
                ) : (
                  "0"
                ),
              },
              detailTitle: r.label,
              detail: (
                <div className="space-y-3 text-body">
                  <p>
                    {fmtNum(r.reached)} passage{r.reached > 1 ? "s" : ""}, {fmtNum(r.failed)} erreur
                    {r.failed > 1 ? "s" : ""}
                    {r.waiting ? `, ${fmtNum(r.waiting)} en attente avant ce bloc` : ""}.
                  </p>
                  {r.type === "condition" ? (
                    <p>
                      Oui : {fmtNum(r.yes)} · Non : {fmtNum(r.no)}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground">
                    {r.lastError ? `Dernière erreur : ${r.lastError}` : "Aucune erreur récente."}
                  </p>
                </div>
              ),
            }))}
            empty={{
              title: "Aucun bloc",
              description: "Ce parcours ne contient encore aucun bloc.",
            }}
          />
        ) : null}
      </section>

      <section aria-labelledby="executions" className="space-y-3">
        <div>
          <h2 id="executions" className="text-body font-semibold text-foreground">
            Dernières exécutions
          </h2>
          <p className="text-note text-muted-foreground">
            Les {LISTED_RUNS} plus récentes. Cliquez sur une ligne pour voir chaque étape.
          </p>
        </div>
        <DataTable
          label="Dernières exécutions"
          columns={[
            { key: "when", header: "Quand" },
            { key: "member", header: "Membre" },
            { key: "status", header: "Statut", sortable: false },
            { key: "where", header: "Où elle en est", hideOnMobile: true, sortable: false },
          ]}
          rows={listed.map((r) => {
            const log = runLogWithNodes(r, linear);
            const test = isTestRun(r.context);
            return {
              id: r.id,
              cells: {
                when: (
                  <span className="whitespace-nowrap" title={fmtDate(r.createdAt)}>
                    {fmtRelative(r.createdAt, now)}
                  </span>
                ),
                member: (
                  <span>
                    {memberName(r.member)}
                    {test ? (
                      <span className="ml-1.5 text-note text-muted-foreground">(test)</span>
                    ) : null}
                  </span>
                ),
                status: <StatusBadge kind="automationRun" value={r.status} />,
                where: (
                  <span className="whitespace-normal text-note">
                    {graph ? runWhereText(r, graph, linear, graphNames) : "—"}
                  </span>
                ),
              },
              sortValues: { when: r.createdAt.getTime(), member: memberName(r.member) },
              detailTitle: `${memberName(r.member)} · ${fmtDate(r.createdAt)}`,
              detailDescription: test ? "Essai « Tester sur moi »." : undefined,
              detail: (
                <div className="space-y-4 text-body">
                  <p>
                    <Link
                      href={`/members/${r.member.id}`}
                      className="font-medium text-brand-ink underline-offset-2 hover:underline"
                    >
                      Ouvrir la fiche du membre
                    </Link>
                  </p>
                  {r.error ? <p className="text-danger">{r.error}</p> : null}
                  {r.status === "PENDING" && r.resumeAt ? (
                    <p className="text-muted-foreground">
                      Reprise prévue le {fmtDate(r.resumeAt)}.
                    </p>
                  ) : null}
                  {log.length === 0 ? (
                    <p className="text-muted-foreground">Aucune étape pour l&apos;instant.</p>
                  ) : (
                    <ol className="space-y-2">
                      {log.map((e, i) => {
                        const where = graph ? nodeLabel(graph, e.nodeId, graphNames) : null;
                        const title =
                          e.type === "condition"
                            ? `${where ?? "Condition"} → ${e.branch === "yes" ? "oui" : e.branch === "no" ? "non" : "?"}`
                            : (where ?? logEntryLabel(e));
                        // Le détail d'une condition ou d'une attente répète le titre : seul celui d'une action est utile.
                        const detail =
                          e.type === "condition" || e.type === "wait"
                            ? e.ok
                              ? null
                              : e.detail
                            : e.detail;
                        return (
                          <li key={i} className="flex gap-2">
                            {e.ok ? (
                              <CircleCheck
                                aria-hidden
                                className="mt-0.5 size-4 shrink-0 text-success"
                              />
                            ) : (
                              <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                            )}
                            <span className="min-w-0">
                              <span className="sr-only">{e.ok ? "Réussi : " : "Échec : "}</span>
                              <span className="font-medium break-words">{title}</span>
                              {detail ? (
                                <span
                                  className={cn(
                                    "block text-note",
                                    e.ok ? "text-muted-foreground" : "text-danger",
                                  )}
                                >
                                  {detail}
                                </span>
                              ) : null}
                              <span className="block text-note text-muted-foreground">
                                {fmtDate(new Date(e.at))}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              ),
            };
          })}
          empty={{
            title: "Aucune exécution pour l'instant",
            description: "Cliquez sur « Tester sur moi » pour vérifier la relance.",
          }}
        />
      </section>

      <section
        aria-labelledby="autres-actions"
        className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-4"
      >
        <h2 id="autres-actions" className="mr-2 text-body font-semibold text-foreground">
          Autres actions
        </h2>
        {card ? (
          <Link
            href={`/members/automations/${rule.id}/edit`}
            className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
          >
            <Workflow aria-hidden />
            Ouvrir dans l&apos;éditeur avancé
          </Link>
        ) : null}
        <form action={duplicateRuleAction}>
          <input type="hidden" name="ruleId" value={rule.id} />
          <Button type="submit" variant="ghost" className="max-md:h-10">
            <Copy aria-hidden />
            Dupliquer
          </Button>
        </form>
        {user.role === "ADMIN" ? (
          <form action={deleteRuleAction}>
            <input type="hidden" name="ruleId" value={rule.id} />
            <ConfirmSubmit
              variant="ghost"
              className="text-danger max-md:h-10"
              confirmTitle={`Supprimer « ${rule.name} » ?`}
              message="La relance et son journal seront supprimés définitivement. Les membres en attente ne recevront pas la suite."
              destructive
            >
              <Trash2 aria-hidden />
              Supprimer
            </ConfirmSubmit>
          </form>
        ) : null}
      </section>
    </>
  );
}
