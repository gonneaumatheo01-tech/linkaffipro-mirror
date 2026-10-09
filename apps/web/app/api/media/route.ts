import { createHash } from "node:crypto";
import { prisma, audit } from "@linkaffipro/db";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;
const WARN_BYTES = 20 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|webm)|application\/pdf|application\/zip|audio\/(mpeg|ogg|mp4))$/;

/** Téléversement d'un ou plusieurs médias (multipart, champ `files`). Dédoublonnage par sha256. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Non connecté." }, { status: 401 });
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "Aucun fichier." }, { status: 400 });
  const out: Array<{ id: string; filename: string; mimeType: string; size: number; warning?: string; error?: string }> = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      out.push({ id: "", filename: f.name, mimeType: f.type, size: f.size, error: "Fichier refusé : plus de 50 Mo." });
      continue;
    }
    const mime = f.type || "application/octet-stream";
    if (!ALLOWED.test(mime)) {
      out.push({ id: "", filename: f.name, mimeType: mime, size: f.size, error: `Type non pris en charge (${mime}).` });
      continue;
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const existing = await prisma.mediaAsset.findUnique({ where: { sha256 }, select: { id: true } });
    const asset = existing ?? (await prisma.mediaAsset.create({ data: { filename: f.name.slice(0, 200), mimeType: mime, size: buf.length, sha256, bytes: buf, createdById: session.user.id }, select: { id: true } }));
    if (!existing) await audit({ userId: session.user.id, action: "media.uploaded", entityType: "MediaAsset", entityId: asset.id, metadata: { filename: f.name, size: buf.length, mimeType: mime } });
    out.push({ id: asset.id, filename: f.name, mimeType: mime, size: buf.length, warning: buf.length > WARN_BYTES ? "Plus de 20 Mo : pas d'aperçu dans l'interface, mais l'envoi Telegram fonctionne." : undefined });
  }
  return Response.json({ files: out });
}
