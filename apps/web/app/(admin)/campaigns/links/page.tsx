import type { Metadata } from "next";
import { CheckCircle2, Plus } from "lucide-react";
import { AD_PLATFORM_LABELS, buildAdUrl } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { DataTable } from "@/components/admin/data-table";
import { Flash } from "@/components/admin/flash";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { PageHeader } from "@/components/admin/page-header";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { SidePanel } from "@/components/admin/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { shortLinkAddress } from "@/lib/campaigns/display";
import { env } from "@/lib/env";
import { fmtDate, fmtNum } from "@/lib/format";
import { listLinksPage, type LinkRow } from "@/lib/links/queries";
import { requireUser } from "@/lib/session";
import { ActiveBadge, statusLabel } from "@/lib/status-badges";
import { universeLabel } from "@/lib/universe";
import { createEntryLinksAction, createGenericLinkAction, toggleLinkAction } from "./actions";

export const metadata: Metadata = { title: "Tous les liens" };

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
          variant="destructive"
          className="max-md:h-10"
          confirmTitle="Désactiver ce lien ?"
          confirmLabel="Désactiver"
          message={`« ${label} » : ${what} Vous pourrez le réactiver ici.`}
        >
          Désactiver le lien
        </ConfirmSubmit>
      ) : (
        <Button type="submit" variant="outline" className="max-md:h-10">
          Réactiver le lien
        </Button>
      )}
    </form>
  );
}

/** Une ligne « libellé : valeur » d'un volet de détail. */
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** Nom d'un lien dans la première cellule : libellé, et la pastille « Inactif » s'il est désactivé. */
function NameCell({ link }: { link: LinkRow }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{link.label}</span>
      {!link.isActive ? <ActiveBadge active={false} /> : null}
    </span>
  );
}

/**
 * Tous les liens traqués (ex-page Liens, rangée dans Campagnes) : entrées par pub, boutons Offre, boutons et liens
 * génériques. Tableaux de 5 colonnes au plus ; adresse à copier, chiffres et désactivation dans le volet de détail.
 * Création dans des volets (« Nouveau lien d'entrée », « Nouveau lien générique ») ; après création, les adresses
 * des liens créés s'affichent en haut (`?highlight=`).
 */
