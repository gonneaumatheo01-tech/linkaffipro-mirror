import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CircleCheck,
  MousePointerClick,
  Send,
  Smartphone,
  TriangleAlert,
  Users,
} from "lucide-react";
import { parseSegment } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Flash } from "@/components/admin/flash";
import { AdvancedSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { BroadcastProgress } from "@/components/broadcasts/broadcast-progress";
import { ReadOnlyPreview } from "@/components/broadcasts/read-only-preview";
import { ScheduleDialog } from "@/components/broadcasts/schedule-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  abLabel,
  broadcastActions,
  broadcastDateInfo,
  clickRate,
  notLaunched,
  sendLabel,
} from "@/lib/broadcasts/display";
import { countSentence, describeGroup, reachableSentence } from "@/lib/broadcasts/group";
import { countTargets } from "@/lib/broadcasts/queries";
import { loadBroadcastResults, loadGroupNames } from "@/lib/broadcasts/results";
import { confirmSendMessage } from "@/lib/broadcasts/wizard";
import { fmtDate, fmtNum } from "@/lib/format";
import { BUTTON_TYPE_LABELS, parseButtons } from "@/lib/posts/buttons";
import { toParisLocalInput } from "@/lib/posts/time";
import { requireUser } from "@/lib/session";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import {
  cancelBroadcastAction,
  deleteDraftAction,
  scheduleAction,
  sendNowAction,
  testToMeAction,
} from "../actions";

export const metadata: Metadata = { title: "Envoi à un groupe" };

function inOneHour(): Date {
  return new Date(Date.now() + 3_600_000);
}

