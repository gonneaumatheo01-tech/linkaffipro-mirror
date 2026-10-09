import type { Metadata } from "next";
import { ROLES, ROLE_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
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
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { ActiveBadge } from "@/lib/status-badges";
import { inviteAction, revokeInvitationAction, setRoleAction, toggleUserAction } from "./actions";
import { SETTINGS_PAGES } from "./nav";

export const metadata: Metadata = { title: "Réglages" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const [users, invitations] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      include: { invitedBy: { select: { name: true } } },
    }),
  ]);
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-8";
  return (
    <>
      <PageHeader
        title="Réglages"
        description="Comptes de l'équipe et invitations, plus l'accès aux autres réglages (connecteurs, alertes, postbacks…). Réservé aux administrateurs."
        help="Pour ajouter un équipier : créez une invitation, copiez le lien et envoyez-le-lui vous-même. Il choisira son mot de passe."
      >
        {SETTINGS_PAGES.map((p) => (
          <Button
            key={p.href}
            variant="outline"
            size="sm"
            className="max-md:h-10"
            render={<Link href={p.href} />}
          >
            {p.label}
          </Button>
        ))}
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utilisateurs</CardTitle>
          <CardDescription>
            Administrateur : tout. Manager : tout sauf réglages, utilisateurs, jetons et
            suppressions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead className="hidden md:table-cell">E-mail</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden md:table-cell">Telegram</TableHead>
                <TableHead className="hidden lg:table-cell">Dernière connexion</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.name}
                    {u.id === admin.id ? (
                      <span className="ml-1 text-xs text-muted-foreground">(vous)</span>
                    ) : null}
                    <div className="text-xs text-muted-foreground md:hidden">{u.email}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{u.email}</TableCell>
                  <TableCell>
                    <form action={setRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <Label htmlFor={`role-${u.id}`} className="sr-only">
                        Rôle de {u.name}
                      </Label>
                      <select
                        id={`role-${u.id}`}
                        name="role"
                        defaultValue={u.role}
                        className={selectCls}
                        disabled={u.id === admin.id}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      {u.id !== admin.id ? (
                        <ConfirmSubmit
                          size="sm"
                          variant="ghost"
                          className="max-md:h-10"
                          aria-label={`Enregistrer le rôle de ${u.name}`}
                          message={`Le rôle de ${u.name} sera modifié et cette personne devra se reconnecter. Continuer ?`}
                        >
                          OK
                        </ConfirmSubmit>
                      ) : null}
                    </form>
                  </TableCell>
                  <TableCell>
                    <ActiveBadge active={u.isActive} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {u.telegramUserId ? (
                      <Badge variant="outline">lié</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">non lié</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {fmtDate(u.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.id !== admin.id ? (
                      <form action={toggleUserAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        {u.isActive ? (
                          <ConfirmSubmit
                            size="sm"
                            variant="outline"
                            className="max-md:h-10"
                            message={`${u.name} sera désactivé : déconnecté immédiatement de tous ses appareils et sans accès au site jusqu'à réactivation. Continuer ?`}
                          >
                            Désactiver
                          </ConfirmSubmit>
                        ) : (
                          <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                            Activer
                          </Button>
                        )}
                      </form>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inviter un équipier</CardTitle>
            <CardDescription>
              Un lien d&apos;invitation valable 7 jours est créé. Envoyez-le vous-même (pas
              d&apos;e-mail automatique).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={inviteAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" required className="h-10 md:h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Rôle</Label>
                <select
                  id="role"
                  name="role"
                  defaultValue="MANAGER"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" className="max-md:h-10">
                Créer l&apos;invitation
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invitations en attente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune invitation en attente.</p>
            ) : null}
            {invitations.map((inv) => (
              <div key={inv.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <span className="font-medium">{inv.email}</span> · {ROLE_LABELS[inv.role]}
                    <div className="text-xs text-muted-foreground">
                      par {inv.invitedBy.name}, expire le {fmtDate(inv.expiresAt)}
                    </div>
                  </div>
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <ConfirmSubmit
                      size="sm"
                      variant="ghost"
                      className="max-md:h-10"
                      message={`L'invitation de ${inv.email} sera annulée : son lien ne fonctionnera plus. Continuer ?`}
                    >
                      Annuler
                    </ConfirmSubmit>
                  </form>
                </div>
                <CopyField value={`${env.appBaseUrl}/invite/${inv.token}`} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
