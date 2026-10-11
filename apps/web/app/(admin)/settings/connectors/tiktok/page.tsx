import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { AdAccountsTable } from "@/components/settings/ad-accounts-table";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadAppState, redirectUriFor } from "@/lib/connectors/common";
import { fmtDate } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { TikTokAppGuide } from "./guide";
import {
  connectSandboxAction,
  disconnectTikTokAction,
  saveTikTokAppAction,
  syncTikTokNowAction,
  verifyTikTokAppAction,
} from "./actions";

export const metadata: Metadata = { title: "Connexions — TikTok" };

const START_URL = "/api/connectors/tiktok/start";

/**
 * Réglages → Connexions → TikTok : comptes publicitaires connectés (tableau + volet de détail avec les actions),
 * application TikTok (identifiants, mode bac à sable dans « Avancé »), connexion d'un compte de test en mode bac à
 * sable, guide de création replié une fois l'application enregistrée. Lecture seule pour un MANAGER. Un seul bouton
 * orange : « Connecter un compte TikTok » quand l'application est prête, sinon « Enregistrer » l'application.
 */
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
  const canConnect = appReady && !sandbox;
  const redirectUri = redirectUriFor("TIKTOK");
  const now = new Date();
  const notConnectableReason = sandbox
    ? "En mode bac à sable, connectez le compte de test avec le formulaire « Compte de test »."
    : "Enregistrez d'abord l'application TikTok.";

  const appState = !app ? (
    <StatusPill tone="muted">Non enregistrée</StatusPill>
  ) : app.verifiedAt ? (
    <StatusPill tone="success">Vérifiée le {fmtDate(app.verifiedAt)}</StatusPill>
  ) : app.lastError ? (
    <StatusPill tone="danger">Vérification en échec</StatusPill>
  ) : (
    <StatusPill tone="warning">Enregistrée, à vérifier</StatusPill>
  );

  const accountsSection = (
    <FormSection
      title="Comptes TikTok connectés"
      description="Chaque compte est relu toutes les heures (3 derniers jours) et chaque nuit (28 jours). Déconnecter efface l'accès ; les dépenses déjà importées restent."
    >
      <AdAccountsTable
        platform="TIKTOK"
        accounts={connections}
        isAdmin={isAdmin}
        now={now}
        syncAction={syncTikTokNowAction}
        disconnectAction={disconnectTikTokAction}
        reconnect={canConnect ? { href: START_URL } : { disabledReason: notConnectableReason }}
        syncWhen="active"
        disconnectMessage={(name) =>
          `L'accès du compte « ${name} » sera effacé : plus aucune dépense ne sera lue pour ce compte. Les chiffres déjà importés restent.`
        }
        empty={{
          title: "Aucun compte TikTok connecté",
          description: appReady
            ? sandbox
              ? "Mode bac à sable : collez le jeton et l'identifiant du compte de test dans « Compte de test » ci-dessous."
              : "Cliquez sur « Connecter un compte TikTok », acceptez sur la page TikTok, puis cochez les comptes à suivre."
            : "Commencez par enregistrer l'application TikTok.",
        }}
      />
    </FormSection>
  );

  const appSection = (
    <FormSection
      title="Application TikTok"
      description="Les identifiants de l'application développeur créée sur business-api.tiktok.com, une seule fois. Le secret est chiffré et jamais réaffiché."
      actions={
        <>
          {appState}
          {sandbox ? <StatusPill tone="info">Mode bac à sable</StatusPill> : null}
        </>
      }
    >
      {app?.lastError ? (
        <Alert variant="destructive">
          <AlertTitle>TikTok refuse ces identifiants</AlertTitle>
          <AlertDescription>{app.lastError}</AlertDescription>
        </Alert>
      ) : null}
      {isAdmin ? (
        <form action={saveTikTokAppAction} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
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
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret">Secret</Label>
              <Input
                id="secret"
                name="secret"
                type="password"
                autoComplete="new-password"
                placeholder={
                  app?.hasSecret ? "•••••••• (inchangé si vide)" : "Secret de l'application"
                }
                required={!app?.hasSecret}
              />
              <p className="text-note text-muted-foreground">
                Collez-le une fois ; laissez vide ensuite pour le garder tel quel.
              </p>
            </div>
          </div>
          <AdvancedSection
            description="Mode bac à sable, pour tester avant la validation de l'application."
            modifiedCount={sandbox ? 1 : 0}
          >
            <label className="flex items-start gap-3">
              <Checkbox name="sandbox" value="1" defaultChecked={sandbox} className="mt-0.5" />
              <span>
                Mode bac à sable (sandbox)
                <span className="block text-note text-muted-foreground">
                  Pour tester avec un compte de test TikTok avant la validation de
                  l&apos;application. Décochez pour les vrais comptes.
                </span>
              </span>
            </label>
          </AdvancedSection>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={canConnect ? "outline" : "default"}
              className="max-md:h-10"
            >
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
        <DetailList>
          <DetailRow label="App ID" mono>
            {app?.clientId ?? "—"}
          </DetailRow>
          <DetailRow label="Secret">{app?.hasSecret ? "Enregistré" : "—"}</DetailRow>
        </DetailList>
      )}
    </FormSection>
  );

  const sandboxSection =
    isAdmin && sandbox ? (
      <FormSection
        title="Compte de test (bac à sable)"
        description="En mode bac à sable, TikTok ne propose pas de page de connexion : collez le jeton généré dans le portail (Tools → Sandbox → Generate Access Token) et l'identifiant d'annonceur de test. Le jeton est chiffré, jamais réaffiché."
      >
        <form action={connectSandboxAction} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="token">Jeton (Access Token) du bac à sable</Label>
              <Input id="token" name="token" type="password" autoComplete="off" required />
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
              />
            </div>
          </div>
          <Button type="submit" variant="outline" className="max-md:h-10">
            Connecter le compte de test
          </Button>
        </form>
      </FormSection>
    ) : null;

  return (
    <>
      <PageHeader
        backHref="/settings/connectors"
        backLabel="Connexions"
        title="TikTok Ads"
        description="Vos comptes publicitaires TikTok, connectés une fois : les dépenses, impressions et clics de chaque pub arrivent ensuite tout seuls dans Campagnes (onglet Pubs), par jour, en devise du compte et en euros."
        help={
          !isAdmin
            ? "Lecture seule : seul un administrateur peut enregistrer l'application ou connecter un compte."
            : appReady
              ? "L'application est enregistrée : cliquez sur « Connecter un compte TikTok » et cochez les comptes à suivre."
              : "Première fois : créez l'application TikTok (guide en bas de page, 10 minutes), collez l'App ID et le Secret, puis Enregistrer et Vérifier."
        }
        primaryAction={
          isAdmin && canConnect ? (
            <a href={START_URL} className={cn(buttonVariants(), "max-md:h-10")}>
              <Plus aria-hidden />
              Connecter un compte TikTok
            </a>
          ) : undefined
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        {appReady ? (
          <>
            {accountsSection}
            {sandboxSection}
            {appSection}
          </>
        ) : (
          <>
            {appSection}
            {accountsSection}
          </>
        )}
        <AdvancedSection
          title="Créer l'application TikTok (10 minutes, puis 1 à 2 semaines de validation)"
          description="Le pas-à-pas sur le portail développeur TikTok, avec les valeurs exactes à copier."
          defaultOpen={isAdmin && !appReady}
        >
          <TikTokAppGuide redirectUri={redirectUri} />
        </AdvancedSection>
      </div>
    </>
  );
}
