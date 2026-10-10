import { prisma } from "@linkaffipro/db";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * Nombre de canaux et dernier canal détecté : GET /api/channels/count (session obligatoire, 401 sinon).
 * Interrogé toutes les 5 secondes par la fenêtre « Ajouter un canal existant » pendant 2 minutes.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Non connecté." }, { status: 401 });
  const [count, latest] = await Promise.all([
    prisma.channel.count(),
    prisma.channel.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, title: true, createdAt: true } }),
  ]);
  return Response.json({ count, latest: latest ? { id: latest.id, title: latest.title, createdAt: latest.createdAt.toISOString() } : null });
}
