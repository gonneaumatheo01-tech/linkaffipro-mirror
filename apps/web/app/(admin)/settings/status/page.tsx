import type { Metadata } from "next";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { StatusPill } from "@/components/admin/status-pill";
import {
  BotConnection,
  TelegramErrorText,
  botCheckLabel,
} from "@/components/settings/bot-connection";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { HealthTiles } from "@/components/settings/health-tiles";
import { SystemAgentsCard } from "@/components/agents/system-agents-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { getSystemStatus } from "@/lib/status/queries";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { botCheck, healthSummary, healthTiles, syncRowState } from "@/lib/status/health";
import {
  alertKindLabel,
  fmtAgeSec,
  fmtBytes,
  linkAffiTableLabel,
  queueLabel,
} from "@/lib/status/labels";
import { cleanFailedJobsAction, retryJobAction } from "./actions";

export const metadata: Metadata = { title: "État du système" };
export const dynamic = "force-dynamic";

/**
 * Réglages → État du système (ADMIN) : d'abord six tuiles « en un coup d'œil » (site, service d'arrière-plan,
 * sauvegarde, bots, synchro Link Affi, alertes), puis ce qui demande une action (alertes ouvertes, tâches en échec à
 * relancer), les files de tâches, les bots et la synchro, l'activité des bots sur 24 h, et le détail technique dans
 * « Avancé ». Données et actions inchangées (`getSystemStatus`). La pastille de l'en-tête (« Tout va bien » ou
 * « N points à voir », N = tuiles qui ne sont pas vertes) est celle de la carte « État du système » de Réglages.
 */
