/**
 * Endpoint temporaire d'import en masse de posts.
 * Protégé par un jeton dans l'URL (variable BATCH_IMPORT_TOKEN). À supprimer après usage.
 */
import { createHash } from "node:crypto";
import { prisma, publishingBotFor } from "@linkaffipro/db";
import { shortId } from "@linkaffipro/core";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const IMPORT_TOKEN = process.env.BATCH_IMPORT_TOKEN ?? "";

interface PostEntry {
  text: string;
  scheduledAt: string; // ISO 8601
  mediaFilenames: string[]; // filenames from the multipart upload
}

/**
 * POST /api/batch-import/<token>
 *
 * Body: multipart/form-data
 *   - posts: JSON string with PostEntry[]
 *   - channelId: string
 *   - files: File[] (media files)
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!IMPORT_TOKEN || token !== IMPORT_TOKEN) return Response.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const channelId = String(form.get("channelId") ?? "");
  const postsJson = String(form.get("posts") ?? "[]");
  const posts: PostEntry[] = JSON.parse(postsJson);

  if (!channelId) return Response.json({ error: "channelId requis" }, { status: 400 });
  if (posts.length === 0) return Response.json({ error: "Aucun post" }, { status: 400 });

  // Resolve channel
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, title: true, vertical: true },
  });
  if (!channel) return Response.json({ error: `Canal ${channelId} introuvable` }, { status: 404 });

  // Find bot for this channel (same logic as post creation)
  const bot = await publishingBotFor(channelId);
  if (!bot) return Response.json({ error: "Aucun bot actif sur ce canal" }, { status: 400 });

  // Find first admin user for createdBy
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (!admin) return Response.json({ error: "Aucun admin actif" }, { status: 500 });

  // Upload media files → MediaAsset (deduplicated by sha256)
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const assetByFilename = new Map<string, string>();

  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const existing = await prisma.mediaAsset.findUnique({
      where: { sha256 },
      select: { id: true },
    });
    const asset =
      existing ??
      (await prisma.mediaAsset.create({
        data: {
          filename: f.name.slice(0, 200),
          mimeType: f.type || "application/octet-stream",
          size: buf.length,
          sha256,
          bytes: buf,
          createdById: admin.id,
        },
        select: { id: true },
      }));
    assetByFilename.set(f.name, asset.id);
  }

  // Create posts
  const created: string[] = [];
  for (const p of posts) {
    const mediaAssetIds = p.mediaFilenames
      .map((fn) => assetByFilename.get(fn))
      .filter((id): id is string => !!id);

    const post = await prisma.post.create({
      data: {
        code: shortId(8),
        channelId,
        botId: bot.id,
        status: "SCHEDULED",
        scheduledAt: new Date(p.scheduledAt),
        text: p.text,
        mediaAssetIds,
        buttons: [],
        pinAfterSend: false,
        disableNotification: false,
        protectContent: false,
        disableLinkPreview: true,
        createdById: admin.id,
        updatedById: admin.id,
        vertical: channel.vertical,
      },
      select: { id: true, code: true },
    });
    created.push(post.id);
  }

  return Response.json({
    ok: true,
    channel: channel.title,
    mediaUploaded: assetByFilename.size,
    postsCreated: created.length,
  });
}
