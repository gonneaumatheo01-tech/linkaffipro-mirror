import { createHash } from "node:crypto";
import { audit, prisma } from "@linkaffipro/db";
import { apiUser } from "@/lib/ai/api-user";
import {
  AGENT_MEDIA_RULES,
  agentUploadProblem,
  existingAssetProblem,
  parsePurpose,
} from "@/lib/agents/dating";
import {
  casinoClassification,
  casinoExistingProblem,
  casinoUploadProblem,
  mediaThemes,
  parseCasinoSettings,
} from "@/lib/agents/casino";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Dépôt des médias des agents (phase 20, ADMIN et MANAGER) : images de référence d'une persona (`purpose=reference`)
 * et vidéos sources de l'équipe Rencontres (`purpose=source`). Multipart : `purpose`, `personaId`, un ou plusieurs
 * `files`. Chaque fichier devient un `MediaAsset` rangé (persona, nature, origine humaine, équipe Rencontres) ; même
 * empreinte qu'un fichier existant : il est rangé à son tour, sauf s'il l'est déjà pour une autre persona.
 * Réponse : `{ files: [{ id, filename, mimeType, size, error? }] }`. Journal `agents.media_uploaded` (nouveau
 * fichier) ou `agents.media_reclassified` (fichier déjà en base rangé à son tour : `from` / `to`).
 * Équipe Casino (phase 22, `purpose=casino`) : vidéos et images déposées par l'équipe avec un ou plusieurs `themes`
 * (thèmes connus de l'équipe) ; voir `casinoUpload`.
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
  if (form.get("purpose") === "casino") return casinoUpload(form, user.id);
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
      select: { id: true, personaId: true, kind: true, origin: true, teamKey: true },
    });
    if (existing) {
      const conflict = existingAssetProblem(existing, { personaId, kind: rule.kind });
      if (conflict) {
        out.push({ id: "", filename, mimeType: mime, size: buf.length, error: conflict });
        continue;
      }
      await prisma.mediaAsset.update({ where: { id: existing.id }, data: classify });
      await audit({
        userId: user.id,
        action: "agents.media_reclassified",
        entityType: "MediaAsset",
        entityId: existing.id,
        metadata: {
          purpose,
          from: {
            personaId: existing.personaId ?? null,
            kind: existing.kind ?? null,
            origin: existing.origin ?? null,
            teamKey: existing.teamKey ?? null,
          },
          to: classify,
          via: "dépôt sur la fiche",
        },
      });
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

type UploadOut = Array<{ id: string; filename: string; mimeType: string; size: number; error?: string }>;

/**
 * Dépôt Casino : chaque fichier devient un `MediaAsset` de l'équipe Casino, d'origine humaine (jamais un média de
 * l'IA), thème principal = le premier thème coché, tous les thèmes en tags `theme:<clé>`. Même empreinte qu'un média
 * de l'équipe : ses thèmes s'ajoutent (et il quitte « à classer ») ; un média d'une autre équipe ou produit par l'IA
 * est refusé.
 */
async function casinoUpload(form: FormData, userId: string): Promise<Response> {
  const config = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" }, select: { settings: true } });
  const known = parseCasinoSettings(config?.settings).themes.map((t) => t.key);
  const themes = form
    .getAll("themes")
    .filter((v): v is string => typeof v === "string")
    .filter((v, i, a) => a.indexOf(v) === i);
  if (themes.length === 0) return Response.json({ error: "Cochez au moins un thème." }, { status: 400 });
  if (themes.some((t) => !known.includes(t)))
    return Response.json({ error: "Thème inconnu : rechargez la page." }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "Aucun fichier." }, { status: 400 });
  if (files.length > 10) return Response.json({ error: "10 fichiers au plus à la fois." }, { status: 400 });

  const out: UploadOut = [];
  for (const f of files) {
    const mime = f.type || "application/octet-stream";
    const filename = f.name.slice(0, 200);
    const problem = casinoUploadProblem(mime, f.size);
    if (problem) {
      out.push({ id: "", filename, mimeType: mime, size: f.size, error: problem });
      continue;
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const existing = await prisma.mediaAsset.findUnique({
      where: { sha256 },
      select: { id: true, teamKey: true, origin: true, kind: true, theme: true, tags: true },
    });
    if (existing) {
      const conflict = casinoExistingProblem(existing);
      if (conflict) {
        out.push({ id: "", filename, mimeType: mime, size: buf.length, error: conflict });
        continue;
      }
      const merged = [...mediaThemes(existing), ...themes].filter((v, i, a) => a.indexOf(v) === i);
      const data = casinoClassification(mime, merged);
      // Étiquettes d'un média casino : `casino`, `theme:<clé>` (et `a-classer`, retiré ici) seulement.
      await prisma.mediaAsset.update({ where: { id: existing.id }, data });
      await audit({
        userId,
        action: "agents.media_reclassified",
        entityType: "MediaAsset",
        entityId: existing.id,
        metadata: {
          purpose: "casino",
          themes: merged,
          from: {
            teamKey: existing.teamKey ?? null,
            origin: existing.origin ?? null,
            kind: existing.kind ?? null,
            theme: existing.theme ?? null,
            tags: existing.tags ?? [],
          },
          to: data,
          via: "dépôt sur la fiche",
        },
      });
      out.push({ id: existing.id, filename, mimeType: mime, size: buf.length });
      continue;
    }
    const asset = await prisma.mediaAsset.create({
      data: {
        filename,
        mimeType: mime,
        size: buf.length,
        sha256,
        bytes: buf,
        createdById: userId,
        ...casinoClassification(mime, themes),
      },
      select: { id: true },
    });
    await audit({
      userId,
      action: "agents.media_uploaded",
      entityType: "MediaAsset",
      entityId: asset.id,
      metadata: { purpose: "casino", themes, filename, size: buf.length, mimeType: mime },
    });
    out.push({ id: asset.id, filename, mimeType: mime, size: buf.length });
  }
  return Response.json({ files: out });
}
