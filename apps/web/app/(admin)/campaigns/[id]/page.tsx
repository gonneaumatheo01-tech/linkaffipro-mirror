import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum } from "@/lib/format";
import { computeMetrics, fmtEur, fmtRatio } from "@/lib/campaigns/metrics";
import { campaignTotals, rangeKeyOf, sinceFor, unattachedEntryLinks } from "@/lib/campaigns/queries";
import { requireUser } from "@/lib/session";
import { CampaignForm, PLATFORM_LABELS, STATUS_LABELS } from "../campaign-form";
import { addAdAction, addAdSetAction, addManualCostAction, attachLinkAction, updateCampaignAction } from "../actions";

export const metadata: Metadata = { title: "Pub" };

const dayFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "UTC" });

export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const range = rangeKeyOf(sp.range);
  const since = sinceFor(range);
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      adSets: { orderBy: { name: "asc" }, include: { ads: { orderBy: { name: "asc" }, include: { inviteLink: { select: { id: true, name: true, requests: true, approved: true, joined: true, channel: { select: { title: true } } } }, trackingLink: { select: { slug: true, clicks: true } } } } } },
      inviteLinks: { select: { id: true } },
      trackingLinks: { select: { id: true } },
    },
  });
  if (!campaign) notFound();
  const [channels, unattached, costs] = await Promise.all([
    prisma.channel.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    unattachedEntryLinks(),
    prisma.adCost.findMany({
      where: { date: { gte: since }, OR: [{ campaignId: id }, { adSet: { campaignId: id } }, { ad: { adSet: { campaignId: id } } }] },
      orderBy: [{ date: "desc" }],
      include: { ad: { select: { name: true } }, adSet: { select: { name: true } } },
    }),
  ]);
  const inviteLinkIds = new Set(campaign.inviteLinks.map((l) => l.id));
  const trackingLinkIds = new Set(campaign.trackingLinks.map((l) => l.id));
  for (const s of campaign.adSets) for (const a of s.ads) {
    if (a.inviteLink) inviteLinkIds.add(a.inviteLink.id);
    if (a.trackingLinkId) trackingLinkIds.add(a.trackingLinkId);
  }
  const metrics = computeMetrics(await campaignTotals(id, [...inviteLinkIds], [...trackingLinkIds], since));
  const channelIds = Array.isArray(campaign.channelIds) ? (campaign.channelIds as string[]) : [];
  const selectCls = "h-9 rounded-md border bg-background px-3 text-sm";
  const today = new Date().toISOString().slice(0, 10);
  const tiles = [
    ["Dépense", fmtEur(metrics.spend)],
    ["Clics d'entrée", fmtNum(metrics.entryClicks ?? 0)],
    ["Membres", fmtNum(metrics.members)],
    ["Inscrits", fmtNum(metrics.registrations)],
    ["FTD", fmtNum(metrics.ftds)],
    ["CPL", fmtEur(metrics.cpl)],
    ["CPA", fmtEur(metrics.cpa)],
    ["Coût / FTD", fmtEur(metrics.costPerFtd)],
    ["Revenu", fmtEur(metrics.revenue)],
    ["ROAS", fmtRatio(metrics.roas)],
  ] as const;

  return (
    <>
      <PageHeader title={campaign.name} description={`${campaign.adPlatform ? PLATFORM_LABELS[campaign.adPlatform] : "Plateforme non précisée"} · ${STATUS_LABELS[campaign.status]} · période : ${range} jours`}>
        <Button variant="outline" render={<Link href="/campaigns" />}>← Toutes les pubs</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value]) => (
          <Card key={label}><CardContent className="pt-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold tabular-nums">{value}</div></CardContent></Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Groupes et pubs</CardTitle><CardDescription>Chaque pub précise se rattache à un lien d&apos;entrée (créé dans Liens). Les clics, membres et inscriptions sont comptés à partir de ce lien.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {campaign.adSets.length === 0 ? <p className="text-sm text-muted-foreground">Aucun groupe pour l&apos;instant.</p> : null}
          {campaign.adSets.map((s) => (
            <div key={s.id} className="rounded-md border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm font-medium">Groupe « {s.name} »</div>
              <Table>
                <TableHeader><TableRow><TableHead>Pub</TableHead><TableHead>Lien d&apos;entrée</TableHead><TableHead className="text-right">Clics</TableHead><TableHead className="text-right">Demandes</TableHead><TableHead className="text-right">Acceptés</TableHead><TableHead>Rattacher</TableHead></TableRow></TableHeader>
                <TableBody>
                  {s.ads.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{a.inviteLink ? <span>{a.inviteLink.name} <span className="text-xs text-muted-foreground">({a.inviteLink.channel.title}{a.trackingLink ? ` · /${a.trackingLink.slug}` : ""})</span></span> : <Badge variant="secondary">aucun</Badge>}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.trackingLink?.clicks ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.inviteLink?.requests ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.inviteLink?.approved ?? 0}</TableCell>
                      <TableCell>
                        <form action={attachLinkAction} className="flex items-center gap-2">
                          <input type="hidden" name="campaignId" value={id} />
                          <input type="hidden" name="adId" value={a.id} />
                          <select name="inviteLinkId" defaultValue={a.inviteLink?.id ?? ""} className={`${selectCls} max-w-56`}>
                            <option value="">— détacher —</option>
                            {a.inviteLink ? <option value={a.inviteLink.id}>{a.inviteLink.name}</option> : null}
                            {unattached.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.channel.title})</option>)}
                          </select>
                          <Button type="submit" size="sm" variant="outline">OK</Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={6}>
                      <form action={addAdAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="campaignId" value={id} />
                        <input type="hidden" name="adSetId" value={s.id} />
                        <Input name="name" placeholder="Nom de la pub (ex. video-3)" required className="max-w-56" />
                        <select name="inviteLinkId" defaultValue="" className={`${selectCls} max-w-56`}>
                          <option value="">Lien d&apos;entrée (optionnel)</option>
                          {unattached.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.channel.title})</option>)}
                        </select>
                        <Button type="submit" size="sm" variant="outline">Ajouter une pub</Button>
                      </form>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ))}
          <form action={addAdSetAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="campaignId" value={id} />
            <Input name="name" placeholder="Nom du groupe (ex. FR-18-34)" required className="max-w-64" />
            <Button type="submit" size="sm">Ajouter un groupe</Button>
          </form>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Coûts par jour</CardTitle><CardDescription>Sur la période. Source CSV (import) ou manuelle.</CardDescription></CardHeader>
          <CardContent>
            {costs.length === 0 ? <p className="text-sm text-muted-foreground">Aucun coût enregistré sur la période. <Link href="/campaigns/import" className="underline">Importer un CSV</Link> ou saisir une dépense ci-contre.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Jour</TableHead><TableHead>Niveau</TableHead><TableHead className="text-right">Dépense</TableHead><TableHead className="text-right">Impr.</TableHead><TableHead className="text-right">Clics</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
                <TableBody>
                  {costs.slice(0, 120).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{dayFmt.format(c.date)}</TableCell>
                      <TableCell className="text-xs">{c.ad ? `pub ${c.ad.name}` : c.adSet ? `groupe ${c.adSet.name}` : "campagne"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtEur(Number(c.spend))}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(c.impressions)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(c.clicks)}</TableCell>
                      <TableCell><Badge variant="outline">{c.source === "CSV" ? "CSV" : c.source === "API" ? "API" : "manuel"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Saisir une dépense</CardTitle><CardDescription>Pour un jour et un niveau. Une saisie du même jour remplace la précédente.</CardDescription></CardHeader>
          <CardContent>
            <form action={addManualCostAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="campaignId" value={id} />
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="level">Niveau</Label>
                <select id="level" name="level" className={`${selectCls} w-full`} defaultValue={`campaign:${id}`}>
                  <option value={`campaign:${id}`}>Toute la pub</option>
                  {campaign.adSets.map((s) => [
                    <option key={s.id} value={`adset:${s.id}`}>Groupe {s.name}</option>,
                    ...s.ads.map((a) => <option key={a.id} value={`ad:${a.id}`}>— Pub {a.name}</option>),
                  ])}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="date">Jour</Label><Input id="date" name="date" type="date" required defaultValue={today} /></div>
              <div className="space-y-1"><Label htmlFor="spend">Dépense (€)</Label><Input id="spend" name="spend" inputMode="decimal" required placeholder="ex. 42,50" /></div>
              <div className="space-y-1"><Label htmlFor="impressions">Impressions</Label><Input id="impressions" name="impressions" inputMode="numeric" defaultValue="0" /></div>
              <div className="space-y-1"><Label htmlFor="clicks">Clics (plateforme)</Label><Input id="clicks" name="clicks" inputMode="numeric" defaultValue="0" /></div>
              <div className="sm:col-span-2"><Button type="submit">Enregistrer la dépense</Button></div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 max-w-3xl">
        <CardHeader><CardTitle className="text-base">Modifier la pub</CardTitle></CardHeader>
        <CardContent>
          <CampaignForm action={updateCampaignAction} values={{ id, name: campaign.name, adPlatform: campaign.adPlatform, vertical: campaign.vertical, status: campaign.status, budgetDaily: campaign.budgetDaily === null ? null : Number(campaign.budgetDaily), notes: campaign.notes, channelIds }} channels={channels} submitLabel="Enregistrer" />
        </CardContent>
      </Card>
    </>
  );
}
