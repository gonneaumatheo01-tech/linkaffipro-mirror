import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { SYNC_TABLES } from "@linkaffipro/linkaffi";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { HelpTip } from "@/components/admin/help-tip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseRates } from "@linkaffipro/connectors";
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
import { fmtDate, fmtNum } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { computeSubIdHealth } from "./health";
import { saveRatesAction, saveSpendThresholdsAction, syncNowAction } from "./actions";

export const metadata: Metadata = { title: "Connecteurs" };

const TABLE_LABELS: Record<string, string> = {
  casinos: "Programmes (casinos)",
  campaigns: "Campagnes / liens Link Affi",
  currency_rates: "Taux de change",
  players: "Joueurs",
  player_events: "Événements joueurs",
  player_financials: "Commissions (CPA)",
  revshare_snapshots: "Revenu net (NGR) par joueur",
  deposit_snapshots: "Dépôts cumulés",
  ftd_invalidations: "Premiers dépôts (FTD) annulés",
  clicks: "Clics Link Affi (identifiant de suivi)",
};

export default async function ConnectorsPage({ searchParams }: PageProps<"/settings/connectors">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [states, health, thresholdSetting, counts, connections, ratesImported, ratesManual, telegramSession] = await Promise.all([
    prisma.syncState.findMany(),
    computeSubIdHealth(),
    prisma.setting.findUnique({ where: { key: "spend.thresholds" } }),
    Promise.all([
      prisma.affiliateProgram.count(),
      prisma.affiliateCampaign.count(),
      prisma.player.count(),
      prisma.playerEvent.count(),
    ]),
    prisma.adAccountConnection.findMany({ orderBy: [{ platform: "asc" }, { name: "asc" }], select: { id: true, platform: true, name: true, status: true, currency: true, lastSyncAt: true, lastSyncRows: true, lastError: true } }),
    prisma.setting.findUnique({ where: { key: "currency.rates.imported" } }),
    prisma.setting.findUnique({ where: { key: "currency.rates.manual" } }),
    prisma.telegramUserSession.findUnique({ where: { id: "main" }, select: { status: true, phone: true, lastUsedAt: true, lastError: true } }),
  ]);
  const manualRates = Object.entries(parseRates(ratesManual?.value));
  const importedRates = Object.entries(parseRates(ratesImported?.value)).filter(([k]) => k !== "EUR");
  const byTable = new Map(states.map((s) => [s.source, s]));
  const thresholds = {
    vip: 500,
    regularDeposits: 3,
    ...((thresholdSetting?.value as { vip?: number; regularDeposits?: number } | null) ?? {}),
  };
  const hasKeys = states.length > 0;
  const healthVariant = health.status === "alert" ? "destructive" : "default";

  return (
    <>
      <PageHeader
        title="Connecteurs"
        description="Tout ce qui alimente la plateforme automatiquement : Link Affi (joueurs, dépôts, revenus, toutes les 2 minutes), vos comptes publicitaires Meta et TikTok (dépenses, chaque heure) et votre compte Telegram (vues des messages)."
        help="Rien à faire au quotidien. Si une table est en erreur, cliquez sur « Synchroniser maintenant » ; si l'erreur persiste, prévenez l'administrateur technique."
      >
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings" />}
        >
          ← Réglages
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Comptes publicitaires et compte Telegram</CardTitle>
          <CardDescription>
            Branchez vous-même vos comptes Meta Ads et TikTok Ads (les dépenses arrivent toutes seules dans Pubs) et votre compte Telegram (nombre de vues par message). La création des applications développeur est expliquée pas à pas sur chaque page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { href: "/settings/connectors/meta", label: "Meta (Facebook / Instagram)", count: connections.filter((c) => c.platform === "META").length },
              { href: "/settings/connectors/tiktok", label: "TikTok Ads", count: connections.filter((c) => c.platform === "TIKTOK").length },
              { href: "/settings/connectors/telegram", label: "Telegram (vues des messages)", count: telegramSession?.status === "ACTIVE" ? 1 : 0 },
            ].map((x) => (
              <Button key={x.href} variant="outline" className="h-auto justify-between py-3 max-md:h-12" render={<Link href={x.href} />}>
                <span>{x.label}</span>
                <span className="text-xs text-muted-foreground">{x.count} connecté{x.count > 1 ? "s" : ""}</span>
              </Button>
            ))}
          </div>
          {connections.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Compte</TableHead>
                  <TableHead className="hidden md:table-cell">Plateforme</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead className="hidden md:table-cell">Dernière synchro</TableHead>
                  <TableHead className="hidden lg:table-cell">Dernière erreur</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/settings/connectors/${c.platform.toLowerCase()}`} className="underline-offset-2 hover:underline">
                        {c.name}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">({c.currency})</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{c.platform === "META" ? "Meta" : c.platform === "TIKTOK" ? "TikTok" : c.platform}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "ACTIVE" ? "default" : c.status === "NEEDS_RECONNECT" ? "destructive" : "secondary"}>
                        {c.status === "ACTIVE" ? "Connecté" : c.status === "NEEDS_RECONNECT" ? "À reconnecter" : "Déconnecté"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{c.lastSyncAt ? `${fmtDate(c.lastSyncAt)} · ${fmtNum(c.lastSyncRows)} lignes` : "jamais"}</TableCell>
                    <TableCell className="hidden max-w-xs truncate text-xs text-muted-foreground lg:table-cell" title={c.lastError ?? ""}>{c.lastError ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun compte publicitaire connecté pour l&apos;instant.</p>
          )}
          <form action={saveRatesAction} className="space-y-2 rounded-md border p-3">
            <div className="text-sm font-medium">Taux de change (pour les comptes qui ne sont pas en euros)</div>
            <p className="text-xs text-muted-foreground">
              Taux « combien d&apos;unités pour 1 € » (ex. USD 1,08). Les taux de Link Affi sont lus automatiquement toutes les 6 heures ; ceux que vous saisissez ici ont priorité.
              {importedRates.length ? ` Taux Link Affi : ${importedRates.map(([k, v]) => `${k} ${v}`).join(", ")}.` : " Aucun taux Link Affi reçu pour l'instant."}
            </p>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                name="rates"
                defaultValue={manualRates.map(([k, v]) => `${k}=${v}`).join(", ")}
                placeholder="USD=1.08, GBP=0.85"
                aria-label="Taux de change saisis"
                className="h-9 rounded-md border bg-background px-3 text-sm"
              />
              <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                Enregistrer les taux
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Programmes", value: counts[0] },
          { label: "Campagnes", value: counts[1] },
          { label: "Joueurs", value: counts[2] },
          { label: "Événements joueurs", value: counts[3] },
        ].map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{fmtNum(t.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Link Affi — état par table</CardTitle>
            <CardDescription>
              {hasKeys
                ? "Les données sont relues toutes les 2 minutes, par fenêtre de dates avec un léger chevauchement pour ne rien manquer."
                : "Aucun passage enregistré pour l’instant : la première synchronisation (historique complet) démarre dans les 2 minutes."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={syncNowAction}>
              <Button type="submit" size="sm" className="max-md:h-10">
                Synchroniser maintenant
              </Button>
            </form>
            <form action={syncNowAction}>
              <input type="hidden" name="full" value="1" />
              <ConfirmSubmit
                size="sm"
                variant="outline"
                className="max-md:h-10"
                message="Toutes les tables Link Affi seront relues depuis le début : cela peut prendre plusieurs minutes et ralentir le site pendant ce temps. Continuer ?"
              >
                Tout resynchroniser
              </ConfirmSubmit>
            </form>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden lg:table-cell">Dernière exécution</TableHead>
                <TableHead className="hidden md:table-cell">Dernier succès</TableHead>
                <TableHead className="hidden text-right md:table-cell">Lignes importées</TableHead>
                <TableHead>Erreur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SYNC_TABLES.map((t) => {
                const s = byTable.get(t.table);
                const status = !s
                  ? "never"
                  : s.isRunning
                    ? "running"
                    : s.lastError
                      ? "error"
                      : s.lastSuccessAt
                        ? "ok"
                        : "never";
                return (
                  <TableRow key={t.table}>
                    <TableCell>
                      <div className="font-medium">{TABLE_LABELS[t.table] ?? t.table}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {t.table}
                        {t.dateCol ? ` · ${t.dateCol}` : " · complète"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind="sync" value={status} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                      {fmtDate(s?.lastRunAt)}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                      {fmtDate(s?.lastSuccessAt)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {fmtNum(s?.rowsImported ?? 0)}
                    </TableCell>
                    <TableCell
                      className="max-w-xs truncate text-xs text-destructive"
                      title={s?.lastError ?? ""}
                    >
                      {s?.lastError ?? ""}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Santé de l&apos;identifiant de suivi (sub-ID), 7 derniers jours
            </CardTitle>
            <CardDescription>
              L&apos;identifiant de suivi (sub-ID) est ajouté à chaque clic sur une offre ; il relie
              l&apos;inscription du joueur au membre et au message d&apos;origine. Il doit revenir
              par postback (appel automatique du partenaire) ou par la synchronisation Link Affi.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant={healthVariant}>
              <AlertTitle>
                {health.status === "ok"
                  ? "Tout va bien"
                  : health.status === "alert"
                    ? "Alerte"
                    : health.status === "warning"
                      ? "À surveiller"
                      : "En attente de données"}
              </AlertTitle>
              <AlertDescription>{health.message}</AlertDescription>
            </Alert>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Joueurs rattachés par postback</dt>
                <dd className="text-xl font-semibold tabular-nums">{fmtNum(health.postback)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-muted-foreground">
                  Rattachés par rapprochement horaire{" "}
                  <HelpTip>
                    Quand l&apos;identifiant de suivi manque, on rattache le joueur au clic le plus
                    proche dans le temps. Moins fiable : à surveiller si ce chiffre grimpe.
                  </HelpTip>
                </dt>
                <dd className="text-xl font-semibold tabular-nums">{fmtNum(health.timeMatch)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Joueurs sans identifiant malgré des clics</dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {fmtNum(health.missingWithClicks)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Clics d&apos;offre avec identifiant envoyés
                </dt>
                <dd className="text-xl font-semibold tabular-nums">{fmtNum(health.offerClicks)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Niveaux de dépense</CardTitle>
            <CardDescription>
              Aucun → Inscrit → Déposant (premier dépôt) → Régulier (dépôts répétés) → VIP (dépôts
              cumulés au-dessus du seuil). Ces niveaux servent de filtre dans Membres, Envois et
              Automatisations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveSpendThresholdsAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="vip">Seuil VIP (dépôts cumulés, en €)</Label>
                <Input
                  id="vip"
                  name="vip"
                  type="number"
                  min={0}
                  step={10}
                  defaultValue={thresholds.vip}
                  className="h-10 md:h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regularDeposits">Nombre de dépôts pour devenir « Régulier »</Label>
                <Input
                  id="regularDeposits"
                  name="regularDeposits"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={thresholds.regularDeposits}
                  className="h-10 md:h-9"
                />
              </div>
              <Button type="submit" className="max-md:h-10">
                Enregistrer
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
