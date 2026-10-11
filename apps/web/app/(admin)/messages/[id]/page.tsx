import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, Copy, Pencil, Split, TriangleAlert } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { StatCard } from "@/components/admin/stat-card";
import { Term } from "@/components/admin/help-tip";
import { UniverseDot } from "@/components/admin/universe-dot";
import { MoveForm } from "@/components/messages/move-form";
import { PublisherBadge } from "@/components/messages/publisher-badge";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
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
import { env } from "@/lib/env";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { BUTTON_TYPE_LABELS, parseButtons, previewButtonUrl } from "@/lib/posts/buttons";
import { canEdit, canMove, toLocal } from "@/lib/posts/calendar";
import { failureFix } from "@/lib/posts/failure";
import { postNetRevenue } from "@/lib/posts/calendar-queries";
import {
  accountPostNote,
  isSentLike,
  postHeaderLine,
  postLanguageOptions,
} from "@/lib/posts/display";
import { templateCardTitle } from "@/lib/posts/templates";
import { TEXT_OFFER_LINK_SUFFIX, trackedLinkSlugs } from "@/lib/posts/offer-link";
import { TELEGRAM_ACCOUNT_SETTINGS_HREF, accountProblemsFor } from "@/lib/posts/publisher";
import { loadPublishStatus } from "@/lib/posts/account-publish";
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

