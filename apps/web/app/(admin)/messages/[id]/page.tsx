import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { env } from "@/lib/env";
import { fmtDate, fmtNum } from "@/lib/format";
import { BUTTON_TYPE_LABELS, parseButtons, previewButtonUrl } from "@/lib/posts/buttons";
import { POST_STATUS_LABELS, POST_STATUS_VARIANT } from "@/lib/posts/queries";
import { cancelPostAction, deleteOnTelegramAction, discardPostAction, saveAsTemplateAction, shiftPostAction } from "../actions";

export const metadata: Metadata = { title: "Message" };

export default async function MessageDetailPage({ params, searchParams }: PageProps<"/messages/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const post = await prisma.post.findUnique({ where: { id }, include: { channel: true, bot: true, category: true, stats: true, trackingLinks: { include: { _count: { select: { clickRecords: true } } } } } });
  if (!post) notFound();
  const buttons = parseButtons(post.buttons);
  const mediaCount = ((post.mediaAssetIds as string[]) ?? []).length;
  const linkById = new Map(post.trackingLinks.map((l) => [l.id, l]));
  // Clics uniques : membres distincts sur les clics offre + ip/ua distincts sur les boutons traqués.
  const uniqueClickers = post.trackingLinks.length
    ? await prisma.click.groupBy({ by: ["memberId", "ipHash", "userAgent"], where: { postId: post.id, isBot: false } }).then((g) => g.length)
    : 0;
  const players = await prisma.player.findMany({ where: { click: { postId: post.id } }, select: { registeredAt: true, ftdAt: true, depositCount: true, depositTotal: true } });
  const stats = {
    clicks: post.trackingLinks.reduce((s, l) => s + l.clicks, 0),
    offerClicks: post.stats?.offerClicks ?? post.trackingLinks.filter((l) => l.kind === "OFFER").reduce((s, l) => s + l.clicks, 0),
    uniqueClickers,
    reactions: (post.stats?.reactions as Record<string, number>) ?? {},
    reactionsTotal: post.stats?.reactionsTotal ?? 0,
    registrations: players.filter((p) => p.registeredAt).length,
    ftds: players.filter((p) => p.ftdAt).length,
    deposits: players.reduce((s, p) => s + p.depositCount, 0),
    depositAmount: players.reduce((s, p) => s + Number(p.depositTotal), 0),
  };
  const ctx = { trackingBaseUrl: env.trackingBaseUrl, botUsername: post.bot.username, postCode: post.code };
  const editable = ["DRAFT", "SCHEDULED", "FAILED", "CANCELLED"].includes(post.status);

  return (
    <>
      <PageHeader title={post.isTemplate ? `Modèle « ${post.templateName} »` : `Message pour ${post.channel.title}`} description={`${POST_STATUS_LABELS[post.status]}${post.scheduledAt ? ` · ${fmtDate(post.scheduledAt)}` : ""}${post.sentAt ? ` · envoyé ${fmtDate(post.sentAt)}` : ""} · via @${post.bot.username}`}>
        <Badge variant={POST_STATUS_VARIANT[post.status]}>{POST_STATUS_LABELS[post.status]}</Badge>
        {editable ? <Button size="sm" variant="outline" render={<Link href={`/messages/${post.id}/edit`} />}>Modifier</Button> : null}
        <Button size="sm" variant="outline" render={<Link href={`/messages/new?from=${post.id}`} />}>Dupliquer</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error ?? post.lastError ?? undefined} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Chiffres</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Clics", stats.clicks], ["Clics uniques", stats.uniqueClickers], ["Clics offres", stats.offerClicks], ["Réactions", stats.reactionsTotal],
                  ["Inscriptions", stats.registrations], ["FTD", stats.ftds], ["Dépôts", stats.deposits], ["Montant déposé", `${fmtNum(Math.round(stats.depositAmount))} €`],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-xl font-semibold tabular-nums">{typeof value === "number" ? fmtNum(value) : value}</div>
                  </div>
                ))}
              </div>
              {Object.keys(stats.reactions).length > 0 ? <p className="mt-3 text-sm text-muted-foreground">{Object.entries(stats.reactions).map(([e, n]) => `${e} ${n}`).join("  ")}</p> : null}
              <p className="mt-3 text-xs text-muted-foreground">Vues et transferts arrivent en phase 2.</p>
            </CardContent>
          </Card>
          {buttons.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Boutons</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Libellé</TableHead><TableHead>Type</TableHead><TableHead>URL</TableHead><TableHead className="text-right">Clics</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {buttons.flat().map((b, i) => {
                      const l = b.trackingLinkId ? linkById.get(b.trackingLinkId) : null;
                      return (
                        <TableRow key={i}>
                          <TableCell>{b.text}</TableCell>
                          <TableCell>{BUTTON_TYPE_LABELS[b.type]}</TableCell>
                          <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">{previewButtonUrl(b, ctx)}</TableCell>
                          <TableCell className="text-right tabular-nums">{l ? `${l.clicks} (${l._count.clickRecords} total)` : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {post.status === "SCHEDULED" ? (
                <>
                  <form action={shiftPostAction} className="flex items-center gap-1"><input type="hidden" name="postId" value={post.id} /><Input name="minutes" type="number" defaultValue={30} className="h-8 w-20" /><Button type="submit" size="sm" variant="outline">Décaler (min)</Button></form>
                  <form action={cancelPostAction}><input type="hidden" name="postId" value={post.id} /><Button type="submit" size="sm" variant="outline">Annuler l&apos;envoi</Button></form>
                </>
              ) : null}
              {post.status === "SENT" ? <form action={deleteOnTelegramAction}><input type="hidden" name="postId" value={post.id} /><Button type="submit" size="sm" variant="destructive">Supprimer sur Telegram</Button></form> : null}
              {!post.isTemplate ? <form action={saveAsTemplateAction} className="flex items-center gap-1"><input type="hidden" name="postId" value={post.id} /><Input name="templateName" placeholder="Nom du modèle" className="h-8 w-44" /><Button type="submit" size="sm" variant="outline">Enregistrer comme modèle</Button></form> : null}
              {["DRAFT", "CANCELLED", "FAILED"].includes(post.status) ? <form action={discardPostAction}><input type="hidden" name="postId" value={post.id} /><Button type="submit" size="sm" variant="ghost">Retirer {post.isTemplate ? "le modèle" : "le brouillon"}</Button></form> : null}
            </CardContent>
          </Card>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Rendu</p>
          <TelegramPreview html={post.text} buttons={buttons} mediaCount={mediaCount} />
          {post.category ? <p className="mt-2 text-xs text-muted-foreground">Catégorie : {post.category.name}</p> : null}
        </div>
      </div>
    </>
  );
}
