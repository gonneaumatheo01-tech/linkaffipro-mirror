import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Badge } from "@/components/ui/badge";
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
import { requireAdminPage } from "@/lib/session";
import { getSystemStatus } from "@/lib/status/queries";
import { StatusBadge } from "@/lib/status-badges";
import { cleanFailedJobsAction, retryJobAction } from "./actions";

export const metadata: Metadata = { title: "État du système" };
export const dynamic = "force-dynamic";

const QUEUE_LABELS: Record<string, string> = {
  scheduler: "Messages programmés",
  "telegram-send": "Envois Telegram",
  approvals: "Adhésions",
  "sync-linkaffi": "Synchro Link Affi",
  stats: "Statistiques",
  maintenance: "Maintenance",
  automations: "Automatisations",
};

const ALERT_LABELS: Record<string, string> = {
  bot_webhook: "Bot en difficulté",
  sync_failed: "Synchro Link Affi en échec",
  queue_backlog: "File d'envoi engorgée",
  dm_blocked: "Messages privés bloqués en masse",
  subid_health: "Santé de l'identifiant de suivi (sub-ID)",
  worker_down: "Worker arrêté",
  job_failures: "Erreurs répétées",
  backup_failed: "Sauvegarde en échec",
  registrations_drop: "Chute des inscriptions",
  spend_no_conversion: "Dépense sans inscription",
  channel_leak: "Canal qui perd ses membres",
  post_failed: "Message programmé en échec",
  offer_link_inactive: "Lien désactivé encore cliqué",
};

function okBadge(ok: boolean, okText = "ok", koText = "erreur") {
  return ok ? <Badge>{okText}</Badge> : <Badge variant="destructive">{koText}</Badge>;
}

