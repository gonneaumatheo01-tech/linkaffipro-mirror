import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { maskPhone, TELEGRAM_USER_API_SETTING, parseTelegramUserApi } from "@linkaffipro/mtproto";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { HelpTip } from "@/components/admin/help-tip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <>
      <PageHeader
        title="Telegram (vues et transferts)"
        description="Connexion d'un compte Telegram (le propriétaire des canaux) pour lire le nombre de vues et de transferts de chaque message publié. Relevé toutes les 15 minutes pendant 48 h après l'envoi, puis une fois par jour pendant 30 jours."
        help="Deux réglages, une seule fois : l'application Telegram (my.telegram.org), puis le compte (numéro, code reçu dans Telegram, mot de passe si la validation en deux étapes est activée). Ensuite tout est automatique."
      >
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings/connectors" />}
        >
          ← Connexions
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      {!isAdmin ? (
        <Alert className="mb-4">
          <AlertTitle>Lecture seule</AlertTitle>
          <AlertDescription>
            Seul un administrateur peut connecter ou déconnecter le compte Telegram.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Application Telegram (my.telegram.org)</CardTitle>
            <CardDescription>
              Telegram demande une « application » pour autoriser la lecture des vues. Elle se crée
              en 2 minutes et ne sert qu&apos;à ça.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              État :{" "}
              {api ? (
                <>
                  <StatusBadge kind="active" value="active" />{" "}
                  <span className="text-muted-foreground">
                    api_id {api.apiId}, api_hash enregistré (chiffré)
                    {apiRow ? `, le ${fmtDate(apiRow.updatedAt)}` : ""}
                  </span>
                </>
              ) : (
                <>
                  <StatusBadge kind="active" value="inactive" />{" "}
                  <span className="text-muted-foreground">non renseignée</span>
                </>
              )}
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Ouvrez{" "}
                <a
                  href="https://my.telegram.org"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  https://my.telegram.org
                </a>{" "}
                et connectez-vous avec le numéro du compte qui possède les canaux (un code arrive
                dans Telegram).
              </li>
              <li>Cliquez « API development tools ».</li>
              <li>
                Créez une application : nom « LinkAffi Pro », plateforme « Web », URL ci-dessous.
                Les autres champs peuvent rester vides.
              </li>
              <li>
                Copiez « App api_id » et « App api_hash » dans les deux champs ci-dessous, puis «
                Enregistrer ».
              </li>
            </ol>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">Nom de l&apos;application</Label>
                <CopyField value="LinkAffi Pro" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">URL</Label>
                <CopyField value="https://app.linkaffipro.com" />
              </div>
            </div>
            {isAdmin ? (
              <form
                action={saveUserApiAction}
                className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
              >
                <div className="space-y-1">
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
                <div className="space-y-1">
                  <Label htmlFor="apiHash">
                    App api_hash{" "}
                    <HelpTip label="Aide : api_hash">
                      32 caractères (lettres a-f et chiffres). Il est chiffré en base et n&apos;est
                      jamais réaffiché.
                    </HelpTip>
                  </Label>
                  <Input
                    id="apiHash"
                    name="apiHash"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      api
                        ? "Ressaisissez le hash pour le modifier"
                        : "0123456789abcdef0123456789abcdef"
                    }
                    required
                  />
                </div>
                <Button type="submit" size="sm" className="max-md:h-10">
                  Enregistrer
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compte Telegram (vues et transferts)</CardTitle>
            <CardDescription>
              Ce compte sert uniquement à lire le nombre de vues des messages de vos canaux ; il
              doit en être administrateur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">État</dt>
              <dd>
                <StatusBadge kind="telegramSession" value={status} />
              </dd>
              <dt className="text-muted-foreground">Numéro</dt>
              <dd className="tabular-nums">{session?.phone ? maskPhone(session.phone) : "—"}</dd>
              <dt className="text-muted-foreground">Connecté</dt>
              <dd>
                {session && status === "ACTIVE"
                  ? `le ${fmtDate(session.updatedAt)}${session.connectedByName ? ` par ${session.connectedByName}` : ""}`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Dernier relevé</dt>
              <dd>
                {lastSample ? fmtDate(lastSample.at) : "aucun"}
                {session?.lastUsedAt ? (
                  <span className="text-muted-foreground">
                    {" "}
                    (dernier accès Telegram : {fmtDate(session.lastUsedAt)})
                  </span>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">Messages suivis</dt>
              <dd className="tabular-nums">{fmtNum(followed)}</dd>
              {session?.lastError ? (
                <>
                  <dt className="text-muted-foreground">Dernière erreur</dt>
                  <dd className="text-destructive">{session.lastError}</dd>
                </>
              ) : null}
              {floodUntil ? (
                <>
                  <dt className="text-muted-foreground">Pause</dt>
                  <dd>
                    Telegram demande d&apos;attendre : reprise automatique le {fmtDate(floodUntil)}.
                  </dd>
                </>
              ) : null}
            </dl>

            {status === "ERROR" ? (
              <Alert variant="destructive">
                <AlertTitle>Compte à reconnecter</AlertTitle>
                <AlertDescription>
                  Telegram n&apos;accepte plus la session (fermée depuis l&apos;application ou
                  expirée). Recommencez l&apos;étape 1 ci-dessous.
                </AlertDescription>
              </Alert>
            ) : null}

            {isAdmin && canStart ? (
              <form action={sendCodeAction} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Étape 1 : numéro de téléphone du compte</p>
                {!api ? (
                  <p className="text-sm text-muted-foreground">
                    Renseignez d&apos;abord l&apos;application Telegram (bloc de gauche).
                  </p>
                ) : null}
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
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
                  <Button type="submit" size="sm" className="max-md:h-10" disabled={!api}>
                    Envoyer le code
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Telegram envoie un code dans l&apos;application (pas par SMS). Gardez votre
                  téléphone à portée de main.
                </p>
              </form>
            ) : null}

            {isAdmin && status === "PENDING_CODE" ? (
              <form action={signInAction} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Étape 2 : code reçu dans Telegram</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
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
                  <Button type="submit" size="sm" className="max-md:h-10">
                    Valider le code
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    className="max-md:h-10"
                    formAction={disconnectAction}
                  >
                    Recommencer
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Le code arrive dans un message de « Telegram » sur le téléphone connecté au numéro{" "}
                  {session?.phone ? maskPhone(session.phone) : ""}. Il expire au bout de quelques
                  minutes.
                </p>
              </form>
            ) : null}

            {isAdmin && status === "PENDING_PASSWORD" ? (
              <form action={checkPasswordAction} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  Étape 3 : mot de passe de validation en deux étapes
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
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
                  <Button type="submit" size="sm" className="max-md:h-10">
                    Connecter
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    className="max-md:h-10"
                    formAction={disconnectAction}
                  >
                    Recommencer
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  C&apos;est le mot de passe défini dans Telegram → Réglages → Confidentialité et
                  sécurité → Validation en deux étapes. Il n&apos;est pas conservé.
                </p>
              </form>
            ) : null}

            {isAdmin && status === "ACTIVE" ? (
              <div className="flex flex-wrap gap-2">
                <form action={pollNowAction}>
                  <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                    Relever maintenant
                  </Button>
                </form>
                <form action={disconnectAction}>
                  <ConfirmSubmit
                    size="sm"
                    variant="destructive"
                    className="max-md:h-10"
                    message="Déconnecter le compte Telegram ? La session sera révoquée et les vues ne seront plus relevées jusqu'à une nouvelle connexion."
                  >
                    Déconnecter
                  </ConfirmSubmit>
                </form>
              </div>
            ) : null}
            {isAdmin && status === "ERROR" ? (
              <form action={disconnectAction}>
                <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                  Effacer la session
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Ce que ça change</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>
            Chaque message envoyé par la plateforme reçoit un relevé de vues et de transferts toutes
            les 15 minutes pendant 48 h, puis une fois par jour jusqu&apos;à 30 jours ; les messages
            des 30 derniers jours sont repris à la connexion.
          </p>
          <p>
            Les vues apparaissent dans la fiche de chaque message (courbe dans le temps), et servent
            au taux de clic par vue, aux meilleurs horaires et aux tests A/B.
          </p>
          <p>
            Rien n&apos;est écrit ni envoyé depuis ce compte : lecture seule, un seul relevé à la
            fois, en respectant les limites de Telegram. La session est chiffrée en base ; «
            Déconnecter » la révoque.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
