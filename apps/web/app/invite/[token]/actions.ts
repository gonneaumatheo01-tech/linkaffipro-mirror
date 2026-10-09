"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { forgetSessionVersion } from "@/auth";

const schema = z
  .object({
    token: z.string().min(10),
    name: z.string().trim().max(60).optional(),
    password: z.string().min(10).max(200),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirm"],
  });

/**
 * Accepte une invitation. Deux cas :
 * - e-mail inconnu : création du compte (nom + mot de passe) ;
 * - e-mail déjà connu (réinitialisation demandée par un administrateur) : le mot de passe est remplacé
 *   et toutes les sessions sont fermées (version de session incrémentée). Le rôle n'est pas modifié.
 */
export async function acceptInviteAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const { token, name, password } = parsed.data;
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date())
    return { error: "Invitation invalide ou expirée." };
  const email = invitation.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      }),
      prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
    ]);
    forgetSessionVersion(existing.id);
    await audit({
      userId: existing.id,
      action: "user.password_reset",
      entityType: "User",
      entityId: existing.id,
      metadata: { invitationId: invitation.id },
    });
    redirect("/login?reset=1");
  }

  if (!name || name.length < 2) return { error: "Indiquez un prénom d'au moins 2 caractères." };
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email, name, passwordHash, role: invitation.role } });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    return u;
  });
  await audit({
    userId: user.id,
    action: "user.invitation_accepted",
    entityType: "User",
    entityId: user.id,
    metadata: { invitationId: invitation.id },
  });
  redirect("/login?welcome=1");
}
