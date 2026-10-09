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
import { HelpTip } from "@/components/admin/help-tip";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import {
  checkAlertsNowAction,
  purgeNowAction,
  resolveAlertAction,
  saveAlertThresholdsAction,
  saveRetentionAction,
} from "./actions";
import { ALERT_THRESHOLDS_KEY, parseThresholds } from "./thresholds";

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
  registrations_drop: "Chute des inscriptions",
  spend_no_conversion: "Dépense sans inscription",
  channel_leak: "Canal qui perd ses membres",
  post_failed: "Message programmé en échec",
  offer_link_inactive: "Lien désactivé encore cliqué",
};

export default async function AlertsPage({ searchParams }: PageProps<"/settings/alerts">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [alerts, retention, lastPurge, thresholdsRow] = await Promise.all([
    prisma.alert.findMany({
      orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.setting.findUnique({ where: { key: "retention.months" } }),
    prisma.auditLog.findFirst({
      where: { action: "maintenance.purge" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.setting.findUnique({ where: { key: ALERT_THRESHOLDS_KEY } }),
  ]);
  const thresholds = parseThresholds(thresholdsRow?.value);
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Seuils des alertes métier</CardTitle>
          <CardDescription>
            Trois alertes se règlent ici. Les autres (message programmé en échec, lien désactivé
            encore cliqué, bot, synchro, sauvegarde…) n&apos;ont pas de seuil.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveAlertThresholdsAction} className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="registrationsDropPct" className="flex items-center gap-1">
                Chute des inscriptions (%)
                <HelpTip>
                  Alerte si les inscriptions des dernières 24 h sont inférieures de ce pourcentage à
                  la moyenne quotidienne des 7 jours précédents (seulement à partir de 10
                  inscriptions par jour en moyenne).
                </HelpTip>
              </Label>
              <Input
                id="registrationsDropPct"
                name="registrationsDropPct"
                type="number"
                min={1}
                max={100}
                defaultValue={thresholds.registrationsDropPct}
                className="h-10 md:h-9"
              />
              <p className="text-xs text-muted-foreground">
                Exemple : 50 = alerte si on passe de 20 par jour à moins de 10.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="spendNoConversionEur" className="flex items-center gap-1">
                Dépense sans inscription (€)
                <HelpTip>
                  Alerte si une pub a coûté plus que ce montant sur les derniers jours couvrant 24 h
                  sans aucune inscription rattachée (par son lien d&apos;entrée ou ses liens
                  traqués).
                </HelpTip>
              </Label>
              <Input
                id="spendNoConversionEur"
                name="spendNoConversionEur"
                inputMode="decimal"
                defaultValue={thresholds.spendNoConversionEur}
                className="h-10 md:h-9"
              />
              <p className="text-xs text-muted-foreground">
                Exemple : 50 = une pub à 60 € sans inscrit déclenche l&apos;alerte.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="channelLeakPct" className="flex items-center gap-1">
                Départs d&apos;un canal (%)
                <HelpTip>
                  Alerte si, sur 24 h, un canal perd plus que ce pourcentage de ses membres actifs
                  (canaux d&apos;au moins 20 membres).
                </HelpTip>
              </Label>
              <Input
                id="channelLeakPct"
                name="channelLeakPct"
                type="number"
                min={1}
                max={100}
                defaultValue={thresholds.channelLeakPct}
                className="h-10 md:h-9"
              />
              <p className="text-xs text-muted-foreground">
                Exemple : 10 = alerte si 11 membres sur 100 partent dans la journée.
              </p>
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" className="max-md:h-10">
                Enregistrer les seuils
              </Button>
            </div>
          </form>
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
