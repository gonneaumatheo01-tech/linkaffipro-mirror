import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { loadAppState, redirectUriFor } from "@/lib/connectors/common";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { TikTokAppGuide } from "./guide";
import {
  connectSandboxAction,
  disconnectTikTokAction,
  saveTikTokAppAction,
  syncTikTokNowAction,
  verifyTikTokAppAction,
} from "./actions";

export const metadata: Metadata = { title: "Connecteurs — TikTok" };

const RUN_LABEL: Record<string, string> = { ok: "ok", error: "error", running: "running" };

export default async function TikTokConnectorPage({
  searchParams,
}: PageProps<"/settings/connectors/tiktok">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  const [app, connections] = await Promise.all([
    loadAppState("TIKTOK"),
    prisma.adAccountConnection.findMany({
      where: { platform: "TIKTOK" },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: {
        connectedBy: { select: { name: true } },
        runs: { orderBy: { startedAt: "desc" }, take: 5 },
      },
    }),
  ]);
  const sandbox = Boolean((app?.extra as { sandbox?: boolean } | undefined)?.sandbox);
  const appReady = Boolean(app?.clientId && app.hasSecret);
  const redirectUri = redirectUriFor("TIKTOK");
  const inputCls = "h-10 md:h-9";

  return (
    <>
      <PageHeader
        title="Connecteur TikTok Ads"
        description="Vos comptes publicitaires TikTok, connectés une fois : les dépenses, impressions et clics de chaque pub arrivent ensuite toutes seules dans le module Pubs, par jour, en devise du compte et en euros."
        help={
          appReady
            ? "L'application est enregistrée : cliquez sur « Connecter un compte TikTok » et cochez les comptes à suivre."
            : "Première fois : créez l'application TikTok (guide ci-dessous, 10 minutes), collez l'App ID et le Secret, puis Enregistrer et Vérifier."
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
      {!isAdmin ? (
        <Alert className="mb-4">
          <AlertDescription>
            Lecture seule : seul un administrateur peut enregistrer l&apos;application ou connecter
            un compte.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Application TikTok</CardTitle>
            <CardDescription>
              Identifiants de l&apos;application développeur créée sur business-api.tiktok.com (une
              seule fois). Le secret est chiffré et jamais réaffiché.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">État :</span>
              {!app ? (
                <Badge variant="secondary">Non enregistrée</Badge>
              ) : app.verifiedAt ? (
                <Badge variant="outline">Vérifiée le {fmtDate(app.verifiedAt)}</Badge>
              ) : app.lastError ? (
                <Badge variant="destructive">Vérification en échec</Badge>
              ) : (
                <Badge variant="default">Enregistrée, à vérifier</Badge>
              )}
              {sandbox ? <Badge variant="outline">Mode bac à sable</Badge> : null}
            </div>
            {app?.lastError ? <p className="text-xs text-destructive">{app.lastError}</p> : null}
            {isAdmin ? (
              <form action={saveTikTokAppAction} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="clientId">App ID</Label>
                  <Input
                    id="clientId"
                    name="clientId"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    defaultValue={app?.clientId ?? ""}
                    placeholder="7123456789012345678"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secret" className="flex items-center gap-1">
                    Secret{" "}
                    <HelpTip>
                      Collez-le une fois ; laissez vide ensuite pour le garder tel quel.
                    </HelpTip>
                  </Label>
                  <Input
                    id="secret"
                    name="secret"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      app?.hasSecret ? "•••••••• (inchangé si vide)" : "Secret de l'application"
                    }
                    required={!app?.hasSecret}
                    className={inputCls}
                  />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="sandbox"
                    value="1"
                    defaultChecked={sandbox}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    Mode bac à sable (sandbox)
                    <span className="block text-xs text-muted-foreground">
                      Pour tester avec un compte de test TikTok avant la validation de
                      l&apos;application. Décochez pour les vrais comptes.
                    </span>
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" className="max-md:h-10">
                    Enregistrer
                  </Button>
                  <Button
                    type="submit"
                    variant="outline"
                    className="max-md:h-10"
                    formAction={verifyTikTokAppAction}
                    disabled={!appReady}
                  >
                    Vérifier
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">App ID</dt>
                <dd className="font-mono">{app?.clientId ?? "—"}</dd>
                <dt className="text-muted-foreground">Secret</dt>
                <dd>{app?.hasSecret ? "enregistré" : "—"}</dd>
              </dl>
            )}
            <TikTokAppGuide redirectUri={redirectUri} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Comptes TikTok connectés</CardTitle>
                <CardDescription>
                  Chaque compte est relu toutes les heures (3 derniers jours) et chaque nuit (28
                  jours). Déconnecter efface le jeton ; les dépenses déjà importées restent.
                </CardDescription>
              </div>
              {isAdmin ? (
                appReady && !sandbox ? (
                  <Button
                    size="sm"
                    className="max-md:h-10"
                    render={<a href="/api/connectors/tiktok/start" />}
                  >
                    Connecter un compte TikTok
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="max-md:h-10"
                    disabled
                    title={
                      sandbox
                        ? "En mode bac à sable, utilisez le formulaire ci-dessous."
                        : "Enregistrez d'abord l'application."
                    }
                  >
                    Connecter un compte TikTok
                  </Button>
                )
              ) : null}
            </CardHeader>
            <CardContent>
              {connections.length === 0 ? (
                <EmptyState
                  title="Aucun compte TikTok connecté"
                  description={
                    appReady
                      ? sandbox
                        ? "Mode bac à sable : collez le jeton et l'identifiant du compte de test ci-dessous."
                        : "Cliquez sur « Connecter un compte TikTok », acceptez sur la page TikTok, puis cochez les comptes à suivre."
                      : "Commencez par enregistrer l'application TikTok (bloc de gauche)."
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Compte</TableHead>
                      <TableHead className="hidden md:table-cell">Devise</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="hidden lg:table-cell">Dernière synchro</TableHead>
                      {isAdmin ? <TableHead className="text-right">Actions</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {connections.map((c) => (
                      <TableRow key={c.id} className="align-top">
                        <TableCell>
                          <div className="font-medium">{c.name}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {c.externalId}
                            {c.businessName ? ` · ${c.businessName}` : ""}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Connecté par {c.connectedBy?.name ?? "—"} le {fmtDate(c.createdAt)}
                            {c.scopes === "sandbox" ? " · bac à sable" : ""}
                          </div>
                          {c.lastError ? (
                            <p
                              className="mt-1 max-w-md text-xs text-destructive"
                              title={c.lastError}
                            >
                              {c.lastError}
                            </p>
                          ) : null}
                          {c.runs.length > 0 ? (
                            <details className="mt-1 text-xs">
                              <summary className="cursor-pointer text-muted-foreground">
                                Dernières synchronisations ({c.runs.length})
                              </summary>
                              <ul className="mt-1 space-y-0.5">
                                {c.runs.map((r) => (
                                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                                    <StatusBadge
                                      kind="sync"
                                      value={RUN_LABEL[r.status] ?? "never"}
                                    />
                                    <span className="whitespace-nowrap text-muted-foreground">
                                      {fmtDate(r.startedAt)}
                                    </span>
                                    <span className="whitespace-nowrap">
                                      {r.dateFrom.toISOString().slice(0, 10)} →{" "}
                                      {r.dateTo.toISOString().slice(0, 10)}
                                    </span>
                                    <span className="tabular-nums">{fmtNum(r.rows)} lignes</span>
                                    {r.error ? (
                                      <span className="text-destructive" title={r.error}>
                                        {r.error.slice(0, 80)}
                                      </span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {c.currency}
                          {c.timezone ? (
                            <div className="text-[11px] text-muted-foreground">{c.timezone}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge kind="connection" value={c.status} />
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                          {c.lastSyncAt ? (
                            <>
                              {fmtDate(c.lastSyncAt)}
                              <div className="text-[11px]">{fmtNum(c.lastSyncRows)} lignes</div>
                            </>
                          ) : (
                            "jamais"
                          )}
                        </TableCell>
                        {isAdmin ? (
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {c.status === "ACTIVE" ? (
                                <>
                                  <form action={syncTikTokNowAction}>
                                    <input type="hidden" name="connectionId" value={c.id} />
                                    <input type="hidden" name="mode" value="recent" />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      variant="outline"
                                      className="max-md:h-10"
                                    >
                                      Synchroniser maintenant
                                    </Button>
                                  </form>
                                  <form action={syncTikTokNowAction}>
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
                              {appReady && !sandbox ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="max-md:h-10"
                                  render={<a href="/api/connectors/tiktok/start" />}
                                >
                                  Reconnecter
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="max-md:h-10"
                                  disabled
                                  title={
                                    sandbox
                                      ? "En mode bac à sable, utilisez le formulaire ci-dessous."
                                      : "Enregistrez d'abord l'application."
                                  }
                                >
                                  Reconnecter
                                </Button>
                              )}
                              {c.status !== "DISABLED" ? (
                                <form action={disconnectTikTokAction}>
                                  <input type="hidden" name="connectionId" value={c.id} />
                                  <ConfirmSubmit
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive max-md:h-10"
                                    message={`Le jeton du compte « ${c.name} » sera effacé : plus aucune dépense ne sera lue pour ce compte. Les chiffres déjà importés restent. Continuer ?`}
                                  >
                                    Déconnecter
                                  </ConfirmSubmit>
                                </form>
                              ) : null}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {isAdmin && sandbox ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connecter un compte bac à sable</CardTitle>
                <CardDescription>
                  En mode bac à sable, TikTok ne propose pas de page de connexion : collez le jeton
                  généré dans le portail (Tools → Sandbox → Generate Access Token) et
                  l&apos;identifiant d&apos;annonceur de test. Le jeton est chiffré, jamais
                  réaffiché.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form action={connectSandboxAction} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="token">Jeton (Access Token) du bac à sable</Label>
                    <Input
                      id="token"
                      name="token"
                      type="password"
                      autoComplete="off"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="advertiserIds">
                      Identifiant(s) d&apos;annonceur de test (Advertiser ID)
                    </Label>
                    <Input
                      id="advertiserIds"
                      name="advertiserIds"
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      placeholder="7000000000000000000"
                      className={inputCls}
                    />
                  </div>
                  <Button type="submit" className="max-md:h-10">
                    Connecter le compte de test
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
