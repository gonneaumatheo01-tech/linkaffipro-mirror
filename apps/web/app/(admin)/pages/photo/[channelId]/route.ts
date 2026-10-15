import { prisma } from "@linkaffipro/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Petite photo d'un canal pour l'aperçu en direct de la rubrique « Pages » (phase 15) : réservée à l'équipe connectée
 * (la page publique sert la sienne par `/j/_p/…`, seulement pour une page active qui l'affiche). 404 sans photo.
 */
export async function GET(_req: Request, ctx: RouteContext<"/pages/photo/[channelId]">) {
  await requireUser();
  const { channelId } = await ctx.params;
  const row = /^[A-Za-z0-9_-]{1,64}$/.test(channelId)
    ? await prisma.channel.findUnique({ where: { id: channelId }, select: { photoSmall: true } })
    : null;
  if (!row?.photoSmall?.length)
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(row.photoSmall), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
