import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, ShieldOff } from "lucide-react";
import { aggregatePlayers, computeSpendLevel, SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Flash } from "@/components/admin/flash";
import { AdvancedSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { PageHeader } from "@/components/admin/page-header";
import { PAGE_SIZE, Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { MemberTags } from "@/components/members/member-cells";
import { MemberMemberships } from "@/components/members/member-memberships";
import { MemberTimeline } from "@/components/members/member-timeline";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { withMinusSign } from "@/lib/campaigns/cards";
import {
  acceptanceText,
  appliedRuleText,
  appliedRuleView,
  membershipProvenance,
  sourceChannelIdsOf,
} from "@/lib/channels/provenance-display";
import { fmtDate, fmtDateShort, fmtMoney, fmtNum, fmtRelative } from "@/lib/format";
import { adLabel, memberProfile, memberSubline, plural } from "@/lib/members/profile";
import { displayName, getSpendThresholds } from "@/lib/members/query";
import { getTagRegistry, memberTags, tagColorClass } from "@/lib/members/tags";
import { buildTimeline, paginateTimeline } from "@/lib/members/timeline";
import { requireUser } from "@/lib/session";
import {
  addNoteAction,
  anonymizeMemberAction,
  deleteNoteAction,
  editNoteAction,
  setMemberTagsAction,
} from "./actions";

export const metadata: Metadata = { title: "Fiche membre" };

/** Demandes montrées dans « Ses demandes et canaux » (les plus récentes ; toutes restent dans la chronologie). */
const MAX_MEMBERSHIPS = 20;

/** Origine du rattachement d'un compte joueur, en mots simples. */
const SUB_ID_SOURCE: Record<string, string> = {
  postback: "reçu par le retour du casino",
  time_match: "rapproché par l'heure du clic",
  linkaffi: "clic Link Affi",
};

/** Bloc de la fiche : carte avec un titre de section (`<h2>`), une ligne d'aide et une action discrète. */
function Block({
  title,
  description,
  action,
  className,
  id,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("min-w-0", className)} id={id}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-note text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

/** Ligne « libellé : valeur » des blocs de l'essentiel. */
function Fact({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-note text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Chiffre de l'essentiel : grand nombre, libellé, précision. */
function Figure({
  label,
  value,
  hint,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-note text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-title tabular-nums">{value}</dd>
      {hint ? <dd className="text-note text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

export default async function MemberPage({ params, searchParams }: PageProps<"/members/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const [member, thresholds, tagRegistry] = await Promise.all([
    prisma.member.findUnique({
      where: { id },
      include: {
        botStates: { include: { bot: { select: { username: true, name: true } } } },
        memberships: {
          orderBy: { requestedAt: "desc" },
          include: {
            channel: { select: { title: true, id: true, vertical: true } },
            inviteLink: {
              include: {
                campaign: { select: { id: true, name: true, vertical: true, adPlatform: true } },
                trackingLinks: { select: { affiliateCampaign: { select: { name: true } } } },
              },
            },
            // Règle des demandes d'avant la phase 11 (sans règle enregistrée dans `source`).
            approvalRule: {
              select: {
                scope: true,
                isDefault: true,
                label: true,
                mode: true,
                delaySeconds: true,
                gateMode: true,
                gateChannelIds: true,
              },
            },
          },
        },
        clicks: {
          orderBy: { createdAt: "desc" },
          take: 200,
          include: { trackingLink: { select: { kind: true, label: true } } },
        },
        players: {
          include: {
            affiliateCampaign: { select: { name: true, program: { select: { name: true } } } },
            events: { orderBy: { occurredAt: "desc" }, take: 200 },
          },
        },
        outboundMessages: {
          orderBy: { queuedAt: "desc" },
          take: 200,
          include: { bot: { select: { username: true } } },
        },
        events: {
          where: { type: { startsWith: "member." } },
          orderBy: { occurredAt: "desc" },
          take: 100,
          select: { type: true, occurredAt: true },
        },
        notes: {
          orderBy: { createdAt: "desc" },
          include: { author: { select: { name: true, id: true } } },
        },
        _count: {
          select: { clicks: { where: { isBot: false, trackingLink: { kind: "OFFER" } } } },
        },
      },
    }),
    getSpendThresholds(),
    getTagRegistry(),
  ]);
  if (!member) notFound();
  const now = new Date();
  // Demandes et canaux : d'où vient chaque demande (titres actuels des canaux d'origine), règle, acceptation.
  const sourceIds = sourceChannelIdsOf(member.memberships);
  const sourceTitles = sourceIds.length
    ? Object.fromEntries(
        (
          await prisma.channel.findMany({
            where: { id: { in: sourceIds } },
            select: { id: true, title: true },
          })
        ).map((c) => [c.id, c.title]),
      )
    : {};
  const membershipItems = member.memberships.slice(0, MAX_MEMBERSHIPS).map((m) => ({
    id: m.id,
    channelId: m.channel.id,
    channelTitle: m.channel.title,
    universe: m.channel.vertical,
    status: m.status,
    provenance: membershipProvenance(m, sourceTitles).label,
    detail:
      [appliedRuleText(appliedRuleView(m)), acceptanceText(m, now)]
        .filter((x): x is string => Boolean(x))
        .join(" · ") || null,
    requestedAt: fmtDate(m.requestedAt),
  }));
  const tags = memberTags(member.tags);
  const anonymized = Boolean(member.anonymizedAt);
  const name = displayName(member);

  const level = computeSpendLevel(
    aggregatePlayers(
      member.players.map((p) => ({
        registeredAt: p.registeredAt,
        depositCount: p.depositCount,
        depositTotal: Number(p.depositTotal),
      })),
    ),
    thresholds,
  );
  const lastPlayerEventAt =
    member.players
      .map((p) => p.lastEventAt)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const profile = memberProfile({
    memberships: member.memberships.map((m) => ({
      status: m.status,
      requestedAt: m.requestedAt,
      approvedAt: m.approvedAt,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      channel: m.channel,
      inviteLink: m.inviteLink
        ? {
            name: m.inviteLink.name,
            adName: m.inviteLink.adName,
            adPlatform: m.inviteLink.adPlatform ?? m.inviteLink.campaign?.adPlatform ?? null,
            campaign: m.inviteLink.campaign,
            offerName:
              m.inviteLink.trackingLinks.find((t) => t.affiliateCampaign)?.affiliateCampaign
                ?.name ?? null,
          }
        : null,
    })),
    players: member.players.map((p) => ({
      ftdAt: p.ftdAt,
      ftdAmount: p.ftdAmount === null ? null : Number(p.ftdAmount),
      depositCount: p.depositCount,
      depositTotal: Number(p.depositTotal),
      ngr: Number(p.ngr),
      offerName: p.affiliateCampaign.name,
    })),
    offerClicks: member._count.clicks,
    botStates: member.botStates,
    lastSeenAt: member.lastSeenAt,
    lastPlayerEventAt,
  });

  const fullTimeline = buildTimeline({
    memberships: member.memberships.map((m) => ({
      id: m.id,
      channelTitle: m.channel.title,
      status: m.status,
      requestedAt: m.requestedAt,
      gateSatisfiedAt: m.gateSatisfiedAt,
      approveAt: m.approveAt,
      approvedAt: m.approvedAt,
      declinedAt: m.declinedAt,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      sourceName: m.inviteLink?.adName || m.inviteLink?.name,
    })),
    outbound: member.outboundMessages.map((o) => ({
      kind: o.kind,
      status: o.status,
      queuedAt: o.queuedAt,
      sentAt: o.sentAt,
      botUsername: o.bot.username,
      // Parti avec une note : « Envoyé avec les emojis normaux… » (emojis animés refusés), média non envoyé.
      error: o.error,
    })),
    clicks: member.clicks.map((c) => ({
      createdAt: c.createdAt,
      subId: c.subId,
      kind: c.trackingLink.kind,
      label: c.trackingLink.label,
      postId: c.postId,
      isBot: c.isBot,
    })),
    playerEvents: member.players.flatMap((p) =>
      p.events.map((e) => ({
        type: e.type,
        occurredAt: e.occurredAt,
        amount: e.amount === null ? null : Number(e.amount),
        currency: e.currency,
        campaignName: p.affiliateCampaign.name,
      })),
    ),
    events: member.events,
  });
  const timeline = paginateTimeline(fullTimeline, pageOf(sp), PAGE_SIZE);

  const { origin, activity, money, reach } = profile;
  const subline = anonymized
    ? `Anonymisé le ${fmtDate(member.anonymizedAt)}`
    : [memberSubline(member), member.isPremium ? "Telegram Premium" : null]
        .filter(Boolean)
        .join(" · ");
  const ad = origin ? adLabel(origin) : null;
  const unknownTags = tags.filter((t) => !tagRegistry.some((r) => r.name === t));
  const canEditNote = (authorId: string | undefined) => me.role === "ADMIN" || authorId === me.id;

  return (
    <>
      <PageHeader
        title={name}
        backHref="/members"
        backLabel="Tous les membres"
        description={subline || undefined}
        meta={
          <>
            {level === "AUCUN" ? null : (
              <StatusPill tone={level === "VIP" ? "brand" : "neutral"} title="Niveau de dépense">
                {SPEND_LEVEL_LABELS[level]}
              </StatusPill>
            )}
            {anonymized ? null : <StatusPill tone={reach.tone}>{reach.label}</StatusPill>}
          </>
        }
        secondaryActions={
          !anonymized && member.username ? (
            <a
              href={`https://t.me/${encodeURIComponent(member.username)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <ExternalLink aria-hidden />
              Ouvrir dans Telegram
              <span className="sr-only"> (nouvel onglet)</span>
            </a>
          ) : null
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      {anonymized ? (
        <Alert variant="info" role="status" className="mb-6">
          <ShieldOff aria-hidden />
          <AlertDescription>
            Ce membre a été supprimé à sa demande : son identité est effacée, son historique est
            conservé sans donnée personnelle.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* L'essentiel d'abord : d'où il vient, ce qu'il a fait, ce qu'il a déposé. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Block title="D'où il vient">
          {origin ? (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact label="Campagne">
                {origin.campaign ? (
                  <Link
                    href={`/campaigns/${origin.campaign.id}`}
                    className="inline-flex items-center gap-2 underline-offset-4 hover:underline max-md:min-h-10"
                  >
                    <UniverseDot universe={origin.universe} />
                    {origin.campaign.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Aucune</span>
                )}
              </Fact>
              <Fact label="Pub">
                {ad ?? <span className="text-muted-foreground">Aucune (lien direct)</span>}
              </Fact>
              <Fact label="Canal">
                <Link
                  href={`/channels/${origin.channelId}`}
                  className="inline-flex items-center gap-2 underline-offset-4 hover:underline max-md:min-h-10"
                >
                  {origin.campaign ? null : <UniverseDot universe={origin.universe} />}
                  {origin.channelTitle}
                </Link>
              </Fact>
              <Fact label="Arrivé le">{fmtDate(origin.at)}</Fact>
              {origin.offerName ? <Fact label="Offre">{origin.offerName}</Fact> : null}
            </dl>
          ) : (
            <p className="text-muted-foreground">
              Pas encore de demande pour rejoindre un canal. Vu pour la première fois le{" "}
              {fmtDate(member.firstSeenAt)}.
            </p>
          )}
        </Block>

        <Block title="Ce qu'il a fait">
          <dl className="grid grid-cols-2 gap-4">
            <Figure
              label="Demandes pour rejoindre"
              value={fmtNum(activity.requests)}
              hint={
                activity.requests === 0
                  ? undefined
                  : activity.entries === 0
                    ? "aucune acceptée"
                    : plural(activity.entries, "acceptée")
              }
            />
            <Figure
              label="Canaux où il est"
              value={fmtNum(activity.currentChannels)}
              hint="en ce moment"
            />
            <Figure label="Clics sur une offre" value={fmtNum(activity.offerClicks)} />
            <Figure
              label="Dernière activité"
              value={
                <time
                  dateTime={activity.lastActivityAt.toISOString()}
                  title={fmtDate(activity.lastActivityAt)}
                  className="text-body"
                >
                  {fmtRelative(activity.lastActivityAt, now)}
                </time>
              }
            />
          </dl>
        </Block>

        <Block title="Ce qu'il a déposé" className="md:col-span-2 xl:col-span-1">
          {money.players === 0 ? (
            <p className="text-muted-foreground">
              Pas encore inscrit chez un partenaire après un clic sur une offre.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-2">
              <Figure
                label={<Term term="FTD">Premiers dépôts</Term>}
                value={fmtNum(money.ftdCount)}
                hint={
                  money.firstFtdAt
                    ? `le ${fmtDateShort(money.firstFtdAt, now)}${money.firstFtdAmount ? ` · ${fmtMoney(money.firstFtdAmount)}` : ""}`
                    : "pas encore"
                }
              />
              <Figure
                label="Dépôts"
                value={fmtMoney(money.depositTotal, "EUR", { digits: 0 })}
                hint={plural(money.depositCount, "dépôt")}
              />
              <Figure
                label={<Term term="NGR">Revenu net</Term>}
                value={withMinusSign(fmtMoney(money.ngr))}
                hint={plural(money.players, "compte joueur", "comptes joueurs")}
              />
            </dl>
          )}
        </Block>
      </div>

      {membershipItems.length > 0 ? (
        <Block
          className="mt-4"
          title="Ses demandes et canaux"
          description="D'où vient chaque demande, la règle appliquée et la date d'acceptation."
        >
          <MemberMemberships
            items={membershipItems}
            more={member.memberships.length - membershipItems.length}
          />
        </Block>
      ) : null}

      {/* Même grille que la rangée du dessus : Étiquettes sur deux colonnes, « Joignable » sur la troisième. */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Block
          title="Étiquettes"
          className="xl:col-span-2"
          description="Pour le retrouver dans la liste et l'inclure dans un groupe de membres."
          action={
            me.role === "ADMIN" && !anonymized ? (
              <Link
                href="/settings/tags"
                className="text-note font-medium text-brand-ink underline-offset-4 hover:underline max-md:inline-flex max-md:min-h-10 max-md:items-center"
              >
                Gérer les étiquettes
              </Link>
            ) : null
          }
        >
          {anonymized ? (
            <p className="text-muted-foreground">Membre anonymisé : pas d&apos;étiquette.</p>
          ) : tagRegistry.length === 0 ? (
            <div className="space-y-2">
              {tags.length > 0 ? <MemberTags tags={tags} registry={tagRegistry} /> : null}
              <p className="text-muted-foreground">
                {me.role === "ADMIN"
                  ? "Aucune étiquette n'est encore créée : « Gérer les étiquettes » pour en ajouter."
                  : "Aucune étiquette n'est encore créée : demandez à un administrateur (Réglages → Étiquettes)."}
              </p>
            </div>
          ) : (
            <form action={setMemberTagsAction} className="space-y-3">
              <input type="hidden" name="memberId" value={member.id} />
              <fieldset>
                <legend className="sr-only">Étiquettes de {name}</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {tagRegistry.map((t) => (
                    <label key={t.name} className="flex min-h-10 items-center gap-2">
                      <Checkbox name="tags" value={t.name} defaultChecked={tags.includes(t.name)} />
                      <span
                        className={cn(
                          "inline-flex h-6 items-center rounded-full border px-2.5 text-note font-medium",
                          tagColorClass(t.color),
                        )}
                      >
                        {t.name}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {unknownTags.length > 0 ? (
                <p className="text-note text-muted-foreground">
                  Posées par une relance automatique (conservées) : {unknownTags.join(", ")}
                </p>
              ) : null}
              <Button type="submit" variant="outline" className="max-md:h-10">
                Enregistrer les étiquettes
              </Button>
            </form>
          )}
        </Block>

        <Block
          title="Joignable par le bot"
          description="Les bots qui peuvent lui écrire en privé : accueil, relances, messages à un groupe."
        >
          {member.botStates.length === 0 ? (
            <p className="text-muted-foreground">
              Il n&apos;a encore jamais écrit à un de nos bots : il ne peut pas recevoir de message
              privé.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {member.botStates.map((s) => (
                <li
                  key={s.id}
                  className="flex min-h-10 flex-wrap items-center justify-between gap-2 py-1.5"
                >
                  <span className="min-w-0 break-all">@{s.bot.username}</span>
                  {s.canDm ? (
                    <StatusPill tone="success">Joignable</StatusPill>
                  ) : s.blockedAt ? (
                    <StatusPill tone="danger" title={`Depuis le ${fmtDate(s.blockedAt)}`}>
                      A bloqué le bot
                    </StatusPill>
                  ) : (
                    <StatusPill tone="muted">Pas joignable</StatusPill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Block
          id="chronologie"
          title="Chronologie"
          description="Tout son parcours, du plus récent au plus ancien (les 200 derniers éléments de chaque sorte)."
          className="lg:col-span-2 lg:self-start"
        >
          <MemberTimeline entries={timeline.entries} />
          <Pagination
            page={timeline.page}
            pages={timeline.pages}
            total={timeline.total}
            noun="élément"
            hrefFor={(p) =>
              `${pageHref(`/members/${member.id}`, { ...sp, ok: undefined, error: undefined }, p)}#chronologie`
            }
          />
        </Block>

        <div className="min-w-0 space-y-6">
          <Block title="Notes internes" description="Visibles uniquement par l'équipe.">
            <div className="space-y-3">
              {member.notes.length === 0 ? (
                <p className="text-muted-foreground">
                  {anonymized ? "Aucune note." : "Aucune note pour l'instant."}
                </p>
              ) : null}
              {member.notes.map((n) => (
                <article key={n.id} className="rounded-lg border border-border p-3">
                  <header className="mb-1 flex flex-wrap items-center justify-between gap-x-2 text-note text-muted-foreground">
                    <span>
                      {n.author?.name ?? "—"} · {fmtDate(n.createdAt)}
                    </span>
                    {canEditNote(n.author?.id) ? (
                      <form action={deleteNoteAction}>
                        <input type="hidden" name="noteId" value={n.id} />
                        <ConfirmSubmit
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          confirmTitle="Supprimer cette note ?"
                          message="Elle sera supprimée définitivement."
                          confirmLabel="Supprimer"
                          destructive
                        >
                          Supprimer
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </header>
                  <p className="break-words whitespace-pre-wrap">{n.text}</p>
                  {canEditNote(n.author?.id) ? (
                    <details className="mt-1">
                      <summary className="inline-flex min-h-8 cursor-pointer items-center text-note text-muted-foreground hover:text-foreground max-md:min-h-10">
                        Modifier
                      </summary>
                      <form action={editNoteAction} className="mt-2 space-y-2">
                        <input type="hidden" name="noteId" value={n.id} />
                        <Label htmlFor={`note-edit-${n.id}`} className="sr-only">
                          Modifier la note
                        </Label>
                        <Textarea
                          id={`note-edit-${n.id}`}
                          name="text"
                          defaultValue={n.text}
                          required
                          maxLength={2000}
                          rows={3}
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Enregistrer
                        </Button>
                      </form>
                    </details>
                  ) : null}
                </article>
              ))}
              {anonymized ? null : (
                <form action={addNoteAction} className="space-y-2">
                  <input type="hidden" name="memberId" value={member.id} />
                  <Label htmlFor="note-text">Nouvelle note</Label>
                  <Textarea
                    id="note-text"
                    name="text"
                    placeholder="2 000 caractères au plus"
                    required
                    maxLength={2000}
                    rows={3}
                  />
                  <Button type="submit" variant="outline" className="max-md:h-10">
                    Ajouter la note
                  </Button>
                </form>
              )}
            </div>
          </Block>

          <Block
            title="Comptes joueurs"
            description={
              <>
                Ses inscriptions chez nos partenaires, reliées à son clic par un{" "}
                <Term term="sub-ID">identifiant de suivi</Term>.
              </>
            }
          >
            {member.players.length === 0 ? (
              <p className="text-muted-foreground">
                Aucun compte joueur : il ne s&apos;est pas encore inscrit après un clic sur une
                offre.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-1">
                {member.players.map((p) => (
                  <li key={p.id} className="rounded-lg border border-border p-3">
                    <p className="font-medium break-words">{p.affiliateCampaign.program.name}</p>
                    <p className="text-note text-muted-foreground break-words">
                      {p.affiliateCampaign.name} · joueur {p.externalPlayerId}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                      <Fact label={<Term term="FTD">Premier dépôt</Term>}>
                        {p.ftdAt ? (
                          <>
                            {fmtDateShort(p.ftdAt, now)}
                            {p.ftdAmount ? (
                              <span className="block text-note text-muted-foreground tabular-nums">
                                {fmtMoney(Number(p.ftdAmount))}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">Pas encore</span>
                        )}
                      </Fact>
                      <Fact label="Dépôts">
                        <span className="tabular-nums">
                          {fmtMoney(Math.round(Number(p.depositTotal)), "EUR", { digits: 0 })}
                        </span>
                        <span className="block text-note text-muted-foreground">
                          {plural(p.depositCount, "dépôt")}
                        </span>
                      </Fact>
                      <div className="col-span-2 min-w-0">
                        <dt className="text-note text-muted-foreground">
                          <Term term="sub-ID">Identifiant de suivi</Term>
                        </dt>
                        <dd className="mt-0.5 font-mono text-note break-all">
                          {p.subId ?? "—"}
                          {p.subIdSource ? (
                            <span className="block font-sans text-muted-foreground">
                              {SUB_ID_SOURCE[p.subIdSource] ?? p.subIdSource}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {me.role === "ADMIN" && !anonymized ? (
            <AdvancedSection
              title="Supprimer ce membre"
              description="Quand la personne demande l'effacement de ses données."
            >
              <form action={anonymizeMemberAction} className="space-y-3">
                <input type="hidden" name="memberId" value={member.id} />
                <p className="text-muted-foreground">
                  Son nom, son pseudo et son identifiant sont effacés, ses notes supprimées ;
                  l&apos;historique est conservé sans donnée personnelle. C&apos;est définitif.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-delete">Pour confirmer, tapez SUPPRIMER</Label>
                  <Input
                    id="confirm-delete"
                    name="confirm"
                    required
                    autoComplete="off"
                    className="sm:max-w-56"
                  />
                </div>
                <ConfirmSubmit
                  variant="destructive"
                  className="max-md:h-10"
                  confirmTitle={`Supprimer ${name} ?`}
                  message={`Le membre « ${name} » sera anonymisé : nom, pseudo et identifiant effacés, notes supprimées. C'est définitif.`}
                  confirmLabel="Supprimer définitivement"
                  destructive
                >
                  Supprimer ce membre
                </ConfirmSubmit>
              </form>
            </AdvancedSection>
          ) : null}
        </div>
      </div>
    </>
  );
}
