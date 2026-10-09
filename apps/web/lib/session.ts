import { redirect } from "next/navigation";
import type { Role } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { auth } from "@/auth";

export type CurrentUser = { id: string; email: string; name: string; role: Role; telegramUserId: bigint | null };

/**
 * Utilisateur connecté et actif, sinon redirection vers /login. Vérifié en base à chaque appel.
 * La version de session du jeton doit être celle en base (sinon : mot de passe ou rôle changé, compte désactivé →
 * déconnexion immédiate de tous les appareils ; voir auth.ts).
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, isActive: true, telegramUserId: true, sessionVersion: true },
  });
  if (!user || !user.isActive) redirect("/login?error=inactive");
  if (user.sessionVersion !== (session?.user?.sessionVersion ?? 0)) redirect("/login?error=expired");
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
