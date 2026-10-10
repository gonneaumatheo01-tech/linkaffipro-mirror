import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { describeSegment, parseSegment } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
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
import { fmtDate, fmtNum } from "@/lib/format";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { progressOf } from "@/lib/broadcasts/queries";
import { parseButtons } from "@/lib/posts/buttons";
import { toParisLocalInput } from "@/lib/posts/time";
import { requireUser } from "@/lib/session";
import {
  cancelBroadcastAction,
  deleteDraftAction,
  scheduleAction,
  sendNowAction,
  testToMeAction,
} from "../actions";

export const metadata: Metadata = { title: "Envoi" };

const BUTTON_TYPE: Record<string, string> = {
  URL: "lien direct",
  BUTTON: "lien traqué",
  OFFER: "offre",
};

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
    },
  });
  if (!b) notFound();
  const [errors, channels, inviteLinks, campaigns, categories, links] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ["error"],
      where: { broadcastId: id, status: { in: ["FAILED", "BLOCKED"] } },
      _count: { _all: true },
      orderBy: { _count: { error: "desc" } },
    }),
    prisma.channel.findMany({ select: { id: true, title: true } }),
    prisma.inviteLink.findMany({ select: { id: true, name: true } }),
    prisma.campaign.findMany({ select: { id: true, name: true } }),
    prisma.messageCategory.findMany({ select: { id: true, name: true } }),
    prisma.trackingLink.findMany({
      where: { post: { templateName: `broadcast:${id}` } },
      select: { label: true, kind: true, clicks: true, uniqueClicks: true, slug: true },
    }),
  ]);
  const toMap = (xs: Array<{ id: string; title?: string; name?: string }>) =>
    Object.fromEntries(xs.map((x) => [x.id, x.title ?? x.name ?? x.id]));
  const segment = parseSegment(b.segment);
  const p = progressOf(b);
  const buttons = parseButtons(b.buttons);
  const canLaunch = b.status === "DRAFT" || b.status === "SCHEDULED";
  const canCancel = b.status === "SCHEDULED" || b.status === "SENDING";
  const targetsText =
    b.targeted > 0
      ? `${fmtNum(b.targeted)} membre${b.targeted > 1 ? "s" : ""}`
      : "tous les membres du segment";
  return (
    <>
      <PageHeader
        title={b.name}
        description={`Envoyé par @${b.bot.username} · créé le ${fmtDate(b.createdAt)}`}
        help={
          canLaunch
            ? "Envoyez d'abord un test sur votre Telegram, puis « Envoyer maintenant » ou « Programmer »."
            : "Suivez ici la progression et les erreurs éventuelles."
        }
      >
        <StatusBadge kind="broadcast" value={b.status} />
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/members/broadcasts" />}
        >
          ← Écrire à un groupe
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      {b.abGroupId ? (
        <div className="mb-4 rounded-md border bg-muted/30 p-3 text-sm">
          Cet envoi fait partie d&apos;un test A/B (
          {b.abVariant === "REST"
            ? "envoi au reste"
            : `version ${b.abVariant}, ${b.abSplit ?? "—"} % des destinataires`}
          ).{" "}
          <Link
            href={`/members/broadcasts/ab/${b.abGroupId}`}
            className="underline underline-offset-2"
          >
            Voir la comparaison A/B
          </Link>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progression</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                ["Ciblés", b.targeted],
                ["Envoyés", b.sent],
                ["Échoués", b.failed],
                ["Bloqués", b.blocked],
              ].map(([l, v]) => (
                <div key={String(l)} className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground">{l}</div>
                  <div className="text-xl font-semibold tabular-nums">{fmtNum(Number(v))}</div>
                </div>
              ))}
            </div>
            <div
              className="h-2 w-full rounded bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={p.pct}
              aria-label={`Progression ${p.pct} %`}
            >
              <div className="h-2 rounded bg-primary" style={{ width: `${p.pct}%` }} />
            </div>
            <div className="text-xs text-muted-foreground">
              {p.pct} % · programmé : {fmtDate(b.scheduledAt)} · démarré : {fmtDate(b.startedAt)} ·
              terminé : {fmtDate(b.finishedAt)}
            </div>
            <p className="text-xs text-muted-foreground">
              « Bloqué » = le membre a bloqué le bot ou supprimé son compte : il ne sera plus
              sollicité.
            </p>
            {errors.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Erreur</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors.map((e) => (
                    <TableRow key={e.error ?? "—"}>
                      <TableCell className="whitespace-normal">{e.error ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{e._count._all}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>
              Le test part uniquement sur votre Telegram (compte lié dans Mon compte).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canLaunch ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <form action={sendNowAction}>
                  <input type="hidden" name="broadcastId" value={b.id} />
                  <ConfirmSubmit
                    className="max-md:h-10"
                    message={`Le message va partir maintenant à ${targetsText}, sans possibilité de le rappeler une fois envoyé. Continuer ?`}
                  >
                    Envoyer maintenant
                  </ConfirmSubmit>
                </form>
                <form
                  action={scheduleAction}
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                >
                  <input type="hidden" name="broadcastId" value={b.id} />
                  <div>
                    <Label htmlFor="scheduledAt" className="sr-only">
                      Date et heure d&apos;envoi (heure de Paris)
                    </Label>
                    <Input
                      id="scheduledAt"
                      name="scheduledAt"
                      type="datetime-local"
                      defaultValue={toParisLocalInput(b.scheduledAt ?? inOneHour())}
                      className="h-10 w-full sm:w-56 md:h-9"
                    />
                  </div>
                  <Button type="submit" variant="secondary" className="max-md:h-10">
                    Programmer
                  </Button>
                </form>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <form action={testToMeAction}>
                <input type="hidden" name="broadcastId" value={b.id} />
                <Button type="submit" variant="outline" className="max-md:h-10">
                  Envoyer un test sur mon Telegram
                </Button>
              </form>
              {canCancel ? (
                <form action={cancelBroadcastAction}>
                  <input type="hidden" name="broadcastId" value={b.id} />
                  <ConfirmSubmit
                    variant="destructive"
                    className="max-md:h-10"
                    message="L'envoi sera arrêté : les messages déjà partis restent envoyés, les autres ne partiront pas. Continuer ?"
                  >
                    Annuler l&apos;envoi
                  </ConfirmSubmit>
                </form>
              ) : null}
              {(b.status === "DRAFT" || b.status === "CANCELLED") && user.role === "ADMIN" ? (
                <form action={deleteDraftAction}>
                  <input type="hidden" name="broadcastId" value={b.id} />
                  <ConfirmSubmit
                    variant="ghost"
                    className="text-destructive max-md:h-10"
                    message={`L'envoi « ${b.name} » sera supprimé de la liste. Cette action est irréversible. Continuer ?`}
                  >
                    Supprimer
                  </ConfirmSubmit>
                </form>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Destinataires</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {describeSegment(segment, {
              channels: toMap(channels),
              inviteLinks: toMap(inviteLinks),
              campaigns: toMap(campaigns),
              categories: toMap(categories),
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs">
              {b.text}
            </div>
            {b.mediaAsset ? (
              <div className="text-xs text-muted-foreground">
                Média joint : {b.mediaAsset.filename}
              </div>
            ) : null}
            {buttons.length > 0 ? (
              <div className="space-y-1">
                {buttons.map((row, i) => (
                  <div key={i} className="flex flex-wrap gap-1">
                    {row.map((x, j) => (
                      <Badge key={j} variant="outline">
                        {x.text} · {BUTTON_TYPE[x.type] ?? x.type}
                      </Badge>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            {links.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bouton traqué</TableHead>
                    <TableHead className="hidden md:table-cell">Type</TableHead>
                    <TableHead className="text-right">Clics</TableHead>
                    <TableHead className="text-right">Personnes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {links.map((l) => (
                    <TableRow key={l.slug}>
                      <TableCell>{l.label}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {statusLabel("trackingLinkKind", l.kind)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.clicks}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.uniqueClicks}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
