import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseActions, summarizeActions } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { ActiveBadge, StatusBadge, statusLabel } from "@/lib/status-badges";
import { describeConditions } from "@/lib/automations/describe";
import {
  deleteRuleAction,
  duplicateRuleAction,
  testRuleOnMeAction,
  toggleRuleAction,
} from "../actions";
import { loadNames } from "../page";

export const metadata: Metadata = { title: "Automatisation" };

export default async function AutomationDetailPage({
  params,
  searchParams,
}: PageProps<"/members/automations/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const rule = await prisma.automationRule.findUnique({ where: { id } });
  if (!rule) notFound();
  const [runs, names] = await Promise.all([
    prisma.automationRun.findMany({
      where: { ruleId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { member: { select: { id: true, firstName: true, username: true } } },
    }),
    loadNames(),
  ]);
  let actions = "";
  try {
    actions = summarizeActions(parseActions(rule.actions));
  } catch {
    actions = "actions à corriger";
  }
  return (
    <>
      <PageHeader
        title={rule.name}
        description={`${statusLabel("automationTrigger", rule.trigger)} · ${describeConditions(rule.conditions, names)}`}
        help={
          rule.isActive
            ? "Cette règle s'applique aux vrais membres. Désactivez-la avant toute modification importante."
            : "Règle inactive : testez-la sur vous (compte Telegram lié dans Mon compte), puis activez-la."
        }
      >
        <form action={testRuleOnMeAction}>
          <input type="hidden" name="ruleId" value={rule.id} />
          <Button type="submit" variant="outline" className="max-md:h-10">
            Tester sur moi
          </Button>
        </form>
        <form action={toggleRuleAction}>
          <input type="hidden" name="ruleId" value={rule.id} />
          {rule.isActive ? (
            <ConfirmSubmit
              className="max-md:h-10"
              message="La règle sera désactivée : plus aucune exécution ne démarrera pour les membres. Continuer ?"
            >
              Désactiver
            </ConfirmSubmit>
          ) : (
            <ConfirmSubmit
              className="max-md:h-10"
              message="La règle sera activée et s'appliquera aux vrais membres dès le prochain événement correspondant. Continuer ?"
            >
              Activer
            </ConfirmSubmit>
          )}
        </form>
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<Link href={`/members/automations/${rule.id}/edit`} />}
        >
          Modifier
        </Button>
        <form action={duplicateRuleAction}>
          <input type="hidden" name="ruleId" value={rule.id} />
          <Button type="submit" variant="ghost" className="max-md:h-10">
            Dupliquer
          </Button>
        </form>
        {user.role === "ADMIN" ? (
          <form action={deleteRuleAction}>
            <input type="hidden" name="ruleId" value={rule.id} />
            <ConfirmSubmit
              variant="ghost"
              className="text-destructive max-md:h-10"
              message={`La règle « ${rule.name} » et son journal d'exécutions seront supprimés définitivement. Continuer ?`}
            >
              Supprimer
            </ConfirmSubmit>
          </form>
        ) : null}
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="mb-6">
        <CardContent className="grid gap-2 pt-6 text-sm md:grid-cols-4">
          <div>
            <span className="text-muted-foreground">Statut :</span>{" "}
            <ActiveBadge active={rule.isActive} />
          </div>
          <div>
            <span className="text-muted-foreground">Alors :</span> {actions}
          </div>
          <div>
            <span className="text-muted-foreground">Exécutions :</span> {fmtNum(rule.runs)} · une
            seule fois par membre : {rule.oncePerMember ? "oui" : "non"}
          </div>
          <div>
            <span className="text-muted-foreground">Dernière :</span> {fmtDate(rule.lastRunAt)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Journal des exécutions</CardTitle>
          <CardDescription>
            Les 100 dernières. Chaque ligne montre les étapes réalisées pour un membre et
            l&apos;erreur éventuelle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune exécution pour l&apos;instant. Cliquez sur « Tester sur moi » pour vérifier la
              règle.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Membre</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden md:table-cell">Étape</TableHead>
                  <TableHead className="hidden lg:table-cell">Reprise prévue</TableHead>
                  <TableHead className="hidden md:table-cell">Détail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => {
                  const log = Array.isArray(r.log)
                    ? (r.log as Array<{ step: number; type: string; ok: boolean; detail?: string }>)
                    : [];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {fmtDate(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/members/${r.member.id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {r.member.username
                            ? `@${r.member.username}`
                            : (r.member.firstName ?? r.member.id)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="automationRun" value={r.status} />
                      </TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">{r.step}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                        {fmtDate(r.resumeAt)}
                      </TableCell>
                      <TableCell className="hidden whitespace-normal text-xs md:table-cell">
                        {r.error ? <span className="text-destructive">{r.error}</span> : null}
                        <ul className="text-muted-foreground">
                          {log.map((l, i) => (
                            <li key={i}>
                              <span aria-label={l.ok ? "réussi" : "échoué"}>
                                {l.ok ? "✓" : "✗"}
                              </span>{" "}
                              {l.type}
                              {l.detail ? ` — ${l.detail}` : ""}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
