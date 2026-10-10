import type { Metadata } from "next";
import { VERTICALS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getWebhookInfoForBot, webhookUrlFor } from "@linkaffipro/telegram";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { UniverseDot } from "@/components/admin/universe-dot";
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
import { requireUser } from "@/lib/session";
import { ActiveBadge, StatusBadge } from "@/lib/status-badges";
import { universeLabel } from "@/lib/universe";
import { addBotAction, resyncWebhookAction, toggleBotAction } from "./actions";

export const metadata: Metadata = { title: "Bots" };

type WebhookView = {
  url?: string;
  pending?: number;
  lastError?: string;
  lastErrorAt?: Date;
  ok: boolean;
  fetchError?: string;
};

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

export default async function BotsPage({ searchParams }: PageProps<"/settings/bots">) {
  const user = await requireUser();
  const sp = await searchParams;
  const bots = await prisma.bot.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { channelAdmins: { where: { revokedAt: null } }, memberStates: true } },
    },
  });
  const webhooks = await Promise.all(
    bots.map((b) => (b.isActive ? webhookView(b.id) : Promise.resolve<WebhookView>({ ok: false }))),
  );
  const isAdmin = user.role === "ADMIN";

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Bots"
        description="Vos bots Telegram, un par univers (casino, paris sportifs, rencontres). Ce sont eux qui accueillent les membres et publient les messages."
        help={
          isAdmin
            ? "Première chose à faire : ajouter un bot en collant son jeton (ci-dessous), puis l'ajouter comme administrateur de vos canaux dans Telegram."
            : "Si une connexion Telegram est « À vérifier », cliquez « Reposer la connexion »."
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="pt-6">
          {bots.length === 0 ? (
            <EmptyState
              title="Aucun bot enregistré"
              description={
                isAdmin
                  ? "Créez un bot avec @BotFather dans Telegram, puis collez son jeton dans le formulaire ci-dessous."
                  : "Un administrateur doit ajouter un bot (jeton @BotFather)."
              }
              action={isAdmin ? { href: "#add-bot", label: "Ajouter un bot" } : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bot</TableHead>
                  <TableHead className="hidden md:table-cell">Univers</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      Connexion Telegram{" "}
                      <HelpTip label="Définition : connexion Telegram">
                        Connexion Telegram (webhook) : l&apos;adresse à laquelle Telegram envoie au
                        bot tout ce qui se passe. Si elle est « À vérifier », cliquez « Reposer la
                        connexion ».
                      </HelpTip>
                    </span>
                  </TableHead>
                  <TableHead className="hidden md:table-cell">Canaux administrés</TableHead>
                  <TableHead className="hidden md:table-cell">Membres</TableHead>
                  <TableHead className="hidden md:table-cell">Dernier signal</TableHead>
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
                        <UniverseDot
                          universe={b.vertical}
                          withLabel
                          className="text-xs text-muted-foreground md:hidden"
                        />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <UniverseDot universe={b.vertical} withLabel />
                      </TableCell>
                      <TableCell>
                        <ActiveBadge active={b.isActive} />
                      </TableCell>
                      <TableCell className="max-w-xs">
                        {!b.isActive ? (
                          <StatusBadge kind="webhook" value="off" />
                        ) : w.fetchError ? (
                          <span className="text-xs text-destructive">
                            Telegram injoignable : {w.fetchError}
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <StatusBadge kind="webhook" value={w.ok ? "ok" : "check"} />
                            <div
                              className="hidden truncate font-mono text-[11px] text-muted-foreground md:block"
                              title={w.url}
                            >
                              {w.url || "aucune adresse"}
                            </div>
                            {w.pending ? (
                              <div className="text-xs text-muted-foreground">
                                {fmtNum(w.pending)} message(s) de Telegram en attente
                              </div>
                            ) : null}
                            {w.lastError ? (
                              <div className="text-xs text-destructive">
                                {w.lastError} ({fmtDate(w.lastErrorAt)})
                              </div>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">
                        {b._count.channelAdmins}
                      </TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">
                        {fmtNum(b._count.memberStates)}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                        {fmtDate(b.lastWebhookAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                          <form action={resyncWebhookAction}>
                            <input type="hidden" name="botId" value={b.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="max-md:h-10"
                              disabled={!b.isActive}
                            >
                              Reposer la connexion
                            </Button>
                          </form>
                          {isAdmin ? (
                            <form action={toggleBotAction}>
                              <input type="hidden" name="botId" value={b.id} />
                              {b.isActive ? (
                                <ConfirmSubmit
                                  size="sm"
                                  variant="ghost"
                                  className="max-md:h-10"
                                  message={`Désactiver @${b.username} ? Le bot ne répondra plus aux membres, n'acceptera plus les demandes d'adhésion et ne publiera plus de messages tant qu'il est inactif. Vous pourrez le réactiver ici.`}
                                >
                                  Désactiver
                                </ConfirmSubmit>
                              ) : (
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="ghost"
                                  className="max-md:h-10"
                                >
                                  Activer
                                </Button>
                              )}
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
        <Card id="add-bot" className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">Ajouter un bot</CardTitle>
            <CardDescription>
              Collez le jeton donné par @BotFather. Le bot est vérifié, son jeton est chiffré, puis
              sa connexion Telegram (webhook) est posée automatiquement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={addBotAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token">Jeton du bot</Label>
                <Input
                  id="token"
                  name="token"
                  placeholder="123456789:AAE…"
                  required
                  autoComplete="off"
                  className="max-md:h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vertical">Univers</Label>
                <select
                  id="vertical"
                  name="vertical"
                  required
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9"
                >
                  {VERTICALS.map((v) => (
                    <option key={v} value={v}>
                      {universeLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" className="max-md:h-10">
                Ajouter le bot
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
