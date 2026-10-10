import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { AdAccountsTable } from "@/components/settings/ad-accounts-table";
import { DetailList, DetailRow } from "@/components/settings/detail-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { loadAppState, redirectUriFor } from "@/lib/connectors/common";
import { requireUser } from "@/lib/session";
import {
  disconnectMetaConnectionAction,
  saveMetaAppAction,
  syncMetaConnectionAction,
  verifyMetaAppAction,
} from "./actions";
import { MetaAppGuide } from "./guide";

export const metadata: Metadata = { title: "Connexions · Meta Ads" };
export const dynamic = "force-dynamic";

const START_URL = "/api/connectors/meta/start";

/**
 * Réglages → Connexions → Meta : comptes publicitaires connectés (tableau + volet de détail avec les actions),
 * application Meta (identifiants, config_id dans « Avancé »), guide de création replié une fois l'application
 * enregistrée. Lecture seule pour un MANAGER. Un seul bouton orange : « Connecter un compte Meta » quand
 * l'application est prête, sinon « Enregistrer » l'application.
 */
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

  const appState = !app ? (
    <StatusPill tone="muted">Non enregistrée</StatusPill>
  ) : app.verifiedAt ? (
    <StatusPill tone="success">Vérifiée le {fmtDate(app.verifiedAt)}</StatusPill>
  ) : app.lastError ? (
    <StatusPill tone="danger">Vérification refusée</StatusPill>
  ) : (
    <StatusPill tone="warning">Enregistrée, à vérifier</StatusPill>
  );

  const accountsSection = (
    <FormSection
      title="Comptes Meta connectés"
      description="Chaque compte est relu toutes les heures (3 derniers jours) et chaque nuit sur 28 jours, car Meta corrige ses chiffres après coup. Ouvrez un compte pour le détail."
    >
      <AdAccountsTable
        platform="META"
        accounts={connections}
        isAdmin={isAdmin}
        now={now}
        syncAction={syncMetaConnectionAction}
        disconnectAction={disconnectMetaConnectionAction}
        reconnect={{ href: START_URL }}
        syncWhen="notDisabled"
        disconnectMessage={(name) =>
          `Le compte « ${name} » ne sera plus synchronisé et son accès sera effacé. Les dépenses déjà importées restent.`
        }
        empty={{
          title: "Aucun compte Meta connecté",
          description: isAdmin
            ? appReady
              ? "Cliquez sur « Connecter un compte Meta » : Facebook s'ouvre, vous acceptez l'accès, puis vous cochez les comptes à suivre."
              : "Créez d'abord l'application Meta (guide ci-dessous), enregistrez ses identifiants, puis connectez vos comptes."
            : "Un administrateur doit connecter les comptes publicitaires.",
        }}
      />
    </FormSection>
  );

  const appSection = (
    <FormSection
      title="Application Meta"
      description="Les identifiants de l'application créée sur developers.facebook.com, une seule fois. Le secret est chiffré et jamais réaffiché."
      actions={appState}
    >
      {app?.lastError ? (
        <Alert variant="destructive">
          <AlertTitle>Meta refuse ces identifiants</AlertTitle>
          <AlertDescription>{app.lastError}</AlertDescription>
        </Alert>
      ) : app && !app.verifiedAt ? (
        <p className="text-note text-muted-foreground">
          Cliquez sur « Vérifier » pour tester les identifiants auprès de Meta, sans rien connecter.
        </p>
      ) : null}
      {isAdmin ? (
        <form action={saveMetaAppAction} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="clientId">App ID (identifiant de l&apos;application)</Label>
              <Input
                id="clientId"
                name="clientId"
                inputMode="numeric"
                autoComplete="off"
                required
                defaultValue={app?.clientId ?? ""}
                placeholder="1234567890123456"
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
                  app?.hasSecret ? "•••••••• (laisser vide = inchangé)" : "Collez la clé secrète"
                }
                required={!app?.hasSecret}
              />
            </div>
          </div>
          <AdvancedSection
            description="Seulement si votre application utilise une configuration de connexion."
            modifiedCount={configId ? 1 : 0}
          >
            <div className="space-y-2">
              <Label htmlFor="configId">config_id (facultatif)</Label>
              <Input
                id="configId"
                name="configId"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={configId}
                placeholder="Vide dans la plupart des cas"
                className="md:max-w-sm"
              />
              <p className="text-note text-muted-foreground">
                Si l&apos;application utilise « Facebook Login for Business » avec une
                configuration, Meta affiche un « ID de configuration » : collez-le ici. Sinon,
                laissez vide.
              </p>
            </div>
          </AdvancedSection>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={appReady ? "outline" : "default"}
              className="max-md:h-10"
            >
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
        <DetailList>
          <DetailRow label="App ID" mono>
            {app?.clientId ?? "—"}
          </DetailRow>
          <DetailRow label="App Secret">{app?.hasSecret ? "Enregistré" : "—"}</DetailRow>
          <DetailRow label="config_id" mono>
            {configId || "—"}
          </DetailRow>
        </DetailList>
      )}
    </FormSection>
  );

  return (
    <>
      <PageHeader
        backHref="/settings/connectors"
        backLabel="Connexions"
        title="Meta Ads"
        description="Vos comptes publicitaires Facebook et Instagram : les dépenses, impressions, clics et résultats de chaque pub arrivent tout seuls dans Campagnes (onglet Pubs), chaque heure."
        help={
          isAdmin
            ? appReady
              ? "Cliquez sur « Connecter un compte Meta », acceptez l'accès sur Facebook, puis cochez les comptes à suivre."
              : "Première fois : créez l'application Meta (guide en bas de page, 10 minutes), enregistrez son App ID et son App Secret, puis connectez un compte."
            : "Lecture seule : seuls les administrateurs peuvent enregistrer l'application ou connecter des comptes."
        }
        primaryAction={
          isAdmin && appReady ? (
            <a href={START_URL} className={cn(buttonVariants(), "max-md:h-10")}>
              <Plus aria-hidden />
              Connecter un compte Meta
            </a>
          ) : undefined
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        {appReady ? (
          <>
            {accountsSection}
            {appSection}
          </>
        ) : (
          <>
            {appSection}
            {accountsSection}
          </>
        )}
        <AdvancedSection
          title="Créer l'application Meta (une seule fois, 10 minutes)"
          description="Le pas-à-pas sur developers.facebook.com, avec les valeurs exactes à copier."
          defaultOpen={isAdmin && !appReady}
        >
          <MetaAppGuide
            redirectUri={redirectUriFor("META")}
            appDomain={appHost}
            privacyUrl={`${env.appBaseUrl}/privacy`}
            termsUrl={`${env.appBaseUrl}/terms`}
          />
        </AdvancedSection>
      </div>
    </>
  );
}
