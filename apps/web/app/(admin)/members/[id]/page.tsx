import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { aggregatePlayers, computeSpendLevel, SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { HelpTip } from "@/components/admin/help-tip";
import { PAGE_SIZE, Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { displayName, getSpendThresholds } from "@/lib/members/query";
import { colorOf, getTagRegistry, memberTags, tagColorClass } from "@/lib/members/tags";
import { buildTimeline, paginateTimeline } from "@/lib/members/timeline";
import {
  addNoteAction,
  anonymizeMemberAction,
  deleteNoteAction,
  editNoteAction,
  setMemberTagsAction,
} from "./actions";

export const metadata: Metadata = { title: "Fiche membre" };

const KIND_COLORS: Record<string, string> = {
  membership: "bg-blue-500",
  message: "bg-slate-400",
  click: "bg-amber-500",
  player: "bg-emerald-500",
  event: "bg-violet-500",
};
const KIND_LABELS: Record<string, string> = {
  membership: "adhésion",
  message: "message",
  click: "clic",
  player: "joueur",
  event: "événement",
};

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
            channel: { select: { title: true, id: true } },
            inviteLink: {
              include: {
                campaign: { select: { name: true, adPlatform: true } },
                trackingLinks: { select: { affiliateCampaign: { select: { name: true } } } },
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
      },
    }),
    getSpendThresholds(),
    getTagRegistry(),
  ]);
  if (!member) notFound();
  const tags = memberTags(member.tags);

  const agg = aggregatePlayers(
    member.players.map((p) => ({
      registeredAt: p.registeredAt,
      depositCount: p.depositCount,
      depositTotal: Number(p.depositTotal),
    })),
  );
  const level = computeSpendLevel(agg, thresholds);
  const ngr = member.players.reduce((s, p) => s + Number(p.ngr), 0);
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
  const origin = member.memberships[member.memberships.length - 1];
  const name = displayName(member);

  return (
    <>
      <PageHeader
        title={name}
        description={
          member.anonymizedAt
            ? `Anonymisé le ${fmtDate(member.anonymizedAt)}`
            : `Identifiant Telegram ${member.telegramUserId.toString()}${member.username ? ` · @${member.username}` : ""}${member.languageCode ? ` · langue ${member.languageCode}` : ""}${member.isPremium ? " · Telegram Premium" : ""}`
        }
        help="Tout le parcours de ce membre : d'où il vient, ce qu'il a reçu, sur quoi il a cliqué et ce qu'il a déposé. Les notes internes ne sont visibles que par l'équipe."
      >
        <Badge variant={level === "VIP" ? "default" : "outline"}>{SPEND_LEVEL_LABELS[level]}</Badge>
        {tags.map((t) => (
          <Badge key={t} variant="outline" className={tagColorClass(colorOf(t, tagRegistry))}>
            {t}
          </Badge>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/members" />}
        >
          ← Membres
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Origine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              Première demande :{" "}
              <span className="text-muted-foreground">
                {origin ? `${origin.channel.title}, ${fmtDate(origin.requestedAt)}` : "—"}
              </span>
            </div>
            <div>
              Lien d&apos;entrée :{" "}
              <span className="text-muted-foreground">{origin?.inviteLink?.name ?? "—"}</span>
            </div>
            <div>
              Pub :{" "}
              <span className="text-muted-foreground">
                {origin?.inviteLink?.adName ?? origin?.inviteLink?.campaign?.name ?? "—"}
                {origin?.inviteLink?.adPlatform ? ` (${origin.inviteLink.adPlatform})` : ""}
              </span>
            </div>
            <div>
              Campagne d&apos;affiliation :{" "}
              <span className="text-muted-foreground">
                {origin?.inviteLink?.trackingLinks.find((t) => t.affiliateCampaign)
                  ?.affiliateCampaign?.name ??
                  member.players[0]?.affiliateCampaign.name ??
                  "—"}
              </span>
            </div>
            <div>
              Vu la première fois :{" "}
              <span className="text-muted-foreground">{fmtDate(member.firstSeenAt)}</span> ·
              dernière fois :{" "}
              <span className="text-muted-foreground">{fmtDate(member.lastSeenAt)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messages privés</CardTitle>
            <CardDescription>Bots qui peuvent lui écrire en privé.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {member.botStates.length === 0 ? (
              <p className="text-muted-foreground">
                Aucun bot n&apos;a encore été contacté par ce membre.
              </p>
            ) : (
              member.botStates.map((s) => (
                <div key={s.id} className="flex items-center justify-between">
                  <span>@{s.bot.username}</span>
                  {s.canDm ? (
                    <Badge variant="outline">joignable</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {s.blockedAt ? "a bloqué le bot" : "non joignable"}
                    </Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dépenses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              Joueurs rattachés :{" "}
              <span className="text-muted-foreground">{member.players.length}</span>
            </div>
            <div>
              Dépôts :{" "}
              <span className="text-muted-foreground">
                {agg.depositCount} · {fmtMoney(Math.round(agg.depositTotal), "EUR", { digits: 0 })}
              </span>
            </div>
            <div className="flex items-center gap-1">
              Revenu net (NGR){" "}
              <HelpTip>
                NGR : ce que le casino ou le site a réellement gagné sur ce joueur (mises moins
                gains et bonus). C&apos;est la base de notre commission.
              </HelpTip>{" "}
              : <span className="text-muted-foreground">{fmtMoney(ngr)}</span>
            </div>
            <div>
              Clics (hors robots) :{" "}
              <span className="text-muted-foreground">
                {member.clicks.filter((c) => !c.isBot).length}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Chronologie</CardTitle>
            <CardDescription>
              Les 200 derniers éléments de chaque type (adhésions, messages, clics, joueurs), du
              plus récent au plus ancien.
              <span className="ml-2 inline-flex flex-wrap gap-2">
                {Object.entries(KIND_LABELS).map(([k, l]) => (
                  <span key={k} className="inline-flex items-center gap-1 text-xs">
                    <span className={`size-2 rounded-full ${KIND_COLORS[k]}`} aria-hidden="true" />
                    {l}
                  </span>
                ))}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {timeline.total === 0 ? (
              <p className="text-sm text-muted-foreground">Rien pour l&apos;instant.</p>
            ) : (
              <ol className="space-y-2">
                {timeline.entries.map((e, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${KIND_COLORS[e.kind] ?? "bg-slate-300"}`}
                      role="img"
                      aria-label={KIND_LABELS[e.kind] ?? e.kind}
                    />
                    <span className="w-32 shrink-0 whitespace-nowrap text-muted-foreground">
                      {fmtDate(e.at)}
                    </span>
                    <span className="min-w-0">
                      {e.href ? (
                        <Link href={e.href} className="hover:underline">
                          {e.title}
                        </Link>
                      ) : (
                        e.title
                      )}
                      {e.detail ? (
                        <span className="ml-2 text-xs text-muted-foreground">{e.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <Pagination
              page={timeline.page}
              pages={timeline.pages}
              total={timeline.total}
              noun="élément"
              hrefFor={(p) =>
                pageHref(`/members/${member.id}`, { ...sp, ok: undefined, error: undefined }, p)
              }
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Joueurs rattachés</CardTitle>
              <CardDescription>
                Comptes joueurs reliés à ce membre grâce à l&apos;identifiant de suivi (sub-ID)
                transmis lors d&apos;un clic sur une offre.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {member.players.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun joueur rattaché : ce membre ne s&apos;est pas encore inscrit après un clic
                  sur une offre.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Programme</TableHead>
                      <TableHead>Sub-ID</TableHead>
                      <TableHead>FTD</TableHead>
                      <TableHead className="text-right">Dépôts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {member.players.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div>{p.affiliateCampaign.program.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.affiliateCampaign.name} · joueur {p.externalPlayerId}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.subId ?? "—"}
                          {p.subIdSource ? (
                            <div className="text-[10px] text-muted-foreground">
                              {p.subIdSource === "postback"
                                ? "reçu par postback"
                                : p.subIdSource === "time_match"
                                  ? "rapprochement horaire"
                                  : p.subIdSource}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {p.ftdAt
                            ? `${fmtDate(p.ftdAt)}${p.ftdAmount ? ` · ${fmtMoney(Number(p.ftdAmount))}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.depositCount} ·{" "}
                          {fmtMoney(Math.round(Number(p.depositTotal)), "EUR", { digits: 0 })}
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
              <CardTitle className="text-base">Étiquettes</CardTitle>
              <CardDescription>
                Pour retrouver ce membre dans Membres et le cibler dans les envois groupés. Les
                étiquettes se créent dans Réglages → Étiquettes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {member.anonymizedAt ? (
                <p className="text-sm text-muted-foreground">Membre anonymisé : pas d&apos;étiquette.</p>
              ) : tagRegistry.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune étiquette définie.{" "}
                  {me.role === "ADMIN" ? (
                    <Link href="/settings/tags" className="underline">
                      En créer une
                    </Link>
                  ) : (
                    "Demandez à un administrateur d'en créer dans Réglages → Étiquettes."
                  )}
                </p>
              ) : (
                <form action={setMemberTagsAction} className="space-y-3">
                  <input type="hidden" name="memberId" value={member.id} />
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {tagRegistry.map((t) => (
                      <label key={t.name} className="flex min-h-10 items-center gap-2 md:min-h-0">
                        <input
                          type="checkbox"
                          name="tags"
                          value={t.name}
                          defaultChecked={tags.includes(t.name)}
                          className="size-4"
                        />
                        <Badge variant="outline" className={tagColorClass(t.color)}>
                          {t.name}
                        </Badge>
                      </label>
                    ))}
                  </div>
                  {tags.some((t) => !tagRegistry.some((r) => r.name === t)) ? (
                    <p className="text-xs text-muted-foreground">
                      Posées par une automatisation (hors registre, conservées) :{" "}
                      {tags.filter((t) => !tagRegistry.some((r) => r.name === t)).join(", ")}
                    </p>
                  ) : null}
                  <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                    Enregistrer les étiquettes
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes internes</CardTitle>
              <CardDescription>Visibles uniquement par l&apos;équipe.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {member.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {member.anonymizedAt ? "Aucune note." : "Aucune note pour l'instant."}
                </p>
              ) : null}
              {member.notes.map((n) => (
                <div key={n.id} className="rounded-md border p-2 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {n.author?.name ?? "—"} · {fmtDate(n.createdAt)}
                    </span>
                    {me.role === "ADMIN" || n.author?.id === me.id ? (
                      <form action={deleteNoteAction}>
                        <input type="hidden" name="noteId" value={n.id} />
                        <ConfirmSubmit
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive"
                          message="Cette note sera supprimée définitivement. Continuer ?"
                        >
                          supprimer
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap">{n.text}</p>
                  {me.role === "ADMIN" || n.author?.id === me.id ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:underline">
                        modifier
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
                        <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                          Enregistrer
                        </Button>
                      </form>
                    </details>
                  ) : null}
                </div>
              ))}
              {member.anonymizedAt ? null : (
                <form action={addNoteAction} className="space-y-2">
                  <input type="hidden" name="memberId" value={member.id} />
                  <Label htmlFor="note-text" className="sr-only">
                    Nouvelle note
                  </Label>
                  <Textarea
                    id="note-text"
                    name="text"
                    placeholder="Ajouter une note (2 000 caractères maximum)…"
                    required
                    maxLength={2000}
                    rows={3}
                  />
                  <Button type="submit" size="sm" className="max-md:h-10">
                    Ajouter la note
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {me.role === "ADMIN" && !member.anonymizedAt ? (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="text-base">Supprimer ce membre</CardTitle>
                <CardDescription>
                  À utiliser quand la personne demande l&apos;effacement de ses données : son nom,
                  son pseudo et son identifiant sont effacés, ses notes supprimées ;
                  l&apos;historique est conservé sans donnée personnelle. Cette action est
                  irréversible.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  action={anonymizeMemberAction}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                >
                  <input type="hidden" name="memberId" value={member.id} />
                  <Label htmlFor="confirm-delete" className="sr-only">
                    Tapez SUPPRIMER pour confirmer
                  </Label>
                  <Input
                    id="confirm-delete"
                    name="confirm"
                    placeholder="Tapez SUPPRIMER"
                    required
                    className="h-10 sm:max-w-48 md:h-9"
                    autoComplete="off"
                  />
                  <ConfirmSubmit
                    variant="destructive"
                    size="sm"
                    className="max-md:h-10"
                    message={`Le membre « ${name} » sera anonymisé : nom, pseudo et identifiant effacés, notes supprimées. Cette action est irréversible. Continuer ?`}
                  >
                    Supprimer
                  </ConfirmSubmit>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
