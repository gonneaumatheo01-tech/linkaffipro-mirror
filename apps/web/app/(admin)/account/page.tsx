import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { ROLE_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { restartTourAction } from "@/lib/onboarding/actions";
import { requireUser } from "@/lib/session";
import { changePasswordAction, generateTelegramLinkAction, unlinkTelegramAction } from "./actions";

export const metadata: Metadata = { title: "Mon compte" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const me = await requireUser();
  const sp = await searchParams;
  const [user, bots] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: me.id },
      select: { telegramLinkToken: true, telegramUserId: true },
    }),
    prisma.bot.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { username: true, name: true },
    }),
  ]);
  return (
    <>
      <PageHeader
        title="Mon compte"
        description={`${me.name} · ${me.email} · ${ROLE_LABELS[me.role]}`}
        help="Changez votre mot de passe et liez votre compte Telegram : il sert aux tests (« Envoyer un test sur mon Telegram », « Tester sur moi ») et aux alertes."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Changer le mot de passe</CardTitle>
            <CardDescription>
              10 caractères minimum. Vos autres appareils seront déconnectés.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={changePasswordAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current">Mot de passe actuel</Label>
                <Input
                  id="current"
                  name="current"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="h-10 md:h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Nouveau mot de passe</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  className="h-10 md:h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmer le nouveau mot de passe</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  className="h-10 md:h-9"
                />
              </div>
              <Button type="submit" className="max-md:h-10">
                Modifier le mot de passe
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lier mon Telegram</CardTitle>
            <CardDescription>
              Permet au bot de vous reconnaître comme membre de l&apos;équipe (vous recevez les
              alertes et les rapports).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {user.telegramUserId ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <Badge>lié</Badge>{" "}
                  <span className="ml-2 text-muted-foreground">
                    identifiant Telegram {user.telegramUserId.toString()}
                  </span>
                </div>
                <form action={unlinkTelegramAction}>
                  <ConfirmSubmit
                    size="sm"
                    variant="outline"
                    className="max-md:h-10"
                    message="Votre compte Telegram sera délié : vous ne recevrez plus les alertes ni les tests. Vous pourrez le relier ensuite. Continuer ?"
                  >
                    Délier
                  </ConfirmSubmit>
                </form>
              </div>
            ) : (
              <>
                {user.telegramLinkToken && bots.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm">
                      Ouvrez un de ces liens dans Telegram, puis appuyez sur{" "}
                      <strong>Démarrer</strong> :
                    </p>
                    {bots.map((b) => (
                      <div key={b.username} className="space-y-1">
                        <div className="text-xs text-muted-foreground">
                          {b.name} (@{b.username})
                        </div>
                        <CopyField
                          value={`https://t.me/${b.username}?start=admin_${user.telegramLinkToken}`}
                        />
                      </div>
                    ))}
                  </div>
                ) : bots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun bot actif : ajoutez d&apos;abord un bot dans Réglages → Bots.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Compte Telegram non lié. Générez un lien, ouvrez-le dans Telegram et appuyez sur
                    Démarrer.
                  </p>
                )}
                <form action={generateTelegramLinkAction}>
                  <Button
                    type="submit"
                    className="max-md:h-10"
                    variant={user.telegramLinkToken ? "outline" : "default"}
                  >
                    {user.telegramLinkToken ? "Régénérer le lien" : "Générer un lien"}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visite guidée</CardTitle>
            <CardDescription>
              Deux minutes pour retrouver chaque rubrique du menu. Elle repart de l&apos;accueil, et
              la liste « À faire pour démarrer » réapparaît si elle n&apos;est pas finie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={restartTourAction}>
              <Button type="submit" variant="outline" className="max-md:h-10">
                <Compass aria-hidden />
                Revoir la visite
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