/**
 * Fiche d'un message : statut et univers, chiffres, aperçu, boutons, actions (Modifier, Déplacer, Annuler…). Message avec
 * emojis animés publié par le compte Telegram connecté (phase 12) : badge, liens d'offre du texte et leurs clics.
 */
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
  const [viewsSession, netRevenue, accountStatus] = await Promise.all([
    prisma.telegramUserSession.findUnique({ where: { id: "main" }, select: { status: true } }),
    postNetRevenue(post.id),
    post.publisher === "ACCOUNT" ? loadPublishStatus() : Promise.resolve(null),
  ]);
  const viewsConnected = viewsSession?.status === "ACTIVE";
  const lastSample = post.viewSamples[post.viewSamples.length - 1] ?? null;
  const buttons = parseButtons(post.buttons);
  const mediaCount = ((post.mediaAssetIds as string[]) ?? []).length;
  const linkById = new Map(post.trackingLinks.map((l) => [l.id, l]));
  // Offres ajoutées comme liens dans le texte (message sans boutons publié par le compte connecté).
  const textSlugs = trackedLinkSlugs(post.text, env.trackingBaseUrl);
  const buttonLinkIds = new Set(buttons.flat().map((b) => b.trackingLinkId));
  const textLinks = post.trackingLinks.filter(
    (l) => textSlugs.includes(l.slug) && !buttonLinkIds.has(l.id),
  );
  const byAccount = post.publisher === "ACCOUNT" && !post.isTemplate;
  // Publié par le compte : sans boutons, jamais modifié par le bot, et pas de « Contenu protégé ».
  const accountNote = accountPostNote(post);
  // Message encore à publier par le compte connecté : le compte peut-il publier dans ce canal (dernier relevé) ?
  const accountProblem =
    byAccount && ["SCHEDULED", "DRAFT"].includes(post.status)
      ? (() => {
          const p = accountProblemsFor(accountStatus, [
            { id: post.channelId, title: post.channel.title },
          ]);
          return p.global ?? p.channels[0]?.problem ?? null;
        })()
      : null;
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
  const editable = canEdit(post);
  const movable = canMove(post);
  const title = post.isTemplate
    ? `Modèle « ${templateCardTitle(post.templateName ?? "")} »`
    : `Message pour ${post.channel.title}`;
  const headerLine = postHeaderLine({
    isTemplate: post.isTemplate,
    status: post.status,
    sentLocal: post.sentAt ? toLocal(post.sentAt) : null,
    scheduledLocal: post.scheduledAt ? toLocal(post.scheduledAt) : null,
    bot: post.bot.username,
    publisher: post.publisher,
  });
  // Pas encore parti (brouillon, programmé, annulé…) : les actions d'abord, les chiffres viendront après l'envoi.
  const sent = isSentLike(post);
  const help = post.isTemplate
    ? "Un modèle ne s'envoie pas : « Utiliser ce modèle » crée un message pré-rempli."
    : post.status === "SCHEDULED"
      ? "Ce message partira à l'heure prévue. Vous pouvez encore le modifier, le déplacer ou annuler l'envoi."
      : post.status === "SENT"
        ? "Ce message est publié. Ses chiffres se mettent à jour tout seuls."
        : post.status === "FAILED"
          ? "L'envoi a échoué : corrigez la cause ci-dessous, puis « Modifier » et « Programmer » pour le renvoyer."
          : editable
            ? "Ce message n'est pas programmé : « Modifier » puis « Programmer » pour choisir sa date d'envoi."
            : undefined;
  const options = [
    post.pinAfterSend ? "épinglé après l'envoi" : null,
    post.unpinPrevious ? "désépingle le précédent" : null,
    post.disableNotification ? "envoi silencieux" : null,
    post.protectContent
      ? byAccount
        ? "contenu protégé (non appliqué par votre compte Telegram)"
        : "contenu protégé"
      : null,
    post.deleteAfterMinutes ? `supprimé après ${post.deleteAfterMinutes} min` : null,
    post.disableLinkPreview ? "sans aperçu des liens" : null,
  ].filter(Boolean);
  const reactions = Object.entries(stats.reactions);

  const primaryLink = post.isTemplate
    ? {
        label: "Utiliser ce modèle",
        href: `/messages/new?from=${post.id}`,
        icon: <Copy aria-hidden />,
      }
    : editable
      ? { label: "Modifier", href: `/messages/${post.id}/edit`, icon: <Pencil aria-hidden /> }
      : { label: "Dupliquer", href: `/messages/new?from=${post.id}`, icon: <Copy aria-hidden /> };
  const primary = (
    <Link href={primaryLink.href} className={cn(buttonVariants(), "max-md:h-10")}>
      {primaryLink.icon}
      {primaryLink.label}
    </Link>
  );
  // Envoi refusé par Telegram : la raison, ce qu'il faut faire et le bon lien (canal ou « Modifier »).
  const failed = post.status === "FAILED" ? failureFix(post.lastError) : null;
  // Note d'un message parti ou en cours (publié avec les emojis normaux, publication reportée…) : pas une erreur.
  const note =
    !failed && post.lastError && (post.status === "SENT" || post.status === "SENDING")
      ? post.lastError
      : null;

  const figures = sent ? (
    <section aria-labelledby="chiffres" className="space-y-3">
      <h2 id="chiffres" className="text-title">
        Chiffres
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Vues" value={stats.views ? fmtNum(stats.views) : "—"} />
        <StatCard label="Clics" value={fmtNum(stats.clicks)} />
        <StatCard label="Premiers dépôts" term="FTD" value={fmtNum(stats.ftds)} />
        <StatCard
          label="Revenu net"
          term="NGR"
          value={fmtMoney(netRevenue, "EUR", { digits: 0 })}
        />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
        {[
          ["Personnes qui ont cliqué", fmtNum(stats.uniqueClickers)],
          ["Inscriptions", fmtNum(stats.registrations)],
          ["Dépôts", fmtNum(stats.deposits)],
          ["Montant déposé", fmtMoney(stats.depositAmount, "EUR", { digits: 0 })],
          ["Clics sur les offres", fmtNum(stats.offerClicks)],
          ["Réactions", fmtNum(stats.reactionsTotal)],
          ["Transferts", post.stats?.forwards ? fmtNum(post.stats.forwards) : "—"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-note text-muted-foreground">{label}</dt>
            <dd className="text-body font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {reactions.length > 0 ? (
        <p className="text-body text-muted-foreground">
          {reactions.map(([e, n]) => `${e} ${fmtNum(n)}`).join("   ")}
        </p>
      ) : null}
      <p className="text-note text-muted-foreground">
        {viewsConnected
          ? `Vues et transferts relevés par le compte Telegram connecté${lastSample ? ` (dernier relevé le ${fmtDate(lastSample.at)})` : ""}.`
          : "Les vues demandent un compte Telegram connecté (Réglages → Connexions → Telegram) ; clics et réactions sont comptés."}{" "}
        Inscriptions, dépôts et revenu net : joueurs venus de ce message par leur{" "}
        <Term term="sub-ID">identifiant de suivi</Term>.
      </p>
    </section>
  ) : (
    <section aria-labelledby="chiffres" className="space-y-1">
      <h2 id="chiffres" className="text-title">
        Chiffres
      </h2>
      <p className="text-body text-muted-foreground">
        Vues, clics, premiers dépôts et revenu net apparaîtront ici dès que le message sera envoyé.
      </p>
    </section>
  );

  const actions = (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>
          {post.isTemplate
            ? "La suppression du modèle demande une confirmation."
            : "Ce qui touche au canal Telegram demande une confirmation."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {movable && post.scheduledAt ? (
          <section aria-labelledby="deplacer" className="space-y-2">
            <h3 id="deplacer" className="text-body font-semibold">
              Déplacer
            </h3>
            <MoveForm postId={post.id} local={toLocal(post.scheduledAt)} />
            {post.status === "SCHEDULED" ? (
              <form action={shiftPostAction} className="space-y-1.5 pt-1">
                <input type="hidden" name="postId" value={post.id} />
                <Label htmlFor="shift-minutes">Ou décaler de</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="shift-minutes"
                    name="minutes"
                    type="number"
                    defaultValue={30}
                    aria-describedby="shift-minutes-help"
                    className="w-28"
                  />
                  <span className="text-body text-muted-foreground">minutes</span>
                  <Button type="submit" variant="outline">
                    Décaler
                  </Button>
                </div>
                <p id="shift-minutes-help" className="text-note text-muted-foreground">
                  Un nombre négatif avance l&apos;envoi.
                </p>
              </form>
            ) : null}
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {post.status === "SCHEDULED" ? (
            <form action={cancelPostAction}>
              <input type="hidden" name="postId" value={post.id} />
              <ConfirmSubmit
                variant="destructive"
                confirmTitle="Annuler l'envoi ?"
                message={`Le message prévu le ${fmtDate(post.scheduledAt)} ne partira pas. Il restera modifiable et vous pourrez le reprogrammer.`}
                confirmLabel="Annuler l'envoi"
              >
                Annuler l&apos;envoi
              </ConfirmSubmit>
            </form>
          ) : null}
          {post.status === "SENT" ? (
            <form action={deleteOnTelegramAction}>
              <input type="hidden" name="postId" value={post.id} />
              <ConfirmSubmit
                variant="destructive"
                confirmTitle="Supprimer sur Telegram ?"
                message={`Le message disparaîtra du canal « ${post.channel.title} »${byAccount ? " (supprimé par votre compte Telegram, qui l'a publié)" : ""} : les membres ne le verront plus. C'est définitif ; les chiffres déjà collectés restent.`}
              >
                Supprimer sur Telegram
              </ConfirmSubmit>
            </form>
          ) : null}
          {["DRAFT", "CANCELLED", "FAILED"].includes(post.status) ? (
            <form action={discardPostAction}>
              <input type="hidden" name="postId" value={post.id} />
              <ConfirmSubmit
                variant="destructive"
                confirmTitle={post.isTemplate ? "Supprimer ce modèle ?" : "Retirer ce message ?"}
                message={
                  post.isTemplate
                    ? `Le modèle « ${post.templateName} » disparaîtra de la galerie. C'est définitif.`
                    : "Il n'a pas été envoyé : il sera supprimé définitivement de la plateforme, avec ses boutons."
                }
              >
                {post.isTemplate
                  ? "Supprimer le modèle"
                  : post.status === "DRAFT"
                    ? "Retirer le brouillon"
                    : "Retirer ce message"}
              </ConfirmSubmit>
            </form>
          ) : null}
        </div>

        {!post.isTemplate ? (
          <form action={saveAsTemplateAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="postId" value={post.id} />
            <div className="space-y-1.5">
              <Label htmlFor="templateName">Nom du modèle</Label>
              <Input
                id="templateName"
                name="templateName"
                placeholder="Ex. : Bonus du vendredi"
                className="w-56"
              />
            </div>
            <Button type="submit" variant="outline">
              Enregistrer comme modèle
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader
        title={title}
        backHref={post.isTemplate ? "/messages?view=templates" : "/messages"}
        backLabel={post.isTemplate ? "Modèles" : "Messages"}
        meta={
          <>
            {post.isTemplate ? null : <StatusBadge kind="post" value={post.status} />}
            {byAccount ? <PublisherBadge publisher="ACCOUNT" /> : null}
            <UniverseDot universe={post.channel.vertical ?? post.vertical} variant="pill" />
          </>
        }
        description={headerLine}
        help={help}
        primaryAction={primary}
        secondaryActions={
          <>
            {post.abGroupId ? (
              <Link
                href={`/messages/ab/${post.abGroupId}`}
                className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
              >
                <Split aria-hidden />
                Comparaison A/B{post.abVariant ? ` (version ${post.abVariant})` : ""}
              </Link>
            ) : null}
            {editable && !post.isTemplate ? (
              <Link
                href={`/messages/new?from=${post.id}`}
                className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
              >
                <Copy aria-hidden />
                Dupliquer
              </Link>
            ) : null}
            {post.isTemplate ? (
              <Link
                href={`/messages/${post.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
              >
                <Pencil aria-hidden />
                Modifier le modèle
              </Link>
            ) : null}
          </>
        }
      />
      <Flash
        ok={sp.ok}
        error={sp.error ?? (failed || note ? undefined : (post.lastError ?? undefined))}
      />
      {note ? (
        <Alert variant="warning" role="status" className="mb-6">
          <TriangleAlert aria-hidden />
          <AlertTitle>
            {post.status === "SENDING" ? "Envoi en cours" : "Message envoyé, avec une remarque"}
          </AlertTitle>
          <AlertDescription>
            <p>{note}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert aria-hidden />
          <AlertTitle>{post.lastError ?? "Telegram a refusé l'envoi."}</AlertTitle>
          <AlertDescription>
            <p>{failed.hint}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <Link
                href={`/channels/${post.channelId}`}
                className="inline-flex items-center font-medium underline underline-offset-2 max-md:min-h-10"
              >
                Ouvrir le canal {post.channel.title}
              </Link>
              {failed.kind === "account" ? (
                <Link
                  href={TELEGRAM_ACCOUNT_SETTINGS_HREF}
                  className="inline-flex items-center font-medium underline underline-offset-2 max-md:min-h-10"
                >
                  Ouvrir Réglages → Connexions → Telegram
                </Link>
              ) : null}
              {editable && failed.kind !== "channel" ? (
                <Link
                  href={`/messages/${post.id}/edit`}
                  className="inline-flex items-center font-medium underline underline-offset-2 max-md:min-h-10"
                >
                  Modifier le message
                </Link>
              ) : null}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {accountProblem ? (
        <Alert variant="warning" role="status" className="mb-6">
          <TriangleAlert aria-hidden />
          <AlertTitle>Votre compte Telegram ne peut pas encore publier ce message</AlertTitle>
          <AlertDescription>
            <p>{accountProblem}</p>
            <p>
              <Link
                href={TELEGRAM_ACCOUNT_SETTINGS_HREF}
                className="inline-flex items-center font-medium underline underline-offset-2 max-md:min-h-10"
              >
                Ouvrir Réglages → Connexions → Telegram
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {/* Téléphone : l'aperçu juste sous l'en-tête, puis les chiffres et actions, puis les réglages du message.
          Ordinateur : l'aperçu et les réglages à droite. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr]">
        <div className="lg:col-start-2 lg:row-start-1">
          <p className="mb-2 text-note font-medium text-muted-foreground">
            Aperçu tel que les membres le voient
          </p>
          <TelegramPreview
            html={post.text}
            buttons={buttons}
            mediaCount={mediaCount}
            counter={false}
          />
        </div>
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {sent ? figures : actions}

          {post.viewSamples.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Vues dans le temps</CardTitle>
                <CardDescription>
                  Un point par relevé ; survolez un point pour la valeur.
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
                <CardTitle>Boutons</CardTitle>
                <CardDescription>Clics de vraies personnes ; robots exclus.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table label="Boutons du message">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bouton</TableHead>
                      <TableHead className="max-md:hidden">Type</TableHead>
                      <TableHead numeric>Clics</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buttons.flat().map((b, i) => {
                      const l = b.trackingLinkId ? linkById.get(b.trackingLinkId) : null;
                      return (
                        <TableRow key={i}>
                          <TableCell className="max-w-48 md:max-w-xs">
                            <span className="block truncate font-medium">{b.text}</span>
                            <span className="block truncate font-mono text-note text-muted-foreground">
                              {previewButtonUrl(b, ctx)}
                            </span>
                          </TableCell>
                          <TableCell className="max-md:hidden">
                            {BUTTON_TYPE_LABELS[b.type]}
                          </TableCell>
                          <TableCell
                            numeric
                            title={
                              l ? `${fmtNum(l._count.clickRecords)} avec les robots` : undefined
                            }
                          >
                            {l ? fmtNum(l.clicks) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {textLinks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Liens dans le texte</CardTitle>
                <CardDescription>
                  Offres ajoutées comme liens dans le texte. Clics de vraies personnes ; robots
                  exclus.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table label="Liens dans le texte du message">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lien</TableHead>
                      <TableHead numeric>Clics</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {textLinks.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="max-w-48 md:max-w-xs">
                          <span className="block truncate font-medium">
                            {l.label.endsWith(TEXT_OFFER_LINK_SUFFIX)
                              ? l.label.slice(0, -TEXT_OFFER_LINK_SUFFIX.length)
                              : l.label}
                          </span>
                          <span className="block truncate font-mono text-note text-muted-foreground">
                            {`${env.trackingBaseUrl}/${l.slug}`}
                          </span>
                        </TableCell>
                        <TableCell
                          numeric
                          title={`${fmtNum(l._count.clickRecords)} avec les robots`}
                        >
                          {fmtNum(l.clicks)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {accountNote ? <p className="text-note text-muted-foreground">{accountNote}</p> : null}

          {sent ? actions : post.isTemplate ? null : figures}
        </div>

        <aside aria-label="Réglages du message" className="lg:col-start-2 lg:row-start-2">
          <dl className="space-y-3 rounded-xl border border-border bg-card p-4 text-body">
            <div>
              <dt className="text-note text-muted-foreground">Canal</dt>
              <dd className="flex items-center gap-2">
                <UniverseDot universe={post.channel.vertical} />
                {post.channel.title}
              </dd>
            </div>
            <div>
              <dt className="text-note text-muted-foreground">Catégorie</dt>
              <dd className="flex items-center gap-2">
                {post.category ? (
                  <>
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: post.category.color }}
                    />
                    {post.category.name}
                  </>
                ) : (
                  "Sans catégorie"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-note text-muted-foreground">Statut</dt>
              <dd>{post.isTemplate ? "Modèle" : statusLabel("post", post.status)}</dd>
            </div>
            <div>
              <dt className="text-note text-muted-foreground">Langue</dt>
              <dd>
                {postLanguageOptions(post.language).find((l) => l.value === post.language)?.label ??
                  post.language}
              </dd>
            </div>
            {options.length > 0 ? (
              <div>
                <dt className="text-note text-muted-foreground">Réglages</dt>
                <dd className="first-letter:uppercase">{options.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>
    </>
  );
}
