import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { ROLES, ROLE_LABELS } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { CopyField } from "@/components/admin/copy-field";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { SidePanel } from "@/components/admin/side-panel";
import { StatusPill } from "@/components/admin/status-pill";
import { DetailList, DetailRow } from "@/components/admin/detail-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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
import {
  accountLock,
  accountLockSentence,
  emailBreakParts,
  INVITATION_KIND_LABELS,
  invitationKind,
  teamSummary,
} from "./team-view";

export const metadata: Metadata = { title: "Équipe" };

function RoleOptions() {
  return ROLES.map((r) => (
    <option key={r} value={r}>
      {ROLE_LABELS[r]}
    </option>
  ));
}

/** E-mail qui passe à la ligne avant « @ » sur téléphone, jamais au milieu du nom de domaine. */
function EmailText({ email }: { email: string }) {
  const [local, domain] = emailBreakParts(email);
  if (domain === undefined) return local;
  return (
    <>
      {local}
      <wbr />
      {domain}
    </>
  );
}

/**
 * Réglages → Équipe : tableau de 5 colonnes (personne, rôle, état, Telegram, dernière connexion), détail au clic avec
 * le changement de rôle, la réinitialisation du mot de passe et la désactivation (toutes confirmées). « Inviter un
 * équipier » ouvre un volet ; les liens d'invitation à copier sont en dessous. Mêmes actions serveur qu'avant.
 */
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
  // Après une action, le tableau (et son volet) repart de zéro : le message de retour reste visible.
  const flashKey = JSON.stringify([sp.ok ?? null, sp.error ?? null]);

  const invitePanel = (
    <SidePanel
      key={`invite-${flashKey}`}
      title="Inviter un équipier"
      description="Un lien valable 7 jours est créé. Envoyez-le vous-même : aucun e-mail n'est envoyé."
      trigger={
        <Button className="max-md:h-10">
          <UserPlus aria-hidden />
          Inviter un équipier
        </Button>
      }
    >
      <form action={inviteAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" required autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Rôle</Label>
          <NativeSelect
            id="role"
            name="role"
            defaultValue="MANAGER"
            wrapperClassName="w-full"
            aria-describedby="role-aide"
          >
            <RoleOptions />
          </NativeSelect>
          <p id="role-aide" className="text-note text-muted-foreground">
            Manager : tout sauf les réglages, les comptes, les jetons et les suppressions.
            Administrateur : tout.
          </p>
        </div>
        <Button type="submit" className="max-md:h-10">
          Créer l&apos;invitation
        </Button>
      </form>
    </SidePanel>
  );

  return (
    <>
      <PageHeader
        backHref="/settings"
        backLabel="Réglages"
        title="Équipe"
        description="Les comptes qui accèdent au site : rôle, état, dernière connexion."
        help="Pour ajouter un équipier : « Inviter un équipier », puis copiez le lien et envoyez-le-lui. Il choisira son mot de passe."
        primaryAction={invitePanel}
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-10">
        <FormSection
          title="Comptes"
          description={`${teamSummary(users)}. Cliquez sur une personne pour changer son rôle, son mot de passe ou la désactiver.`}
        >
          <DataTable
            key={`users-${flashKey}`}
            label="Comptes de l'équipe"
            columns={[
              { key: "person", header: "Personne", className: "min-w-44 whitespace-normal" },
              { key: "role", header: "Rôle" },
              { key: "state", header: "État", hideOnMobile: true },
              { key: "telegram", header: "Telegram", hideOnMobile: true },
              { key: "lastLogin", header: "Dernière connexion", hideOnMobile: true },
            ]}
            rows={users.map((u) => {
              const isMe = u.id === admin.id;
              const lock = accountLock(u, admin.id, activeAdmins);
              const lockSentence = accountLockSentence(lock);
              return {
                id: u.id,
                cells: {
                  person: (
                    <span className="flex flex-col items-start">
                      <span>
                        {u.name}
                        {isMe ? (
                          <span className="ml-1 font-normal text-muted-foreground">(vous)</span>
                        ) : null}
                      </span>
                      <span className="text-note font-normal text-muted-foreground">
                        <EmailText email={u.email} />
                      </span>
                    </span>
                  ),
                  role: ROLE_LABELS[u.role],
                  state: <ActiveBadge active={u.isActive} />,
                  telegram: u.telegramUserId ? (
                    <StatusPill tone="success">Lié</StatusPill>
                  ) : (
                    <StatusPill tone="muted">Non lié</StatusPill>
                  ),
                  lastLogin: fmtDate(u.lastLoginAt),
                },
                sortValues: {
                  person: u.name,
                  state: u.isActive ? 1 : 0,
                  telegram: u.telegramUserId ? 1 : 0,
                  lastLogin: u.lastLoginAt,
                },
                detailTitle: isMe ? `${u.name} (vous)` : u.name,
                detailDescription: `${u.email} · ${ROLE_LABELS[u.role]}`,
                detail: (
                  <div className="space-y-8">
                    <DetailList>
                      <DetailRow label="État">
                        <ActiveBadge active={u.isActive} />
                      </DetailRow>
                      <DetailRow label="Telegram">
                        {u.telegramUserId ? "Lié (reçoit les alertes et les tests)" : "Non lié"}
                      </DetailRow>
                      <DetailRow label="Dernière connexion">{fmtDate(u.lastLoginAt)}</DetailRow>
                      <DetailRow label="Compte créé le">{fmtDate(u.createdAt)}</DetailRow>
                    </DetailList>

                    <form action={setRoleAction} className="space-y-3 border-t border-border pt-6">
                      <input type="hidden" name="userId" value={u.id} />
                      <div className="space-y-2">
                        <Label htmlFor={`role-${u.id}`}>Rôle</Label>
                        <NativeSelect
                          id={`role-${u.id}`}
                          name="role"
                          defaultValue={u.role}
                          disabled={lock !== null}
                          wrapperClassName="w-full"
                          aria-describedby={lockSentence ? `role-${u.id}-aide` : undefined}
                        >
                          <RoleOptions />
                        </NativeSelect>
                        {lockSentence ? (
                          <p id={`role-${u.id}-aide`} className="text-note text-muted-foreground">
                            {lockSentence}
                          </p>
                        ) : null}
                      </div>
                      {lock === null ? (
                        <ConfirmSubmit
                          variant="outline"
                          className="max-md:h-10"
                          confirmTitle={`Changer le rôle de ${u.name}\u00a0?`}
                          confirmLabel="Changer le rôle"
                          message={`Le rôle de ${u.name} sera modifié et cette personne devra se reconnecter.`}
                        >
                          Enregistrer le rôle
                        </ConfirmSubmit>
                      ) : null}
                    </form>

                    <div className="space-y-3 border-t border-border pt-6">
                      <h3 className="text-body font-semibold text-foreground">Mot de passe</h3>
                      <p className="text-note text-muted-foreground">
                        Un lien à copier est créé (valable 48 h) ; l&apos;ancien mot de passe reste
                        valable jusqu&apos;à ce qu&apos;il soit utilisé.
                      </p>
                      <form action={resetPasswordAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <ConfirmSubmit
                          variant="outline"
                          className="max-md:h-10"
                          confirmTitle={`Réinitialiser le mot de passe de ${u.name}\u00a0?`}
                          confirmLabel="Créer le lien"
                          message={`Un lien de réinitialisation sera créé pour ${u.name}. Son mot de passe actuel reste valable jusqu'à ce que le lien soit utilisé.`}
                        >
                          Réinitialiser le mot de passe
                        </ConfirmSubmit>
                      </form>
                    </div>

                    {!isMe ? (
                      <form
                        action={toggleUserAction}
                        className="space-y-3 border-t border-border pt-6"
                      >
                        <input type="hidden" name="userId" value={u.id} />
                        <h3 className="text-body font-semibold text-foreground">Accès au site</h3>
                        {u.isActive ? (
                          <ConfirmSubmit
                            variant="destructive"
                            className="max-md:h-10"
                            disabled={lock === "lastAdmin"}
                            confirmTitle={`Désactiver ${u.name}\u00a0?`}
                            confirmLabel="Désactiver"
                            message={`${u.name} sera déconnecté immédiatement de tous ses appareils et n'aura plus accès au site jusqu'à sa réactivation.`}
                          >
                            Désactiver le compte
                          </ConfirmSubmit>
                        ) : (
                          <Button type="submit" variant="outline" className="max-md:h-10">
                            Réactiver le compte
                          </Button>
                        )}
                      </form>
                    ) : null}
                  </div>
                ),
              };
            })}
          />
        </FormSection>

        <FormSection
          title="Invitations en attente"
          description="Nouveaux comptes et nouveaux mots de passe. Copiez le lien et envoyez-le à la personne."
        >
          {invitations.length === 0 ? (
            <EmptyState
              title="Aucune invitation en attente"
              description={
                "Cliquez sur «\u00a0Inviter un équipier\u00a0», ou ouvrez une personne puis «\u00a0Réinitialiser le mot de passe\u00a0»."
              }
            />
          ) : (
            <ul className="space-y-3">
              {invitations.map((inv) => {
                const kind = invitationKind(inv.email, knownEmails);
                return (
                  <li
                    key={inv.id}
                    className="space-y-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium wrap-anywhere text-foreground">
                            <EmailText email={inv.email} />
                          </span>
                          <StatusPill tone={kind === "reset" ? "warning" : "info"}>
                            {INVITATION_KIND_LABELS[kind]}
                          </StatusPill>
                        </div>
                        <p className="text-note text-muted-foreground">
                          {ROLE_LABELS[inv.role]} · créée par {inv.invitedBy.name} · expire le{" "}
                          {fmtDate(inv.expiresAt)}
                        </p>
                      </div>
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <ConfirmDialog
                          title={`Annuler l'invitation de ${inv.email}\u00a0?`}
                          description="Son lien ne fonctionnera plus. Vous pourrez en créer un autre."
                          confirmLabel="Annuler l'invitation"
                          cancelLabel="Garder l'invitation"
                          destructive
                          trigger={
                            <Button type="submit" size="sm" variant="ghost" className="max-md:h-10">
                              Annuler l&apos;invitation
                            </Button>
                          }
                        />
                      </form>
                    </div>
                    <CopyField
                      value={`${env.appBaseUrl}/invite/${inv.token}`}
                      label={`Lien d'invitation pour ${inv.email}`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </FormSection>
      </div>
    </>
  );
}
