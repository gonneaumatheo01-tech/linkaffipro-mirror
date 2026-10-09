import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { SYNC_TABLES } from "@linkaffipro/linkaffi";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { computeSubIdHealth } from "./health";
import { saveSpendThresholdsAction, syncNowAction } from "./actions";

export const metadata: Metadata = { title: "Connecteurs" };

const TABLE_LABELS: Record<string, string> = {
  casinos: "Programmes (casinos)",
  campaigns: "Campagnes / liens Link Affi",
  currency_rates: "Taux de change",
  players: "Joueurs",
  player_events: "Événements joueurs",
  player_financials: "Commissions (CPA)",
  revshare_snapshots: "NGR par joueur",
  deposit_snapshots: "Dépôts cumulés",
  ftd_invalidations: "FTD annulés",
  clicks: "Clics Link Affi (sub-ID)",
};

export default async function ConnectorsPage({ searchParams }: PageProps<"/settings/connectors">) {
  await requireAdminPage();
  const sp = await searchParams;
  const [states, health, thresholdSetting, counts] = await Promise.all([
    prisma.syncState.findMany(),
    computeSubIdHealth(),
    prisma.setting.findUnique({ where: { key: "spend.thresholds" } }),
    Promise.all([prisma.affiliateProgram.count(), prisma.affiliateCampaign.count(), prisma.player.count(), prisma.playerEvent.count()]),
  ]);
  const byTable = new Map(states.map((s) => [s.source, s]));
  const thresholds = { vip: 500, regularDeposits: 3, ...((thresholdSetting?.value as { vip?: number; regularDeposits?: number } | null) ?? {}) };
  const hasKeys = states.length > 0;
  const healthVariant = health.status === "alert" ? "destructive" : "default";

  return (
    <>
      <PageHeader title="Connecteurs" description="Synchronisation Link Affi (lecture seule, toutes les 2 minutes) et santé du sub-ID.">
        <Button variant="ghost" size="sm" render={<Link href="/settings" />}>← Réglages</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {[
          { label: "Programmes", value: counts[0] },
          { label: "Campagnes", value: counts[1] },
          { label: "Joueurs", value: counts[2] },
          { label: "Événements joueurs", value: counts[3] },
        ].map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold tabular-nums">{fmtNum(t.value)}</p></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Link Affi — état par table</CardTitle>
            <CardDescription>{hasKeys ? "Le worker lit l’API toutes les 2 minutes par fenêtre de dates (chevauchement de 15 minutes)." : "Aucun passage enregistré pour l’instant : le worker démarre la première synchronisation (historique complet) dans les 2 minutes."}</CardDescription>
          </div>
          <div className="flex gap-2">
            <form action={syncNowAction}><Button type="submit" size="sm">Synchroniser maintenant</Button></form>
            <form action={syncNowAction}><input type="hidden" name="full" value="1" /><Button type="submit" size="sm" variant="outline">Resynchroniser tout</Button></form>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Dernière exécution</TableHead>
                <TableHead>Dernier succès</TableHead>
                <TableHead className="text-right">Lignes importées</TableHead>
                <TableHead>Erreur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SYNC_TABLES.map((t) => {
                const s = byTable.get(t.table);
                const status = !s ? "jamais" : s.isRunning ? "en cours" : s.lastError ? "erreur" : s.lastSuccessAt ? "ok" : "jamais";
                return (
                  <TableRow key={t.table}>
                    <TableCell><div className="font-medium">{TABLE_LABELS[t.table] ?? t.table}</div><div className="font-mono text-[11px] text-muted-foreground">{t.table}{t.dateCol ? ` · ${t.dateCol}` : " · complète"}</div></TableCell>
                    <TableCell>{status === "ok" ? <Badge>ok</Badge> : status === "erreur" ? <Badge variant="destructive">erreur</Badge> : status === "en cours" ? <Badge variant="outline">en cours</Badge> : <Badge variant="secondary">jamais</Badge>}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(s?.lastRunAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(s?.lastSuccessAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(s?.rowsImported ?? 0)}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-destructive" title={s?.lastError ?? ""}>{s?.lastError ?? ""}</TableCell>
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
            <CardTitle className="text-base">Santé du sub-ID (7 derniers jours)</CardTitle>
            <CardDescription>Le sub-ID relie chaque inscription au membre et au message d&apos;origine. Il doit revenir par postback.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant={healthVariant}>
              <AlertTitle>{health.status === "ok" ? "OK" : health.status === "alert" ? "Alerte" : health.status === "warning" ? "À surveiller" : "En attente"}</AlertTitle>
              <AlertDescription>{health.message}</AlertDescription>
            </Alert>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Joueurs rattachés par postback</dt><dd className="text-xl font-semibold tabular-nums">{fmtNum(health.postback)}</dd></div>
              <div><dt className="text-muted-foreground">Joueurs rattachés par rapprochement horaire</dt><dd className="text-xl font-semibold tabular-nums">{fmtNum(health.timeMatch)}</dd></div>
              <div><dt className="text-muted-foreground">Joueurs sans sub-ID malgré des clics</dt><dd className="text-xl font-semibold tabular-nums">{fmtNum(health.missingWithClicks)}</dd></div>
              <div><dt className="text-muted-foreground">Clics d&apos;offre avec sub-ID envoyés</dt><dd className="text-xl font-semibold tabular-nums">{fmtNum(health.offerClicks)}</dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Niveaux de dépense</CardTitle>
            <CardDescription>Aucun → Inscrit → Déposant (FTD) → Régulier (dépôts répétés) → VIP (dépôts cumulés au-dessus du seuil).</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveSpendThresholdsAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="vip">Seuil VIP (dépôts cumulés, en €)</Label>
                <Input id="vip" name="vip" type="number" min={0} step={10} defaultValue={thresholds.vip} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regularDeposits">Nombre de dépôts pour « Régulier »</Label>
                <Input id="regularDeposits" name="regularDeposits" type="number" min={1} step={1} defaultValue={thresholds.regularDeposits} />
              </div>
              <Button type="submit">Enregistrer</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
