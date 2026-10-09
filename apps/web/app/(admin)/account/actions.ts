"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomToken } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";

function back(params: Record<string, string>): never {
  redirect(`/account?${new URLSearchParams(params).toString()}`);
}

const pwSchema = z
  .object({ current: z.string().min(1), password: z.string().min(10).max(200), confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: "Les deux nouveaux mots de passe ne correspondent pas." });

export async function changePasswordAction(formData: FormData): Promise<void> {
  const me = await requireUser();
  const parsed = pwSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back({ error: parsed.error.issues[0]?.message ?? "Le nouveau mot de passe doit faire au moins 10 caractères." });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  const ok = await bcrypt.compare(parsed.data.current, user.passwordHash);
  if (!ok) back({ error: "Mot de passe actuel incorrect." });
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await bcrypt.hash(parsed.data.password, 12) } });
  await audit({ userId: me.id, action: "user.password_changed", entityType: "User", entityId: me.id });
  back({ ok: "Mot de passe modifié." });
}

export async function generateTelegramLinkAction(): Promise<void> {
  const me = await requireUser();
  await prisma.user.update({ where: { id: me.id }, data: { telegramLinkToken: randomToken(16) } });
  await audit({ userId: me.id, action: "user.telegram_link_requested", entityType: "User", entityId: me.id });
  revalidatePath("/account");
  back({ ok: "Lien généré. Ouvrez-le dans Telegram puis appuyez sur Démarrer." });
}

export async function unlinkTelegramAction(): Promise<void> {
  const me = await requireUser();
  await prisma.user.update({ where: { id: me.id }, data: { telegramUserId: null, telegramLinkToken: null } });
  await audit({ userId: me.id, action: "user.telegram_unlinked", entityType: "User", entityId: me.id });
  revalidatePath("/account");
  back({ ok: "Compte Telegram délié." });
}
