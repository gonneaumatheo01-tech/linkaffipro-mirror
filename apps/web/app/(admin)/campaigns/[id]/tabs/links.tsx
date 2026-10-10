import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { CopyField } from "@/components/admin/copy-field";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { env } from "@/lib/env";
import { fmtNum } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badges";
import { PLATFORM_LABELS } from "../../campaign-form";
import { addEntryLinkAction } from "../../actions";
import { selectCls, type TabProps } from "./shared";

/** Onglet Liens : les liens d'entrée de la campagne (adresse à coller dans chaque pub) et le bouton « Ajouter un lien d'entrée ». */
export async function LinksTab({ id, campaign, scope }: TabProps) {
  const [links, channels] = await Promise.all([
    scope.inviteLinkIds.length
      ? prisma.inviteLink.findMany({
          where: { id: { in: scope.inviteLinkIds } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            adPlatform: true,
            adName: true,
            adSetName: true,
            isActive: true,
            requests: true,
            approved: true,
            joined: true,
            telegramInviteLink: true,
            channel: { select: { title: true } },
            ad: { select: { name: true, adSet: { select: { name: true } } } },
            trackingLinks: { where: { kind: "AD_ENTRY" }, select: { slug: true, clicks: true, uniqueClicks: true }, take: 1 },
          },
        })
      : [],
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
  ]);
  const base = env.trackingBaseUrl.replace(/\/$/, "");
  const campaignChannels = channels.filter((c) => scope.channelIds.includes(c.id));
  const channelOptions = campaignChannels.length ? campaignChannels : channels;
  const nextNumber = links.length + 1;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Liens d&apos;entrée ({links.length})</CardTitle>
          <CardDescription>
            Un lien par pub. Collez l&apos;adresse {base.replace(/^https?:\/\//, "")}/… dans la pub : chaque clic est compté, puis le visiteur reçoit l&apos;invitation Telegram du canal (avec demande
            d&apos;adhésion). Les membres arrivés par ces liens sont rattachés à la campagne.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <EmptyState title="Aucun lien d'entrée pour l'instant." description="Ajoutez-en un ci-dessous : une pub précise est créée dans « Groupe 1 » avec son lien goolink et son invitation Telegram." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pub précise</TableHead>
                  <TableHead>Adresse à coller dans la pub</TableHead>
                  <TableHead className="hidden md:table-cell">Canal</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Clics</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Demandes</TableHead>
                  <TableHead className="text-right">Acceptés</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l) => {
                  const tl = l.trackingLinks[0];
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="font-medium">{l.ad ? `${l.ad.adSet.name} › ${l.ad.name}` : l.adName || l.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.name}
                          {l.adPlatform ? ` · ${PLATFORM_LABELS[l.adPlatform] ?? l.adPlatform}` : ""}
                          {!l.isActive ? " · désactivé" : ""}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-64">
                        {tl ? <CopyField value={`${base}/${tl.slug}`} /> : <span className="text-xs text-muted-foreground">Lien goolink manquant : invitation directe {l.telegramInviteLink}</span>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{l.channel.title}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {fmtNum(tl?.clicks ?? 0)}
                        {tl ? <span className="text-xs text-muted-foreground"> ({fmtNum(tl.uniqueClicks)} uniques)</span> : null}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtNum(l.requests)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.approved)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Pour un lien créé ailleurs (page{" "}
            <Link href="/links" className="underline">
              Liens
            </Link>
            ), rattachez-le à une pub précise dans l&apos;onglet Pubs : il rejoint alors la campagne.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Ajouter un lien d&apos;entrée</CardTitle>
          <CardDescription>Crée une pub précise (dans le groupe indiqué, « Groupe 1 » par défaut) et son lien : goolink + invitation Telegram avec demande d&apos;adhésion sur le canal choisi.</CardDescription>
        </CardHeader>
        <CardContent>
          {channelOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun canal actif : ajoutez d&apos;abord un canal (menu Canaux).</p>
          ) : (
            <form action={addEntryLinkAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="campaignId" value={id} />
              <div className="space-y-1">
                <Label htmlFor="link-channel">Canal à rejoindre</Label>
                <select id="link-channel" name="channelId" className={`${selectCls} w-full`} defaultValue={channelOptions[0]?.id ?? ""} required>
                  {channelOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="link-platform">Plateforme</Label>
                <select id="link-platform" name="platform" className={`${selectCls} w-full`} defaultValue={campaign.adPlatform ?? "OTHER"}>
                  {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="link-adname">Nom de la pub précise</Label>
                <Input id="link-adname" name="adName" placeholder={`ex. Pub ${nextNumber}`} maxLength={80} className="h-10 md:h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="link-adset">Groupe (facultatif)</Label>
                <Input id="link-adset" name="adSetName" placeholder="Groupe 1" maxLength={80} className="h-10 md:h-9" />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" className="max-md:h-10">
                  Ajouter un lien d&apos;entrée
                </Button>
                <span className="ml-2 text-xs text-muted-foreground">
                  Statut de la campagne : <StatusBadge kind="campaign" value={campaign.status} />
                </span>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </>
  );
}
