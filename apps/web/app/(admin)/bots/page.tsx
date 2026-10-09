import type { Metadata } from "next";
import { VERTICALS, VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getWebhookInfoForBot, webhookUrlFor } from "@linkaffipro/telegram";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { addBotAction, resyncWebhookAction, toggleBotAction } from "./actions";

export const metadata: Metadata = { title: "Bots" };

type WebhookView = { url?: string; pending?: number; lastError?: string; lastErrorAt?: Date; ok: boolean; fetchError?: string };

async function webhookView(botId: string): Promise<WebhookView> {
  try {
    const info = await getWebhookInfoForBot(botId);
    const expected = webhookUrlFor(botId);
    return {
      url: info.url,
      pending: info.pending_update_count,
      lastError: info.last_error_message,
      lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000) : undefined,
      ok: info.url === expected && !info.last_error_message,
    };
  } catch (err) {
    return { ok: false, fetchError: err instanceof Error ? err.message : "inconnu" };
  }
}

export default async function BotsPage({ searchParams }: PageProps<"/bots">) {
  const user = await requireUser();
  const sp = await searchParams;
  const bots = await prisma.bot.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { channelAdmins: { where: { revokedAt: null } }, memberStates: true } } } });
  const webhooks = await Promise.all(bots.map((b) => (b.isActive ? webhookView(b.id) : Promise.resolve<WebhookView>({ ok: false }))));
  const isAdmin = user.role === "ADMIN";

  return (
    <>
      <PageHeader title="Bots" description="Un bot Telegram par univers. Les jetons sont chiffrés en base." />
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="pt-6">
          {bots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun bot enregistré.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bot</TableHead>
                  <TableHead>Univers</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Webhook</TableHead>
                  <TableHead>Canaux admin</TableHead>
                  <TableHead>Membres</TableHead>
                  <TableHead>Dernière update</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bots.map((b, i) => {
                  const w = webhooks[i]!;
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-muted-foreground">@{b.username}</div>
                      </TableCell>
                      <TableCell>{VERTICAL_LABELS[b.vertical]}</TableCell>
                      <TableCell>{b.isActive ? <Badge>actif</Badge> : <Badge variant="secondary">inactif</Badge>}</TableCell>
                      <TableCell className="max-w-xs">
                        {!b.isActive ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : w.fetchError ? (
                          <span className="text-xs text-destructive">Telegram injoignable : {w.fetchError}</span>
                        ) : (
                          <div className="space-y-1">
                            {w.ok ? <Badge variant="outline">ok</Badge> : <Badge variant="destructive">à vérifier</Badge>}
                            <div className="truncate font-mono text-[11px] text-muted-foreground" title={w.url}>{w.url || "aucune URL"}</div>
                            {w.pending ? <div className="text-xs text-muted-foreground">{w.pending} update(s) en attente</div> : null}
                            {w.lastError ? <div className="text-xs text-destructive">{w.lastError} ({fmtDate(w.lastErrorAt)})</div> : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{b._count.channelAdmins}</TableCell>
                      <TableCell className="tabular-nums">{b._count.memberStates}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(b.lastWebhookAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <form action={resyncWebhookAction}>
                            <input type="hidden" name="botId" value={b.id} />
                            <Button type="submit" size="sm" variant="outline" disabled={!b.isActive}>Re-synchroniser le webhook</Button>
                          </form>
                          {isAdmin ? (
                            <form action={toggleBotAction}>
                              <input type="hidden" name="botId" value={b.id} />
                              <Button type="submit" size="sm" variant="ghost">{b.isActive ? "Désactiver" : "Activer"}</Button>
                            </form>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">Ajouter un bot</CardTitle>
            <CardDescription>Collez le jeton donné par @BotFather. Le bot est vérifié (getMe), chiffré, puis son webhook est posé.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={addBotAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token">Jeton du bot</Label>
                <Input id="token" name="token" placeholder="123456789:AAE…" required autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vertical">Univers</Label>
                <select id="vertical" name="vertical" required className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  {VERTICALS.map((v) => (
                    <option key={v} value={v}>{VERTICAL_LABELS[v]}</option>
                  ))}
                </select>
              </div>
              <Button type="submit">Ajouter le bot</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
