/**
 * Endpoint temporaire : remplace la photo de posts programmés et crée les posts manquants. À supprimer après usage.
 */
import { createHash } from "node:crypto";
import { prisma, publishingBotFor } from "@linkaffipro/db";
import { shortId } from "@linkaffipro/core";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TOKEN_HASH = "ff96a032be359c0d38e5035e3cd9a3b06a808004e8c262826c8b164326d8b814";

interface FixOp {
  scheduledAt: string;
  text: string;
  file: string;
  create: boolean;
  newText?: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (createHash("sha256").update(token).digest("hex") !== TOKEN_HASH)
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const channelId = String(form.get("channelId") ?? "");
  const dryRun = form.get("dryRun") === "1";
  const ops: FixOp[] = JSON.parse(String(form.get("ops") ?? "[]"));

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, vertical: true },
  });
  if (!channel) return Response.json({ error: "Canal introuvable" }, { status: 404 });
  const bot = await publishingBotFor(channelId);
  if (!bot) return Response.json({ error: "Aucun bot actif sur ce canal" }, { status: 400 });
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (!admin) return Response.json({ error: "Aucun admin actif" }, { status: 500 });

  const targets = new Map<FixOp, string | null>();
  for (const op of ops) {
    if (op.create) {
      const dup = await prisma.post.findFirst({
        where: { channelId, scheduledAt: new Date(op.scheduledAt), text: op.text },
        select: { id: true },
      });
      targets.set(op, dup ? "EXISTE_DEJA" : null);
      continue;
    }
    const found = await prisma.post.findMany({
      where: { channelId, scheduledAt: new Date(op.scheduledAt), text: op.text, status: "SCHEDULED" },
      select: { id: true },
    });
    targets.set(op, found.length === 1 ? found[0]!.id : `TROUVES_${found.length}`);
  }

  const problems = ops
    .filter((op) => {
      const t = targets.get(op);
      return op.create ? t === "EXISTE_DEJA" : !t || t.startsWith("TROUVES_");
    })
    .map((op) => ({ scheduledAt: op.scheduledAt, file: op.file, result: targets.get(op) }));
  if (dryRun || problems.length)
    return Response.json({ ok: problems.length === 0, dryRun, ops: ops.length, problems });

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const assetByFilename = new Map<string, string>();
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const existing = await prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
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

  let updated = 0;
  let created = 0;
  for (const op of ops) {
    const assetId = assetByFilename.get(op.file);
    if (!assetId) return Response.json({ error: `Fichier absent : ${op.file}` }, { status: 400 });
    const text = op.newText ?? op.text;
    if (op.create) {
      await prisma.post.create({
        data: {
          code: shortId(8),
          channelId,
          botId: bot.id,
          status: "SCHEDULED",
          scheduledAt: new Date(op.scheduledAt),
          text,
          mediaAssetIds: [assetId],
          buttons: [],
          pinAfterSend: false,
          disableNotification: false,
          protectContent: false,
          disableLinkPreview: true,
          createdById: admin.id,
          updatedById: admin.id,
          vertical: channel.vertical,
        },
      });
      created++;
    } else {
      await prisma.post.update({
        where: { id: targets.get(op)! },
        data: { mediaAssetIds: [assetId], text, updatedById: admin.id },
      });
      updated++;
    }
  }

  return Response.json({ ok: true, updated, created, mediaUploaded: assetByFilename.size });
}
