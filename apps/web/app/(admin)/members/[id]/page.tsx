import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { aggregatePlayers, computeSpendLevel, SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { displayName, getSpendThresholds } from "@/lib/members/query";
import { buildTimeline } from "@/lib/members/timeline";
import { addNoteAction, anonymizeMemberAction, deleteNoteAction } from "./actions";

export const metadata: Metadata = { title: "Fiche membre" };

const KIND_COLORS: Record<string, string> = { membership: "bg-blue-500", message: "bg-slate-400", click: "bg-amber-500", player: "bg-emerald-500", event: "bg-violet-500" };

export default async function MemberPage({ params, searchParams }: PageProps<"/members/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const [member, thresholds] = await Promise.all([
    prisma.member.findUnique({
      where: { id },
      include: {
        botStates: { include: { bot: { select: { username: true, name: true } } } },
        memberships: { orderBy: { requestedAt: "desc" }, include: { channel: { select: { title: true, id: true } }, inviteLink: { include: { campaign: { select: { name: true, adPlatform: true } }, trackingLinks: { select: { affiliateCampaign: { select: { name: true } } } } } } } },
        clicks: { orderBy: { createdAt: "desc" }, take: 200, include: { trackingLink: { select: { kind: true, label: true } } } },
        players: { include: { affiliateCampaign: { select: { name: true, program: { select: { name: true } } } }, events: { orderBy: { occurredAt: "desc" }, take: 200 } } },
        outboundMessages: { orderBy: { queuedAt: "desc" }, take: 200, include: { bot: { select: { username: true } } } },
        events: { where: { type: { startsWith: "member." } }, orderBy: { occurredAt: "desc" }, take: 100, select: { type: true, occurredAt: true } },
        notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true, id: true } } } },
      },
    }),
    getSpendThresholds(),
  ]);
  if (!member) notFound();

  const agg = aggregatePlayers(member.players.map((p) => ({ registeredAt: p.registeredAt, depositCount: p.depositCount, depositTotal: Number(p.depositTotal) })));
  const level = computeSpendLevel(agg, thresholds);
  const ngr = member.players.reduce((s, p) => s + Number(p.ngr), 0);
  const timeline = buildTimeline({
    memberships: member.memberships.map((m) => ({ id: m.id, channelTitle: m.channel.title, status: m.status, requestedAt: m.requestedAt, gateSatisfiedAt: m.gateSatisfiedAt, approveAt: m.approveAt, approvedAt: m.approvedAt, declinedAt: m.declinedAt, joinedAt: m.joinedAt, leftAt: m.leftAt, sourceName: m.inviteLink?.adName || m.inviteLink?.name })),
    outbound: member.outboundMessages.map((o) => ({ kind: o.kind, status: o.status, queuedAt: o.queuedAt, sentAt: o.sentAt, botUsername: o.bot.username })),
    clicks: member.clicks.map((c) => ({ createdAt: c.createdAt, subId: c.subId, kind: c.trackingLink.kind, label: c.trackingLink.label, postId: c.postId, isBot: c.isBot })),
    playerEvents: member.players.flatMap((p) => p.events.map((e) => ({ type: e.type, occurredAt: e.occurredAt, amount: e.amount === null ? null : Number(e.amount), currency: e.currency, campaignName: p.affiliateCampaign.name }))),
    events: member.events,
  });
  const origin = member.memberships[member.memberships.length - 1];
  const name = displayName(member);

  return (
    <>
      <PageHeader title={name} description={member.anonymizedAt ? `Anonymisé le ${fmtDate(member.anonymizedAt)}` : `Identifiant Telegram ${member.telegramUserId.toString()}${member.username ? ` · @${member.username}` : ""}${member.languageCode ? ` · langue ${member.languageCode}` : ""}${member.isPremium ? " · Premium" : ""}`}>
        <Badge variant={level === "VIP" ? "default" : "outline"}>{SPEND_LEVEL_LABELS[level]}</Badge>
        <Button variant="outline" size="sm" render={<Link href="/members" />}>← Membres</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Origine</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Première demande : <span className="text-muted-foreground">{origin ? `${origin.channel.title}, ${fmtDate(origin.requestedAt)}` : "—"}</span></div>
            <div>Lien d&apos;entrée : <span className="text-muted-foreground">{origin?.inviteLink?.name ?? "—"}</span></div>
            <div>Pub : <span className="text-muted-foreground">{origin?.inviteLink?.adName ?? origin?.inviteLink?.campaign?.name ?? "—"}{origin?.inviteLink?.adPlatform ? ` (${origin.inviteLink.adPlatform})` : ""}</span></div>
            <div>Campagne d&apos;affiliation : <span className="text-muted-foreground">{origin?.inviteLink?.trackingLinks.find((t) => t.affiliateCampaign)?.affiliateCampaign?.name ?? member.players[0]?.affiliateCampaign.name ?? "—"}</span></div>
            <div>Vu la première fois : <span className="text-muted-foreground">{fmtDate(member.firstSeenAt)}</span> · dernière fois : <span className="text-muted-foreground">{fmtDate(member.lastSeenAt)}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Messages privés</CardTitle><CardDescription>Bots qui peuvent lui écrire.</CardDescription></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {member.botStates.length === 0 ? <p className="text-muted-foreground">Aucun bot contacté.</p> : member.botStates.map((s) => (
              <div key={s.id} className="flex items-center justify-between">
                <span>@{s.bot.username}</span>
                {s.canDm ? <Badge variant="outline">joignable</Badge> : <Badge variant="secondary">{s.blockedAt ? "bloqué" : "non joignable"}</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Dépenses</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Joueurs rattachés : <span className="text-muted-foreground">{member.players.length}</span></div>
            <div>Dépôts : <span className="text-muted-foreground">{agg.depositCount} · {fmtNum(Math.round(agg.depositTotal))} €</span></div>
            <div>NGR : <span className="text-muted-foreground">{ngr.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €</span></div>
            <div>Clics (humains) : <span className="text-muted-foreground">{member.clicks.filter((c) => !c.isBot).length}</span></div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Chronologie</CardTitle></CardHeader>
          <CardContent>
            {timeline.length === 0 ? <p className="text-sm text-muted-foreground">Rien pour l&apos;instant.</p> : (
              <ol className="space-y-2">
                {timeline.map((e, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${KIND_COLORS[e.kind] ?? "bg-slate-300"}`} />
                    <span className="w-32 shrink-0 whitespace-nowrap text-muted-foreground">{fmtDate(e.at)}</span>
                    <span>
                      {e.href ? <Link href={e.href} className="hover:underline">{e.title}</Link> : e.title}
                      {e.detail ? <span className="ml-2 text-xs text-muted-foreground">{e.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Joueurs rattachés</CardTitle></CardHeader>
            <CardContent>
              {member.players.length === 0 ? <p className="text-sm text-muted-foreground">Aucun joueur rattaché (pas encore d&apos;inscription via un clic offre).</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Programme</TableHead><TableHead>Sub-ID</TableHead><TableHead>FTD</TableHead><TableHead className="text-right">Dépôts</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {member.players.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell><div>{p.affiliateCampaign.program.name}</div><div className="text-xs text-muted-foreground">{p.affiliateCampaign.name} · joueur {p.externalPlayerId}</div></TableCell>
                        <TableCell className="font-mono text-xs">{p.subId ?? "—"}{p.subIdSource ? <div className="text-[10px] text-muted-foreground">{p.subIdSource}</div> : null}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{p.ftdAt ? `${fmtDate(p.ftdAt)}${p.ftdAmount ? ` · ${Number(p.ftdAmount)} €` : ""}` : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.depositCount} · {fmtNum(Math.round(Number(p.depositTotal)))} €</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Notes internes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {member.notes.map((n) => (
                <div key={n.id} className="rounded-md border p-2 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{n.author?.name ?? "—"} · {fmtDate(n.createdAt)}</span>
                    {me.role === "ADMIN" || n.author?.id === me.id ? (
                      <form action={deleteNoteAction}><input type="hidden" name="noteId" value={n.id} /><button type="submit" className="hover:underline">supprimer</button></form>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap">{n.text}</p>
                </div>
              ))}
              {member.anonymizedAt ? null : (
                <form action={addNoteAction} className="space-y-2">
                  <input type="hidden" name="memberId" value={member.id} />
                  <Textarea name="text" placeholder="Ajouter une note…" required maxLength={2000} rows={3} />
                  <Button type="submit" size="sm">Ajouter</Button>
                </form>
              )}
            </CardContent>
          </Card>

          {me.role === "ADMIN" && !member.anonymizedAt ? (
            <Card className="border-destructive/40">
              <CardHeader><CardTitle className="text-base">Supprimer ce membre</CardTitle><CardDescription>Efface son identité (nom, pseudo, identifiant), supprime les notes, conserve l&apos;historique anonyme. Irréversible.</CardDescription></CardHeader>
              <CardContent>
                <form action={anonymizeMemberAction} className="flex items-center gap-2">
                  <input type="hidden" name="memberId" value={member.id} />
                  <Input name="confirm" placeholder="Tapez SUPPRIMER" required className="max-w-48" />
                  <Button type="submit" variant="destructive" size="sm">Supprimer</Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
