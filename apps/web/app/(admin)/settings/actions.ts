"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isRole, randomToken } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { forgetSessionVersion } from "@/auth";
import { requireAdmin } from "@/lib/session";

function back(params: Record<string, string>): never {
  redirect(`/settings?${new URLSearchParams(params).toString()}`);
}

/** Créer une invitation (ADMIN). Le lien est affiché à copier ; l'envoi d'e-mail viendra plus tard. */
export async function inviteAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = z.string().email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  const role = String(formData.get("role") ?? "MANAGER");
  if (!email.success) back({ error: "Adresse e-mail invalide." });
  if (!isRole(role)) back({ error: "Rôle invalide." });
  const existing = await prisma.user.findUnique({ where: { email: email.data } });
  if (existing) back({ error: "Un compte existe déjà avec cet e-mail." });
  const token = randomToken(24);
  const inv = await prisma.invitation.create({
    data: { email: email.data, role, token, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000), invitedById: admin.id },
  });
  await audit({ userId: admin.id, action: "invitation.created", entityType: "Invitation", entityId: inv.id, metadata: { email: email.data, role } });
  revalidatePath("/settings");
  back({ ok: `Invitation créée pour ${email.data}. Copiez le lien ci-dessous et envoyez-le.` });
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("invitationId"));
  await prisma.invitation.update({ where: { id }, data: { expiresAt: new Date() } });
  await audit({ userId: admin.id, action: "invitation.revoked", entityType: "Invitation", entityId: id });
  revalidatePath("/settings");
  back({ ok: "Invitation annulée." });
}

export async function toggleUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("userId"));
  if (id === admin.id) back({ error: "Vous ne pouvez pas désactiver votre propre compte." });
  const user = await prisma.user.findUniqueOrThrow({ where: { id } });
  // Désactivation : la version de session change pour déconnecter l'utilisateur de tous ses appareils.
  await prisma.user.update({ where: { id }, data: { isActive: !user.isActive, ...(user.isActive ? { sessionVersion: { increment: 1 } } : {}) } });
  forgetSessionVersion(id);
  await audit({ userId: admin.id, action: user.isActive ? "user.deactivated" : "user.activated", entityType: "User", entityId: id });
  revalidatePath("/settings");
  back({ ok: `${user.name} ${user.isActive ? "désactivé" : "activé"}.` });
}

export async function setRoleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = z.string().min(1).parse(formData.get("userId"));
  const role = String(formData.get("role") ?? "");
  if (!isRole(role)) back({ error: "Rôle invalide." });
  if (id === admin.id && role !== "ADMIN") back({ error: "Vous ne pouvez pas retirer votre propre rôle d'administrateur." });
  const before = await prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true } });
  if (before.role === role) back({ ok: "Rôle inchangé." });
  // Le rôle est porté par le jeton : nouvelle version de session pour forcer une reconnexion avec le bon rôle.
  await prisma.user.update({ where: { id }, data: { role, sessionVersion: { increment: 1 } } });
  forgetSessionVersion(id);
  await audit({ userId: admin.id, action: "user.role_changed", entityType: "User", entityId: id, metadata: { role, from: before.role } });
  revalidatePath("/settings");
  back({ ok: "Rôle mis à jour." });
}
