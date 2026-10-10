import { prisma } from "@linkaffipro/db";
import { auth } from "@/auth";

/** Utilisateur connecté pour une route API (même contrôle que requireUser, sans redirection). */
export async function apiUser(): Promise<{ id: string; role: "ADMIN" | "MANAGER" } | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true, sessionVersion: true } });
  if (!user || !user.isActive || user.sessionVersion !== (session?.user?.sessionVersion ?? 0)) return null;
  return { id: user.id, role: user.role };
}
