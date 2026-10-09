import { prisma } from "@linkaffipro/db";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/** Aperçu d'un média (réservé aux utilisateurs connectés ; pas d'aperçu au-delà de 20 Mo). */
export async function GET(_req: Request, ctx: RouteContext<"/api/media/[id]">) {
  const session = await auth();
  if (!session?.user?.id) return new Response("non connecté", { status: 401 });
  const { id } = await ctx.params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return new Response("introuvable", { status: 404 });
  if (asset.size > 20 * 1024 * 1024) return new Response("trop volumineux pour un aperçu", { status: 413 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: { "Content-Type": asset.mimeType, "Content-Length": String(asset.size), "Cache-Control": "private, max-age=3600", "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename)}"` },
  });
}
