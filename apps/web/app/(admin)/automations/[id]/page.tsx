import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AUTOMATION_TRIGGER_LABELS, parseActions, summarizeActions, type AutomationTriggerKey } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { describeConditions } from "@/lib/automations/describe";
import { deleteRuleAction, duplicateRuleAction, testRuleOnMeAction, toggleRuleAction } from "../actions";
import { loadNames } from "../page";

export const metadata: Metadata = { title: "Automatisation" };

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  PENDING: { label: "en attente", variant: "secondary" },
  RUNNING: { label: "en cours", variant: "default" },
  DONE: { label: "terminé", variant: "outline" },
  FAILED: { label: "échec", variant: "destructive" },
  SKIPPED: { label: "ignoré", variant: "secondary" },
  CANCELLED: { label: "annulé", variant: "secondary" },
};

export default async function AutomationDetailPage({ params, searchParams }: PageProps<"/automations/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const rule = await prisma.automationRule.findUnique({ where: { id } });
  if (!rule) notFound();
  const [runs, names] = await Promise.all([
    prisma.automationRun.findMany({ where: { ruleId: id }, orderBy: { createdAt: "desc" }, take: 100, include: { member: { select: { id: true, firstName: true, username: true } } } }),
    loadNames(),
  ]);
  let actions = "";
  try { actions = summarizeActions(parseActions(rule.actions)); } catch { actions = "actions invalides"; }
  return (
    <>
      <PageHeader title={rule.name} description={`${AUTOMATION_TRIGGER_LABELS[rule.trigger as AutomationTriggerKey]} · ${describeConditions(rule.conditions, names)}`}>
        <form action={testRuleOnMeAction}><input type="hidden" name="ruleId" value={rule.id} /><Button type="submit" variant="outline">Tester sur moi</Button></form>
        <form action={toggleRuleAction}><input type="hidden" name="ruleId" value={rule.id} /><Button type="submit">{rule.isActive ? "Désactiver" : "Activer"}</Button></form>
        <Button variant="outline" render={<Link href={`/automations/${rule.id}/edit`} />}>Modifier</Button>
        <form action={duplicateRuleAction}><input type="hidden" name="ruleId" value={rule.id} /><Button type="submit" variant="ghost">Dupliquer</Button></form>
        {user.role === "ADMIN" ? <form action={deleteRuleAction}><input type="hidden" name="ruleId" value={rule.id} /><Button type="submit" variant="ghost" className="text-destructive">Supprimer</Button></form> : null}
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card className="mb-6">
        <CardContent className="grid gap-2 pt-6 text-sm md:grid-cols-4">
          <div><span className="text-muted-foreground">Statut :</span> {rule.isActive ? <Badge>active</Badge> : <Badge variant="secondary">inactive</Badge>}</div>
          <div><span className="text-muted-foreground">Alors :</span> {actions}</div>
          <div><span className="text-muted-foreground">Exécutions :</span> {fmtNum(rule.runs)} · une fois par membre : {rule.oncePerMember ? "oui" : "non"}</div>
          <div><span className="text-muted-foreground">Dernière :</span> {fmtDate(rule.lastRunAt)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Journal des exécutions (100 dernières)</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 ? <p className="text-sm text-muted-foreground">Aucune exécution pour l&apos;instant.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Membre</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Étape</TableHead>
                  <TableHead>Reprise</TableHead>
                  <TableHead>Détail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => {
                  const log = Array.isArray(r.log) ? (r.log as Array<{ step: number; type: string; ok: boolean; detail?: string }>) : [];
                  const s = STATUS[r.status] ?? { label: r.status, variant: "outline" as const };
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                      <TableCell><Link href={`/members/${r.member.id}`} className="underline-offset-2 hover:underline">{r.member.username ? `@${r.member.username}` : r.member.firstName ?? r.member.id}</Link></TableCell>
                      <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                      <TableCell className="tabular-nums">{r.step}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.resumeAt)}</TableCell>
                      <TableCell className="text-xs">
                        {r.error ? <span className="text-destructive">{r.error}</span> : null}
                        <ul className="text-muted-foreground">{log.map((l, i) => <li key={i}>{l.ok ? "✓" : "✗"} {l.type}{l.detail ? ` — ${l.detail}` : ""}</li>)}</ul>
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
