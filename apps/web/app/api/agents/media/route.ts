import { createHash } from "node:crypto";
import { audit, prisma } from "@linkaffipro/db";
import { apiUser } from "@/lib/ai/api-user";
import {
  AGENT_MEDIA_RULES,
  agentUploadProblem,
  existingAssetProblem,
  parsePurpose,
} from "@/lib/agents/dating";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Dépôt des médias des agents (phase 20, ADMIN et MANAGER) : images de référence d'une persona (`purpose=reference`)
 * et vidéos sources de l'équipe Rencontres (`purpose=source`). Multipart : `purpose`, `personaId`, un ou plusieurs
 * `files`. Chaque fichier devient un `MediaAsset` rangé (persona, nature, origine humaine, équipe Rencontres) ; même
 * empreinte qu'un fichier existant : il est rangé à son tour, sauf s'il l'est déjà pour une autre persona.
 * Réponse : `{ files: [{ id, filename, mimeType, size, error? }] }`. Journal `agents.media_uploaded`.
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return Response.json({ error: "Non connecté." }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: "Envoi illisible : le fichier est sans doute trop lourd (50 Mo au plus)." },
      { status: 400 },
    );
  }
  const purpose = parsePurpose(form.get("purpose"));
  if (!purpose) return Response.json({ error: "Type de dépôt inconnu : rechargez la page." }, { status: 400 });
  const personaId = String(form.get("personaId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(personaId))
    return Response.json({ error: "Choisissez d'abord la persona." }, { status: 400 });
  const persona = await prisma.persona.findUnique({ where: { id: personaId }, select: { id: true } });
  if (!persona) return Response.json({ error: "Persona introuvable : rechargez la page." }, { status: 404 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "Aucun fichier." }, { status: 400 });
  if (files.length > 10) return Response.json({ error: "10 fichiers au plus à la fois." }, { status: 400 });

  const rule = AGENT_MEDIA_RULES[purpose];
  const out: Array<{ id: string; filename: string; mimeType: string; size: number; error?: string }> = [];
  for (const f of files) {
    const mime = f.type || "application/octet-stream";
    const filename = f.name.slice(0, 200);
    const problem = agentUploadProblem(purpose, mime, f.size);
    if (problem) {
      out.push({ id: "", filename, mimeType: mime, size: f.size, error: problem });
      continue;
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const classify = { personaId, kind: rule.kind, origin: "HUMAN" as const, teamKey: "dating" };
    const existing = await prisma.mediaAsset.findUnique({
      where: { sha256 },
      select: { id: true, personaId: true, kind: true },
    });
    if (existing) {
      const conflict = existingAssetProblem(existing, { personaId, kind: rule.kind });
      if (conflict) {
        out.push({ id: "", filename, mimeType: mime, size: buf.length, error: conflict });
        continue;
      }
      await prisma.mediaAsset.update({ where: { id: existing.id }, data: classify });
      out.push({ id: existing.id, filename, mimeType: mime, size: buf.length });
      continue;
    }
    const asset = await prisma.mediaAsset.create({
      data: { filename, mimeType: mime, size: buf.length, sha256, bytes: buf, createdById: user.id, ...classify },
      select: { id: true },
    });
    await audit({
      userId: user.id,
      action: "agents.media_uploaded",
      entityType: "MediaAsset",
      entityId: asset.id,
      metadata: { purpose, personaId, filename, size: buf.length, mimeType: mime },
    });
    out.push({ id: asset.id, filename, mimeType: mime, size: buf.length });
  }
  return Response.json({ files: out });
}
