import { prisma } from "@linkaffipro/db";
import { apiUser } from "@/lib/ai/api-user";
import { parseRange } from "@/lib/agents/media-range";
import { TOO_BIG_TEXT, playableInBrowser, safeMontageId, telegramMessageLink } from "@/lib/agents/montage";
import { shortBytes } from "@/lib/agents/montage-bytes";

export const dynamic = "force-dynamic";

/** Morceaux envoyés au navigateur (lecture en continu). */
const CHUNK = 256 * 1024;

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + CHUNK, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

function tooBig(link: string | null): Response {
  return new Response(link ? `${TOO_BIG_TEXT} ${link}` : TOO_BIG_TEXT, {
    status: 413,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...(link ? { Link: `<${link}>; rel="alternate"` } : {}) },
  });
}

/**
 * Lecture d'un short de l'équipe Montage (phase 28) dans le navigateur. Réservée aux utilisateurs connectés et actifs
 * (`apiUser`, sinon 401) ; identifiant = le short (`ShortClip`). Un short gardé dans Telegram est récupéré par la chaîne
 * Montage (`resolveAssetBytes`) et servi en continu, par morceaux (`Range`, nécessaire à Safari). Trop lourd pour le
 * bot (plus de 20 Mo) : 413 et « ouvrez-le dans Telegram », avec le lien du message de la médiathèque si possible.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/agents/montage/short/[id]">) {
  if (!(await apiUser())) return new Response("non connecté", { status: 401 });
  const { id } = await ctx.params;
  const clipId = safeMontageId(id);
  if (!clipId) return new Response("introuvable", { status: 404 });
  const clip = await prisma.shortClip.findUnique({
    where: { id: clipId },
    select: {
      index: true,
      asset: { select: { id: true, filename: true, mimeType: true, size: true, storage: true, bytes: true, telegramRef: true, kind: true } },
    },
  });
  const asset = clip?.asset;
  if (!clip || !asset) return new Response("introuvable", { status: 404 });

  let bytes: Uint8Array;
  if (asset.storage !== "telegram") {
    bytes = new Uint8Array(asset.bytes);
  } else {
    const ch = await prisma.channel.findFirst({ where: { isMediaLibrary: true }, select: { username: true } });
    const link = telegramMessageLink(asset.telegramRef, ch?.username ?? null);
    if (!playableInBrowser(asset)) return tooBig(link);
    let r: Uint8Array | "too_big" | null;
    try {
      r = await shortBytes(asset.id);
    } catch {
      return new Response("Lecture impossible pour l'instant : réessayez dans un moment.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (r === "too_big") return tooBig(link);
    if (!r) return new Response("Lecture pas encore disponible ici : ouvrez le short dans Telegram.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    bytes = r;
  }

  const size = bytes.byteLength;
  const headers: Record<string, string> = {
    "Content-Type": asset.mimeType || "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename || `short-${clip.index}.mp4`)}"`,
  };
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    return new Response(streamOf(bytes.subarray(range.start, range.end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  return new Response(streamOf(bytes), { headers: { ...headers, "Content-Length": String(size) } });
}
