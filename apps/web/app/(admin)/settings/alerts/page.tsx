import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { checkAlertsNowAction, purgeNowAction, resolveAlertAction, saveRetentionAction } from "./actions";

export const metadata: Metadata = { title: "Alertes" };

const KIND_LABELS: Record<string, string> = {
  bot_webhook: "Bot en difficulté",
  sync_failed: "Synchro Link Affi en échec",
  queue_backlog: "File d'envoi engorgée",
  dm_blocked: "Messages privés bloqués en masse",
  subid_health: "Santé du sub-ID",
  worker_down: "Worker arrêté",
  job_failures: "Erreurs répétées dans une file",
  backup_failed: "Sauvegarde en échec",
};

function severityBadge(s: string) {
  if (s === "CRITICAL") return <Badge variant="destructive">critique</Badge>;
  if (s === "WARNING") return <Badge>attention</Badge>;
  return <Badge variant="secondary">info</Badge>;
}

export default async function AlertsPage({ searchParams }: PageProps<"/settings/alerts">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [alerts, retention, lastPurge] = await Promise.all([
    prisma.alert.findMany({ orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 200 }),
    prisma.setting.findUnique({ where: { key: "retention.months" } }),
    prisma.auditLog.findFirst({ where: { action: "maintenance.purge" }, orderBy: { createdAt: "desc" } }),
  ]);
  const months = typeof retention?.value === "number" ? retention.value : Number(retention?.value ?? 24) || 24;
  const openCount = alerts.filter((a) => !a.resolvedAt).length;
  const purgeMeta = (lastPurge?.metadata ?? null) as { membersAnonymized?: number; eventsDeleted?: number } | null;

  return (
    <>
      <PageHeader title="Alertes et rétention" description="Surveillance automatique (toutes les 5 minutes) et purge des données au-delà de la durée de conservation.">
        <Button variant="outline" size="sm" render={<Link href="/settings" />}>← Réglages</Button>
        <form action={checkAlertsNowAction}>
          <Button type="submit" size="sm" variant="outline">Vérifier maintenant</Button>
        </form>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alertes {openCount > 0 ? <Badge variant="destructive" className="ml-2">{openCount} ouverte{openCount > 1 ? "s" : ""}</Badge> : <Badge variant="outline" className="ml-2">aucune ouverte</Badge>}</CardTitle>
          <CardDescription>Chaque alerte est envoyée une fois par Telegram à l&apos;administrateur, puis se résout seule quand la cause disparaît.</CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune alerte enregistrée.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Gravité</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Notifiée</TableHead>
                  <TableHead>Résolue</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => (
                  <TableRow key={a.id} className={a.resolvedAt ? "text-muted-foreground" : ""}>
                    <TableCell className="whitespace-nowrap">{fmtDate(a.createdAt)}</TableCell>
                    <TableCell>{severityBadge(a.severity)}</TableCell>
                    <TableCell>{KIND_LABELS[a.kind] ?? a.kind}</TableCell>
                    <TableCell className="max-w-md">{a.message}</TableCell>
                    <TableCell className="whitespace-nowrap">{a.notifiedAt ? fmtDate(a.notifiedAt) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{a.resolvedAt ? fmtDate(a.resolvedAt) : <Badge variant="outline">ouverte</Badge>}</TableCell>
                    <TableCell className="text-right">
                      {!a.resolvedAt ? (
                        <form action={resolveAlertAction}>
                          <input type="hidden" name="alertId" value={a.id} />
                          <Button type="submit" size="sm" variant="outline">Marquer résolu</Button>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Durée de conservation</CardTitle>
            <CardDescription>Au-delà, les membres inactifs sont anonymisés et les événements supprimés (sauf les événements joueurs). Règle produit : 24 mois.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveRetentionAction} className="flex items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="months">Mois (minimum 6)</Label>
                <Input id="months" name="months" type="number" min={6} max={120} defaultValue={months} className="w-32" />
              </div>
              <Button type="submit">Enregistrer</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Purge</CardTitle>
            <CardDescription>Exécutée automatiquement chaque nuit par le worker. {lastPurge ? `Dernière purge : ${fmtDate(lastPurge.createdAt)} (${purgeMeta?.membersAnonymized ?? 0} membre(s) anonymisé(s), ${purgeMeta?.eventsDeleted ?? 0} événement(s) supprimé(s)).` : "Aucune purge exécutée pour l'instant."}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={purgeNowAction}>
              <Button type="submit" variant="outline">Lancer la purge maintenant</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
