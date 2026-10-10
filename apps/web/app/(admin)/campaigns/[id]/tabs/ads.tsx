import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PeriodSelect } from "@/components/admin/period-select";
import { Badge } from "@/components/ui/badge";
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
import { fmtMoney, fmtNum } from "@/lib/format";
import { isImportedShell, readAdLink } from "@/lib/campaigns/ad-link";
import { listImportedShells, unattachedEntryLinks } from "@/lib/campaigns/queries";
import { periodDates } from "@/lib/periods";
import { parisDayKey } from "@/lib/posts/time";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { StatusBadge } from "@/lib/status-badges";
import { PLATFORM_LABELS } from "../../campaign-form";
import {
  addAdAction,
  addAdSetAction,
  addManualCostAction,
  attachImportedCampaignAction,
  attachLinkAction,
  deleteAdAction,
  deleteAdSetAction,
} from "../../actions";
import { selectCls, type TabProps } from "./shared";

const dayFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "UTC" });

/**
 * Onglet Pubs : la campagne pub (structure TikTok / Meta : groupes → pubs précises → lien d'entrée) et ses coûts ;
 * « Rattacher une campagne pub importée » (compte connecté) ; suppression d'une pub ou d'un groupe (ADMIN).
 */
export async function AdsTab({ id, campaign, period, compare, isAdmin }: TabProps) {
  const { dateFrom, dateTo } = periodDates(period);
  const shell = isImportedShell(campaign);
  const adLink = readAdLink(campaign.adExternalIds);
  const [adSets, unattached, costs, importable] = await Promise.all([
    prisma.adSet.findMany({
      where: { campaignId: id },
      orderBy: { name: "asc" },
      include: {
        ads: {
          orderBy: { name: "asc" },
          include: {
            inviteLink: {
              select: {
                id: true,
                name: true,
                requests: true,
                approved: true,
                joined: true,
                channel: { select: { title: true } },
              },
            },
            trackingLink: { select: { slug: true, clicks: true } },
          },
        },
      },
    }),
    unattachedEntryLinks(),
    prisma.adCost.findMany({
      where: {
        date: { gte: dateFrom, lte: dateTo },
        OR: [
          { campaignId: id },
          { adSet: { campaignId: id } },
          { ad: { adSet: { campaignId: id } } },
        ],
      },
      orderBy: [{ date: "desc" }],
      include: { ad: { select: { name: true } }, adSet: { select: { name: true } } },
    }),
    // Une campagne pub importée elle-même, ou une campagne qui suit déjà une campagne pub, ne rattache rien.
    shell || campaign.externalCampaignId
      ? Promise.resolve([])
      : listImportedShells({ exceptId: id }),
  ]);
  // Jour proposé pour une saisie de dépense : aujourd'hui à l'heure de Paris (pas en UTC : entre 0 h et 2 h, la veille).
  const today = parisDayKey(new Date());
  const platform = campaign.adPlatform ? PLATFORM_LABELS[campaign.adPlatform] : null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <PeriodSelect
          period={period}
          compare={compare}
          action={`/campaigns/${id}`}
          extra={{ tab: "ads" }}
        />
        <span className="text-muted-foreground">
          Campagne pub : {platform ?? "plateforme non précisée"}
          {campaign.externalCampaignId
            ? shell
              ? ` · importée (identifiant ${campaign.externalCampaignId})`
              : ` · « ${adLink?.platformName ?? campaign.externalCampaignId} » (identifiant ${campaign.externalCampaignId})`
            : ""}
          {campaign.connection ? ` · compte connecté « ${campaign.connection.name} »` : ""}
        </span>
      </div>
      {shell ? (
        <p className="mb-4 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Cette campagne pub a été importée d&apos;un compte connecté. Pour lui donner des offres,
          des canaux et des liens, ouvrez une de vos campagnes, onglet Pubs, et utilisez « Rattacher
          une campagne pub importée » : tout ce qu&apos;elle contient (groupes, pubs, dépenses) y
          sera déplacé.
        </p>
      ) : null}
      {importable.length ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Rattacher une campagne pub importée</CardTitle>
            <CardDescription>
              Campagnes pub reçues d&apos;un compte Meta ou TikTok connecté, pas encore rattachées.
              Rattachée, sa structure (groupes, pubs) et ses dépenses rejoignent cette campagne, et
              les prochaines dépenses arrivent ici toutes seules.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={attachImportedCampaignAction}
              className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
            >
              <input type="hidden" name="campaignId" value={id} />
              <Label htmlFor="imported-campaign" className="sr-only">
                Campagne pub importée
              </Label>
              <select
                id="imported-campaign"
                name="importedCampaignId"
                defaultValue=""
                required
                className={`${selectCls} sm:max-w-md`}
              >
                <option value="">— choisir une campagne pub importée —</option>
                {importable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.adPlatform ? (PLATFORM_LABELS[c.adPlatform] ?? c.adPlatform) : "?"}
                    {c.connectionName ? ` · ${c.connectionName}` : ""})
                  </option>
                ))}
              </select>
              <ConfirmSubmit
                size="sm"
                className="max-md:h-10"
                message="Rattacher cette campagne pub ? Ses groupes, pubs et dépenses seront déplacés dans cette campagne, et la campagne pub importée disparaîtra de la liste des campagnes."
              >
                Rattacher
              </ConfirmSubmit>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Groupes et pubs précises</CardTitle>
          <CardDescription>
            La campagne pub se découpe en groupes (ex. par pays ou par âge), eux-mêmes en pubs
            précises (ex. vidéo 1, vidéo 2). Chaque pub précise se rattache à un lien d&apos;entrée
            : ses clics, membres et inscriptions sont comptés à partir de ce lien. L&apos;onglet
            Liens crée une pub précise et son lien en un clic.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {adSets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun groupe pour l&apos;instant : ajoutez-en un ci-dessous, ou passez par
              l&apos;onglet Liens (le groupe « Groupe 1 » sera créé tout seul).
            </p>
          ) : null}
          {adSets.map((s) => (
            <div key={s.id} className="rounded-md border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                <span>Groupe « {s.name} »</span>
                {isAdmin ? (
                  <form action={deleteAdSetAction}>
                    <input type="hidden" name="campaignId" value={id} />
                    <input type="hidden" name="adSetId" value={s.id} />
                    <ConfirmSubmit
                      size="sm"
                      variant="ghost"
                      className="text-destructive max-md:h-10"
                      aria-label={`Supprimer le groupe ${s.name}`}
                      message={`Supprimer le groupe « ${s.name} », ses ${s.ads.length} pub${s.ads.length > 1 ? "s" : ""} précise${s.ads.length > 1 ? "s" : ""} et leurs coûts ? Les liens d'entrée restent dans la campagne.`}
                    >
                      Supprimer
                    </ConfirmSubmit>
                  </form>
                ) : null}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pub précise</TableHead>
                    <TableHead>Lien d&apos;entrée</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Clics</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Demandes</TableHead>
                    <TableHead className="text-right">Acceptés</TableHead>
                    <TableHead>Rattacher</TableHead>
                    {isAdmin ? <TableHead className="sr-only">Supprimer</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.ads.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>
                        {a.inviteLink ? (
                          <span>
                            {a.inviteLink.name}{" "}
                            <span className="text-xs text-muted-foreground">
                              ({a.inviteLink.channel.title}
                              {a.trackingLink ? ` · /${a.trackingLink.slug}` : ""})
                            </span>
                          </span>
                        ) : (
                          <Badge variant="secondary">aucun</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {a.trackingLink?.clicks ?? 0}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {a.inviteLink?.requests ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.inviteLink?.approved ?? 0}
                      </TableCell>
                      <TableCell>
                        <form action={attachLinkAction} className="flex items-center gap-2">
                          <input type="hidden" name="campaignId" value={id} />
                          <input type="hidden" name="adId" value={a.id} />
                          <Label htmlFor={`link-${a.id}`} className="sr-only">
                            Lien d&apos;entrée de la pub {a.name}
                          </Label>
                          <select
                            id={`link-${a.id}`}
                            name="inviteLinkId"
                            defaultValue={a.inviteLink?.id ?? ""}
                            className={`${selectCls} max-w-56`}
                          >
                            <option value="">— détacher —</option>
                            {a.inviteLink ? (
                              <option value={a.inviteLink.id}>{a.inviteLink.name}</option>
                            ) : null}
                            {unattached.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name} ({l.channel.title})
                              </option>
                            ))}
                          </select>
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="max-md:h-10"
                            aria-label={`Enregistrer le lien de la pub ${a.name}`}
                          >
                            OK
                          </Button>
                        </form>
                      </TableCell>
                      {isAdmin ? (
                        <TableCell className="text-right">
                          <form action={deleteAdAction}>
                            <input type="hidden" name="campaignId" value={id} />
                            <input type="hidden" name="adId" value={a.id} />
                            <ConfirmSubmit
                              size="sm"
                              variant="ghost"
                              className="text-destructive max-md:h-10"
                              aria-label={`Supprimer la pub ${a.name}`}
                              message={`Supprimer la pub précise « ${a.name} » et ses coûts ? Son lien d'entrée reste dans la campagne (onglet Liens).`}
                            >
                              Supprimer
                            </ConfirmSubmit>
                          </form>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 7 : 6}>
                      <form
                        action={addAdAction}
                        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
                      >
                        <input type="hidden" name="campaignId" value={id} />
                        <input type="hidden" name="adSetId" value={s.id} />
                        <Label htmlFor={`new-ad-${s.id}`} className="sr-only">
                          Nom de la nouvelle pub précise
                        </Label>
                        <Input
                          id={`new-ad-${s.id}`}
                          name="name"
                          placeholder="Nom de la pub précise (ex. video-3)"
                          required
                          className="h-10 sm:max-w-56 md:h-9"
                        />
                        <Label htmlFor={`new-ad-link-${s.id}`} className="sr-only">
                          Lien d&apos;entrée (facultatif)
                        </Label>
                        <select
                          id={`new-ad-link-${s.id}`}
                          name="inviteLinkId"
                          defaultValue=""
                          className={`${selectCls} sm:max-w-56`}
                        >
                          <option value="">Lien d&apos;entrée (facultatif)</option>
                          {unattached.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name} ({l.channel.title})
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                          Ajouter une pub précise
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ))}
          <form
            action={addAdSetAction}
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <input type="hidden" name="campaignId" value={id} />
            <Label htmlFor="new-adset" className="sr-only">
              Nom du nouveau groupe
            </Label>
            <Input
              id="new-adset"
              name="name"
              placeholder="Nom du groupe (ex. FR 18-34)"
              required
              className="h-10 sm:max-w-64 md:h-9"
            />
            <Button type="submit" size="sm" className="max-md:h-10">
              Ajouter un groupe
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coûts par jour</CardTitle>
            <CardDescription>
              Sur la période. Source : compte connecté (API), import CSV ou saisie à la main.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {costs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun coût enregistré sur la période.{" "}
                <Link href="/campaigns/import" className="underline">
                  Importer un CSV
                </Link>{" "}
                ou saisir une dépense ci-contre.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jour</TableHead>
                    <TableHead className="hidden md:table-cell">Niveau</TableHead>
                    <TableHead className="text-right">Dépense</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Impressions</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Clics</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costs.slice(0, 120).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{dayFmt.format(c.date)}</TableCell>
                      <TableCell className="hidden text-xs md:table-cell">
                        {c.ad
                          ? `pub ${c.ad.name}`
                          : c.adSet
                            ? `groupe ${c.adSet.name}`
                            : "toute la campagne pub"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMoney(Number(c.spend))}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(c.impressions)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(c.clicks)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="costSource" value={c.source} />
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
            <CardTitle className="text-base">Saisir une dépense</CardTitle>
            <CardDescription>
              Pour un jour et un niveau. Une nouvelle saisie du même jour remplace la précédente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={addManualCostAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="campaignId" value={id} />
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="level">Niveau</Label>
                <select
                  id="level"
                  name="level"
                  className={`${selectCls} w-full`}
                  defaultValue={`campaign:${id}`}
                >
                  <option value={`campaign:${id}`}>Toute la campagne pub</option>
                  {adSets.map((s) => [
                    <option key={s.id} value={`adset:${s.id}`}>
                      Groupe {s.name}
                    </option>,
                    ...s.ads.map((a) => (
                      <option key={a.id} value={`ad:${a.id}`}>
                        — Pub {a.name}
                      </option>
                    )),
                  ])}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="date">Jour</Label>
                <Input
                  id="date"
                  name="date"
                  type="date"
                  required
                  defaultValue={today}
                  className="h-10 md:h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spend">Dépense (€)</Label>
                <Input
                  id="spend"
                  name="spend"
                  inputMode="decimal"
                  required
                  placeholder="ex. 42,50"
                  className="h-10 md:h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="impressions">Impressions (facultatif)</Label>
                <Input
                  id="impressions"
                  name="impressions"
                  inputMode="numeric"
                  defaultValue="0"
                  className="h-10 md:h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="clicks">Clics plateforme (facultatif)</Label>
                <Input
                  id="clicks"
                  name="clicks"
                  inputMode="numeric"
                  defaultValue="0"
                  className="h-10 md:h-9"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" className="max-md:h-10">
                  Enregistrer la dépense
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
