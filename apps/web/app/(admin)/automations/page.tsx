import type { Metadata } from "next";
import Link from "next/link";
import { AUTOMATION_TRIGGER_LABELS, parseActions, summarizeActions, type AutomationTriggerKey } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { describeConditions } from "@/lib/automations/describe";

export const metadata: Metadata = { title: "Automatisations" };

export default async function AutomationsPage({ searchParams }: PageProps<"/automations">) {
  const sp = await searchParams;
  const rules = await prisma.automationRule.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] });
  const names = await loadNames();
  return (
    <>
      <PageHeader title="Automatisations" description="Règles « si… alors… » exécutées automatiquement par les bots.">
        <Button render={<Link href="/automations/new" />}>Nouvelle règle</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="pt-6">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune règle. Créez-en une à partir d&apos;un modèle (relance 24 h, merci après dépôt, inactifs…).</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Règle</TableHead>
                  <TableHead>Si…</TableHead>
                  <TableHead>Alors…</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Exécutions</TableHead>
                  <TableHead>Dernière</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => {
                  let actions = "";
                  try { actions = summarizeActions(parseActions(r.actions)); } catch { actions = "actions invalides"; }
                  return (
                    <TableRow key={r.id}>
                      <TableCell><Link href={`/automations/${r.id}`} className="font-medium underline-offset-2 hover:underline">{r.name}</Link></TableCell>
                      <TableCell className="text-sm">{AUTOMATION_TRIGGER_LABELS[r.trigger as AutomationTriggerKey]}<div className="text-xs text-muted-foreground">{describeConditions(r.conditions, names)}</div></TableCell>
                      <TableCell className="text-sm">{actions}</TableCell>
                      <TableCell>{r.isActive ? <Badge>active</Badge> : <Badge variant="secondary">inactive</Badge>}</TableCell>
                      <TableCell className="tabular-nums">{fmtNum(r.runs)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.lastRunAt)}</TableCell>
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

export async function loadNames() {
  const [channels, campaigns, categories] = await Promise.all([
    prisma.channel.findMany({ select: { id: true, title: true } }),
    prisma.campaign.findMany({ select: { id: true, name: true } }),
    prisma.messageCategory.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    channels: Object.fromEntries(channels.map((c) => [c.id, c.title])),
    campaigns: Object.fromEntries(campaigns.map((c) => [c.id, c.name])),
    categories: Object.fromEntries(categories.map((c) => [c.id, c.name])),
  };
}
