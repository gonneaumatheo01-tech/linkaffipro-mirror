import type { Metadata } from "next";
import Link from "next/link";
import { parseActions, summarizeActions } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { ActiveBadge, statusLabel } from "@/lib/status-badges";
import { describeConditions } from "@/lib/automations/describe";

export const metadata: Metadata = { title: "Relances automatiques" };

export default async function AutomationsPage({ searchParams }: PageProps<"/members/automations">) {
  const sp = await searchParams;
  const rules = await prisma.automationRule.findMany({
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
  });
  const names = await loadNames();
  return (
    <>
      <PageHeader
        backHref="/members"
        backLabel="Membres"
        title="Relances automatiques"
        description="Règles « si… alors… » que les bots appliquent seuls : par exemple relancer un membre 24 h après son arrivée, ou le remercier après un dépôt."
        help="Une règle est créée inactive. Testez-la sur vous-même depuis sa page, puis activez-la."
      >
        <Button className="max-md:h-10" render={<Link href="/members/automations/new" />}>
          Nouvelle règle
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="pt-6">
          {rules.length === 0 ? (
            <EmptyState
              title="Aucune règle pour l'instant."
              description="Partez d'un modèle (relance 24 h, merci après dépôt, membres inactifs…) : chaque règle est créée inactive, vous la testez sur vous avant de l'activer."
              action={{ href: "/members/automations/new", label: "Créer une règle" }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Règle</TableHead>
                  <TableHead>Si…</TableHead>
                  <TableHead className="hidden md:table-cell">Alors…</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Exécutions</TableHead>
                  <TableHead className="hidden lg:table-cell">Dernière</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => {
                  let actions = "";
                  try {
                    actions = summarizeActions(parseActions(r.actions));
                  } catch {
                    actions = "actions à corriger";
                  }
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          href={`/members/automations/${r.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">
                        {statusLabel("automationTrigger", r.trigger)}
                        <div className="text-xs text-muted-foreground">
                          {describeConditions(r.conditions, names)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal text-sm md:table-cell">
                        {actions}
                      </TableCell>
                      <TableCell>
                        <ActiveBadge active={r.isActive} />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(r.runs)}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                        {fmtDate(r.lastRunAt)}
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
