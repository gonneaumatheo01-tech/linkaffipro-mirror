import type { Metadata } from "next";
import { ROLES, ROLE_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { CopyField } from "@/components/admin/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { inviteAction, revokeInvitationAction, setRoleAction, toggleUserAction } from "./actions";

export const metadata: Metadata = { title: "Réglages" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const [users, invitations] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invitation.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, include: { invitedBy: { select: { name: true } } } }),
  ]);
  const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";
  return (
    <>
      <PageHeader title="Réglages" description="Utilisateurs et invitations. Réservé aux administrateurs.">
        <Button variant="outline" size="sm" render={<Link href="/settings/connectors" />}>Connecteurs (Link Affi)</Button>
        <Button variant="outline" size="sm" render={<Link href="/settings/categories" />}>Catégories</Button>
        <Button variant="outline" size="sm" render={<Link href="/settings/alerts" />}>Alertes</Button>
        <Button variant="outline" size="sm" render={<Link href="/settings/postbacks" />}>Postbacks</Button>
        <Button variant="outline" size="sm" render={<Link href="/settings/reports" />}>Rapports</Button>
        <Button variant="outline" size="sm" render={<Link href="/settings/status" />}>État du système</Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utilisateurs</CardTitle>
          <CardDescription>ADMIN : tout. MANAGER : tout sauf réglages, utilisateurs, jetons et suppressions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Telegram</TableHead>
                <TableHead>Dernière connexion</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}{u.id === admin.id ? <span className="ml-1 text-xs text-muted-foreground">(vous)</span> : null}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <form action={setRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select name="role" defaultValue={u.role} className={selectCls} disabled={u.id === admin.id}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      {u.id !== admin.id ? <Button type="submit" size="sm" variant="ghost">OK</Button> : null}
                    </form>
                  </TableCell>
                  <TableCell>{u.isActive ? <Badge>actif</Badge> : <Badge variant="secondary">désactivé</Badge>}</TableCell>
                  <TableCell>{u.telegramUserId ? <Badge variant="outline">lié</Badge> : <span className="text-xs text-muted-foreground">non lié</span>}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(u.lastLoginAt)}</TableCell>
                  <TableCell className="text-right">
                    {u.id !== admin.id ? (
                      <form action={toggleUserAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <Button type="submit" size="sm" variant="outline">{u.isActive ? "Désactiver" : "Activer"}</Button>
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
            <CardDescription>Un lien d&apos;invitation valable 7 jours est créé. Envoyez-le vous-même (l&apos;envoi automatique d&apos;e-mail viendra plus tard).</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={inviteAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Rôle</Label>
                <select id="role" name="role" defaultValue="MANAGER" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <Button type="submit">Créer l&apos;invitation</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invitations en attente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {invitations.length === 0 ? <p className="text-sm text-muted-foreground">Aucune invitation en attente.</p> : null}
            {invitations.map((inv) => (
              <div key={inv.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <span className="font-medium">{inv.email}</span> · {ROLE_LABELS[inv.role]}
                    <div className="text-xs text-muted-foreground">par {inv.invitedBy.name}, expire le {fmtDate(inv.expiresAt)}</div>
                  </div>
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <Button type="submit" size="sm" variant="ghost">Annuler</Button>
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
