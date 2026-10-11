import type { Metadata } from "next";
import Link from "next/link";
import { Download, RefreshCw } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { SYNC_TABLES } from "@linkaffipro/linkaffi";
import { parseRates } from "@linkaffipro/connectors";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { DataTable } from "@/components/admin/data-table";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { StatCard } from "@/components/admin/stat-card";
import { StatusPill } from "@/components/admin/status-pill";
import { ConnectionTiles } from "@/components/settings/connection-tiles";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate, fmtNum } from "@/lib/format";
import { loadLinkAffiDiagnostic, newCampaignHrefFor } from "@/lib/linkaffi/diagnostic";
import { requireAdminPage } from "@/lib/session";
import { StatusBadge, statusLabel, type SyncStatus } from "@/lib/status-badges";
import { linkAffiTableLabel } from "@/lib/status/labels";
import { adPlatformState, linkAffiState, telegramState } from "@/lib/status/settings-cards";
import { subIdHealthView } from "@/lib/status/sub-id-view";
import { computeSubIdHealth } from "./health";
import { saveRatesAction, saveSpendThresholdsAction, syncNowAction } from "./actions";

export const metadata: Metadata = { title: "Connexions" };

/** Export brut de tous les joueurs Link Affi (ADMIN, diagnostic) : route de téléchargement, pas une page. */
const RAW_PLAYERS_EXPORT = "/members/players/export?scope=all";

const PLATFORM_LABELS: Record<string, string> = { META: "Meta", TIKTOK: "TikTok" };
const PLATFORM_PAGES: Record<string, string> = {
  META: "/settings/connectors/meta",
  TIKTOK: "/settings/connectors/tiktok",
};

/**
 * Réglages → Connexions : ce qui remplit la plateforme tout seul. En haut, les quatre connexions (Link Affi, Meta,
 * TikTok, Telegram) avec leur état ; puis Link Affi (vos joueurs, offres non liées, identifiant de suivi), les comptes
 * publicitaires connectés, les réglages des chiffres (taux de change, niveaux de dépense), et le détail technique de
 * la synchro dans « Avancé » (ouvert d'office si une donnée est en erreur). Contenu et actions inchangés.
 */
