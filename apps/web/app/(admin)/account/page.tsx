import type { Metadata } from "next";
import { ROLE_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { CopyField } from "@/components/admin/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireUser } from "@/lib/session";
import { changePasswordAction, generateTelegramLinkAction, unlinkTelegramAction } from "./actions";

export const metadata: Metadata = { title: "Mon compte" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const me = await requireUser();
  const sp = await searchParams;
  const [user, bots] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { telegramLinkToken: true, telegramUserId: true } }),
    prisma.bot.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { username: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="Mon compte" description={`${me.name} · ${me.email} · ${ROLE_LABELS[me.role]}`} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Changer le mot de passe</CardTitle>
            <CardDescription>10 caractères minimum.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={changePasswordAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current">Mot de passe actuel</Label>
                <Input id="current" name="current" type="password" required autoComplete="current-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Nouveau mot de passe</Label>
                <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmer</Label>
                <Input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" />
              </div>
              <Button type="submit">Modifier</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lier mon Telegram</CardTitle>
            <CardDescription>Permet au bot de vous reconnaître comme membre de l&apos;équipe (alertes et commandes à venir).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {user.telegramUserId ? (
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm">
                  <Badge>lié</Badge> <span className="ml-2 text-muted-foreground">identifiant Telegram {user.telegramUserId.toString()}</span>
                </div>
                <form action={unlinkTelegramAction}>
                  <Button type="submit" size="sm" variant="outline">Délier</Button>
                </form>
              </div>
            ) : (
              <>
                {user.telegramLinkToken && bots.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm">Ouvrez un de ces liens dans Telegram, puis appuyez sur <strong>Démarrer</strong> :</p>
                    {bots.map((b) => (
                      <div key={b.username} className="space-y-1">
                        <div className="text-xs text-muted-foreground">{b.name} (@{b.username})</div>
                        <CopyField value={`https://t.me/${b.username}?start=admin_${user.telegramLinkToken}`} />
                      </div>
                    ))}
                  </div>
                ) : bots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun bot actif : ajoutez d&apos;abord un bot.</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Compte Telegram non lié.</p>
                )}
                <form action={generateTelegramLinkAction}>
                  <Button type="submit" variant={user.telegramLinkToken ? "outline" : "default"}>{user.telegramLinkToken ? "Régénérer le lien" : "Générer un lien"}</Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