function fmtAge(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `il y a ${sec} s`;
  if (sec < 3600) return `il y a ${Math.round(sec / 60)} min`;
  return `il y a ${Math.round(sec / 3600)} h`;
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${n} o`;
}

export default async function StatusPage({ searchParams }: PageProps<"/settings/status">) {
  await requireAdminPage();
  const sp = await searchParams;
  const now = new Date();
  const s = await getSystemStatus(now);
  const webOk = s.web.db === "ok" && s.web.redis === "ok";
  const hb = s.worker.heartbeat;
  const totalFailed = s.queues.counts.reduce((a, c) => a + c.failed, 0);

  return (
    <>
      <PageHeader
        title="État du système"
        description="Un coup d'œil sur la santé du site, du worker (le programme qui envoie les messages et fait les calculs en arrière-plan), des files de tâches, des bots et des sauvegardes."
        help="Tout en vert : rien à faire. Un badge rouge : lisez le message, puis « Relancer » la tâche ou prévenez l'administrateur technique. La page se recharge à chaque visite."
      >
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings" />}
        >
          ← Réglages
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings/alerts" />}
        >
          Alertes et rétention
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings/status" />}
        >
          Actualiser
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site {okBadge(webOk)}</CardTitle>
            <CardDescription>
              Base de données et Redis (mémoire des files de tâches) vus depuis le site.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Base</span>
              <span>{s.web.db === "ok" ? `ok · ${s.web.dbLatencyMs ?? "?"} ms` : s.web.db}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Redis</span>
              <span>{s.web.redis}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Vérifié</span>
              <span>{fmtDate(now)}</span>
            </div>
            {s.web.dbLatencyMs !== null && s.web.dbLatencyMs > 150 ? (
              <p className="pt-1 text-xs text-muted-foreground">
                Latence élevée : vérifier que le service est dans la même région que la base.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Worker{" "}
              {hb ? (
                okBadge(!s.worker.down, "en vie", "arrêté")
              ) : (
                <Badge variant="secondary">inconnu</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Le worker donne signe de vie toutes les 30 secondes ; rouge au-delà de 3 minutes sans
              nouvelle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {s.worker.error ? <p className="text-destructive">{s.worker.error}</p> : null}
            {hb ? (
              <>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Dernier battement</span>
                  <span className={s.worker.down ? "text-destructive" : ""}>
                    {fmtAge(s.worker.ageSec)} · {fmtDate(new Date(hb.at))}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Version</span>
                  <span>
                    {hb.version}
                    {hb.commit ? ` (${hb.commit})` : ""}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Démarré le</span>
                  <span>{fmtDate(new Date(hb.startedAt))}</span>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                Aucun battement connu : le worker n&apos;a jamais démarré avec cette version, ou
                Redis est injoignable.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Dernière sauvegarde{" "}
              {s.backup ? (
                okBadge(s.backup.ok, "ok", "échec")
              ) : (
                <Badge variant="secondary">aucune</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Sauvegarde automatique de la base chaque nuit à 4 h (Paris), 14 jours conservés.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {s.backup ? (
              <>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Quand</span>
                  <span>{fmtDate(s.backup.at)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Fichier</span>
                  <span className="truncate" title={s.backup.file ?? ""}>
                    {s.backup.file ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Taille</span>
                  <span>{fmtBytes(s.backup.bytes)}</span>
                </div>
                {s.backup.durationMs !== undefined ? (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Durée</span>
                    <span>{(s.backup.durationMs / 1000).toFixed(1)} s</span>
                  </div>
                ) : null}
                {s.backup.dir ? (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Dossier</span>
                    <span className="truncate" title={s.backup.dir}>
                      {s.backup.dir}
                    </span>
                  </div>
                ) : null}
                {s.backup.error ? <p className="text-destructive">{s.backup.error}</p> : null}
              </>
            ) : (
              <p className="text-muted-foreground">
                Aucune sauvegarde enregistrée pour l&apos;instant.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">
            Files de tâches{" "}
            {s.queues.error ? (
              <Badge variant="destructive" className="ml-2">
                injoignables
              </Badge>
            ) : totalFailed > 0 ? (
              <Badge variant="destructive" className="ml-2">
                {totalFailed} échec{totalFailed > 1 ? "s" : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2">
                aucun échec
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Ce que le worker a à faire. Si « En attente » grimpe sans redescendre, le worker est
            arrêté ou trop lent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {s.queues.error ? (
            <p className="mb-3 text-sm text-destructive">{s.queues.error}</p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="text-right">En attente</TableHead>
                <TableHead className="text-right">En cours</TableHead>
                <TableHead className="text-right">Retardées</TableHead>
                <TableHead className="text-right">Échouées</TableHead>
                <TableHead className="text-right">Terminées (gardées)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.queues.counts.map((q) => (
                <TableRow key={q.name}>
                  <TableCell>
                    <span className="font-medium">{QUEUE_LABELS[q.name] ?? q.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">{q.name}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(q.waiting)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(q.active)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(q.delayed)}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${q.failed > 0 ? "font-medium text-destructive" : ""}`}
                  >
                    {fmtNum(q.failed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtNum(q.completed)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Dernières tâches échouées</CardTitle>
              <CardDescription>
                Les 20 plus récentes. « Relancer » remet la tâche en attente ; les échecs de plus de
                7 jours sont effacés chaque nuit.
              </CardDescription>
            </div>
            <form action={cleanFailedJobsAction}>
              <ConfirmSubmit
                size="sm"
                variant="outline"
                className="max-md:h-10"
                message="Les tâches échouées depuis plus de 7 jours seront effacées de toutes les files (elles ne seront plus relançables). Continuer ?"
              >
                Effacer les échecs de plus de 7 jours
              </ConfirmSubmit>
            </form>
          </div>
        </CardHeader>
        <CardContent>
          {s.failedJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune tâche en échec.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead className="hidden md:table-cell">File</TableHead>
                  <TableHead>Tâche</TableHead>
                  <TableHead>Erreur</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Essais</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.failedJobs.map((j) => (
                  <TableRow key={`${j.queue}-${j.id}`}>
                    <TableCell className="whitespace-nowrap">
                      {fmtDate(j.failedAt ?? j.timestamp)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {QUEUE_LABELS[j.queue] ?? j.queue}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{j.name}</div>
                      <div className="text-xs text-muted-foreground">{j.id}</div>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <span className="line-clamp-3 text-sm" title={j.failedReason}>
                        {j.failedReason || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {j.attemptsMade}
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={retryJobAction}>
                        <input type="hidden" name="queue" value={j.queue} />
                        <input type="hidden" name="jobId" value={j.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          className="max-md:h-10"
                          aria-label={`Relancer la tâche ${j.name}`}
                        >
                          Relancer
                        </Button>
                      </form>
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
            <CardTitle className="text-base">Bots</CardTitle>
            <CardDescription>
              Connexion Telegram (webhook) vérifiée auprès de Telegram pour chaque bot actif.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {s.bots.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun bot enregistré.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bot</TableHead>
                    <TableHead>Connexion Telegram</TableHead>
                    <TableHead className="hidden md:table-cell">Dernier message reçu</TableHead>
                    <TableHead className="hidden lg:table-cell">Dernière erreur</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.bots.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-muted-foreground">@{b.username}</div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        {!b.isActive ? (
                          <StatusBadge kind="webhook" value="off" />
                        ) : !b.webhook ? (
                          "—"
                        ) : b.webhook.fetchError ? (
                          <span className="text-xs text-destructive">{b.webhook.fetchError}</span>
                        ) : (
                          <div className="space-y-1">
                            <StatusBadge kind="webhook" value={b.webhook.ok ? "ok" : "check"} />
                            {b.webhook.pending ? (
                              <div className="text-xs text-muted-foreground">
                                {b.webhook.pending} message{b.webhook.pending > 1 ? "s" : ""} en
                                attente
                              </div>
                            ) : null}
                            {b.webhook.lastError ? (
                              <div className="text-xs text-destructive">
                                {b.webhook.lastError}
                                {b.webhook.lastErrorAt
                                  ? ` (${fmtDate(b.webhook.lastErrorAt)})`
                                  : ""}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                        {fmtDate(b.lastWebhookAt)}
                      </TableCell>
                      <TableCell className="hidden max-w-xs text-xs lg:table-cell">
                        {b.lastError ? (
                          <span className="text-destructive">{b.lastError}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Synchro Link Affi</CardTitle>
            <CardDescription>
              Lecture des données Link Affi toutes les 2 minutes, table par table.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {s.syncStates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune synchro enregistrée.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Table</TableHead>
                    <TableHead>Dernier succès</TableHead>
                    <TableHead className="text-right">Lignes</TableHead>
                    <TableHead>Erreur</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.syncStates.map((st) => (
                    <TableRow key={st.source}>
                      <TableCell className="font-medium">
                        {st.source}
                        {st.isRunning ? (
                          <StatusBadge kind="sync" value="running" className="ml-2" />
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {fmtDate(st.lastSuccessAt)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(st.rowsImported)}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs">
                        {st.lastError ? (
                          <span className="text-destructive">{st.lastError}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">
            Alertes ouvertes{" "}
            {s.openAlerts.length > 0 ? (
              <Badge variant="destructive" className="ml-2">
                {s.openAlerts.length}
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2">
                aucune
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Les alertes se résolvent seules quand la cause disparaît. Détail et historique dans
            Réglages → Alertes et rétention.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {s.openAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tout va bien.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {s.openAlerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="alert" value={a.severity} />
                  <span className="font-medium">{ALERT_LABELS[a.kind] ?? a.kind}</span>
                  <span className="text-muted-foreground">{a.message}</span>
                  <span className="text-xs text-muted-foreground">({fmtDate(a.createdAt)})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
