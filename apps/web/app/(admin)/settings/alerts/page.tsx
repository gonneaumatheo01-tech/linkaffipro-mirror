import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import {
  checkAlertsNowAction,
  purgeNowAction,
  resolveAlertAction,
  saveRetentionAction,
} from "./actions";

export const metadata: Metadata = { title: "Alertes et rétention" };

const KIND_LABELS: Record<string, string> = {
  bot_webhook: "Bot en difficulté",
  sync_failed: "Synchro Link Affi en échec",
  queue_backlog: "File d'envoi engorgée",
  dm_blocked: "Messages privés bloqués en masse",
  subid_health: "Santé de l'identifiant de suivi (sub-ID)",
  worker_down: "Worker arrêté",
  job_failures: "Erreurs répétées dans une file",
  backup_failed: "Sauvegarde en échec",
};

export default async function AlertsPage({ searchParams }: PageProps<"/settings/alerts">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [alerts, retention, lastPurge] = await Promise.all([
    prisma.alert.findMany({
      orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.setting.findUnique({ where: { key: "retention.months" } }),
    prisma.auditLog.findFirst({
      where: { action: "maintenance.purge" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const months =
    typeof retention?.value === "number" ? retention.value : Number(retention?.value ?? 24) || 24;
  const openCount = alerts.filter((a) => !a.resolvedAt).length;
  const purgeMeta = (lastPurge?.metadata ?? null) as {
    membersAnonymized?: number;
    eventsDeleted?: number;
  } | null;

  return (
    <>
      <PageHeader
        title="Alertes et rétention"
        description="Surveillance automatique du système (toutes les 5 minutes) et effacement des données personnelles au-delà de la durée de conservation."
        help="Une alerte ouverte vous est envoyée une fois sur Telegram ; elle se ferme seule quand le problème disparaît. « Vérifier maintenant » force un passage."
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings" />}
        >
          ← Réglages
        </Button>
        <form action={checkAlertsNowAction}>
          <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
            Vérifier maintenant
          </Button>
        </form>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Alertes{" "}
            {openCount > 0 ? (
              <Badge variant="destructive" className="ml-2">
                {openCount} ouverte{openCount > 1 ? "s" : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2">
                aucune ouverte
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Chaque alerte est envoyée une fois par Telegram à l&apos;administrateur, puis se résout
            seule quand la cause disparaît.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <EmptyState
              title="Aucune alerte enregistrée."
              description="Tout fonctionne. Les alertes apparaîtront ici (bot injoignable, synchronisation en échec, sauvegarde ratée…)."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Gravité</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="hidden lg:table-cell">Notifiée</TableHead>
                  <TableHead className="hidden md:table-cell">Résolue</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => (
                  <TableRow key={a.id} className={a.resolvedAt ? "text-muted-foreground" : ""}>
                    <TableCell className="whitespace-nowrap">{fmtDate(a.createdAt)}</TableCell>
                    <TableCell>
                      <StatusBadge kind="alert" value={a.severity} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {KIND_LABELS[a.kind] ?? a.kind}
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">{a.message}</TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">
                      {a.notifiedAt ? fmtDate(a.notifiedAt) : "—"}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {a.resolvedAt ? (
                        fmtDate(a.resolvedAt)
                      ) : (
                        <Badge variant="outline">ouverte</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!a.resolvedAt ? (
                        <form action={resolveAlertAction}>
                          <input type="hidden" name="alertId" value={a.id} />
                          <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                            Marquer résolue
                          </Button>
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
            <CardDescription>
              Au-delà de cette durée, les membres inactifs sont anonymisés et leurs événements
              supprimés (sauf les événements joueurs). Règle de l&apos;équipe : 24 mois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={saveRetentionAction}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div className="space-y-2">
                <Label htmlFor="months">Durée en mois (de 6 à 120)</Label>
                <Input
                  id="months"
                  name="months"
                  type="number"
                  min={6}
                  max={120}
                  defaultValue={months}
                  className="h-10 w-32 md:h-9"
                />
              </div>
              <Button type="submit" className="max-md:h-10">
                Enregistrer
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Purge</CardTitle>
            <CardDescription>
              Exécutée automatiquement chaque nuit.{" "}
              {lastPurge
                ? `Dernière purge : ${fmtDate(lastPurge.createdAt)} (${purgeMeta?.membersAnonymized ?? 0} membre(s) anonymisé(s), ${purgeMeta?.eventsDeleted ?? 0} événement(s) supprimé(s)).`
                : "Aucune purge exécutée pour l'instant."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={purgeNowAction}>
              <ConfirmSubmit
                variant="outline"
                className="max-md:h-10"
                message={`La purge va anonymiser tous les membres inactifs depuis plus de ${months} mois et supprimer leurs événements. Cette action est irréversible. Continuer ?`}
              >
                Lancer la purge maintenant
              </ConfirmSubmit>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
