import { Download, Info, Plus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { SidePanel } from "@/components/admin/side-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { isImportedShell, readAdLink } from "@/lib/campaigns/ad-link";
import { adCampaignLine, costLevelLabel, groupCostsByDay } from "@/lib/campaigns/display";
import { listImportedShells, unattachedEntryLinks } from "@/lib/campaigns/queries";
import { fmtMoney, fmtNum } from "@/lib/format";
import { periodDates, periodParams } from "@/lib/periods";
import { parisDayKey } from "@/lib/posts/time";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import {
  addAdAction,
  addAdSetAction,
  addManualCostAction,
  attachImportedCampaignAction,
  attachLinkAction,
  deleteAdAction,
  deleteAdSetAction,
} from "../../actions";
import type { TabProps } from "./shared";

const dayFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "UTC" });

/** Une ligne « libellé : valeur » d'un volet de détail. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/**
 * Onglet Pubs : la campagne pub (structure TikTok / Meta : groupes → pubs → lien d'entrée) et ses dépenses.
 * Formulaires rares dans des volets (ajouter un groupe, une pub, saisir une dépense) ou repliés (rattacher une
 * campagne pub importée) ; le détail d'une pub (lien d'entrée, suppression) s'ouvre au clic sur sa ligne.
 * Suppressions réservées aux ADMIN, avec confirmation.
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
  const exportHref = `/campaigns/export?${new URLSearchParams({ kind: "costs", campaignId: id, ...periodParams(period, compare) }).toString()}`;
  const days = groupCostsByDay(
    costs.map((c) => ({
      id: c.id,
      date: c.date,
      spend: Number(c.spend),
      impressions: c.impressions,
      clicks: c.clicks,
      source: c.source,
      ad: c.ad,
      adSet: c.adSet,
    })),
  );
  const shownDays = days.slice(0, 120);
  const spendTotal = days.reduce((sum, d) => sum + d.spend, 0);

  const addAdSetPanel = (
    <SidePanel
      title="Ajouter un groupe"
      description="Un groupe rassemble des pubs (ex. par pays ou par âge)."
      trigger={
        <Button variant="outline" className="max-md:h-10">
          <Plus aria-hidden />
          Ajouter un groupe
        </Button>
      }
    >
      <form action={addAdSetAction} className="space-y-5">
        <input type="hidden" name="campaignId" value={id} />
        <div className="space-y-2">
          <Label htmlFor="new-adset">Nom du groupe</Label>
          <Input id="new-adset" name="name" placeholder="ex. FR 18-34" required />
        </div>
        <Button type="submit" className="max-md:h-10">
          Ajouter le groupe
        </Button>
      </form>
    </SidePanel>
  );

  const linkOptions = (current: { id: string; name: string } | null) => (
    <>
      <option value="">Aucun (détacher)</option>
      {current ? <option value={current.id}>{current.name}</option> : null}
      {unattached.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name} ({l.channel.title})
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-8">
      <p className="text-body text-muted-foreground">
        {adCampaignLine({
          platform: campaign.adPlatform,
          externalCampaignId: campaign.externalCampaignId,
          platformName: adLink?.platformName ?? null,
          imported: shell,
          connectionName: campaign.connection?.name ?? null,
        })}
      </p>

      {shell ? (
        <Alert variant="info" role="status">
          <Info aria-hidden />
          <AlertTitle>Campagne pub importée d&apos;un compte connecté</AlertTitle>
          <AlertDescription>
            Pour lui donner des offres, des canaux et des liens, ouvrez une de vos campagnes, onglet
            Pubs, puis « Rattacher une campagne pub importée » : ses groupes, pubs et dépenses y
            seront déplacés.
          </AlertDescription>
        </Alert>
      ) : null}

      {importable.length ? (
        <AdvancedSection
          title="Rattacher une campagne pub importée"
          description={`${importable.length} campagne${importable.length > 1 ? "s" : ""} pub reçue${importable.length > 1 ? "s" : ""} de Meta ou TikTok attend${importable.length > 1 ? "ent" : ""} d'être rattachée${importable.length > 1 ? "s" : ""}.`}
        >
          <p className="text-body text-muted-foreground">
            Rattachée, sa structure (groupes, pubs) et ses dépenses rejoignent cette campagne, et
            les prochaines dépenses arrivent ici toutes seules.
          </p>
          <form
            action={attachImportedCampaignAction}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="campaignId" value={id} />
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="imported-campaign">Campagne pub importée</Label>
              <NativeSelect
                id="imported-campaign"
                name="importedCampaignId"
                defaultValue=""
                required
                wrapperClassName="w-full"
              >
                <option value="">Choisir une campagne pub</option>
                {importable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.adPlatform ? statusLabel("adPlatform", c.adPlatform) : "?"}
                    {c.connectionName ? ` · ${c.connectionName}` : ""})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <ConfirmSubmit
              variant="outline"
              className="max-md:h-10"
              destructive={false}
              confirmTitle="Rattacher cette campagne pub ?"
              confirmLabel="Rattacher"
              message="Ses groupes, pubs et dépenses seront déplacés dans cette campagne, et la campagne pub importée disparaîtra de la liste des campagnes."
            >
              Rattacher
            </ConfirmSubmit>
          </form>
        </AdvancedSection>
      ) : null}

      <FormSection
        title="Groupes et pubs"
        description="La campagne pub se découpe en groupes, puis en pubs ; chaque pub a son lien d'entrée. Clics et membres comptés depuis la création du lien (pas seulement sur la période)."
        actions={adSets.length ? addAdSetPanel : null}
      >
        {adSets.length === 0 ? (
          <EmptyState
            title="Aucun groupe pour l'instant"
            description="Ajoutez un groupe, ou créez directement un lien d'entrée dans l'onglet Liens : « Groupe 1 » est créé tout seul."
          >
            {addAdSetPanel}
          </EmptyState>
        ) : (
          adSets.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <h3 className="text-body font-semibold text-foreground">
                  Groupe « {s.name} »{" "}
                  <span className="font-normal text-muted-foreground">
                    · {s.ads.length} pub{s.ads.length > 1 ? "s" : ""}
                  </span>
                </h3>
                <div className="flex flex-wrap items-center gap-1">
                  <SidePanel
                    title="Ajouter une pub"
                    description={`Dans le groupe « ${s.name} ».`}
                    trigger={
                      <Button variant="ghost" size="sm" className="max-md:h-10">
                        <Plus aria-hidden />
                        Ajouter une pub
                      </Button>
                    }
                  >
                    <form action={addAdAction} className="space-y-5">
                      <input type="hidden" name="campaignId" value={id} />
                      <input type="hidden" name="adSetId" value={s.id} />
                      <div className="space-y-2">
                        <Label htmlFor={`new-ad-${s.id}`}>Nom de la pub</Label>
                        <Input
                          id={`new-ad-${s.id}`}
                          name="name"
                          placeholder="ex. video-3"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`new-ad-link-${s.id}`}>
                          Lien d&apos;entrée (facultatif)
                        </Label>
                        <NativeSelect
                          id={`new-ad-link-${s.id}`}
                          name="inviteLinkId"
                          defaultValue=""
                          wrapperClassName="w-full"
                        >
                          <option value="">Aucun pour l&apos;instant</option>
                          {unattached.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name} ({l.channel.title})
                            </option>
                          ))}
                        </NativeSelect>
                        <p className="text-note text-muted-foreground">
                          Pour créer la pub et son lien d&apos;un coup, passez par l&apos;onglet
                          Liens.
                        </p>
                      </div>
                      <Button type="submit" className="max-md:h-10">
                        Ajouter la pub
                      </Button>
                    </form>
                  </SidePanel>
                  {isAdmin ? (
                    <form action={deleteAdSetAction}>
                      <input type="hidden" name="campaignId" value={id} />
                      <input type="hidden" name="adSetId" value={s.id} />
                      <ConfirmSubmit
                        size="sm"
                        variant="ghost"
                        className="text-danger max-md:h-10"
                        aria-label={`Supprimer le groupe ${s.name}`}
                        confirmTitle="Supprimer ce groupe ?"
                        confirmLabel="Supprimer"
                        message={`Le groupe « ${s.name} », ses ${s.ads.length} pub${s.ads.length > 1 ? "s" : ""} et leurs dépenses seront supprimés. Les liens d'entrée restent dans la campagne.`}
                      >
                        Supprimer
                      </ConfirmSubmit>
                    </form>
                  ) : null}
                </div>
              </div>
              {s.ads.length === 0 ? (
                <p className="px-4 py-3 text-body text-muted-foreground">
                  Aucune pub dans ce groupe.
                </p>
              ) : (
                <DataTable
                  // Largeurs fixes, identiques dans chaque groupe : les colonnes des tableaux empilés restent
                  // alignées d'un groupe à l'autre. Téléphone : 3 colonnes (pub, clics, acceptés), en-têtes sur deux
                  // lignes, pour que « Acceptés (total) » et ses chiffres restent dans l'écran.
                  className="px-2 pb-1 [&_table]:table-fixed"
                  label={`Pubs du groupe ${s.name}`}
                  columns={[
                    {
                      key: "name",
                      header: "Pub",
                      className: "whitespace-normal break-words max-md:w-[38%] md:w-[26%]",
                    },
                    {
                      key: "link",
                      header: "Lien d'entrée",
                      hideOnMobile: true,
                      className: "whitespace-normal md:w-[29%]",
                    },
                    {
                      key: "clicks",
                      header: "Clics (total)",
                      align: "right",
                      className: "max-md:w-[28%] max-md:whitespace-normal md:w-[15%]",
                    },
                    {
                      key: "requests",
                      header: "Demandes (total)",
                      align: "right",
                      hideOnMobile: true,
                      className: "md:w-[15%]",
                    },
                    {
                      key: "approved",
                      header: "Acceptés (total)",
                      align: "right",
                      className: "max-md:w-[34%] max-md:whitespace-normal md:w-[15%]",
                    },
                  ]}
                  rows={s.ads.map((a) => ({
                    id: a.id,
                    cells: {
                      name: a.name,
                      link: a.inviteLink ? (
                        <span className="flex flex-col">
                          <span>{a.inviteLink.name}</span>
                          <span className="text-note text-muted-foreground">
                            {a.inviteLink.channel.title}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Aucun</span>
                      ),
                      clicks: fmtNum(a.trackingLink?.clicks ?? 0),
                      requests: fmtNum(a.inviteLink?.requests ?? 0),
                      approved: fmtNum(a.inviteLink?.approved ?? 0),
                    },
                    sortValues: { link: a.inviteLink?.name ?? "" },
                    detailDescription: `Groupe « ${s.name} »`,
                    detail: (
                      <div className="space-y-6">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                          <Row label="Lien d'entrée">{a.inviteLink?.name ?? "Aucun"}</Row>
                          {a.inviteLink ? (
                            <Row label="Canal">{a.inviteLink.channel.title}</Row>
                          ) : null}
                          {a.trackingLink ? (
                            <Row label="Adresse">
                              <span className="font-mono text-note">/{a.trackingLink.slug}</span>
                            </Row>
                          ) : null}
                          <Row label="Clics (total)">{fmtNum(a.trackingLink?.clicks ?? 0)}</Row>
                          <Row label="Demandes (total)">{fmtNum(a.inviteLink?.requests ?? 0)}</Row>
                          <Row label="Acceptés (total)">{fmtNum(a.inviteLink?.approved ?? 0)}</Row>
                        </dl>
                        <p className="text-note text-muted-foreground">
                          Chiffres depuis la création du lien, quelle que soit la période choisie.
                        </p>
                        <form action={attachLinkAction} className="space-y-3">
                          <input type="hidden" name="campaignId" value={id} />
                          <input type="hidden" name="adId" value={a.id} />
                          <div className="space-y-2">
                            <Label htmlFor={`link-${a.id}`}>Lien d&apos;entrée de cette pub</Label>
                            <NativeSelect
                              id={`link-${a.id}`}
                              name="inviteLinkId"
                              defaultValue={a.inviteLink?.id ?? ""}
                              wrapperClassName="w-full"
                            >
                              {linkOptions(a.inviteLink)}
                            </NativeSelect>
                            <p className="text-note text-muted-foreground">
                              Ses clics, membres et inscriptions sont comptés à partir de ce lien.
                            </p>
                          </div>
                          <Button type="submit" variant="outline" className="max-md:h-10">
                            Enregistrer le lien
                          </Button>
                        </form>
                        {isAdmin ? (
                          <form action={deleteAdAction} className="border-t border-border pt-4">
                            <input type="hidden" name="campaignId" value={id} />
                            <input type="hidden" name="adId" value={a.id} />
                            <ConfirmSubmit
                              variant="destructive"
                              className="max-md:h-10"
                              confirmTitle="Supprimer cette pub ?"
                              confirmLabel="Supprimer"
                              message={`La pub « ${a.name} » et ses dépenses seront supprimées. Son lien d'entrée reste dans la campagne (onglet Liens).`}
                            >
                              Supprimer la pub
                            </ConfirmSubmit>
                          </form>
                        ) : null}
                      </div>
                    ),
                  }))}
                />
              )}
            </div>
          ))
        )}
      </FormSection>

      <FormSection
        title="Dépenses par jour"
        description={
          costs.length
            ? `${fmtMoney(spendTotal)} sur la période : reçues du compte connecté, importées (CSV) ou saisies.`
            : "Reçues du compte connecté, importées (CSV) ou saisies à la main."
        }
        actions={
          <>
            {costs.length ? (
              <a
                href={exportHref}
                className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
              >
                <Download aria-hidden />
                Exporter (CSV)
              </a>
            ) : null}
            <SidePanel
              title="Saisir une dépense"
              description="Pour un jour : une nouvelle saisie du même jour remplace la précédente."
              trigger={
                <Button variant="outline" className="max-md:h-10">
                  <Plus aria-hidden />
                  Saisir une dépense
                </Button>
              }
            >
              <form action={addManualCostAction} className="space-y-5">
                <input type="hidden" name="campaignId" value={id} />
                <div className="space-y-2">
                  <Label htmlFor="level">Pour</Label>
                  <NativeSelect
                    id="level"
                    name="level"
                    defaultValue={`campaign:${id}`}
                    wrapperClassName="w-full"
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
                  </NativeSelect>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="date">Jour</Label>
                    <Input id="date" name="date" type="date" required defaultValue={today} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="spend">Dépense (€)</Label>
                    <Input
                      id="spend"
                      name="spend"
                      inputMode="decimal"
                      required
                      placeholder="ex. 42,50"
                    />
                  </div>
                </div>
                <AdvancedSection
                  title="Impressions et clics"
                  description="Facultatif : chiffres affichés par la plateforme."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="impressions">Impressions</Label>
                      <Input
                        id="impressions"
                        name="impressions"
                        inputMode="numeric"
                        defaultValue="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="clicks">Clics sur la plateforme</Label>
                      <Input id="clicks" name="clicks" inputMode="numeric" defaultValue="0" />
                    </div>
                  </div>
                </AdvancedSection>
                <Button type="submit" className="max-md:h-10">
                  Enregistrer la dépense
                </Button>
              </form>
            </SidePanel>
          </>
        }
      >
        {costs.length === 0 ? (
          <EmptyState
            title="Aucune dépense sur la période"
            description="Elles arrivent toutes seules d'un compte connecté, ou importez le rapport CSV de TikTok ou Meta."
            action={{
              href: "/campaigns/import",
              label: "Importer des dépenses",
              variant: "outline",
            }}
          />
        ) : (
          <>
            <DataTable
              label="Dépenses par jour"
              columns={[
                { key: "day", header: "Jour" },
                { key: "spend", header: "Dépense", align: "right" },
                { key: "lines", header: "Détail", hideOnMobile: true },
                { key: "source", header: "Source" },
              ]}
              rows={shownDays.map((d) => ({
                id: d.day,
                cells: {
                  day: dayFmt.format(d.date),
                  spend: fmtMoney(d.spend),
                  lines:
                    d.lines.length > 1 ? `${d.lines.length} lignes` : costLevelLabel(d.lines[0]!),
                  source: (
                    <span className="flex flex-wrap gap-1">
                      {d.sources.map((src) => (
                        <StatusBadge key={src} kind="costSource" value={src} />
                      ))}
                    </span>
                  ),
                },
                sortValues: {
                  day: d.date,
                  lines: d.lines.length,
                  source: d.sources.map((src) => statusLabel("costSource", src)).join(", "),
                },
                detailTitle: `Dépense du ${dayFmt.format(d.date)}`,
                detailDescription: `${fmtMoney(d.spend)} · ${fmtNum(d.impressions)} impressions · ${fmtNum(d.clicks)} clics sur la plateforme`,
                detail: (
                  <ul className="divide-y divide-border">
                    {d.lines.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-4 py-3">
                        <span className="min-w-0">
                          <span className="block font-medium">{costLevelLabel(c)}</span>
                          <span className="block text-note text-muted-foreground">
                            {fmtNum(c.impressions)} impressions · {fmtNum(c.clicks)} clics ·{" "}
                            {statusLabel("costSource", c.source)}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">{fmtMoney(c.spend)}</span>
                      </li>
                    ))}
                  </ul>
                ),
              }))}
            />
            {days.length > shownDays.length ? (
              <p className="text-note text-muted-foreground">
                {shownDays.length} jours affichés sur {days.length} :{" "}
                <a href={exportHref} className="font-medium text-brand-ink underline">
                  exportez le CSV
                </a>{" "}
                pour tout voir.
              </p>
            ) : null}
          </>
        )}
      </FormSection>
    </div>
  );
}
