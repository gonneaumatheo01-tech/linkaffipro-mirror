import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { maskPhone, TELEGRAM_USER_API_SETTING, parseTelegramUserApi } from "@linkaffipro/mtproto";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { getTelegramSessionView, getViewsFloodUntil } from "@/lib/views/session";
import {
  checkPasswordAction,
  disconnectAction,
  pollNowAction,
  saveUserApiAction,
  sendCodeAction,
  signInAction,
} from "./actions";

export const metadata: Metadata = { title: "Telegram (vues et transferts)" };

/**
 * Réglages → Connexions → Telegram : le compte Telegram qui lit les vues et les transferts des messages publiés.
 * Deux réglages, une seule fois : l'application (my.telegram.org), puis le compte (numéro, code, mot de passe si la
 * validation en deux étapes est activée). L'application déjà enregistrée se replie dans « Avancé ». Un seul bouton
 * orange : celui de l'étape en cours. Lecture seule pour un MANAGER.
 */
export default async function TelegramConnectorPage({
  searchParams,
}: PageProps<"/settings/connectors/telegram">) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const sp = await searchParams;
  const [apiRow, session, floodUntil, lastSample, followed] = await Promise.all([
    prisma.setting.findUnique({ where: { key: TELEGRAM_USER_API_SETTING } }),
    getTelegramSessionView(),
    getViewsFloodUntil(),
    prisma.postViewSample.findFirst({ orderBy: { at: "desc" }, select: { at: true } }),
    prisma.post.count({ where: { status: "SENT", viewsNextAt: { not: null } } }),
  ]);
  const api = parseTelegramUserApi(apiRow?.value);
  const status = session?.status ?? "DISCONNECTED";
  const canStart = !session || status === "DISCONNECTED" || status === "ERROR";

  const appGuide = (
    <>
      <ol className="list-decimal space-y-1 pl-5 text-body text-muted-foreground">
        <li>
          Ouvrez{" "}
          <a
            href="https://my.telegram.org"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            https://my.telegram.org
          </a>{" "}
          et connectez-vous avec le numéro du compte qui possède les canaux (un code arrive dans
          Telegram).
        </li>
        <li>Cliquez « API development tools ».</li>
        <li>
          Créez une application : nom « LinkAffi Pro », plateforme « Web », adresse ci-dessous. Les
          autres champs peuvent rester vides.
        </li>
        <li>
          Copiez « App api_id » et « App api_hash » dans les deux champs ci-dessous, puis
          « Enregistrer ».
        </li>
      </ol>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-body leading-tight font-medium text-foreground">
            Nom de l&apos;application
          </p>
          <CopyField value="LinkAffi Pro" label="Nom de l'application" />
        </div>
        <div className="space-y-2">
          <p className="text-body leading-tight font-medium text-foreground">Adresse (URL)</p>
          <CopyField value="https://app.linkaffipro.com" label="Adresse (URL)" />
        </div>
      </div>
      {isAdmin ? (
        <form
          action={saveUserApiAction}
          className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"
        >
          <div className="space-y-2">
            <Label htmlFor="apiId">App api_id</Label>
            <Input
              id="apiId"
              name="apiId"
              inputMode="numeric"
              placeholder="1234567"
              defaultValue={api?.apiId ?? ""}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiHash">App api_hash</Label>
            <Input
              id="apiHash"
              name="apiHash"
              type="password"
              autoComplete="off"
              placeholder={
                api ? "Ressaisissez le hash pour le modifier" : "0123456789abcdef0123456789abcdef"
              }
              required
              aria-describedby="apiHash-aide"
            />
          </div>
          <Button type="submit" variant={api ? "outline" : "default"} className="max-md:h-10">
            Enregistrer
          </Button>
          <p id="apiHash-aide" className="text-note text-muted-foreground sm:col-span-3">
            Le hash fait 32 caractères (lettres a à f et chiffres). Il est chiffré et jamais
            réaffiché.
          </p>
        </form>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        backHref="/settings/connectors"
        backLabel="Connexions"
        title="Telegram (vues et transferts)"
        description="Le compte Telegram propriétaire des canaux lit le nombre de vues et de transferts de chaque message publié : toutes les 15 minutes pendant 48 h, puis une fois par jour pendant 30 jours."
        help={
          isAdmin
            ? "Deux réglages, une seule fois : l'application Telegram (my.telegram.org), puis le compte (numéro, code reçu dans Telegram, mot de passe si besoin). Ensuite tout est automatique."
            : "Lecture seule : seul un administrateur peut connecter ou déconnecter le compte Telegram."
        }
        meta={<StatusBadge kind="telegramSession" value={status} />}
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <FormSection
          title="1. Application Telegram"
          description="Telegram demande une « application » pour autoriser la lecture des vues. Elle se crée en 2 minutes et ne sert qu'à ça."
          actions={
            api ? (
              <StatusPill tone="success">Enregistrée</StatusPill>
            ) : (
              <StatusPill tone="muted">Non renseignée</StatusPill>
            )
          }
        >
          {api ? (
            <>
              <p className="text-body text-muted-foreground">
                api_id {api.apiId}, api_hash enregistré (chiffré)
                {apiRow ? `, le ${fmtDate(apiRow.updatedAt)}` : ""}.
              </p>
              <AdvancedSection
                title="Modifier l'application Telegram"
                description="Seulement si vous avez recréé l'application sur my.telegram.org."
              >
                {appGuide}
              </AdvancedSection>
            </>
          ) : (
            appGuide
          )}
        </FormSection>

        <FormSection
          title="2. Compte Telegram"
          description="Ce compte sert uniquement à lire le nombre de vues des messages de vos canaux ; il doit en être administrateur."
        >
          <DetailList className="max-w-2xl">
            <DetailRow label="État">
              <StatusBadge kind="telegramSession" value={status} />
            </DetailRow>
            <DetailRow label="Numéro">
              <span className="tabular-nums">
                {session?.phone ? maskPhone(session.phone) : "—"}
              </span>
            </DetailRow>
            <DetailRow label="Connecté">
              {session && status === "ACTIVE"
                ? `le ${fmtDate(session.updatedAt)}${session.connectedByName ? ` par ${session.connectedByName}` : ""}`
                : "—"}
            </DetailRow>
            <DetailRow label="Dernier relevé">
              {lastSample ? fmtDate(lastSample.at) : "—"}
              {session?.lastUsedAt ? (
                <span className="text-muted-foreground">
                  {" "}
                  (dernier accès Telegram : {fmtDate(session.lastUsedAt)})
                </span>
              ) : null}
            </DetailRow>
            <DetailRow label="Messages suivis">
              <span className="tabular-nums">{fmtNum(followed)}</span>
            </DetailRow>
            {session?.lastError ? (
              <DetailRow label="Dernière erreur">
                <span className="text-danger">{session.lastError}</span>
              </DetailRow>
            ) : null}
            {floodUntil ? (
              <DetailRow label="Pause">
                Telegram demande d&apos;attendre : reprise automatique le {fmtDate(floodUntil)}.
              </DetailRow>
            ) : null}
          </DetailList>

          {status === "ERROR" ? (
            <Alert variant="destructive">
              <AlertTitle>Compte à reconnecter</AlertTitle>
              <AlertDescription>
                Telegram n&apos;accepte plus la session (fermée depuis l&apos;application ou
                expirée). Recommencez l&apos;étape « Numéro de téléphone » ci-dessous.
              </AlertDescription>
            </Alert>
          ) : null}

          {isAdmin && canStart ? (
            <form
              action={sendCodeAction}
              className="space-y-3 rounded-xl border border-border bg-card p-4"
            >
              <h3 className="text-body font-semibold text-foreground">
                Numéro de téléphone du compte
              </h3>
              {!api ? (
                <p className="text-body text-muted-foreground">
                  Renseignez d&apos;abord l&apos;application Telegram (étape 1).
                </p>
              ) : null}
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-2">
                  <Label htmlFor="phone">Numéro (format international)</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    placeholder="+33 6 12 34 56 78"
                    className="w-56"
                    required
                    disabled={!api}
                  />
                </div>
                <Button
                  type="submit"
                  variant={api ? "default" : "outline"}
                  className="max-md:h-10"
                  disabled={!api}
                >
                  Envoyer le code
                </Button>
              </div>
              <p className="text-note text-muted-foreground">
                Telegram envoie un code dans l&apos;application (pas par SMS). Gardez votre
                téléphone à portée de main.
              </p>
            </form>
          ) : null}

          {isAdmin && status === "PENDING_CODE" ? (
            <form
              action={signInAction}
              className="space-y-3 rounded-xl border border-border bg-card p-4"
            >
              <h3 className="text-body font-semibold text-foreground">Code reçu dans Telegram</h3>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="12345"
                    className="w-32"
                    required
                  />
                </div>
                <Button type="submit" className="max-md:h-10">
                  Valider le code
                </Button>
                <Button
                  type="submit"
                  variant="ghost"
                  className="max-md:h-10"
                  formAction={disconnectAction}
                >
                  Recommencer
                </Button>
              </div>
              <p className="text-note text-muted-foreground">
                Le code arrive dans un message de « Telegram » sur le téléphone connecté au numéro{" "}
                {session?.phone ? maskPhone(session.phone) : ""}. Il expire au bout de quelques
                minutes.
              </p>
            </form>
          ) : null}

          {isAdmin && status === "PENDING_PASSWORD" ? (
            <form
              action={checkPasswordAction}
              className="space-y-3 rounded-xl border border-border bg-card p-4"
            >
              <h3 className="text-body font-semibold text-foreground">
                Mot de passe de validation en deux étapes
              </h3>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="off"
                    className="w-56"
                    required
                  />
                </div>
                <Button type="submit" className="max-md:h-10">
                  Connecter
                </Button>
                <Button
                  type="submit"
                  variant="ghost"
                  className="max-md:h-10"
                  formAction={disconnectAction}
                >
                  Recommencer
                </Button>
              </div>
              <p className="text-note text-muted-foreground">
                C&apos;est le mot de passe défini dans Telegram → Réglages → Confidentialité et
                sécurité → Validation en deux étapes. Il n&apos;est pas conservé.
              </p>
            </form>
          ) : null}

          {isAdmin && status === "ACTIVE" ? (
            <div className="flex flex-wrap gap-2">
              <form action={pollNowAction}>
                <Button type="submit" variant="outline" className="max-md:h-10">
                  Relever maintenant
                </Button>
              </form>
              <form action={disconnectAction}>
                <ConfirmSubmit
                  variant="destructive"
                  className="max-md:h-10"
                  confirmTitle="Déconnecter le compte Telegram ?"
                  confirmLabel="Déconnecter"
                  message="La session sera révoquée et les vues ne seront plus relevées jusqu'à une nouvelle connexion."
                >
                  Déconnecter
                </ConfirmSubmit>
              </form>
            </div>
          ) : null}
          {isAdmin && status === "ERROR" ? (
            <form action={disconnectAction}>
              <Button type="submit" variant="outline" className="max-md:h-10">
                Effacer la session
              </Button>
            </form>
          ) : null}
        </FormSection>

        <FormSection title="Ce que ça change">
          <div className="max-w-3xl space-y-2 text-body text-muted-foreground">
            <p>
              Chaque message envoyé par la plateforme reçoit un relevé de vues et de transferts
              toutes les 15 minutes pendant 48 h, puis une fois par jour jusqu&apos;à 30 jours ; les
              messages des 30 derniers jours sont repris à la connexion.
            </p>
            <p>
              Les vues apparaissent dans la fiche de chaque message (courbe dans le temps), et
              servent au taux de clic par vue, aux meilleurs horaires et aux tests A/B.
            </p>
            <p>
              Rien n&apos;est écrit ni envoyé depuis ce compte : lecture seule, un seul relevé à la
              fois, en respectant les limites de Telegram. La session est chiffrée ; « Déconnecter »
              la révoque.
            </p>
          </div>
        </FormSection>
      </div>
    </>
  );
}