export default async function ConnectorsPage({ searchParams }: PageProps<"/settings/connectors">) {
  await requireAdminPage();
  const sp = await searchParams;
  const now = new Date();
  const [
    states,
    health,
    thresholdSetting,
    diag,
    connections,
    ratesImported,
    ratesManual,
    telegramSession,
  ] = await Promise.all([
    prisma.syncState.findMany(),
    computeSubIdHealth(),
    prisma.setting.findUnique({ where: { key: "spend.thresholds" } }),
    loadLinkAffiDiagnostic(),
    prisma.adAccountConnection.findMany({
      orderBy: [{ platform: "asc" }, { name: "asc" }],
      select: {
        id: true,
        platform: true,
        name: true,
        status: true,
        currency: true,
        lastSyncAt: true,
        lastSyncRows: true,
        lastError: true,
      },
    }),
    prisma.setting.findUnique({ where: { key: "currency.rates.imported" } }),
    prisma.setting.findUnique({ where: { key: "currency.rates.manual" } }),
    prisma.telegramUserSession.findUnique({
      where: { id: "main" },
      select: { status: true, phone: true, lastUsedAt: true, lastError: true },
    }),
  ]);
  const manualRates = Object.entries(parseRates(ratesManual?.value));
  const importedRates = Object.entries(parseRates(ratesImported?.value)).filter(
    ([k]) => k !== "EUR",
  );
  const byTable = new Map(states.map((s) => [s.source, s]));
  const thresholds = {
    vip: 500,
    regularDeposits: 3,
    ...((thresholdSetting?.value as { vip?: number; regularDeposits?: number } | null) ?? {}),
  };
  const hasKeys = states.length > 0;
  const syncErrors = states.filter((s) => s.lastError).length;
  const healthView = subIdHealthView(health);

  const connectionCounts = connections.map((c) => ({
    platform: c.platform,
    status: c.status,
    count: 1,
  }));
  const linkAffi = linkAffiState(states, now);
  const tiles = [
    {
      key: "linkaffi",
      href: "#linkaffi",
      label: "Link Affi",
      description: "Joueurs, dépôts et revenus, relus toutes les 2 minutes.",
      state: linkAffi,
    },
    {
      key: "meta",
      href: "/settings/connectors/meta",
      label: "Meta",
      description: "Facebook et Instagram : les dépenses de vos pubs, chaque heure.",
      state: adPlatformState(connectionCounts, "META"),
    },
    {
      key: "tiktok",
      href: "/settings/connectors/tiktok",
      label: "TikTok",
      description: "Les dépenses de vos pubs, chaque heure.",
      state: adPlatformState(connectionCounts, "TIKTOK"),
    },
    {
      key: "telegram",
      href: "/settings/connectors/telegram",
      label: "Telegram (vues)",
      description: "Le nombre de vues de chaque message publié.",
      state: telegramState({ status: telegramSession?.status ?? null }),
    },
  ] as const;

  const diagFigures = [
    {
      label: "Programmes",
      value: diag.programs,
      hint: "Casinos et opérateurs connus de Link Affi.",
    },
    { label: "Offres Link Affi", value: diag.offers, hint: "Toutes, liées ou non." },
    {
      label: "Offres liées",
      value: diag.linkedOffers,
      hint: "Rattachées à une de vos campagnes.",
    },
    { label: "Joueurs (tous)", value: diag.players.total, hint: "Tous ceux lus chez Link Affi." },
    {
      label: "Vos joueurs",
      value: diag.players.ours,
      hint: "Les seuls comptés dans les statistiques.",
    },
    {
      label: "Non rattachés",
      value: diag.players.notOurs,
      hint: "Autres affiliés ou offres non liées : jamais comptés.",
    },
  ];

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Connexions"
        description="Ce qui remplit la plateforme tout seul : Link Affi toutes les 2 minutes, vos comptes pub chaque heure, votre compte Telegram pour les vues."
        help="Rien à faire au quotidien. Une connexion en rouge : ouvrez-la et suivez la phrase affichée."
        primaryAction={
          <form action={syncNowAction}>
            <Button type="submit" className="max-md:h-10">
              <RefreshCw aria-hidden />
              Synchroniser Link Affi
            </Button>
          </form>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <FormSection
          title="Vos connexions"
          description="Ouvrez une connexion pour la brancher, la vérifier ou la reconnecter."
        >
          <ConnectionTiles tiles={tiles} />
        </FormSection>

        <FormSection
          id="linkaffi"
          title="Link Affi : vos joueurs"
          description="Seuls vos joueurs entrent dans les statistiques : ceux venus d'un de vos clics, ou d'une offre Link Affi liée à une de vos campagnes."
          actions={
            <a
              href={RAW_PLAYERS_EXPORT}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
            >
              <Download aria-hidden />
              Exporter tous les joueurs (CSV)
            </a>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-body">
            {linkAffi ? (
              <StatusPill tone={linkAffi.tone} title={linkAffi.title}>
                {linkAffi.label}
              </StatusPill>
            ) : null}
            {syncErrors > 0 ? (
              <span className="text-note text-muted-foreground">
                Le détail des erreurs est dans « Avancé », en bas de page.
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {diagFigures.map((t) => (
              <StatCard key={t.label} label={t.label} value={fmtNum(t.value)} hint={t.hint} />
            ))}
          </div>
          <div className="space-y-3">
            <h3 className="text-body font-semibold text-foreground">
              Offres Link Affi non liées qui ont des joueurs
              {diag.unlinkedOffersTotal > diag.unlinked.length
                ? ` (les ${diag.unlinked.length} plus grosses sur ${diag.unlinkedOffersTotal})`
                : ""}
            </h3>
            <DataTable
              label="Offres Link Affi non liées qui ont des joueurs"
              columns={[
                { key: "name", header: "Offre Link Affi", className: "min-w-40 whitespace-normal" },
                { key: "program", header: "Programme", hideOnMobile: true },
                { key: "players", header: "Joueurs", align: "right" },
                { key: "last", header: "Dernière inscription", hideOnMobile: true },
              ]}
              rows={diag.unlinked.map((o) => ({
                id: o.affiliateCampaignId,
                cells: {
                  name: o.name,
                  program: o.programName,
                  players: fmtNum(o.players),
                  last: fmtDate(o.lastRegisteredAt),
                },
                detailTitle: o.name,
                detailDescription: o.programName,
                detail: (
                  <div className="space-y-6">
                    <DetailList>
                      <DetailRow label="Programme">{o.programName}</DetailRow>
                      <DetailRow label="Joueurs non rattachés">{fmtNum(o.players)}</DetailRow>
                      <DetailRow label="Dernière inscription">
                        {fmtDate(o.lastRegisteredAt)}
                      </DetailRow>
                      {o.campaignKey ? (
                        <DetailRow label="Clé Link Affi" mono>
                          {o.campaignKey}
                        </DetailRow>
                      ) : null}
                    </DetailList>
                    <p className="text-body text-muted-foreground">
                      Si cette offre est bien la vôtre, liez-la à une campagne : ses joueurs
                      entreront dans vos statistiques après le prochain recalcul.
                    </p>
                    <Link
                      href={newCampaignHrefFor(o)}
                      className={cn(buttonVariants(), "max-md:h-10")}
                    >
                      Créer une campagne avec cette offre
                    </Link>
                  </div>
                ),
              }))}
              empty={{
                title: "Aucun joueur non rattaché",
                description:
                  "Toutes les offres qui ont des joueurs sont liées à une de vos campagnes.",
              }}
            />
            {diag.unlinked.length > 0 ? (
              <p className="text-note text-muted-foreground">
                Une de ces offres est la vôtre ? Ouvrez-la et créez une campagne avec elle, ou
                liez-la depuis la fiche d&apos;une campagne existante.
              </p>
            ) : null}
          </div>
        </FormSection>

        <FormSection
          title="Identifiant de suivi, 7 derniers jours"
          description={
            <>
              L&apos;<Term term="sub-ID">identifiant de suivi</Term> est ajouté à chaque clic sur
              une offre : il relie l&apos;inscription du joueur au membre et au message
              d&apos;origine.
            </>
          }
        >
          <Alert variant={healthView.alert} role="status">
            <AlertTitle>{healthView.title}</AlertTitle>
            <AlertDescription>{healthView.sentence}</AlertDescription>
          </Alert>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Joueurs revenus avec leur identifiant"
              value={fmtNum(health.postback)}
              hint="Par le retour du casino."
            />
            <StatCard
              label="Rattachés à l'heure du clic"
              value={fmtNum(health.timeMatch)}
              hint="Sans identifiant : rattachés au clic le plus proche. Moins fiable."
            />
            <StatCard
              label="Sans identifiant malgré vos clics"
              value={fmtNum(health.missingWithClicks)}
              hint="Joueurs d'offres où vous avez envoyé des clics."
            />
            <StatCard
              label="Clics d'offre envoyés"
              value={fmtNum(health.offerClicks)}
              hint="Chacun avec son identifiant de suivi."
            />
          </div>
        </FormSection>

        <FormSection
          title="Comptes publicitaires connectés"
          description="Les dépenses arrivent toutes seules dans Campagnes (onglet Pubs). Ouvrez un compte pour le détail."
        >
          <DataTable
            label="Comptes publicitaires connectés"
            columns={[
              { key: "name", header: "Compte", className: "min-w-40 whitespace-normal" },
              { key: "platform", header: "Plateforme", hideOnMobile: true },
              { key: "status", header: "État" },
              { key: "sync", header: "Dernière synchro", hideOnMobile: true },
            ]}
            rows={connections.map((c) => {
              const platform = PLATFORM_LABELS[c.platform] ?? c.platform;
              return {
                id: c.id,
                cells: {
                  name: c.name,
                  platform,
                  status: <StatusBadge kind="connection" value={c.status} />,
                  sync: c.lastSyncAt ? fmtDate(c.lastSyncAt) : "—",
                },
                sortValues: { status: statusLabel("connection", c.status) },
                detailTitle: c.name,
                detailDescription: `${platform} · ${c.currency}`,
                detail: (
                  <div className="space-y-6">
                    <DetailList>
                      <DetailRow label="Plateforme">{platform}</DetailRow>
                      <DetailRow label="Devise">{c.currency}</DetailRow>
                      <DetailRow label="État">
                        <StatusBadge kind="connection" value={c.status} />
                      </DetailRow>
                      <DetailRow label="Dernière synchro">
                        {c.lastSyncAt
                          ? `${fmtDate(c.lastSyncAt)} · ${fmtNum(c.lastSyncRows)} lignes`
                          : "Jamais"}
                      </DetailRow>
                      {c.lastError ? (
                        <DetailRow label="Dernière erreur">
                          <span className="text-danger">{c.lastError}</span>
                        </DetailRow>
                      ) : null}
                    </DetailList>
                    {PLATFORM_PAGES[c.platform] ? (
                      <Link
                        href={PLATFORM_PAGES[c.platform]!}
                        className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
                      >
                        Gérer les comptes {platform}
                      </Link>
                    ) : null}
                  </div>
                ),
              };
            })}
            empty={{
              title: "Aucun compte publicitaire connecté",
              description:
                "Ouvrez Meta ou TikTok ci-dessus pour brancher vos comptes : les dépenses arriveront ensuite toutes seules.",
            }}
          />
        </FormSection>

        <FormSection
          title="Réglages des chiffres"
          description="Ce qui sert à convertir les dépenses et à ranger les membres par niveau de dépense."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <form
              action={saveRatesAction}
              className="space-y-3 rounded-xl border border-border bg-card p-4"
            >
              <h3 className="text-body font-semibold text-foreground">Taux de change</h3>
              <div className="space-y-2">
                <Label htmlFor="rates">
                  Taux saisis (pour les comptes qui ne sont pas en euros)
                </Label>
                <Input
                  id="rates"
                  name="rates"
                  defaultValue={manualRates.map(([k, v]) => `${k}=${v}`).join(", ")}
                  placeholder="USD=1.08, GBP=0.85"
                  autoComplete="off"
                />
                <p className="text-note text-muted-foreground">
                  Combien d&apos;unités pour 1 € (ex. USD=1.08). Ceux de Link Affi sont lus toutes
                  les 6 heures ; ceux saisis ici passent avant.
                  {importedRates.length
                    ? ` Taux Link Affi : ${importedRates.map(([k, v]) => `${k} ${v}`).join(", ")}.`
                    : " Aucun taux Link Affi reçu pour l'instant."}
                </p>
              </div>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Enregistrer les taux
              </Button>
            </form>

            <form
              action={saveSpendThresholdsAction}
              className="space-y-3 rounded-xl border border-border bg-card p-4"
            >
              <h3 className="text-body font-semibold text-foreground">Niveaux de dépense</h3>
              <p className="text-note text-muted-foreground">
                Aucun → Inscrit → Déposant (premier dépôt) → Régulier (dépôts répétés) → VIP (dépôts
                cumulés au-dessus du seuil). Ils servent de filtre dans Membres, Écrire à un groupe
                et Relances automatiques.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="vip">Seuil VIP (dépôts cumulés, en €)</Label>
                  <Input
                    id="vip"
                    name="vip"
                    type="number"
                    min={0}
                    step={10}
                    defaultValue={thresholds.vip}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="regularDeposits">Dépôts pour devenir « Régulier »</Label>
                  <Input
                    id="regularDeposits"
                    name="regularDeposits"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={thresholds.regularDeposits}
                  />
                </div>
              </div>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Enregistrer les seuils
              </Button>
            </form>
          </div>
        </FormSection>

        <AdvancedSection
          title="Avancé : détail de la synchro Link Affi"
          description={
            hasKeys
              ? "État de chaque donnée lue chez Link Affi, et resynchronisation complète."
              : "Aucun passage enregistré : la première synchro (tout l'historique) démarre dans les 2 minutes."
          }
          defaultOpen={syncErrors > 0}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-note text-muted-foreground">
              Les données sont relues toutes les 2 minutes, par fenêtre de dates avec un léger
              chevauchement pour ne rien manquer. Si une donnée reste en erreur, cliquez sur
              « Synchroniser Link Affi » ; si l&apos;erreur persiste, prévenez l&apos;administrateur
              technique.
            </p>
            <form action={syncNowAction}>
              <input type="hidden" name="full" value="1" />
              <ConfirmSubmit
                size="sm"
                variant="outline"
                className="max-md:h-10"
                confirmTitle="Tout resynchroniser ?"
                message="Toutes les données Link Affi seront relues depuis le début : cela peut prendre plusieurs minutes et ralentir le site pendant ce temps."
              >
                Tout resynchroniser
              </ConfirmSubmit>
            </form>
          </div>
          <DataTable
            label="État de chaque donnée Link Affi"
            columns={[
              { key: "table", header: "Donnée", className: "min-w-36 whitespace-normal" },
              { key: "status", header: "État" },
              { key: "success", header: "Dernier succès", hideOnMobile: true },
              { key: "rows", header: "Lignes importées", align: "right", hideOnMobile: true },
              { key: "error", header: "Erreur", sortable: false, hideOnMobile: true },
            ]}
            rows={SYNC_TABLES.map((t) => {
              const s = byTable.get(t.table);
              const status: SyncStatus = !s
                ? "never"
                : s.isRunning
                  ? "running"
                  : s.lastError
                    ? "error"
                    : s.lastSuccessAt
                      ? "ok"
                      : "never";
              const label = linkAffiTableLabel(t.table);
              return {
                id: t.table,
                cells: {
                  table: label,
                  status: <StatusBadge kind="sync" value={status} />,
                  success: fmtDate(s?.lastSuccessAt),
                  rows: fmtNum(s?.rowsImported ?? 0),
                  error: s?.lastError ? (
                    <span
                      className="block max-w-56 truncate text-note text-danger"
                      title={s.lastError}
                    >
                      {s.lastError}
                    </span>
                  ) : (
                    "—"
                  ),
                },
                sortValues: { status: statusLabel("sync", status) },
                detailTitle: label,
                detail: (
                  <DetailList>
                    <DetailRow label="Nom technique" mono>
                      {t.table}
                      {t.dateCol ? ` · ${t.dateCol}` : " · complète"}
                    </DetailRow>
                    <DetailRow label="État">
                      <StatusBadge kind="sync" value={status} />
                    </DetailRow>
                    <DetailRow label="Dernière exécution">{fmtDate(s?.lastRunAt)}</DetailRow>
                    <DetailRow label="Dernier succès">{fmtDate(s?.lastSuccessAt)}</DetailRow>
                    <DetailRow label="Lignes importées">{fmtNum(s?.rowsImported ?? 0)}</DetailRow>
                    <DetailRow label="Erreur">
                      {s?.lastError ? <span className="text-danger">{s.lastError}</span> : "—"}
                    </DetailRow>
                  </DetailList>
                ),
              };
            })}
          />
          <p className="text-note text-muted-foreground">
            Message technique sur l&apos;<Term term="sub-ID">identifiant de suivi</Term> :{" "}
            {health.message}
          </p>
        </AdvancedSection>
      </div>
    </>
  );
}
