import { prisma } from "@linkaffipro/db";
import { apiUser } from "@/lib/ai/api-user";
import { parseRange } from "@/lib/agents/media-range";

export const dynamic = "force-dynamic";

/**
 * Aperçu d'un média des agents (phase 20 : images de référence, vidéos sources, vidéos et photos produites). Réservé
 * aux utilisateurs connectés et actifs (`apiUser`, sinon 401) ; seuls les médias rangés par les agents sont servis
 * (404 sinon). Les vidéos se lisent par morceaux (`Range`, nécessaire à Safari). En-têtes de cache privés.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/agents/media/[id]">) {
  if (!(await apiUser())) return new Response("non connecté", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("introuvable", { status: 404 });
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { filename: true, mimeType: true, size: true, bytes: true, kind: true },
  });
  if (!asset || !asset.kind) return new Response("introuvable", { status: 404 });
  const bytes = new Uint8Array(asset.bytes);
  const size = bytes.byteLength;
  const headers: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
  };
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range)
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    return new Response(bytes.subarray(range.start, range.end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }
  return new Response(bytes, { headers: { ...headers, "Content-Length": String(size) } });
}
