"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isRole, randomToken } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { forgetSessionVersion } from "@/auth";
import { requireAdmin } from "@/lib/session";

const INVITE_DAYS = 7;
const RESET_HOURS = 48;

function back(params: Record<string, string>): never {
  redirect(`/settings/team?${new URLSearchParams(params).toString()}`);
}

/** Nombre d'administrateurs actifs autres que `excludeId` : on ne retire jamais le dernier. */
async function otherActiveAdmins(excludeId: string): Promise<number> {
  return prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: excludeId } } });
}

/** Créer une invitation (ADMIN). Le lien est affiché à copier : aucun e-mail n'est envoyé. */
export async function inviteAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = z
    .string()
    .email()
    .safeParse(
      String(formData.get("email") ?? "")
        .trim()
        .toLowerCase(),
    );
  const role = String(formData.get("role") ?? "MANAGER");
  if (!email.success) back({ error: "L'adresse e-mail n'est pas valide." });
  if (!isRole(role)) back({ error: "Choisissez un rôle dans la liste." });
  const existing = await prisma.user.findUnique({ where: { email: email.data } });
  if (existing)
    back({
      error:
        "Un compte existe déjà avec cette adresse. Pour lui donner un nouveau mot de passe, utilisez « Réinitialiser le mot de passe » sur sa ligne.",
    });
  const token = randomToken(24);
  const inv = await prisma.invitation.create({
    data: {
      email: email.data,
      role,
      token,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000),
      invitedById: admin.id,
    },
  });
  await audit({
    userId: admin.id,
    action: "invitation.created",
    entityType: "Invitation",
    entityId: inv.id,
    metadata: { email: email.data, role },
  });
  revalidatePath("/settings/team");
  back({ ok: `Invitation créée pour ${email.data}. Copiez le lien ci-dessous et envoyez-le.` });
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("invitationId"));
  const inv = await prisma.invitation.update({ where: { id }, data: { expiresAt: new Date() } });
  await audit({
    userId: admin.id,
    action: "invitation.revoked",
    entityType: "Invitation",
    entityId: id,
    metadata: { email: inv.email },
  });
  revalidatePath("/settings/team");
  back({ ok: "Invitation annulée." });
}

export async function toggleUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("userId"));
  if (id === admin.id) back({ error: "Vous ne pouvez pas désactiver votre propre compte." });
  const user = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (user.isActive && user.role === "ADMIN" && (await otherActiveAdmins(id)) === 0)
    back({ error: "Impossible : ce compte est le dernier administrateur actif." });
  // Désactivation : la version de session change pour déconnecter l'utilisateur de tous ses appareils.
  await prisma.user.update({
    where: { id },
    data: {
      isActive: !user.isActive,
      ...(user.isActive ? { sessionVersion: { increment: 1 } } : {}),
    },
  });
  forgetSessionVersion(id);
  await audit({
    userId: admin.id,
    action: user.isActive ? "user.deactivated" : "user.activated",
    entityType: "User",
    entityId: id,
    metadata: { email: user.email },
  });
  revalidatePath("/settings/team");
  back({
    ok: `${user.name} ${user.isActive ? "désactivé : cette personne est déconnectée de tous ses appareils" : "activé : cette personne peut de nouveau se connecter"}.`,
  });
}

export async function setRoleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("userId"));
  const role = String(formData.get("role") ?? "");
  if (!isRole(role)) back({ error: "Choisissez un rôle dans la liste." });
  if (id === admin.id && role !== "ADMIN")
    back({ error: "Vous ne pouvez pas retirer votre propre rôle d'administrateur." });
  const before = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: { role: true, isActive: true, email: true },
  });
  if (before.role === role) back({ ok: "Rôle inchangé." });
  if (before.role === "ADMIN" && before.isActive && (await otherActiveAdmins(id)) === 0)
    back({ error: "Impossible : ce compte est le dernier administrateur actif." });
  // Le rôle est porté par le jeton : nouvelle version de session pour forcer une reconnexion avec le bon rôle.
  await prisma.user.update({ where: { id }, data: { role, sessionVersion: { increment: 1 } } });
  forgetSessionVersion(id);
  await audit({
    userId: admin.id,
    action: "user.role_changed",
    entityType: "User",
    entityId: id,
    metadata: { role, from: before.role, email: before.email },
  });
  revalidatePath("/settings/team");
  back({ ok: "Rôle mis à jour : la personne devra se reconnecter." });
}

/**
 * Réinitialisation du mot de passe (ADMIN) : crée une invitation liée à l'e-mail du compte existant.
 * Quand la personne l'accepte, son mot de passe est remplacé et toutes ses sessions sont fermées
 * (voir /invite/[token]). Le lien est valable 48 h ; les invitations précédentes du même e-mail sont annulées.
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("userId"));
  const user = await prisma.user.findUniqueOrThrow({ where: { id } });
  const token = randomToken(24);
  const [, inv] = await prisma.$transaction([
    prisma.invitation.updateMany({
      where: { email: user.email, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    }),
    prisma.invitation.create({
      data: {
        email: user.email,
        role: user.role,
        token,
        expiresAt: new Date(Date.now() + RESET_HOURS * 3600 * 1000),
        invitedById: admin.id,
      },
    }),
  ]);
  await audit({
    userId: admin.id,
    action: "user.password_reset_requested",
    entityType: "User",
    entityId: id,
    metadata: { invitationId: inv.id, email: user.email },
  });
  revalidatePath("/settings/team");
  back({
    ok: `Lien de réinitialisation créé pour ${user.name} (valable ${RESET_HOURS} h). Copiez-le dans « Invitations en attente » et envoyez-le-lui.`,
  });
}
