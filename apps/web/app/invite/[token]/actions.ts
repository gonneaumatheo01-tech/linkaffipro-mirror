"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";

const schema = z
  .object({ token: z.string().min(10), name: z.string().trim().min(2).max(60), password: z.string().min(10).max(200), confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: "Les deux mots de passe ne correspondent pas.", path: ["confirm"] });

export async function acceptInviteAction(_prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const { token, name, password } = parsed.data;
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) return { error: "Invitation invalide ou expirée." };
  const email = invitation.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "Un compte existe déjà avec cet e-mail. Connectez-vous." };
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email, name, passwordHash, role: invitation.role } });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    return u;
  });
  await audit({ userId: user.id, action: "user.invitation_accepted", entityType: "User", entityId: user.id, metadata: { invitationId: invitation.id } });
  redirect("/login?welcome=1");
}
