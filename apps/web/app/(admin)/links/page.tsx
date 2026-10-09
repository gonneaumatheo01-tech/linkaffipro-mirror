import type { Metadata } from "next";
import { AD_PLATFORM_LABELS, buildAdUrl, VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { CopyField } from "@/components/admin/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { env } from "@/lib/env";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { createEntryLinksAction, createGenericLinkAction, toggleLinkAction } from "./actions";

export const metadata: Metadata = { title: "Liens" };

type Agg = { registrations: number; ftds: number };

export default async function LinksPage({ searchParams }: PageProps<"/links">) {
  await requireUser();
  const sp = await searchParams;
  const highlight = new Set(typeof sp.highlight === "string" ? sp.highlight.split(",") : []);
  const [links, channels, players] = await Promise.all([
    prisma.trackingLink.findMany({
      orderBy: { createdAt: "desc" },
      include: { inviteLink: { select: { name: true, requests: true, approved: true, joined: true, adPlatform: true, telegramInviteLink: true } }, channel: { select: { title: true } }, post: { select: { id: true, code: true, scheduledAt: true } }, affiliateCampaign: { select: { name: true } } },
    }),
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, include: { approvalRules: { where: { isActive: true }, select: { id: true, name: true, isDefault: true } } } }),
    prisma.player.findMany({ where: { click: { isNot: null } }, select: { registeredAt: true, ftdAt: true, click: { select: { trackingLinkId: true } } } }),
  ]);
  const agg = new Map<string, Agg>();
  for (const p of players) {
    const id = p.click?.trackingLinkId;
    if (!id) continue;
    const a = agg.get(id) ?? { registrations: 0, ftds: 0 };
    if (p.registeredAt) a.registrations++;
    if (p.ftdAt) a.ftds++;
    agg.set(id, a);
  }
  const base = env.trackingBaseUrl;
  const entries = links.filter((l) => l.kind === "AD_ENTRY");
  const offers = links.filter((l) => l.kind === "OFFER");
  const buttons = links.filter((l) => l.kind === "BUTTON" || l.kind === "GENERIC");
  const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";

  return (
    <>
      <PageHeader title="Liens" description={`Liens goolink (${base.replace("https://", "")}) : entrées par pub, offres personnalisées, boutons traqués.`} />
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entrées par pub</CardTitle>
          <CardDescription>Chaque pub a son lien goolink et son lien d&apos;invitation Telegram (avec demande d&apos;adhésion).</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun lien d&apos;entrée. Créez-en un ci-dessous.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Plateforme</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="text-right">Uniques</TableHead>
                  <TableHead className="text-right">Demandes</TableHead>
                  <TableHead className="text-right">Acceptés</TableHead>
                  <TableHead className="text-right">Inscrits</TableHead>
                  <TableHead className="text-right">FTD</TableHead>
                  <TableHead>URL à coller dans la pub</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((l) => {
                  const a = agg.get(l.id) ?? { registrations: 0, ftds: 0 };
                  const platform = l.inviteLink?.adPlatform ?? "OTHER";
                  return (
                    <TableRow key={l.id} className={highlight.has(l.slug) ? "bg-accent/40" : undefined}>
                      <TableCell>
                        <div className="font-medium">{l.label}</div>
                        <div className="text-xs text-muted-foreground">{base}/{l.slug} · {fmtDate(l.createdAt)}</div>
                        {!l.isActive ? <Badge variant="secondary">désactivé</Badge> : null}
                      </TableCell>
                      <TableCell>{l.channel?.title ?? "—"}</TableCell>
                      <TableCell>{AD_PLATFORM_LABELS[platform]}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.clicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.uniqueClicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.inviteLink?.requests ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.inviteLink?.approved ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(a.registrations)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(a.ftds)}</TableCell>
                      <TableCell className="min-w-72"><CopyField value={buildAdUrl(platform, `${base}/${l.slug}`)} /></TableCell>
                      <TableCell>
                        <form action={toggleLinkAction}>
                          <input type="hidden" name="linkId" value={l.id} />
                          <Button type="submit" size="sm" variant="ghost">{l.isActive ? "Désactiver" : "Réactiver"}</Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouveau lien d&apos;entrée (pub)</CardTitle>
            <CardDescription>Une ligne par nom pour en créer plusieurs d&apos;un coup (ex. TT-casino-FR-video3).</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createEntryLinksAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="channelId">Canal</Label>
                <select id="channelId" name="channelId" required className={selectCls}>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.title}{c.vertical ? ` · ${VERTICAL_LABELS[c.vertical]}` : ""}{c.isTest ? " (TEST)" : ""}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="names">Nom(s) de lien</Label>
                <Textarea id="names" name="names" required rows={3} placeholder={"TT-casino-FR-video3\nTT-casino-FR-video4"} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="platform">Plateforme</Label>
                  <select id="platform" name="platform" className={selectCls} defaultValue="TIKTOK">
                    {(["TIKTOK", "META", "OTHER"] as const).map((p) => <option key={p} value={p}>{AD_PLATFORM_LABELS[p]}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">Langue</Label>
                  <Input id="language" name="language" defaultValue="fr" maxLength={5} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="adCampaignName">Campagne</Label><Input id="adCampaignName" name="adCampaignName" placeholder="optionnel" /></div>
                <div className="space-y-2"><Label htmlFor="adSetName">Groupe</Label><Input id="adSetName" name="adSetName" placeholder="optionnel" /></div>
                <div className="space-y-2"><Label htmlFor="adName">Pub</Label><Input id="adName" name="adName" placeholder="optionnel" /></div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="approvalRuleId">Règle d&apos;adhésion (optionnel)</Label>
                <select id="approvalRuleId" name="approvalRuleId" className={selectCls} defaultValue="">
                  <option value="">— règle par défaut du canal —</option>
                  {channels.flatMap((c) => c.approvalRules.map((r) => <option key={r.id} value={r.id}>{c.title} · {r.name}{r.isDefault ? " (défaut)" : ""}</option>))}
                </select>
                <p className="text-xs text-muted-foreground">Si une règle est choisie, une copie propre à ce lien est créée (modifiable ensuite dans le canal).</p>
              </div>
              <Button type="submit">Créer le(s) lien(s)</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouveau lien générique</CardTitle>
            <CardDescription>Une URL quelconque traquée (clics comptés, robots exclus).</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createGenericLinkAction} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="label">Nom</Label><Input id="label" name="label" required maxLength={120} /></div>
              <div className="space-y-2"><Label htmlFor="url">URL de destination</Label><Input id="url" name="url" type="url" required placeholder="https://…" /></div>
              <Button type="submit" variant="outline">Créer le lien</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Offres personnalisées</CardTitle>
          <CardDescription>Boutons « Offre » des messages : chaque clic crée un sub-ID transmis à Link Affi.</CardDescription>
        </CardHeader>
        <CardContent>
          {offers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune offre : ajoutez un bouton de type Offre dans un message (page Messages).</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Campagne Link Affi</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="text-right">Membres</TableHead>
                  <TableHead className="text-right">Inscrits</TableHead>
                  <TableHead className="text-right">FTD</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((l) => {
                  const a = agg.get(l.id) ?? { registrations: 0, ftds: 0 };
                  return (
                    <TableRow key={l.id}>
                      <TableCell><div className="font-medium">{l.label}</div><div className="text-xs text-muted-foreground">{l.slug}{!l.isActive ? " · désactivé" : ""}</div></TableCell>
                      <TableCell>{l.affiliateCampaign?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.post ? `${l.post.code} · ${fmtDate(l.post.scheduledAt)}` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.clicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.uniqueClicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(a.registrations)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(a.ftds)}</TableCell>
                      <TableCell>
                        <form action={toggleLinkAction}><input type="hidden" name="linkId" value={l.id} /><Button type="submit" size="sm" variant="ghost">{l.isActive ? "Désactiver" : "Réactiver"}</Button></form>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Boutons et liens génériques</CardTitle>
          <CardDescription>URL traquées anonymes (boutons de messages et liens libres).</CardDescription>
        </CardHeader>
        <CardContent>
          {buttons.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun lien.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="text-right">Uniques</TableHead>
                  <TableHead>Lien goolink</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buttons.map((l) => (
                  <TableRow key={l.id} className={highlight.has(l.slug) ? "bg-accent/40" : undefined}>
                    <TableCell><div className="font-medium">{l.label}</div>{!l.isActive ? <Badge variant="secondary">désactivé</Badge> : null}</TableCell>
                    <TableCell>{l.kind === "BUTTON" ? "Bouton" : "Générique"}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={l.destinationTemplate}>{l.destinationTemplate}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(l.clicks)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(l.uniqueClicks)}</TableCell>
                    <TableCell className="min-w-64"><CopyField value={`${base}/${l.slug}`} /></TableCell>
                    <TableCell>
                      <form action={toggleLinkAction}><input type="hidden" name="linkId" value={l.id} /><Button type="submit" size="sm" variant="ghost">{l.isActive ? "Désactiver" : "Réactiver"}</Button></form>
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