export default async function BroadcastPage({
  params,
  searchParams,
}: PageProps<"/members/broadcasts/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const b = await prisma.broadcast.findUnique({
    where: { id },
    include: {
      bot: { select: { username: true, name: true } },
      mediaAsset: { select: { filename: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!b) notFound();
  const segment = parseSegment(b.segment);
  const pending = notLaunched(b.status);
  const [errors, results, names, estimate] = await Promise.all([
    pending
      ? Promise.resolve([])
      : prisma.outboundMessage.groupBy({
          by: ["error"],
          where: { broadcastId: id, status: { in: ["FAILED", "BLOCKED"] } },
          _count: { _all: true },
          orderBy: { _count: { error: "desc" } },
        }),
    loadBroadcastResults(id),
    loadGroupNames([segment]),
    // Avant le départ : nombre de membres joignables aujourd'hui (même calcul que l'assistant).
    pending ? countTargets(segment, b.botId).catch(() => null) : Promise.resolve(null),
  ]);
  const actions = broadcastActions(b.status, user.role);
  const ab = abLabel(b);
  const group = describeGroup(segment, names);
  const buttons = parseButtons(b.buttons);
  const when = broadcastDateInfo(b);
  const targets = pending ? estimate : b.targeted;

  const sendForm = actions.send ? (
    <form action={sendNowAction} className="contents">
      <input type="hidden" name="broadcastId" value={b.id} />
      <ConfirmSubmit
        className="max-md:h-10"
        confirmTitle="Envoyer maintenant ?"
        confirmLabel="Envoyer"
        message={confirmSendMessage(targets, { enabled: false, split: 50 })}
      >
        <Send aria-hidden />
        {sendLabel(b.status)}
      </ConfirmSubmit>
    </form>
  ) : null;

  return (
    <>
      <PageHeader
        backHref="/members/broadcasts"
        backLabel="Écrire à un groupe"
        title={b.name}
        meta={
          <>
            <StatusBadge kind="broadcast" value={b.status} />
            {ab ? <StatusPill tone="info">{ab}</StatusPill> : null}
          </>
        }
        description={`Envoyé par @${b.bot.username} · créé le ${fmtDate(b.createdAt)}${b.createdBy?.name ? ` par ${b.createdBy.name}` : ""}`}
        help={
          pending
            ? "Envoyez-vous d'abord un test sur Telegram, puis envoyez ou programmez."
            : b.status === "SENDING"
              ? "Les messages partent par vagues, au rythme permis par Telegram."
              : undefined
        }
        primaryAction={sendForm}
        secondaryActions={
          <>
            <form action={testToMeAction} className="contents">
              <input type="hidden" name="broadcastId" value={b.id} />
              <Button type="submit" variant="outline" className="max-md:h-10">
                <Smartphone aria-hidden />
                Envoyer un test à moi
              </Button>
            </form>
            {actions.schedule ? (
              <ScheduleDialog
                action={scheduleAction}
                broadcastId={b.id}
                defaultValue={toParisLocalInput(b.scheduledAt ?? inOneHour())}
                label={actions.schedule}
              />
            ) : null}
            {actions.cancel ? (
              <form action={cancelBroadcastAction} className="contents">
                <input type="hidden" name="broadcastId" value={b.id} />
                <ConfirmDialog
                  title="Annuler l'envoi ?"
                  description="L'envoi s'arrête : les messages déjà partis restent envoyés, les autres ne partiront pas."
                  confirmLabel="Oui, annuler l'envoi"
                  cancelLabel="Ne rien changer"
                  destructive
                  trigger={
                    <Button type="submit" variant="destructive" className="max-md:h-10">
                      Annuler l&apos;envoi
                    </Button>
                  }
                />
              </form>
            ) : null}
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      {b.abGroupId ? (
        <Alert variant="info" role="status" className="mb-6">
          <Users aria-hidden />
          <AlertDescription>
            Cet envoi fait partie d&apos;un test A/B (
            {b.abVariant === "REST"
              ? "envoi de la gagnante au reste du groupe"
              : `version ${b.abVariant}, ${b.abSplit ?? "—"} % du groupe`}
            ).{" "}
            <Link
              href={`/members/broadcasts/ab/${b.abGroupId}`}
              className="font-medium underline underline-offset-2"
            >
              Comparer les versions
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {pending ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Recevront ce message"
            icon={<Users aria-hidden />}
            value={estimate === null ? "—" : fmtNum(estimate)}
            hint={
              estimate === null
                ? "Le nombre sera calculé au moment de l'envoi."
                : `${countSentence(estimate)} Nombre d'aujourd'hui, recalculé au départ.`
            }
          />
          <StatCard
            label="Départ"
            icon={<Send aria-hidden />}
            value={
              <span className="text-title">
                {b.status === "SCHEDULED" && b.scheduledAt
                  ? fmtDate(b.scheduledAt)
                  : "Pas encore programmé"}
              </span>
            }
            hint={
              b.status === "SCHEDULED"
                ? "Heure de Paris. Il partira tout seul."
                : "Brouillon : rien ne part tant que vous n'envoyez pas ou ne programmez pas."
            }
          />
        </div>
      ) : (
        <section aria-labelledby="results-title" className="mb-6 space-y-4">
          <h2 id="results-title" className="text-title text-foreground">
            Résultats
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Ciblés"
              value={fmtNum(b.targeted)}
              hint="Membres du groupe joignables."
            />
            <StatCard label="Envoyés" icon={<CircleCheck aria-hidden />} value={fmtNum(b.sent)} />
            <StatCard
              label="Échoués"
              icon={<TriangleAlert aria-hidden />}
              value={fmtNum(b.failed)}
              hint="Erreur ou envoi annulé."
            />
            <StatCard
              label="Bloqués"
              value={fmtNum(b.blocked)}
              hint="Ont bloqué le bot : plus sollicités."
            />
            <StatCard
              label="Ont cliqué"
              icon={<MousePointerClick aria-hidden />}
              value={fmtNum(results.uniqueClicks)}
              hint={`${clickRate(b.sent, results.uniqueClicks)} des envoyés · ${fmtNum(results.clicks)} clic${results.clicks > 1 ? "s" : ""}`}
            />
            <StatCard
              label="Premiers dépôts"
              term="FTD"
              value={fmtNum(results.ftds)}
              hint={`${fmtNum(results.registrations)} inscription${results.registrations > 1 ? "s" : ""} rattachée${results.registrations > 1 ? "s" : ""}`}
            />
          </div>
          <Card>
            <CardContent className="space-y-2">
              <BroadcastProgress b={b} />
              <p className="text-note text-muted-foreground">
                {b.scheduledAt ? `Programmé le ${fmtDate(b.scheduledAt)} · ` : ""}
                {b.startedAt ? `démarré le ${fmtDate(b.startedAt)}` : "pas encore démarré"}
                {b.finishedAt ? ` · ${when.label.toLowerCase()} ${fmtDate(b.finishedAt)}` : ""}
              </p>
            </CardContent>
          </Card>
        </section>
      )}

      {errors.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Messages non partis</CardTitle>
            <CardDescription>
              « Bloqué » : le membre a bloqué le bot ou supprimé son compte. Il ne sera plus
              sollicité.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table label="Messages non partis, par raison">
              <TableHeader>
                <TableRow>
                  <TableHead>Raison (réponse de Telegram)</TableHead>
                  <TableHead numeric>Messages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.map((e) => (
                  <TableRow key={e.error ?? "—"}>
                    <TableCell className="whitespace-normal break-words">
                      {e.error ?? "—"}
                    </TableCell>
                    <TableCell numeric>{fmtNum(e._count._all)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Le groupe de membres</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-body">
              <p>{group}.</p>
              <p className="text-note text-muted-foreground">{reachableSentence(b.bot.username)}</p>
            </CardContent>
          </Card>

          {results.links.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Clics par bouton</CardTitle>
                <CardDescription>
                  Clics comptés sur les boutons traqués et les offres.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table label="Clics par bouton">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bouton</TableHead>
                      <TableHead className="max-md:hidden">Type</TableHead>
                      <TableHead numeric>Clics</TableHead>
                      <TableHead numeric>Personnes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.links.map((l) => (
                      <TableRow key={l.slug}>
                        <TableCell className="whitespace-normal break-words">
                          {l.label.replace(/ \(envoi groupé\)$/, "")}
                        </TableCell>
                        <TableCell className="max-md:hidden">
                          {statusLabel("trackingLinkKind", l.kind)}
                        </TableCell>
                        <TableCell numeric>{fmtNum(l.clicks)}</TableCell>
                        <TableCell numeric>{fmtNum(l.uniqueClicks)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {actions.remove ? (
            <AdvancedSection
              title="Supprimer cet envoi"
              description="Le retire de la liste. Les messages déjà partis restent sur Telegram."
            >
              <form action={deleteDraftAction}>
                <input type="hidden" name="broadcastId" value={b.id} />
                <ConfirmSubmit
                  variant="destructive"
                  className="max-md:h-10"
                  confirmTitle="Supprimer cet envoi ?"
                  confirmLabel="Supprimer définitivement"
                  message={`L'envoi « ${b.name} » sera retiré de la liste. Cette action est irréversible.`}
                >
                  Supprimer
                </ConfirmSubmit>
              </form>
            </AdvancedSection>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Le message</CardTitle>
            <CardDescription>Tel que les membres le voient.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReadOnlyPreview
              html={b.text}
              buttons={buttons.map((r) => r.map((x) => ({ text: x.text })))}
              mediaCount={b.mediaAssetId ? 1 : 0}
            />
            {b.mediaAsset ? (
              <p className="text-note text-muted-foreground">
                Média joint : {b.mediaAsset.filename}
              </p>
            ) : null}
            {buttons.length > 0 ? (
              <ul className="space-y-1 text-note text-muted-foreground">
                {buttons.flat().map((x, i) => (
                  <li key={i}>
                    {x.text} · {BUTTON_TYPE_LABELS[x.type]?.toLowerCase() ?? x.type}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
