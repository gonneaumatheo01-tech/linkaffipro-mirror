import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { HelpTip } from "@/components/admin/help-tip";
import { METRIC_HELP } from "@/components/dashboard/metric-help";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { env } from "@/lib/env";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { BUTTON_TYPE_LABELS, parseButtons, previewButtonUrl } from "@/lib/posts/buttons";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { ViewsChart } from "./views-chart";
import {
  cancelPostAction,
  deleteOnTelegramAction,
  discardPostAction,
  saveAsTemplateAction,
  shiftPostAction,
} from "../actions";

export const metadata: Metadata = { title: "Message" };

export default async function MessageDetailPage({
  params,
  searchParams,
}: PageProps<"/messages/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      channel: true,
      bot: true,
      category: true,
      stats: true,
      trackingLinks: { include: { _count: { select: { clickRecords: true } } } },
      viewSamples: { orderBy: { at: "asc" }, select: { at: true, views: true, forwards: true } },
    },
  });
  if (!post) notFound();
  const viewsSession = await prisma.telegramUserSession.findUnique({
    where: { id: "main" },
    select: { status: true },
  });
  const viewsConnected = viewsSession?.status === "ACTIVE";
  const lastSample = post.viewSamples[post.viewSamples.length - 1] ?? null;
  const buttons = parseButtons(post.buttons);
  const mediaCount = ((post.mediaAssetIds as string[]) ?? []).length;
  const linkById = new Map(post.trackingLinks.map((l) => [l.id, l]));
  // Clics uniques : membres distincts sur les clics offre + ip/ua distincts sur les boutons traqués.
  const uniqueClickers = post.trackingLinks.length
    ? await prisma.click
        .groupBy({
          by: ["memberId", "ipHash", "userAgent"],
          where: { postId: post.id, isBot: false },
        })
        .then((g) => g.length)
    : 0;
  const players = await prisma.player.findMany({
    where: { click: { postId: post.id } },
    select: { registeredAt: true, ftdAt: true, depositCount: true, depositTotal: true },
  });
  const stats = {
    clicks: post.trackingLinks.reduce((s, l) => s + l.clicks, 0),
    offerClicks:
      post.stats?.offerClicks ??
      post.trackingLinks.filter((l) => l.kind === "OFFER").reduce((s, l) => s + l.clicks, 0),
    uniqueClickers,
    reactions: (post.stats?.reactions as Record<string, number>) ?? {},
    reactionsTotal: post.stats?.reactionsTotal ?? 0,
    views: post.stats?.views ?? 0,
    registrations: players.filter((p) => p.registeredAt).length,
    ftds: players.filter((p) => p.ftdAt).length,
    deposits: players.reduce((s, p) => s + p.depositCount, 0),
    depositAmount: players.reduce((s, p) => s + Number(p.depositTotal), 0),
  };
  const ctx = {
    trackingBaseUrl: env.trackingBaseUrl,
    botUsername: post.bot.username,
    postCode: post.code,
  };
  const editable = ["DRAFT", "SCHEDULED", "FAILED", "CANCELLED"].includes(post.status);
  const title = post.isTemplate
    ? `Modèle « ${post.templateName} »`
    : `Message pour ${post.channel.title}`;
  const tiles: Array<{ label: string; value: string; key: string }> = [
    { label: "Vues", value: stats.views ? fmtNum(stats.views) : "—", key: "views" },
    {
      label: "Transferts",
      value: post.stats?.forwards ? fmtNum(post.stats.forwards) : "—",
      key: "forwards",
    },
    { label: "Clics", value: fmtNum(stats.clicks), key: "clicks" },
    { label: "Clics uniques", value: fmtNum(stats.uniqueClickers), key: "uniqueClickers" },
    { label: "Clics offres", value: fmtNum(stats.offerClicks), key: "offerClicks" },
    { label: "Réactions", value: fmtNum(stats.reactionsTotal), key: "reactions" },
    { label: "Inscriptions", value: fmtNum(stats.registrations), key: "registrations" },
    { label: "FTD", value: fmtNum(stats.ftds), key: "ftds" },
    { label: "Dépôts", value: fmtNum(stats.deposits), key: "deposits" },
    {
      label: "Montant déposé",
      value: fmtMoney(stats.depositAmount, "EUR", { digits: 0 }),
      key: "depositAmount",
    },
  ];
  const help = post.isTemplate
    ? "Un modèle ne s'envoie pas : cliquez « Dupliquer » pour créer un vrai message à partir de lui."
    : post.status === "SCHEDULED"
      ? "Ce message partira à l'heure prévue. Vous pouvez encore le modifier, le décaler ou annuler l'envoi."
      : post.status === "SENT"
        ? "Ce message est publié dans le canal. Ses chiffres se mettent à jour automatiquement (clics, inscriptions, dépôts)."
        : "Ce message n'est pas programmé : cliquez « Modifier » puis « Programmer » pour choisir sa date d'envoi.";

  return (
    <>
      <PageHeader
        title={title}
        description={`${statusLabel("post", post.status)}${post.scheduledAt ? ` · prévu le ${fmtDate(post.scheduledAt)}` : ""}${post.sentAt ? ` · envoyé le ${fmtDate(post.sentAt)}` : ""} · publié par @${post.bot.username}`}
        help={help}
      >
        <StatusBadge kind="post" value={post.status} />
        {post.abGroupId ? (
          <Button
            size="sm"
            variant="outline"
            className="max-md:h-10"
            render={<Link href={`/messages/ab/${post.abGroupId}`} />}
          >
            Voir la comparaison A/B{post.abVariant ? ` (version ${post.abVariant})` : ""}
          </Button>
        ) : null}
        {editable ? (
          <Button
            size="sm"
            variant="outline"
            className="max-md:h-10"
            render={<Link href={`/messages/${post.id}/edit`} />}
          >
            Modifier
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="max-md:h-10"
          render={<Link href={`/messages/new?from=${post.id}`} />}
        >
          Dupliquer
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="max-md:h-10"
          render={<Link href="/messages" />}
        >
          ← Messages
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error ?? post.lastError ?? undefined} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chiffres</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {tiles.map((t) => (
                  <div key={t.key} className="rounded-md border p-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {t.label}{" "}
                      {METRIC_HELP[t.key] ? (
                        <HelpTip label={`Définition : ${t.label}`}>{METRIC_HELP[t.key]}</HelpTip>
                      ) : null}
                    </div>
                    <div className="text-xl font-semibold tabular-nums">{t.value}</div>
                  </div>
                ))}
              </div>
              {Object.keys(stats.reactions).length > 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {Object.entries(stats.reactions)
                    .map(([e, n]) => `${e} ${n}`)
                    .join("  ")}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                {viewsConnected
                  ? `Vues et transferts sont relevés par le compte Telegram connecté (toutes les 15 min pendant 48 h, puis chaque jour pendant 30 jours)${lastSample ? ` ; dernier relevé le ${fmtDate(lastSample.at)}` : ""}.`
                  : "Le nombre de vues nécessite un compte Telegram connecté (Réglages → Connecteurs → Telegram) ; réactions et clics sont comptés."}{" "}
                Les inscriptions et dépôts sont ceux des joueurs rattachés à ce message par leur
                identifiant de suivi (sub-ID).
              </p>
            </CardContent>
          </Card>
          {post.viewSamples.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vues dans le temps</CardTitle>
                <CardDescription>
                  Un point par relevé. Survolez un point pour lire la valeur ; le tableau en dessous
                  liste les derniers relevés.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ViewsChart samples={post.viewSamples} />
              </CardContent>
            </Card>
          ) : null}
          {buttons.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Boutons</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Libellé</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="hidden md:table-cell">Adresse</TableHead>
                      <TableHead className="text-right">Clics</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buttons.flat().map((b, i) => {
                      const l = b.trackingLinkId ? linkById.get(b.trackingLinkId) : null;
                      return (
                        <TableRow key={i}>
                          <TableCell>{b.text}</TableCell>
                          <TableCell>{BUTTON_TYPE_LABELS[b.type]}</TableCell>
                          <TableCell className="hidden max-w-xs truncate font-mono text-xs text-muted-foreground md:table-cell">
                            {previewButtonUrl(b, ctx)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {l
                              ? `${fmtNum(l.clicks)} (${fmtNum(l._count.clickRecords)} avec les robots)`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
              <CardDescription>
                Les actions qui touchent au canal Telegram demandent une confirmation.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {post.status === "SCHEDULED" ? (
                <>
                  <form action={shiftPostAction} className="flex items-center gap-1">
                    <input type="hidden" name="postId" value={post.id} />
                    <Input
                      name="minutes"
                      aria-label="Décalage en minutes (négatif pour avancer)"
                      type="number"
                      defaultValue={30}
                      className="h-10 w-20 md:h-8"
                    />
                    <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                      Décaler (minutes)
                    </Button>
                  </form>
                  <form action={cancelPostAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <ConfirmSubmit
                      size="sm"
                      variant="outline"
                      className="max-md:h-10"
                      message={`Annuler l'envoi prévu le ${fmtDate(post.scheduledAt)} ? Le message ne partira pas. Il restera modifiable et vous pourrez le reprogrammer.`}
                    >
                      Annuler l&apos;envoi
                    </ConfirmSubmit>
                  </form>
                </>
              ) : null}
              {post.status === "SENT" ? (
                <form action={deleteOnTelegramAction}>
                  <input type="hidden" name="postId" value={post.id} />
                  <ConfirmSubmit
                    size="sm"
                    variant="destructive"
                    className="max-md:h-10"
                    message={`Supprimer ce message du canal « ${post.channel.title} » sur Telegram ? Les membres ne le verront plus. Cette action est définitive ; les chiffres déjà collectés sont conservés.`}
                  >
                    Supprimer sur Telegram
                  </ConfirmSubmit>
                </form>
              ) : null}
              {!post.isTemplate ? (
                <form action={saveAsTemplateAction} className="flex items-center gap-1">
                  <input type="hidden" name="postId" value={post.id} />
                  <Input
                    name="templateName"
                    aria-label="Nom du modèle"
                    placeholder="Nom du modèle"
                    className="h-10 w-44 md:h-8"
                  />
                  <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                    Enregistrer comme modèle
                  </Button>
                </form>
              ) : null}
              {["DRAFT", "CANCELLED", "FAILED"].includes(post.status) ? (
                <form action={discardPostAction}>
                  <input type="hidden" name="postId" value={post.id} />
                  <ConfirmSubmit
                    size="sm"
                    variant="ghost"
                    className="text-destructive max-md:h-10"
                    message={
                      post.isTemplate
                        ? `Supprimer le modèle « ${post.templateName} » ? Il disparaîtra de la liste des modèles. Cette action est définitive.`
                        : "Retirer ce message de la plateforme ? Il n'a pas été envoyé et sera supprimé définitivement, avec ses boutons."
                    }
                  >
                    Retirer{" "}
                    {post.isTemplate
                      ? "le modèle"
                      : post.status === "DRAFT"
                        ? "le brouillon"
                        : "ce message"}
                  </ConfirmSubmit>
                </form>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Aperçu tel que les membres le voient</p>
          <TelegramPreview html={post.text} buttons={buttons} mediaCount={mediaCount} />
          {post.category ? (
            <p className="mt-2 text-xs text-muted-foreground">Catégorie : {post.category.name}</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
