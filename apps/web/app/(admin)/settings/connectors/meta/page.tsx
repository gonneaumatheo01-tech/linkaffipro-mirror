import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { env } from "@/lib/env";
import { fmtDate, fmtDateShort, fmtNum } from "@/lib/format";
import { loadAppState, redirectUriFor } from "@/lib/connectors/common";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import {
  disconnectMetaConnectionAction,
  saveMetaAppAction,
  syncMetaConnectionAction,
  verifyMetaAppAction,
} from "./actions";
import { MetaAppGuide } from "./guide";

export const metadata: Metadata = { title: "Connecteurs · Meta Ads" };
export const dynamic = "force-dynamic";

const START_URL = "/api/connectors/meta/start";

function runStatus(status: string): "ok" | "error" | "running" | "never" {
  return status === "ok" || status === "error" || status === "running" ? status : "never";
}

export default async function MetaConnectorPage({
  searchParams,
}: PageProps<"/settings/connectors/meta">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  const [app, connections] = await Promise.all([
    loadAppState("META"),
    prisma.adAccountConnection.findMany({
      where: { platform: "META" },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        connectedBy: { select: { name: true } },
        runs: { orderBy: { startedAt: "desc" }, take: 5 },
      },
    }),
  ]);
  const appReady = Boolean(app?.clientId && app.hasSecret);
  const configId = typeof app?.extra.configId === "string" ? app.extra.configId : "";
  const appHost = env.appBaseUrl.replace(/^https?:\/\//, "");
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86400_000);

  return (
    <>
      <PageHeader
        title="Connecteurs · Meta Ads"
        description="Connectez vos comptes publicitaires Facebook / Instagram : les dépenses, impressions, clics et résultats de chaque pub arrivent automatiquement dans Campagnes (onglet Pubs), chaque heure."
        help={
          isAdmin
            ? "Première fois : créez l'application Meta (guide en bas de page, 10 minutes), enregistrez son App ID et son App Secret, puis cliquez sur « Connecter un compte Meta »."
            : "Lecture seule : seuls les administrateurs peuvent enregistrer l'application ou connecter des comptes."
        }
      >
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings/connectors" />}
        >
          ← Connecteurs
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Application Meta</CardTitle>
            <CardDescription>
              Identifiants de l&apos;application créée sur developers.facebook.com (une seule fois).
              Le secret est chiffré en base et jamais réaffiché.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {app ? (
              <Alert variant={app.lastError ? "destructive" : "default"}>
                <AlertTitle>
                  {app.verifiedAt
                    ? `Vérifiée le ${fmtDate(app.verifiedAt)}`
                    : app.lastError
                      ? "Vérification refusée"
                      : "Enregistrée, pas encore vérifiée"}
                </AlertTitle>
                <AlertDescription>
                  {app.lastError
                    ? app.lastError
                    : app.verifiedAt
                      ? "Les identifiants sont acceptés par Meta. Vous pouvez connecter des comptes."
                      : "Cliquez sur « Vérifier » pour tester les identifiants auprès de Meta (sans rien connecter)."}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertTitle>Aucune application enregistrée</AlertTitle>
                <AlertDescription>
                  Suivez le guide ci-dessous pour créer l&apos;application Meta, puis collez ici son
                  App ID et son App Secret.
                </AlertDescription>
              </Alert>
            )}

            {isAdmin ? (
              <form action={saveMetaAppAction} className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="clientId">App ID (ID de l&apos;app)</Label>
                  <Input
                    id="clientId"
                    name="clientId"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    defaultValue={app?.clientId ?? ""}
                    placeholder="1234567890123456"
                    className="h-10 md:h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secret">App Secret (clé secrète)</Label>
                  <Input
                    id="secret"
                    name="secret"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      app?.hasSecret
                        ? "•••••••• (laisser vide = inchangé)"
                        : "Collez la clé secrète"
                    }
                    required={!app?.hasSecret}
                    className="h-10 md:h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="configId" className="flex items-center gap-1">
                    config_id (optionnel)
                    <HelpTip>
                      Seulement si votre app utilise « Facebook Login for Business » avec une
                      configuration : Meta affiche alors un « ID de configuration ». Laissez vide
                      sinon.
                    </HelpTip>
                  </Label>
                  <Input
                    id="configId"
                    name="configId"
                    inputMode="numeric"
                    autoComplete="off"
                    defaultValue={configId}
                    placeholder="Vide dans la plupart des cas"
                    className="h-10 md:h-9"
                  />
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-3">
                  <Button type="submit" className="max-md:h-10">
                    Enregistrer
                  </Button>
                  <Button
                    type="submit"
                    variant="outline"
                    className="max-md:h-10"
                    formAction={verifyMetaAppAction}
                    disabled={!appReady}
                  >
                    Vérifier
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="grid gap-2 text-sm md:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">App ID</dt>
                  <dd className="font-mono">{app?.clientId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">App Secret</dt>
                  <dd>{app?.hasSecret ? "Enregistré" : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">config_id</dt>
                  <dd className="font-mono">{configId || "—"}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Comptes Meta connectés</CardTitle>
              <CardDescription>
                Chaque compte est relu toutes les heures (3 derniers jours) et chaque nuit sur 28
                jours, car Meta corrige ses chiffres après coup. Plusieurs comptes et plusieurs
                Business Manager possibles.
              </CardDescription>
            </div>
            {isAdmin ? (
              appReady ? (
                <Button className="max-md:h-10" render={<a href={START_URL} />}>
                  Connecter un compte Meta
                </Button>
              ) : (
                <div className="text-right">
                  <Button className="max-md:h-10" disabled>
                    Connecter un compte Meta
                  </Button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enregistrez d&apos;abord l&apos;application Meta.
                  </p>
                </div>
              )
            ) : null}
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <EmptyState
                title="Aucun compte Meta connecté"
                description={
                  isAdmin
                    ? appReady
                      ? "Cliquez sur « Connecter un compte Meta » : Facebook s'ouvre, vous acceptez l'accès, puis vous cochez les comptes à suivre."
                      : "Créez d'abord l'application Meta (guide ci-dessous), enregistrez ses identifiants, puis connectez vos comptes."
                    : "Un administrateur doit connecter les comptes publicitaires."
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Compte</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="hidden md:table-cell">Jeton expire le</TableHead>
                    <TableHead className="hidden lg:table-cell">Dernière synchro</TableHead>
                    <TableHead className="hidden lg:table-cell">Erreur</TableHead>
                    {isAdmin ? <TableHead className="text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((c) => {
                    const expiring = c.tokenExpiresAt && c.tokenExpiresAt < soon;
                    return [
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            <span className="font-mono">{c.externalId}</span> · {c.currency}
                            {c.businessName ? ` · ${c.businessName}` : ""}
                            {c.connectedBy ? ` · connecté par ${c.connectedBy.name}` : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge kind="connection" value={c.status} />
                        </TableCell>
                        <TableCell
                          className={`hidden whitespace-nowrap md:table-cell ${expiring && c.status === "ACTIVE" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
                        >
                          {c.status === "DISABLED" ? "—" : fmtDateShort(c.tokenExpiresAt, now)}
                          {expiring && c.status === "ACTIVE" ? " (renouvellement automatique)" : ""}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                          {c.lastSyncAt
                            ? `${fmtDate(c.lastSyncAt)} · ${fmtNum(c.lastSyncRows)} lignes`
                            : "Jamais"}
                        </TableCell>
                        <TableCell
                          className="hidden max-w-xs truncate text-xs text-destructive lg:table-cell"
                          title={c.lastError ?? ""}
                        >
                          {c.lastError ?? ""}
                        </TableCell>
                        {isAdmin ? (
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {c.status !== "DISABLED" ? (
                                <>
                                  <form action={syncMetaConnectionAction}>
                                    <input type="hidden" name="connectionId" value={c.id} />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      variant="outline"
                                      className="max-md:h-10"
                                    >
                                      Synchroniser maintenant
                                    </Button>
                                  </form>
                                  <form action={syncMetaConnectionAction}>
                                    <input type="hidden" name="connectionId" value={c.id} />
                                    <input type="hidden" name="mode" value="full" />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      variant="outline"
                                      className="max-md:h-10"
                                    >
                                      Resynchroniser 28 jours
                                    </Button>
                                  </form>
                                </>
                              ) : null}
                              <Button
                                size="sm"
                                variant={c.status === "NEEDS_RECONNECT" ? "default" : "outline"}
                                className="max-md:h-10"
                                render={<a href={START_URL} />}
                              >
                                Reconnecter
                              </Button>
                              {c.status !== "DISABLED" ? (
                                <form action={disconnectMetaConnectionAction}>
                                  <input type="hidden" name="connectionId" value={c.id} />
                                  <ConfirmSubmit
                                    size="sm"
                                    variant="destructive"
                                    className="max-md:h-10"
                                    message={`Le compte « ${c.name} » ne sera plus synchronisé et son jeton sera effacé. Les dépenses déjà importées restent. Continuer ?`}
                                  >
                                    Déconnecter
                                  </ConfirmSubmit>
                                </form>
                              ) : null}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>,
                      c.runs.length > 0 ? (
                        <TableRow key={`${c.id}-runs`} className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={isAdmin ? 6 : 5} className="py-2">
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              5 dernières synchronisations
                            </p>
                            <ul className="space-y-0.5 text-xs">
                              {c.runs.map((r) => (
                                <li key={r.id} className="flex flex-wrap items-center gap-2">
                                  <span className="whitespace-nowrap text-muted-foreground">
                                    {fmtDate(r.startedAt)}
                                  </span>
                                  <span className="whitespace-nowrap">
                                    {fmtDateShort(r.dateFrom, now)} → {fmtDateShort(r.dateTo, now)}
                                  </span>
                                  <span className="tabular-nums">{fmtNum(r.rows)} lignes</span>
                                  <StatusBadge kind="sync" value={runStatus(r.status)} />
                                  {r.error ? (
                                    <span
                                      className={
                                        r.status === "error"
                                          ? "text-destructive"
                                          : "text-amber-700 dark:text-amber-300"
                                      }
                                      title={r.error}
                                    >
                                      {r.error}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      ) : null,
                    ];
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <MetaAppGuide
          redirectUri={redirectUriFor("META")}
          appDomain={appHost}
          privacyUrl={`${env.appBaseUrl}/privacy`}
          termsUrl={`${env.appBaseUrl}/terms`}
        />
      </div>
    </>
  );
}
