import { isValidCustomEmojiId } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { apiUser } from "@/lib/ai/api-user";
import { previewEtag, previewPayload } from "@/lib/custom-emoji/preview";

export const dynamic = "force-dynamic";

/**
 * Aperçu d'un emoji animé par son identifiant Telegram (phase 12) : animation (JSON, un fichier .tgs est décompressé
 * ici), vidéo ou image, en cache privé du navigateur. Pas d'aperçu (pas encore récupéré, emoji absent de la
 * bibliothèque, fichier illisible) : 204 sans contenu (pas d'erreur dans la console du navigateur), l'emoji de
 * remplacement reste affiché. Identifiant invalide : 404. Utilisateurs connectés et actifs seulement.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/custom-emoji/[id]">) {
  if (!(await apiUser())) return new Response("non connecté", { status: 401 });
  const { id } = await ctx.params;
  if (!isValidCustomEmojiId(id)) return new Response("introuvable", { status: 404 });
  const row = await prisma.customEmoji.findUnique({
    where: { customEmojiId: id },
    select: { previewBytes: true, previewMime: true, previewAt: true },
  });
  if (!row?.previewBytes || !row.previewMime)
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const etag = previewEtag(id, row.previewAt);
  const cache = "private, max-age=86400";
  if (req.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cache } });
  const payload = previewPayload(row.previewBytes, row.previewMime);
  if (!payload)
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return new Response(payload.body as BodyInit, {
    headers: {
      "Content-Type": payload.contentType,
      "Content-Length": String(payload.body.length),
      "Cache-Control": cache,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
