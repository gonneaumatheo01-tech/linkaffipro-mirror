import type { Metadata } from "next";
import { VERTICALS, VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { updateChannelAction } from "./actions";

export const metadata: Metadata = { title: "Canaux" };

export default async function ChannelsPage({ searchParams }: PageProps<"/channels">) {
  const sp = await searchParams;
  const [channels, bots] = await Promise.all([
    prisma.channel.findMany({ orderBy: { createdAt: "desc" }, include: { botAdmins: { where: { revokedAt: null }, include: { bot: { select: { username: true } } } } } }),
    prisma.bot.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, username: true, vertical: true } }),
  ]);
  const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";
  return (
    <>
      <PageHeader title="Canaux" description="Détectés automatiquement dès qu'un de nos bots est ajouté comme administrateur ou voit un message." />
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="pt-6">
          {channels.length === 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Aucun canal détecté pour l&apos;instant.</p>
              <p>Pour en ajouter un : dans Telegram, ouvrez le canal → Administrateurs → Ajouter un administrateur → choisissez un de nos bots (ex. @casinogamblingoobot) → validez. Le canal apparaît ici en quelques secondes.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead>Bots administrateurs</TableHead>
                  <TableHead>Univers</TableHead>
                  <TableHead>Langue</TableHead>
                  <TableHead>Bot principal</TableHead>
                  <TableHead>Options</TableHead>
                  <TableHead>Détecté</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.title}</div>
                      <div className="text-xs text-muted-foreground">{c.username ? `@${c.username} · ` : ""}{c.type === "CHANNEL" ? "canal" : "groupe"} · id {c.telegramChatId.toString()}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.botAdmins.length === 0 ? <span className="text-xs text-muted-foreground">aucun</span> : c.botAdmins.map((a) => <Badge key={a.id} variant="outline">@{a.bot.username}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell colSpan={5} className="p-0">
                      <form action={updateChannelAction} id={`f-${c.id}`} className="contents">
                        <input type="hidden" name="channelId" value={c.id} />
                      </form>
                      <div className="grid grid-cols-5 items-center gap-2 px-2 py-2">
                        <select name="vertical" form={`f-${c.id}`} defaultValue={c.vertical ?? ""} className={selectCls}>
                          <option value="">— à choisir —</option>
                          {VERTICALS.map((v) => <option key={v} value={v}>{VERTICAL_LABELS[v]}</option>)}
                        </select>
                        <input name="language" form={`f-${c.id}`} defaultValue={c.language} maxLength={5} className={`${selectCls} w-16`} />
                        <select name="primaryBotId" form={`f-${c.id}`} defaultValue={c.primaryBotId ?? ""} className={selectCls}>
                          <option value="">— aucun —</option>
                          {bots.map((b) => <option key={b.id} value={b.id}>@{b.username}</option>)}
                        </select>
                        <div className="flex flex-col gap-1 text-xs">
                          <label className="flex items-center gap-1"><input type="checkbox" name="isTest" form={`f-${c.id}`} defaultChecked={c.isTest} /> TEST</label>
                          <label className="flex items-center gap-1"><input type="checkbox" name="isMediaLibrary" form={`f-${c.id}`} defaultChecked={c.isMediaLibrary} /> Médiathèque</label>
                          <label className="flex items-center gap-1"><input type="checkbox" name="isActive" form={`f-${c.id}`} defaultChecked={c.isActive} /> Actif</label>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
                          <Button type="submit" form={`f-${c.id}`} size="sm" variant="outline">Enregistrer</Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
