import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { CopyField } from "@/components/admin/copy-field";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { SidePanel } from "@/components/admin/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { entryLinkTitle, shortLinkAddress } from "@/lib/campaigns/display";
import { env } from "@/lib/env";
import { fmtNum } from "@/lib/format";
import { shortUrl, sourcePublicUrl } from "@/lib/landing/form";
import { ActiveBadge } from "@/lib/status-badges";
import { PLATFORM_LABELS } from "../../campaign-form";
import { addEntryLinkAction } from "../../actions";
import type { TabProps } from "./shared";

/**
 * Onglet Liens : les liens d'entrée de la campagne (l'adresse à coller dans chaque pub, détail et copie au clic sur
 * la ligne) et « Ajouter un lien d'entrée » dans un volet (une pub et son lien : goolink + invitation Telegram).
 * Les liens des pages d'atterrissage n'y sont jamais (leurs demandes comptent dans la campagne, mais leur lien
 * Telegram ne se colle pas dans une pub) : en dessous, les pages reliées à ses pubs, avec l'adresse de la page.
 */
export async function LinksTab({ id, campaign, scope }: TabProps) {
  const [links, channels, pageSources] = await Promise.all([
    scope.inviteLinkIds.length
      ? prisma.inviteLink.findMany({
          where: { id: { in: scope.inviteLinkIds }, kind: { not: "LANDING" } },
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
            trackingLinks: {
              where: { kind: "AD_ENTRY" },
              select: { slug: true, clicks: true, uniqueClicks: true },
              take: 1,
            },
          },
        })
      : [],
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    // Sources de pages d'atterrissage reliées aujourd'hui à une pub de la campagne.
    prisma.landingSource.findMany({
      where: { isActive: true, ad: { adSet: { campaignId: id } } },
      orderBy: [{ landingPage: { name: "asc" } }, { key: "asc" }],
      select: {
        id: true,
        key: true,
        ad: { select: { name: true } },
        landingPage: { select: { id: true, name: true, slug: true } },
      },
    }),
  ]);
  const base = env.trackingBaseUrl.replace(/\/$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const campaignChannels = channels.filter((c) => scope.channelIds.includes(c.id));
  const channelOptions = campaignChannels.length ? campaignChannels : channels;
  const nextNumber = links.length + 1;

  const addPanel = (
    <SidePanel
      title="Ajouter un lien d'entrée"
      description="Crée une pub et son lien : adresse traquée + invitation Telegram avec demande d'adhésion."
      trigger={
        <Button className="max-md:h-10">
          <Plus aria-hidden />
          Ajouter un lien d&apos;entrée
        </Button>
      }
    >
      {channelOptions.length === 0 ? (
        <EmptyState
          title="Aucun canal actif"
          description="Ajoutez d'abord un canal Telegram : le lien d'entrée y fait entrer les membres."
          action={{ href: "/channels", label: "Aller aux canaux", variant: "outline" }}
        />
      ) : (
        <form action={addEntryLinkAction} className="space-y-5">
          <input type="hidden" name="campaignId" value={id} />
          <div className="space-y-2">
            <Label htmlFor="link-channel">Canal à rejoindre</Label>
            <NativeSelect
              id="link-channel"
              name="channelId"
              defaultValue={channelOptions[0]?.id ?? ""}
              required
              wrapperClassName="w-full"
            >
              {channelOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="link-platform">Plateforme</Label>
              <NativeSelect
                id="link-platform"
                name="platform"
                defaultValue={campaign.adPlatform ?? "OTHER"}
                wrapperClassName="w-full"
              >
                {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="link-adname">Nom de la pub</Label>
              <Input
                id="link-adname"
                name="adName"
                placeholder={`ex. Pub ${nextNumber}`}
                maxLength={80}
              />
            </div>
          </div>
          <AdvancedSection title="Groupe de pubs" description="« Groupe 1 » par défaut.">
            <div className="space-y-2">
              <Label htmlFor="link-adset">Nom du groupe</Label>
              <Input id="link-adset" name="adSetName" placeholder="Groupe 1" maxLength={80} />
            </div>
          </AdvancedSection>
          <Button type="submit" className="max-md:h-10">
            Créer le lien
          </Button>
        </form>
      )}
    </SidePanel>
  );

  return (
    <FormSection
      title={`Liens d'entrée (${links.length})`}
      description={`Un lien par pub : collez son adresse ${host}/… dans la pub. Les membres arrivés par ces liens comptent dans la campagne. Clics et membres acceptés depuis la création du lien (pas seulement sur la période).`}
      actions={links.length ? addPanel : null}
    >
      {links.length === 0 ? (
        <EmptyState
          title="Aucun lien d'entrée pour l'instant"
          description="Créez-en un par pub : vous obtiendrez l'adresse à coller dans TikTok ou Meta."
        >
          {addPanel}
        </EmptyState>
      ) : (
        <DataTable
          // Téléphone : 3 colonnes à largeur fixe et en-têtes sur deux lignes, pour que « Acceptés (total) » et ses
          // chiffres restent dans l'écran (sans défilement horizontal du tableau).
          className="max-md:[&_table]:table-fixed"
          label="Liens d'entrée de la campagne"
          columns={[
            {
              key: "name",
              header: "Pub",
              className: "whitespace-normal break-words max-md:w-[38%] md:min-w-32",
            },
            { key: "address", header: "Adresse", hideOnMobile: true },
            { key: "channel", header: "Canal", hideOnMobile: true },
            {
              key: "clicks",
              header: "Clics (total)",
              align: "right",
              className: "max-md:w-[28%] max-md:whitespace-normal",
            },
            {
              key: "approved",
              header: "Acceptés (total)",
              align: "right",
              className: "max-md:w-[34%] max-md:whitespace-normal",
            },
          ]}
          rows={links.map((l) => {
            const tl = l.trackingLinks[0];
            const title = entryLinkTitle(l);
            const platform = l.adPlatform ? (PLATFORM_LABELS[l.adPlatform] ?? l.adPlatform) : null;
            return {
              id: l.id,
              cells: {
                name: (
                  <span className="flex flex-col items-start gap-1">
                    <span>{title}</span>
                    {!l.isActive ? <ActiveBadge active={false} /> : null}
                  </span>
                ),
                address: tl ? (
                  <span className="font-mono text-note">{shortLinkAddress(base, tl.slug)}</span>
                ) : (
                  <span className="text-muted-foreground">Invitation directe</span>
                ),
                channel: l.channel.title,
                clicks: fmtNum(tl?.clicks ?? 0),
                approved: fmtNum(l.approved),
              },
              sortValues: { name: title, address: tl?.slug ?? "" },
              detailTitle: title,
              detailDescription: l.name,
              detail: (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-body font-medium">Adresse à coller dans la pub</p>
                    {tl ? (
                      <CopyField
                        value={`${base}/${tl.slug}`}
                        label={`Adresse de la pub ${title}`}
                      />
                    ) : (
                      <>
                        <p className="text-note text-muted-foreground">
                          Ce lien n&apos;a pas d&apos;adresse traquée : invitation Telegram directe.
                        </p>
                        <CopyField
                          value={l.telegramInviteLink}
                          label={`Invitation Telegram de ${title}`}
                        />
                      </>
                    )}
                  </div>
                  <p className="text-note text-muted-foreground">
                    Chiffres depuis la création du lien, quelle que soit la période choisie.
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                    <dt className="text-muted-foreground">Canal</dt>
                    <dd>{l.channel.title}</dd>
                    {platform ? (
                      <>
                        <dt className="text-muted-foreground">Plateforme</dt>
                        <dd>{platform}</dd>
                      </>
                    ) : null}
                    <dt className="text-muted-foreground">Clics (total)</dt>
                    <dd className="tabular-nums">
                      {fmtNum(tl?.clicks ?? 0)}
                      {tl ? ` (${fmtNum(tl.uniqueClicks)} personnes)` : ""}
                    </dd>
                    <dt className="text-muted-foreground">Demandes (total)</dt>
                    <dd className="tabular-nums">{fmtNum(l.requests)}</dd>
                    <dt className="text-muted-foreground">Acceptés (total)</dt>
                    <dd className="tabular-nums">{fmtNum(l.approved)}</dd>
                    <dt className="text-muted-foreground">État</dt>
                    <dd>
                      <ActiveBadge active={l.isActive} />
                    </dd>
                  </dl>
                  <p className="text-note text-muted-foreground">
                    Désactiver ou réactiver ce lien : Campagnes →{" "}
                    <Link href="/campaigns/links" className="font-medium text-brand-ink underline">
                      Tous les liens
                    </Link>
                    .
                  </p>
                </div>
              ),
            };
          })}
        />
      )}
      {pageSources.length ? (
        <div className="space-y-3">
          <p className="text-body font-medium">Pages reliées à ses pubs</p>
          <ul className="space-y-3">
            {pageSources.map((s) => {
              const url = sourcePublicUrl(env.trackingBaseUrl, s.landingPage.slug, s.key);
              return (
                <li key={s.id} className="space-y-1.5">
                  <p className="text-note">
                    <Link
                      href={`/pages/${s.landingPage.id}`}
                      className="font-medium text-brand-ink underline"
                    >
                      {s.landingPage.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {" "}
                      · {s.key ? `source ${s.key}` : "lien principal"} · pub « {s.ad?.name} »
                    </span>
                  </p>
                  <CopyField value={url} label={`Adresse de la page ${shortUrl(url)}`} />
                </li>
              );
            })}
          </ul>
          <p className="text-note text-muted-foreground">
            Dans ces pubs, collez l&apos;adresse de la page : ses visites et ses demandes comptent
            dans la campagne.
          </p>
        </div>
      ) : null}
      <p className="text-note text-muted-foreground">
        Un lien créé dans{" "}
        <Link href="/campaigns/links" className="font-medium text-brand-ink underline">
          Tous les liens
        </Link>{" "}
        rejoint la campagne quand vous le rattachez à une pub (onglet Pubs).
      </p>
    </FormSection>
  );
}
