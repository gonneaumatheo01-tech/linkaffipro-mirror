import type { Metadata } from "next";
import Link from "next/link";
import { ROLES, ROLE_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { EmptyState } from "@/components/admin/empty-state";
import { HelpTip } from "@/components/admin/help-tip";
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
import {
  inviteAction,
  resetPasswordAction,
  revokeInvitationAction,
  setRoleAction,
  toggleUserAction,
} from "./actions";

export const metadata: Metadata = { title: "Équipe" };

export default async function TeamPage({ searchParams }: PageProps<"/settings/team">) {
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
  const knownEmails = new Set(users.map((u) => u.email));
  const activeAdmins = users.filter((u) => u.role === "ADMIN" && u.isActive).length;
  const selectCls = "h-10 rounded-md border bg-background px-2 text-sm md:h-8";
  return (
    <>
      <PageHeader
        title="Équipe"
        description="Les comptes qui accèdent au site : rôle, activité, dernière connexion. Invitations et réinitialisations de mot de passe par lien à copier."
        help="Pour ajouter un équipier : créez une invitation, copiez le lien et envoyez-le-lui vous-même (aucun e-mail automatique). Il choisira son mot de passe."
      >
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          render={<Link href="/settings" />}
        >
          ← Réglages
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utilisateurs</CardTitle>
          <CardDescription>
            Administrateur : tout. Manager : tout sauf réglages, utilisateurs, jetons et
            suppressions. Il reste toujours au moins un administrateur actif.
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
              {users.map((u) => {
                const isMe = u.id === admin.id;
                const lastAdmin = u.role === "ADMIN" && u.isActive && activeAdmins <= 1;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.name}
                      {isMe ? (
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
                          disabled={isMe || lastAdmin}
                          title={
                            lastAdmin && !isMe
                              ? "Dernier administrateur actif : le rôle ne peut pas être retiré."
                              : undefined
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        {!isMe && !lastAdmin ? (
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
                      <div className="flex flex-wrap justify-end gap-1">
                        <form action={resetPasswordAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <ConfirmSubmit
                            size="sm"
                            variant="ghost"
                            className="max-md:h-10"
                            message={`Un lien de réinitialisation sera créé pour ${u.name}. Son mot de passe actuel reste valable jusqu'à ce qu'elle utilise le lien. Continuer ?`}
                          >
                            Réinitialiser le mot de passe
                          </ConfirmSubmit>
                        </form>
                        {!isMe ? (
                          <form action={toggleUserAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            {u.isActive ? (
                              <ConfirmSubmit
                                size="sm"
                                variant="outline"
                                className="max-md:h-10"
                                disabled={lastAdmin}
                                title={
                                  lastAdmin
                                    ? "Dernier administrateur actif : impossible de le désactiver."
                                    : undefined
                                }
                                message={`${u.name} sera désactivé : déconnecté immédiatement de tous ses appareils et sans accès au site jusqu'à réactivation. Continuer ?`}
                              >
                                Désactiver
                              </ConfirmSubmit>
                            ) : (
                              <Button
                                type="submit"
                                size="sm"
                                variant="outline"
                                className="max-md:h-10"
                              >
                                Activer
                              </Button>
                            )}
                          </form>
                        ) : null}
                      </div>
                    </TableCell>
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
                <Label htmlFor="role" className="inline-flex items-center gap-1">
                  Rôle{" "}
                  <HelpTip>
                    Manager : peut tout faire sauf les réglages, les comptes, les jetons et les
                    suppressions. Administrateur : tout.
                  </HelpTip>
                </Label>
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
            <CardDescription>
              Nouveaux comptes et réinitialisations de mot de passe. Copiez le lien et envoyez-le.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {invitations.length === 0 ? (
              <EmptyState
                title="Aucune invitation en attente."
                description="Créez-en une à gauche, ou cliquez « Réinitialiser le mot de passe » sur la ligne d'un utilisateur."
              />
            ) : null}
            {invitations.map((inv) => {
              const reset = knownEmails.has(inv.email);
              return (
                <div key={inv.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div>
                      <span className="font-medium">{inv.email}</span> · {ROLE_LABELS[inv.role]}{" "}
                      {reset ? (
                        <Badge variant="secondary">réinitialisation</Badge>
                      ) : (
                        <Badge variant="outline">nouveau compte</Badge>
                      )}
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
              );
            })}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