export default async function LinksPage({ searchParams }: PageProps<"/campaigns/links">) {
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
  const base = env.trackingBaseUrl.replace(/\/$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const pageLinks = { ...sp, ok: undefined, error: undefined, highlight: undefined };
  const paginationFor = (
    key: (typeof PAGE_KEYS)[keyof typeof PAGE_KEYS],
    page: { page: number; pages: number; total: number },
    noun: string,
  ) =>
    page.total > 0 ? (
      <Pagination
        page={page.page}
        pages={page.pages}
        total={page.total}
        noun={noun}
        hrefFor={(p) => pageHref("/campaigns/links", pageLinks, p, key)}
      />
    ) : null;
  const entryUrl = (l: LinkRow) =>
    buildAdUrl(l.inviteLink?.adPlatform ?? "OTHER", `${base}/${l.slug}`);
  const created = [...entries.rows, ...buttons.rows].filter((l) => highlight.has(l.slug));

  const newEntryPanel = (
    <SidePanel
      size="lg"
      title="Nouveau lien d'entrée"
      description="Un lien par pub : adresse traquée + invitation Telegram avec demande d'adhésion."
      trigger={
        <Button className="max-md:h-10">
          <Plus aria-hidden />
          Nouveau lien d&apos;entrée
        </Button>
      }
    >
      <form action={createEntryLinksAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="channelId">Canal à rejoindre</Label>
          <NativeSelect id="channelId" name="channelId" required wrapperClassName="w-full">
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.vertical ? ` · ${universeLabel(c.vertical)}` : ""}
                {c.isTest ? " (canal de test)" : ""}
              </option>
            ))}
          </NativeSelect>
          {channels.length === 0 ? (
            <p className="text-note text-danger">
              Aucun canal actif : ajoutez d&apos;abord un bot comme administrateur d&apos;un canal
              (menu Canaux).
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="names">Nom du lien</Label>
          <Textarea
            id="names"
            name="names"
            required
            rows={3}
            placeholder={"TT-casino-FR-video3\nTT-casino-FR-video4"}
          />
          <p className="text-note text-muted-foreground">
            Un nom par ligne pour en créer plusieurs d&apos;un coup.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="platform">Plateforme</Label>
          <NativeSelect
            id="platform"
            name="platform"
            defaultValue="TIKTOK"
            wrapperClassName="w-full"
          >
            {(["TIKTOK", "META", "OTHER"] as const).map((p) => (
              <option key={p} value={p}>
                {AD_PLATFORM_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <AdvancedSection
          title="Langue, campagne pub et accueil"
          description="Facultatif : langue du bot, noms de la campagne pub, de son groupe et de la pub, règle d'adhésion."
        >
          <div className="space-y-2">
            <Label htmlFor="language">Langue du bot (code à deux lettres)</Label>
            <Input id="language" name="language" defaultValue="fr" maxLength={5} className="w-24" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="adCampaignName">Campagne pub</Label>
              <Input id="adCampaignName" name="adCampaignName" placeholder="facultatif" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adSetName">Groupe de pubs</Label>
              <Input id="adSetName" name="adSetName" placeholder="facultatif" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adName">Pub</Label>
              <Input id="adName" name="adName" placeholder="facultatif" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="approvalRuleId">Règle d&apos;adhésion</Label>
            <NativeSelect
              id="approvalRuleId"
              name="approvalRuleId"
              defaultValue=""
              wrapperClassName="w-full"
            >
              <option value="">Règle par défaut du canal</option>
              {channels.flatMap((c) =>
                c.approvalRules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {c.title} · {r.name}
                    {r.isDefault ? " (par défaut)" : ""}
                  </option>
                )),
              )}
            </NativeSelect>
            <p className="text-note text-muted-foreground">
              Une règle choisie est copiée pour ce lien seul (modifiable ensuite dans le canal).
            </p>
          </div>
        </AdvancedSection>
        <Button type="submit" className="max-md:h-10">
          Créer le lien
        </Button>
      </form>
    </SidePanel>
  );

  const newGenericPanel = (
    <SidePanel
      title="Nouveau lien générique"
      description="N'importe quelle adresse, avec comptage des clics (robots exclus) : bio, story, partenaire."
      trigger={
        <Button variant="outline" className="max-md:h-10">
          Nouveau lien générique
        </Button>
      }
    >
      <form action={createGenericLinkAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="label">Nom</Label>
          <Input id="label" name="label" required maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="url">Adresse de destination</Label>
          <Input id="url" name="url" type="url" required placeholder="https://…" />
        </div>
        <Button type="submit" className="max-md:h-10">
          Créer le lien
        </Button>
      </form>
    </SidePanel>
  );

  return (
    <>
      <PageHeader
        backHref="/campaigns"
        backLabel="Campagnes"
        title="Tous les liens"
        description={`Vos liens traqués (${host}) : chaque clic est compté et rattaché à la bonne pub, au bon message et au bon membre.`}
        primaryAction={newEntryPanel}
        secondaryActions={newGenericPanel}
      />
      <Flash ok={sp.ok} error={sp.error} />

      {created.length ? (
        <section
          aria-labelledby="created-links"
          className="mb-8 space-y-3 rounded-xl border border-success/30 bg-success-soft p-4"
        >
          <h2
            id="created-links"
            className="flex items-center gap-2 text-body font-semibold text-foreground"
          >
            <CheckCircle2 aria-hidden className="size-4 text-success" />
            {created.length > 1
              ? "Liens créés : copiez leurs adresses"
              : "Lien créé : copiez son adresse"}
          </h2>
          <ul className="space-y-3">
            {created.map((l) => (
              <li key={l.id} className="space-y-1">
                <p className="text-note font-medium text-foreground">{l.label}</p>
                <CopyField
                  value={l.kind === "AD_ENTRY" ? entryUrl(l) : `${base}/${l.slug}`}
                  label={`Adresse du lien ${l.label}`}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="space-y-10">
        <FormSection
          title={`Entrées par pub (${fmtNum(entries.total)})`}
          description="Chaque pub a son lien traqué et son invitation Telegram : on sait quelle pub a amené chaque membre."
        >
          <DataTable
            label="Liens d'entrée des pubs"
            columns={[
              { key: "name", header: "Nom", className: "min-w-40 whitespace-normal" },
              { key: "channel", header: "Canal", hideOnMobile: true },
              { key: "clicks", header: "Clics", align: "right" },
              { key: "registrations", header: "Inscriptions", align: "right", hideOnMobile: true },
              {
                key: "ftds",
                header: "Premiers dépôts",
                term: "FTD",
                align: "right",
                hideOnMobile: true,
              },
            ]}
            rows={entries.rows.map((l) => {
              const a = entries.agg.get(l.id) ?? { registrations: 0, ftds: 0 };
              const platform = l.inviteLink?.adPlatform ?? "OTHER";
              return {
                id: l.id,
                cells: {
                  name: <NameCell link={l} />,
                  channel: l.channel?.title ?? "—",
                  clicks: fmtNum(l.clicks),
                  registrations: fmtNum(a.registrations),
                  ftds: fmtNum(a.ftds),
                },
                sortValues: { name: l.label },
                detailTitle: l.label,
                detailDescription: shortLinkAddress(base, l.slug),
                detail: (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <p className="text-body font-medium">Adresse à coller dans la pub</p>
                      <CopyField value={entryUrl(l)} label={`Adresse de la pub ${l.label}`} />
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                      <Row label="Canal">{l.channel?.title ?? "—"}</Row>
                      <Row label="Plateforme">{statusLabel("adPlatform", platform)}</Row>
                      <Row label="Créé le">{fmtDate(l.createdAt)}</Row>
                      <Row label="Clics">
                        {fmtNum(l.clicks)} ({fmtNum(l.uniqueClicks)} personnes)
                      </Row>
                      <Row label="Demandes">{fmtNum(l.inviteLink?.requests ?? 0)}</Row>
                      <Row label="Acceptés">{fmtNum(l.inviteLink?.approved ?? 0)}</Row>
                      <Row label="Inscriptions">{fmtNum(a.registrations)}</Row>
                      <Row label={<Term term="FTD">Premiers dépôts</Term>}>{fmtNum(a.ftds)}</Row>
                      <Row label="État">
                        <ActiveBadge active={l.isActive} />
                      </Row>
                    </dl>
                    <div className="border-t border-border pt-4">
                      <ToggleLink
                        id={l.id}
                        label={l.label}
                        isActive={l.isActive}
                        what="les personnes qui cliqueront sur la pub seront renvoyées vers l'accueil du site, sans entrer dans le canal."
                      />
                    </div>
                  </div>
                ),
              };
            })}
            empty={{
              title: "Aucun lien d'entrée",
              description:
                "Créez-en un par pub (« Nouveau lien d'entrée ») : vous obtiendrez l'adresse à coller dans TikTok ou Meta.",
            }}
          />
          {paginationFor(PAGE_KEYS.entries, entries, "lien")}
        </FormSection>

        <AdvancedSection
          title={`Boutons Offre des messages (${fmtNum(offers.total)})`}
          description="Créés par les messages : chaque clic donne au membre son identifiant de suivi, transmis à Link Affi."
          defaultOpen={Boolean(sp.po)}
        >
          <DataTable
            label="Boutons Offre des messages"
            columns={[
              { key: "name", header: "Nom", className: "min-w-40 whitespace-normal" },
              { key: "offer", header: "Offre Link Affi", hideOnMobile: true },
              { key: "clicks", header: "Clics", align: "right" },
              { key: "registrations", header: "Inscriptions", align: "right", hideOnMobile: true },
              {
                key: "ftds",
                header: "Premiers dépôts",
                term: "FTD",
                align: "right",
                hideOnMobile: true,
              },
            ]}
            rows={offers.rows.map((l) => {
              const a = offers.agg.get(l.id) ?? { registrations: 0, ftds: 0 };
              return {
                id: l.id,
                cells: {
                  name: <NameCell link={l} />,
                  offer: l.affiliateCampaign?.name ?? "—",
                  clicks: fmtNum(l.clicks),
                  registrations: fmtNum(a.registrations),
                  ftds: fmtNum(a.ftds),
                },
                sortValues: { name: l.label },
                detailTitle: l.label,
                detailDescription: l.affiliateCampaign?.name ?? undefined,
                detail: (
                  <div className="space-y-6">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                      <Row label="Offre Link Affi">{l.affiliateCampaign?.name ?? "—"}</Row>
                      <Row label="Message">
                        {l.post ? `${l.post.code} · ${fmtDate(l.post.scheduledAt)}` : "—"}
                      </Row>
                      <Row label="Repère">
                        <span className="font-mono text-note">{l.slug}</span>
                      </Row>
                      <Row label="Clics">{fmtNum(l.clicks)}</Row>
                      <Row label="Membres">{fmtNum(l.uniqueClicks)}</Row>
                      <Row label="Inscriptions">{fmtNum(a.registrations)}</Row>
                      <Row label={<Term term="FTD">Premiers dépôts</Term>}>{fmtNum(a.ftds)}</Row>
                      <Row label="État">
                        <ActiveBadge active={l.isActive} />
                      </Row>
                    </dl>
                    <div className="border-t border-border pt-4">
                      <ToggleLink
                        id={l.id}
                        label={l.label}
                        isActive={l.isActive}
                        what="les membres qui cliqueront sur ce bouton seront renvoyés vers l'accueil du site, sans l'offre."
                      />
                    </div>
                  </div>
                ),
              };
            })}
            empty={{
              title: "Aucun bouton Offre pour l'instant",
              description:
                "Ajoutez un bouton Offre dans un message : il apparaîtra ici avec ses clics, inscriptions et premiers dépôts.",
              action: { href: "/messages/new", label: "Programmer un message", variant: "outline" },
            }}
          />
          {paginationFor(PAGE_KEYS.offers, offers, "bouton")}
        </AdvancedSection>

        <AdvancedSection
          title={`Boutons et liens génériques (${fmtNum(buttons.total)})`}
          description="Adresses traquées sans identifiant de membre : boutons « Lien traqué » des messages et liens libres."
          defaultOpen={Boolean(sp.pb) || created.some((l) => l.kind !== "AD_ENTRY")}
        >
          <DataTable
            label="Boutons et liens génériques"
            columns={[
              { key: "name", header: "Nom", className: "min-w-40 whitespace-normal" },
              { key: "kind", header: "Type", hideOnMobile: true },
              { key: "clicks", header: "Clics", align: "right" },
              { key: "unique", header: "Personnes", align: "right", hideOnMobile: true },
            ]}
            rows={buttons.rows.map((l) => ({
              id: l.id,
              cells: {
                name: <NameCell link={l} />,
                kind: statusLabel("trackingLinkKind", l.kind),
                clicks: fmtNum(l.clicks),
                unique: fmtNum(l.uniqueClicks),
              },
              sortValues: { name: l.label },
              detailTitle: l.label,
              detailDescription: statusLabel("trackingLinkKind", l.kind),
              detail: (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-body font-medium">Lien traqué</p>
                    <CopyField value={`${base}/${l.slug}`} label={`Lien traqué ${l.label}`} />
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                    <Row label="Destination">
                      <span className="text-note">{l.destinationTemplate}</span>
                    </Row>
                    <Row label="Clics">{fmtNum(l.clicks)}</Row>
                    <Row label="Personnes">{fmtNum(l.uniqueClicks)}</Row>
                    <Row label="État">
                      <ActiveBadge active={l.isActive} />
                    </Row>
                  </dl>
                  <div className="border-t border-border pt-4">
                    <ToggleLink
                      id={l.id}
                      label={l.label}
                      isActive={l.isActive}
                      what="les personnes qui cliqueront dessus seront renvoyées vers l'accueil du site."
                    />
                  </div>
                </div>
              ),
            }))}
            empty={{
              title: "Aucun bouton ni lien générique",
              description:
                "Créez un lien générique, ou ajoutez un bouton « Lien traqué » dans un message.",
            }}
          />
          {paginationFor(PAGE_KEYS.buttons, buttons, "lien")}
        </AdvancedSection>
      </div>
    </>
  );
}
