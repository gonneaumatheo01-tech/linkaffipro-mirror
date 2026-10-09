import type { Metadata } from "next";
import { AD_PLATFORM_LABELS, buildAdUrl, VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
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
import { Textarea } from "@/components/ui/textarea";
import { env } from "@/lib/env";
import { fmtDate, fmtNum } from "@/lib/format";
import { listLinksPage } from "@/lib/links/queries";
import { requireUser } from "@/lib/session";
import { ActiveBadge, statusLabel } from "@/lib/status-badges";
import { createEntryLinksAction, createGenericLinkAction, toggleLinkAction } from "./actions";

export const metadata: Metadata = { title: "Liens" };

/** Paramètres d'URL de pagination, un par tableau (entrées, offres, boutons). */
const PAGE_KEYS = { entries: "pe", offers: "po", buttons: "pb" } as const;

/** Bouton « Désactiver / Réactiver » d'un lien, avec confirmation à la désactivation. */
function ToggleLink({
  id,
  label,
  isActive,
  what,
}: {
  id: string;
  label: string;
  isActive: boolean;
  what: string;
}) {
  return (
    <form action={toggleLinkAction}>
      <input type="hidden" name="linkId" value={id} />
      {isActive ? (
        <ConfirmSubmit
          size="sm"
          variant="ghost"
          className="max-md:h-10"
          message={`Désactiver le lien « ${label} » ? ${what} Vous pourrez le réactiver ici.`}
        >
          Désactiver
        </ConfirmSubmit>
      ) : (
        <Button type="submit" size="sm" variant="ghost" className="max-md:h-10">
          Réactiver
        </Button>
      )}
    </form>
  );
}

export default async function LinksPage({ searchParams }: PageProps<"/links">) {
  await requireUser();
  const sp = await searchParams;
  const highlight = new Set(typeof sp.highlight === "string" ? sp.highlight.split(",") : []);
  const [entries, offers, buttons, channels] = await Promise.all([
    listLinksPage(["AD_ENTRY"], pageOf(sp, PAGE_KEYS.entries)),
    listLinksPage(["OFFER"], pageOf(sp, PAGE_KEYS.offers)),
    listLinksPage(["BUTTON", "GENERIC"], pageOf(sp, PAGE_KEYS.buttons)),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      include: {
        approvalRules: {
          where: { isActive: true },
          select: { id: true, name: true, isDefault: true },
        },
      },
    }),
  ]);
  const base = env.trackingBaseUrl;
  const host = base.replace("https://", "");
  const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";
  const pageLinks = { ...sp, ok: undefined, error: undefined };
  const paginationFor = (
    key: (typeof PAGE_KEYS)[keyof typeof PAGE_KEYS],
    page: { page: number; pages: number; total: number },
    noun: string,
  ) => (
    <Pagination
      page={page.page}
      pages={page.pages}
      total={page.total}
      noun={noun}
      hrefFor={(p) => pageHref("/links", pageLinks, p, key)}
    />
  );

  return (
    <>
      <PageHeader
        title="Liens"
        description={`Vos liens traqués (${host}) : chaque clic est compté et rattaché à la bonne pub, au bon message et au bon membre.`}
        help="Première chose à faire : créer un lien d'entrée par pub (formulaire « Nouveau lien d'entrée »), puis coller l'adresse obtenue dans votre pub TikTok ou Meta."
      />
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entrées par pub</CardTitle>
          <CardDescription>
            Chaque pub a son lien traqué et son lien d&apos;invitation Telegram (avec demande
            d&apos;adhésion) : on sait ainsi quelle pub a amené chaque membre.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.total === 0 ? (
            <EmptyState
              title="Aucun lien d'entrée"
              description="Créez-en un pour chaque pub : vous obtiendrez l'adresse à coller dans TikTok ou Meta."
              action={{ href: "#new-entry", label: "Créer un lien d'entrée" }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead className="hidden md:table-cell">Canal</TableHead>
                  <TableHead className="hidden lg:table-cell">Plateforme</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    <span className="inline-flex items-center gap-1">
                      Uniques{" "}
                      <HelpTip label="Définition : clics uniques">
                        Personnes distinctes ayant cliqué (un même appareil n&apos;est compté
                        qu&apos;une fois).
                      </HelpTip>
                    </span>
                  </TableHead>
                  <TableHead className="hidden text-right md:table-cell">Demandes</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Acceptés</TableHead>
                  <TableHead className="text-right">Inscrits</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      FTD{" "}
                      <HelpTip label="Définition : FTD">
                        Premiers dépôts (FTD) : joueurs venus par ce lien qui ont déposé pour la
                        première fois.
                      </HelpTip>
                    </span>
                  </TableHead>
                  <TableHead>Adresse à coller dans la pub</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.rows.map((l) => {
                  const a = entries.agg.get(l.id) ?? { registrations: 0, ftds: 0 };
                  const platform = l.inviteLink?.adPlatform ?? "OTHER";
                  return (
                    <TableRow
                      key={l.id}
                      className={highlight.has(l.slug) ? "bg-accent/40" : undefined}
                    >
                      <TableCell>
                        <div className="font-medium">{l.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {host}/{l.slug} · {fmtDate(l.createdAt)}
                        </div>
                        <div className="text-xs text-muted-foreground md:hidden">
                          {l.channel?.title ?? "—"} · {statusLabel("adPlatform", platform)}
                        </div>
                        {!l.isActive ? <ActiveBadge active={false} className="mt-1" /> : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {l.channel?.title ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {statusLabel("adPlatform", platform)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.clicks)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(l.uniqueClicks)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(l.inviteLink?.requests ?? 0)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(l.inviteLink?.approved ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(a.registrations)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(a.ftds)}</TableCell>
                      <TableCell className="min-w-72">
                        <CopyField value={buildAdUrl(platform, `${base}/${l.slug}`)} />
                      </TableCell>
                      <TableCell>
                        <ToggleLink
                          id={l.id}
                          label={l.label}
                          isActive={l.isActive}
                          what="Les personnes qui cliqueront sur la pub seront renvoyées vers l'accueil du site, sans entrer dans le canal."
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {paginationFor(PAGE_KEYS.entries, entries, "lien d'entrée")}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card id="new-entry">
          <CardHeader>
            <CardTitle className="text-base">Nouveau lien d&apos;entrée (pub)</CardTitle>
            <CardDescription>
              Une ligne par nom pour en créer plusieurs d&apos;un coup (ex. TT-casino-FR-video3).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createEntryLinksAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="channelId">Canal</Label>
                <select id="channelId" name="channelId" required className={selectCls}>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.vertical ? ` · ${VERTICAL_LABELS[c.vertical]}` : ""}
                      {c.isTest ? " (canal de test)" : ""}
                    </option>
                  ))}
                </select>
                {channels.length === 0 ? (
                  <p className="text-xs text-destructive">
                    Aucun canal actif : ajoutez d&apos;abord un bot comme administrateur d&apos;un
                    canal (page Canaux).
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="names">Nom(s) de lien</Label>
                <Textarea
                  id="names"
                  name="names"
                  required
                  rows={3}
                  placeholder={"TT-casino-FR-video3\nTT-casino-FR-video4"}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="platform">Plateforme</Label>
                  <select id="platform" name="platform" className={selectCls} defaultValue="TIKTOK">
                    {(["TIKTOK", "META", "OTHER"] as const).map((p) => (
                      <option key={p} value={p}>
                        {AD_PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">Langue (code à deux lettres)</Label>
                  <Input
                    id="language"
                    name="language"
                    defaultValue="fr"
                    maxLength={5}
                    className="max-md:h-10"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="adCampaignName">Campagne</Label>
                  <Input
                    id="adCampaignName"
                    name="adCampaignName"
                    placeholder="optionnel"
                    className="max-md:h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adSetName">Groupe de pubs</Label>
                  <Input
                    id="adSetName"
                    name="adSetName"
                    placeholder="optionnel"
                    className="max-md:h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adName">Pub</Label>
                  <Input
                    id="adName"
                    name="adName"
                    placeholder="optionnel"
                    className="max-md:h-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="approvalRuleId">Règle d&apos;adhésion (optionnel)</Label>
                <select
                  id="approvalRuleId"
                  name="approvalRuleId"
                  className={selectCls}
                  defaultValue=""
                >
                  <option value="">— règle par défaut du canal —</option>
                  {channels.flatMap((c) =>
                    c.approvalRules.map((r) => (
                      <option key={r.id} value={r.id}>
                        {c.title} · {r.name}
                        {r.isDefault ? " (défaut)" : ""}
                      </option>
                    )),
                  )}
                </select>
                <p className="text-xs text-muted-foreground">
                  Si une règle est choisie, une copie propre à ce lien est créée (modifiable ensuite
                  dans le canal).
                </p>
              </div>
              <Button type="submit" className="max-md:h-10">
                Créer le(s) lien(s)
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouveau lien générique</CardTitle>
            <CardDescription>
              N&apos;importe quelle adresse, avec comptage des clics (robots exclus). Utile pour une
              bio, une story ou un partenaire.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createGenericLinkAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Nom</Label>
                <Input id="label" name="label" required maxLength={120} className="max-md:h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">Adresse de destination</Label>
                <Input
                  id="url"
                  name="url"
                  type="url"
                  required
                  placeholder="https://…"
                  className="max-md:h-10"
                />
              </div>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Créer le lien
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Offres personnalisées</CardTitle>
          <CardDescription>
            Boutons « Offre » des messages : chaque clic crée un identifiant de suivi (sub-ID)
            propre au membre, transmis à Link Affi. C&apos;est ce qui permet de relier les
            inscriptions et dépôts au bon membre et au bon message.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {offers.total === 0 ? (
            <EmptyState
              title="Aucune offre pour l'instant"
              description="Ajoutez un bouton de type « Offre personnalisée » dans un message : le lien apparaîtra ici avec ses clics, inscriptions et premiers dépôts."
              action={{ href: "/messages/new", label: "Nouveau message", variant: "outline" }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead className="hidden md:table-cell">Campagne Link Affi</TableHead>
                  <TableHead className="hidden lg:table-cell">Message</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Membres</TableHead>
                  <TableHead className="text-right">Inscrits</TableHead>
                  <TableHead className="text-right">FTD</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.rows.map((l) => {
                  const a = offers.agg.get(l.id) ?? { registrations: 0, ftds: 0 };
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="font-medium">{l.label}</div>
                        <div className="text-xs text-muted-foreground">{l.slug}</div>
                        <div className="text-xs text-muted-foreground md:hidden">
                          {l.affiliateCampaign?.name ?? "—"}
                        </div>
                        {!l.isActive ? <ActiveBadge active={false} className="mt-1" /> : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {l.affiliateCampaign?.name ?? "—"}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {l.post ? `${l.post.code} · ${fmtDate(l.post.scheduledAt)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(l.clicks)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(l.uniqueClicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(a.registrations)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(a.ftds)}</TableCell>
                      <TableCell>
                        <ToggleLink
                          id={l.id}
                          label={l.label}
                          isActive={l.isActive}
                          what="Les membres qui cliqueront sur ce bouton seront renvoyés vers l'accueil du site, sans l'offre."
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {paginationFor(PAGE_KEYS.offers, offers, "offre")}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Boutons et liens génériques</CardTitle>
          <CardDescription>
            Adresses traquées sans identifiant de membre : boutons « Lien traqué » des messages et
            liens libres.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {buttons.total === 0 ? (
            <EmptyState
              title="Aucun bouton ni lien générique"
              description="Créez un lien générique ci-dessus, ou ajoutez un bouton « Lien traqué » dans un message."
              action={{ href: "/messages/new", label: "Nouveau message", variant: "outline" }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Destination</TableHead>
                  <TableHead className="text-right">Clics</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Uniques</TableHead>
                  <TableHead>Lien traqué</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buttons.rows.map((l) => (
                  <TableRow
                    key={l.id}
                    className={highlight.has(l.slug) ? "bg-accent/40" : undefined}
                  >
                    <TableCell>
                      <div className="font-medium">{l.label}</div>
                      <div className="text-xs text-muted-foreground md:hidden">
                        {statusLabel("trackingLinkKind", l.kind)}
                      </div>
                      {!l.isActive ? <ActiveBadge active={false} className="mt-1" /> : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {statusLabel("trackingLinkKind", l.kind)}
                    </TableCell>
                    <TableCell
                      className="hidden max-w-xs truncate text-xs text-muted-foreground lg:table-cell"
                      title={l.destinationTemplate}
                    >
                      {l.destinationTemplate}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(l.clicks)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {fmtNum(l.uniqueClicks)}
                    </TableCell>
                    <TableCell className="min-w-64">
                      <CopyField value={`${base}/${l.slug}`} />
                    </TableCell>
                    <TableCell>
                      <ToggleLink
                        id={l.id}
                        label={l.label}
                        isActive={l.isActive}
                        what="Les personnes qui cliqueront dessus seront renvoyées vers l'accueil du site."
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {paginationFor(PAGE_KEYS.buttons, buttons, "lien")}
        </CardContent>
      </Card>
    </>
  );
}
