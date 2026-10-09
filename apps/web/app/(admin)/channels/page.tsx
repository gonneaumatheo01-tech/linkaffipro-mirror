import type { Metadata } from "next";
import Link from "next/link";
import { VERTICALS, VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { ActiveBadge, statusLabel } from "@/lib/status-badges";
import { updateChannelAction } from "./actions";

export const metadata: Metadata = { title: "Canaux" };

export default async function ChannelsPage({ searchParams }: PageProps<"/channels">) {
  const sp = await searchParams;
  const [channels, bots] = await Promise.all([
    prisma.channel.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        botAdmins: { where: { revokedAt: null }, include: { bot: { select: { username: true } } } },
      },
    }),
    prisma.bot.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, username: true, vertical: true },
    }),
  ]);
  const selectCls = "h-10 w-full rounded-md border bg-background px-2 text-sm md:h-8";
  const exampleBot = bots[0]?.username ?? "votre bot";
  return (
    <>
      <PageHeader
        title="Canaux"
        description="Vos canaux et groupes Telegram. Ils sont détectés automatiquement dès qu'un de nos bots y est ajouté comme administrateur."
        help="Pour chaque canal : choisissez l'univers et le bot principal, puis ouvrez-le pour régler l'accueil des membres (délai, canaux à rejoindre, messages du bot)."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <Card>
        <CardContent className="pt-6">
          {channels.length === 0 ? (
            <EmptyState
              title="Aucun canal détecté pour l'instant"
              description={
                <>
                  Dans Telegram, ouvrez le canal → Administrateurs → Ajouter un administrateur →
                  choisissez @{exampleBot} → validez. Le canal apparaît ici en quelques secondes.
                </>
              }
              action={{ href: "/bots", label: "Voir les bots", variant: "outline" }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead className="hidden lg:table-cell">Bots administrateurs</TableHead>
                  <TableHead>Réglages</TableHead>
                  <TableHead className="hidden md:table-cell">Détecté le</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c) => {
                  const fid = `f-${c.id}`;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="align-top">
                        <div className="font-medium">
                          <Link href={`/channels/${c.id}`} className="hover:underline">
                            {c.title}
                          </Link>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.username ? `@${c.username} · ` : ""}
                          {statusLabel("chatType", c.type).toLowerCase()} · identifiant{" "}
                          {c.telegramChatId.toString()}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <ActiveBadge active={c.isActive} />
                          {c.isTest ? <Badge variant="outline">TEST</Badge> : null}
                          {c.isMediaLibrary ? <Badge variant="outline">Médiathèque</Badge> : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1 lg:hidden">
                          {c.botAdmins.map((a) => (
                            <Badge key={a.id} variant="outline">
                              @{a.bot.username}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="hidden align-top lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {c.botAdmins.length === 0 ? (
                            <span className="text-xs text-destructive">
                              aucun : ajoutez un bot administrateur dans Telegram
                            </span>
                          ) : (
                            c.botAdmins.map((a) => (
                              <Badge key={a.id} variant="outline">
                                @{a.bot.username}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <form action={updateChannelAction} id={fid}>
                          <input type="hidden" name="channelId" value={c.id} />
                        </form>
                        <div className="grid min-w-64 gap-2 md:grid-cols-[1fr_4rem_1fr]">
                          <select
                            name="vertical"
                            form={fid}
                            aria-label={`Univers de ${c.title}`}
                            defaultValue={c.vertical ?? ""}
                            className={selectCls}
                          >
                            <option value="">— univers à choisir —</option>
                            {VERTICALS.map((v) => (
                              <option key={v} value={v}>
                                {VERTICAL_LABELS[v]}
                              </option>
                            ))}
                          </select>
                          <input
                            name="language"
                            form={fid}
                            aria-label={`Langue de ${c.title} (code à deux lettres)`}
                            defaultValue={c.language}
                            maxLength={5}
                            className={selectCls}
                            title="Langue (fr, en, es…)"
                          />
                          <select
                            name="primaryBotId"
                            form={fid}
                            aria-label={`Bot principal de ${c.title}`}
                            defaultValue={c.primaryBotId ?? ""}
                            className={selectCls}
                          >
                            <option value="">— bot principal : aucun —</option>
                            {bots.map((b) => (
                              <option key={b.id} value={b.id}>
                                @{b.username}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              name="isTest"
                              form={fid}
                              defaultChecked={c.isTest}
                            />{" "}
                            Canal de test{" "}
                            <HelpTip label="Définition : canal de test">
                              Un canal de test sert à essayer les messages et les règles sans
                              toucher aux vrais membres. Les envois automatiques s&apos;y limitent.
                            </HelpTip>
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              name="isMediaLibrary"
                              form={fid}
                              defaultChecked={c.isMediaLibrary}
                            />{" "}
                            Médiathèque{" "}
                            <HelpTip label="Définition : médiathèque">
                              Canal privé où le bot dépose les photos et vidéos pour les réutiliser
                              sans les renvoyer.
                            </HelpTip>
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              name="isActive"
                              form={fid}
                              defaultChecked={c.isActive}
                            />{" "}
                            Actif
                          </label>
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap align-top text-xs text-muted-foreground md:table-cell">
                        {fmtDate(c.createdAt)}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <Button
                          type="submit"
                          form={fid}
                          size="sm"
                          variant="outline"
                          className="max-md:h-10"
                        >
                          Enregistrer
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