export default async function StatusPage({ searchParams }: PageProps<"/settings/status">) {
  await requireAdminPage();
  const sp = await searchParams;
  const now = new Date();
  const s = await getSystemStatus(now);
  const hb = s.worker.heartbeat;
  const tiles = healthTiles(s, now);
  const summary = healthSummary(tiles);
  // Clé renouvelée à chaque rendu : après « Relancer » ou « Effacer » (redirection vers cette page), les volets
  // ouverts se ferment au lieu de montrer l'état d'avant (une tâche déjà relancée).
  const viewKey = String(now.getTime());
  const totalFailed = s.queues.counts.reduce((a, c) => a + c.failed, 0);

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="État du système"
        description="La santé du site, du service d'arrière-plan (qui envoie les messages et fait les calculs), des bots, de la synchro et des sauvegardes."
        help="Tout en vert : rien à faire. Un point rouge : lisez la phrase, puis relancez la tâche ou prévenez l'administrateur technique."
        meta={
          <StatusPill tone={summary.tone} title={summary.title}>
            {summary.label}
          </StatusPill>
        }
        secondaryActions={
          <>
            <Link
              href="/settings/alerts"
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              Alertes
            </Link>
            <Link
              href="/settings/status"
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <RefreshCw aria-hidden />
              Actualiser
            </Link>
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div key={viewKey} className="space-y-10">
        <section aria-label="En un coup d'œil">
          <HealthTiles tiles={tiles} />
          <p className="mt-2 text-note text-muted-foreground">Vérifié le {fmtDate(now)}.</p>
        </section>

        <FormSection
          title="Alertes ouvertes"
          description="Elles se ferment toutes seules quand la cause disparaît. Seuils et historique : Réglages → Alertes et rapports."
          actions={
            s.openAlerts.length > 0 ? (
              <StatusPill tone="danger">{fmtNum(s.openAlerts.length)}</StatusPill>
            ) : (
              <StatusPill tone="success">Aucune</StatusPill>
            )
          }
        >
          {s.openAlerts.length === 0 ? (
            <p className="text-body text-muted-foreground">Tout va bien.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {s.openAlerts.map((a) => (
                <li key={a.id} className="space-y-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="alert" value={a.severity} />
                    <span className="font-medium text-foreground">{alertKindLabel(a.kind)}</span>
                    <span className="text-note text-muted-foreground">{fmtDate(a.createdAt)}</span>
                  </div>
                  <p className="text-body text-muted-foreground">{a.message}</p>
                </li>
              ))}
            </ul>
          )}
        </FormSection>

        <FormSection
          title="Tâches en échec"
          description="Les 20 plus récentes. « Relancer » remet la tâche en attente ; les échecs de plus de 7 jours sont effacés chaque nuit."
          actions={
            <form action={cleanFailedJobsAction}>
              <ConfirmSubmit
                size="sm"
                variant="outline"
                className="max-md:h-10"
                confirmTitle="Effacer les vieux échecs ?"
                confirmLabel="Effacer"
                message="Les tâches échouées depuis plus de 7 jours seront effacées de toutes les files : elles ne pourront plus être relancées."
              >
                Effacer les échecs de plus de 7 jours
              </ConfirmSubmit>
            </form>
          }
        >
          <DataTable
            label="Tâches en échec"
            columns={[
              { key: "when", header: "Quand" },
              { key: "queue", header: "File", hideOnMobile: true },
              { key: "error", header: "Erreur", className: "min-w-48 whitespace-normal" },
              { key: "attempts", header: "Essais", align: "right", hideOnMobile: true },
              { key: "retry", header: "Action", sortable: false },
            ]}
            rows={s.failedJobs.map((j) => ({
              id: `${j.queue}-${j.id}`,
              cells: {
                when: fmtDate(j.failedAt ?? j.timestamp),
                queue: queueLabel(j.queue),
                error: (
                  <span className="line-clamp-2 text-body" title={j.failedReason}>
                    {j.failedReason || "—"}
                  </span>
                ),
                attempts: fmtNum(j.attemptsMade),
                retry: (
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
                ),
              },
              sortValues: { when: (j.failedAt ?? j.timestamp).getTime(), error: j.failedReason },
              detailTitle: queueLabel(j.queue),
              detailDescription: fmtDate(j.failedAt ?? j.timestamp),
              detail: (
                <div className="space-y-6">
                  <DetailList>
                    <DetailRow label="File">{queueLabel(j.queue)}</DetailRow>
                    <DetailRow label="Tâche" mono>
                      {j.name}
                    </DetailRow>
                    <DetailRow label="Identifiant" mono>
                      {j.id}
                    </DetailRow>
                    <DetailRow label="Créée le">{fmtDate(j.timestamp)}</DetailRow>
                    <DetailRow label="Échec le">{fmtDate(j.failedAt)}</DetailRow>
                    <DetailRow label="Essais">{fmtNum(j.attemptsMade)}</DetailRow>
                  </DetailList>
                  <div className="space-y-2">
                    <p className="text-body font-medium">Erreur</p>
                    <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-muted/40 p-3 font-mono text-note whitespace-pre-wrap">
                      {j.failedReason || "—"}
                    </pre>
                  </div>
                  <form action={retryJobAction}>
                    <input type="hidden" name="queue" value={j.queue} />
                    <input type="hidden" name="jobId" value={j.id} />
                    <Button type="submit" className="max-md:h-10">
                      Relancer la tâche
                    </Button>
                  </form>
                </div>
              ),
            }))}
            empty={{
              title: "Aucune tâche en échec",
              description: "Tout ce que le service d'arrière-plan avait à faire s'est bien passé.",
            }}
          />
        </FormSection>

        <FormSection
          title="Files de tâches"
          description="Ce que le service d'arrière-plan a à faire. Si « En attente » grimpe sans redescendre, il est arrêté ou trop lent."
          actions={
            s.queues.error ? (
              <StatusPill tone="danger">Injoignables</StatusPill>
            ) : totalFailed > 0 ? (
              <StatusPill tone="danger">
                {totalFailed === 1 ? "1 échec" : `${fmtNum(totalFailed)} échecs`}
              </StatusPill>
            ) : (
              <StatusPill tone="success">Aucun échec</StatusPill>
            )
          }
        >
          {s.queues.error ? <p className="text-body text-danger">{s.queues.error}</p> : null}
          <DataTable
            label="Files de tâches"
            columns={[
              { key: "name", header: "File", className: "min-w-40 whitespace-normal" },
              { key: "waiting", header: "En attente", align: "right" },
              { key: "active", header: "En cours", align: "right", hideOnMobile: true },
              { key: "delayed", header: "Retardées", align: "right", hideOnMobile: true },
              { key: "failed", header: "Échouées", align: "right" },
            ]}
            rows={s.queues.counts.map((q) => ({
              id: q.name,
              cells: {
                name: queueLabel(q.name),
                waiting: fmtNum(q.waiting),
                active: fmtNum(q.active),
                delayed: fmtNum(q.delayed),
                failed: (
                  <span className={q.failed > 0 ? "font-medium text-danger" : undefined}>
                    {fmtNum(q.failed)}
                  </span>
                ),
              },
              sortValues: { failed: q.failed },
              detailTitle: queueLabel(q.name),
              detail: (
                <DetailList>
                  <DetailRow label="Nom technique" mono>
                    {q.name}
                  </DetailRow>
                  <DetailRow label="En attente">{fmtNum(q.waiting)}</DetailRow>
                  <DetailRow label="En cours">{fmtNum(q.active)}</DetailRow>
                  <DetailRow label="Retardées">{fmtNum(q.delayed)}</DetailRow>
                  <DetailRow label="Échouées">{fmtNum(q.failed)}</DetailRow>
                  <DetailRow label="Terminées (gardées)">{fmtNum(q.completed)}</DetailRow>
                </DetailList>
              ),
            }))}
          />
        </FormSection>

        <div className="grid gap-10 xl:grid-cols-2">
          <FormSection
            title="Bots"
            description="La connexion Telegram de chaque bot actif."
            actions={
              <Link
                href="/settings/bots"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
              >
                Gérer les bots
              </Link>
            }
          >
            <DataTable
              label="Connexion Telegram des bots"
              columns={[
                { key: "bot", header: "Bot", className: "min-w-36 whitespace-normal" },
                { key: "connection", header: "Connexion" },
                { key: "last", header: "Dernier message reçu", hideOnMobile: true },
              ]}
              rows={s.bots.map((b) => {
                const check = botCheck(b);
                const connection = <BotConnection check={check} error={b.webhook?.fetchError} />;
                return {
                  id: b.id,
                  cells: {
                    bot: (
                      <span className="flex flex-col items-start">
                        <span>{b.name}</span>
                        <span className="text-note font-normal text-muted-foreground">
                          @{b.username}
                        </span>
                      </span>
                    ),
                    connection,
                    last: fmtDate(b.lastWebhookAt),
                  },
                  sortValues: {
                    bot: b.name,
                    connection: botCheckLabel(check, b.webhook?.fetchError),
                  },
                  detailTitle: b.name,
                  detailDescription: `@${b.username}`,
                  detail: (
                    <div className="space-y-6">
                      <DetailList>
                        <DetailRow label="Connexion">{connection}</DetailRow>
                        {b.webhook?.pending ? (
                          <DetailRow label="En attente">
                            {fmtNum(b.webhook.pending)} message
                            {b.webhook.pending > 1 ? "s" : ""} de Telegram
                          </DetailRow>
                        ) : null}
                        {b.webhook?.fetchError ? (
                          <DetailRow label="Réponse de Telegram">
                            <TelegramErrorText raw={b.webhook.fetchError} />
                          </DetailRow>
                        ) : null}
                        {b.webhook?.lastError ? (
                          <DetailRow label="Erreur de connexion">
                            <TelegramErrorText
                              raw={b.webhook.lastError}
                              source="delivery"
                              at={b.webhook.lastErrorAt ? fmtDate(b.webhook.lastErrorAt) : null}
                            />
                          </DetailRow>
                        ) : null}
                        <DetailRow label="Dernier message reçu">
                          {fmtDate(b.lastWebhookAt)}
                        </DetailRow>
                        <DetailRow label="Dernière erreur du bot">
                          <TelegramErrorText raw={b.lastError} source="bot" />
                        </DetailRow>
                      </DetailList>
                      <Link
                        href="/settings/bots"
                        className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
                      >
                        Ouvrir la page des bots
                      </Link>
                    </div>
                  ),
                };
              })}
              empty={{
                title: "Aucun bot enregistré",
                action: { href: "/settings/bots", label: "Ajouter un bot", variant: "outline" },
              }}
            />
          </FormSection>

          <FormSection
            title="Synchro Link Affi"
            description="Les données de Link Affi relues toutes les 2 minutes, une par une."
            actions={
              <Link
                href="/settings/connectors"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
              >
                Ouvrir Connexions
              </Link>
            }
          >
            <DataTable
              label="Synchro Link Affi"
              columns={[
                { key: "source", header: "Donnée", className: "min-w-36 whitespace-normal" },
                { key: "success", header: "Dernier succès", hideOnMobile: true },
                { key: "rows", header: "Lignes", align: "right" },
                { key: "state", header: "État" },
              ]}
              rows={s.syncStates.map((st) => {
                // Même seuil que la tuile « Synchro Link Affi » : un dernier succès trop ancien est « En retard ».
                const rowState = syncRowState(st, now);
                const pill = (
                  <StatusBadge
                    kind="sync"
                    value={rowState}
                    title={
                      rowState === "late"
                        ? "La synchro passe normalement toutes les 2 minutes."
                        : undefined
                    }
                  />
                );
                return {
                  id: st.source,
                  cells: {
                    source: linkAffiTableLabel(st.source),
                    success: fmtDate(st.lastSuccessAt),
                    rows: fmtNum(st.rowsImported),
                    state: pill,
                  },
                  sortValues: {
                    state: statusLabel("sync", rowState),
                  },
                  detailTitle: linkAffiTableLabel(st.source),
                  detail: (
                    <DetailList>
                      <DetailRow label="Nom technique" mono>
                        {st.source}
                      </DetailRow>
                      <DetailRow label="État">{pill}</DetailRow>
                      <DetailRow label="Dernière exécution">{fmtDate(st.lastRunAt)}</DetailRow>
                      <DetailRow label="Dernier succès">{fmtDate(st.lastSuccessAt)}</DetailRow>
                      <DetailRow label="Lignes importées">{fmtNum(st.rowsImported)}</DetailRow>
                      <DetailRow label="Erreur">
                        {st.lastError ? <span className="text-danger">{st.lastError}</span> : "—"}
                      </DetailRow>
                    </DetailList>
                  ),
                };
              })}
              empty={{
                title: "Aucune synchro enregistrée",
                description: "La première synchro Link Affi démarre dans les 2 minutes.",
              }}
            />
          </FormSection>
        </div>

        <SystemAgentsCard now={now} />

        <FormSection
          title="Activité des bots (24 h)"
          description="Ce que les bots ont reçu ou fait ces dernières 24 heures : demandes d'adhésion, entrées, clics, messages privés, publications."
          actions={
            <>
              <StatusPill tone="neutral">{fmtNum(s.botActivity.total)} événements</StatusPill>
              <Link
                href="/settings/journal/events"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
              >
                Voir le détail dans le Journal
              </Link>
            </>
          }
        >
          {s.botActivity.error ? (
            <p className="text-body text-danger">Lecture impossible : {s.botActivity.error}</p>
          ) : (
            <DataTable
              label="Activité des bots sur 24 heures"
              columns={[
                { key: "label", header: "Type", className: "min-w-48 whitespace-normal" },
                { key: "count", header: "Nombre", align: "right" },
              ]}
              rows={s.botActivity.byType.map((r) => ({
                id: r.type,
                cells: { label: r.label, count: fmtNum(r.count) },
                detailTitle: r.label,
                detail: (
                  <div className="space-y-6">
                    <DetailList>
                      <DetailRow label="Nombre (24 h)">{fmtNum(r.count)}</DetailRow>
                      <DetailRow label="Code technique" mono>
                        {r.type}
                      </DetailRow>
                    </DetailList>
                    <Link
                      href={`/settings/journal/events?type=${encodeURIComponent(r.type)}`}
                      className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
                    >
                      Voir ces événements dans le Journal
                    </Link>
                  </div>
                ),
              }))}
              empty={{
                title: "Aucun événement sur les dernières 24 heures",
                description:
                  "Si vos bots devraient être actifs, vérifiez leur connexion Telegram ci-dessus.",
              }}
            />
          )}
        </FormSection>

        <AdvancedSection
          title="Avancé : détail technique"
          description="Base de données, mémoire des files, version du service d'arrière-plan et fichier de sauvegarde."
        >
          <div className="grid gap-6 lg:grid-cols-3">
            <section aria-labelledby="tech-site" className="space-y-3">
              <h3 id="tech-site" className="text-body font-semibold text-foreground">
                Site
              </h3>
              <DetailList>
                <DetailRow label="Base">
                  {s.web.db === "ok" ? `ok · ${s.web.dbLatencyMs ?? "?"} ms` : s.web.db}
                </DetailRow>
                <DetailRow label="Redis">{s.web.redis}</DetailRow>
                <DetailRow label="Vérifié">{fmtDate(now)}</DetailRow>
              </DetailList>
              {s.web.dbLatencyMs !== null && s.web.dbLatencyMs > 150 ? (
                <p className="text-note text-muted-foreground">
                  Latence élevée : vérifier que le service est dans la même région que la base.
                </p>
              ) : null}
            </section>
            <section aria-labelledby="tech-worker" className="space-y-3">
              <h3 id="tech-worker" className="text-body font-semibold text-foreground">
                <Term term="worker">Service d&apos;arrière-plan</Term>
              </h3>
              {s.worker.error ? <p className="text-body text-danger">{s.worker.error}</p> : null}
              {hb ? (
                <DetailList>
                  <DetailRow label="Dernier signe de vie">
                    <span className={s.worker.down ? "text-danger" : undefined}>
                      {fmtAgeSec(s.worker.ageSec)} · {fmtDate(new Date(hb.at))}
                    </span>
                  </DetailRow>
                  <DetailRow label="Version" mono>
                    {hb.version}
                    {hb.commit ? ` (${hb.commit})` : ""}
                  </DetailRow>
                  <DetailRow label="Démarré le">{fmtDate(new Date(hb.startedAt))}</DetailRow>
                </DetailList>
              ) : (
                <p className="text-body text-muted-foreground">
                  Aucun signe de vie connu : le service n&apos;a jamais démarré avec cette version,
                  ou Redis est injoignable.
                </p>
              )}
              <p className="text-note text-muted-foreground">
                Il donne signe de vie toutes les 30 secondes ; rouge au-delà de 3 minutes sans
                nouvelle.
              </p>
            </section>
            <section aria-labelledby="tech-backup" className="space-y-3">
              <h3 id="tech-backup" className="text-body font-semibold text-foreground">
                Dernière sauvegarde
              </h3>
              {s.backup ? (
                <DetailList>
                  <DetailRow label="Quand">{fmtDate(s.backup.at)}</DetailRow>
                  <DetailRow label="Fichier" mono>
                    {s.backup.file ?? "—"}
                  </DetailRow>
                  <DetailRow label="Taille">{fmtBytes(s.backup.bytes)}</DetailRow>
                  {s.backup.durationMs !== undefined ? (
                    <DetailRow label="Durée">
                      {(s.backup.durationMs / 1000).toLocaleString("fr-FR", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      s
                    </DetailRow>
                  ) : null}
                  {s.backup.dir ? (
                    <DetailRow label="Dossier" mono>
                      {s.backup.dir}
                    </DetailRow>
                  ) : null}
                  {s.backup.error ? (
                    <DetailRow label="Erreur">
                      <span className="text-danger">{s.backup.error}</span>
                    </DetailRow>
                  ) : null}
                </DetailList>
              ) : (
                <EmptyState
                  title="Aucune sauvegarde enregistrée"
                  description="La sauvegarde automatique a lieu chaque nuit à 4 h (Paris), 14 jours conservés."
                />
              )}
            </section>
          </div>
        </AdvancedSection>
      </div>
    </>
  );
}
