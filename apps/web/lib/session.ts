import { redirect } from "next/navigation";
import type { Role } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { auth } from "@/auth";

export type CurrentUser = { id: string; email: string; name: string; role: Role; telegramUserId: bigint | null };

/** Utilisateur connecté et actif, sinon redirection vers /login. Vérifié en base à chaque appel. */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, isActive: true, telegramUserId: true },
  });
  if (!user || !user.isActive) redirect("/login?error=inactive");
  return { id: user.id, email: user.email, name: user.name, role: user.role, telegramUserId: user.telegramUserId };
}

export class ForbiddenError extends Error {
  constructor() {
    super("Action réservée aux administrateurs");
    this.name = "ForbiddenError";
  }
}

/** Administrateur requis (vérification côté serveur). */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ForbiddenError();
  return user;
}

/** Variante pour les pages : redirige vers l'accueil au lieu de lever une erreur. */
export async function requireAdminPage(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/?forbidden=1");
  return user;
}
