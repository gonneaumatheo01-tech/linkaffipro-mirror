/**
 * Lecture et enregistrement des « Médias du personnage » d'une persona (phase 20). ADMIN et MANAGER. Les images de
 * référence doivent être des images de la médiathèque, sans persona ou rangées pour celle-ci : elles sont alors
 * rangées (`MediaAsset` REFERENCE, origine humaine, équipe Rencontres, persona). Journal `persona.media_updated`
 * (champs modifiés, nombre d'images, domaine du fichier : jamais l'adresse entière ni les consignes).
 */
import { audit, prisma } from "@linkaffipro/db";
import {
  changedMediaFields,
  parseReferenceIds,
  urlHost,
  type PersonaMediaInput,
} from "./media";

export type PersonaMediaView = PersonaMediaInput & {
  references: Array<{ id: string; filename: string; mimeType: string }>;
};

const IMAGE = /^image\/(jpeg|png|webp)$/;

export async function loadPersonaMedia(personaId: string): Promise<PersonaMediaView | null> {
  const p = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { referenceImageIds: true, loraUrl: true, loraTrigger: true, loraScale: true, mediaNotes: true },
  });
  if (!p) return null;
  const ids = parseReferenceIds(p.referenceImageIds);
  const assets = ids.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: ids } },
        select: { id: true, filename: true, mimeType: true },
      })
    : [];
  // Ordre de la persona (la première sert de modèle) ; une image supprimée entre-temps disparaît de la liste.
  const references = ids.flatMap((id) => assets.filter((a) => a.id === id));
  return {
    referenceImageIds: references.map((r) => r.id),
    references,
    loraUrl: p.loraUrl,
    loraTrigger: p.loraTrigger,
    loraScale: p.loraScale,
    mediaNotes: p.mediaNotes,
  };
}

export type PersonaMediaSaveResult = { ok: true; message: string } | { ok: false; error: string };

export async function savePersonaMedia(
  personaId: string,
  input: PersonaMediaInput,
  userId: string | null,
  /** Phase 34 : essai à blanc (tout vérifié, rien d'écrit) et provenance notée au journal. */
  opts: { dryRun?: boolean; via?: "WEB" | "TELEGRAM" } = {},
): Promise<PersonaMediaSaveResult> {
  const before = await loadPersonaMedia(personaId);
  if (!before) return { ok: false, error: "Persona introuvable : rechargez la page." };
  if (input.referenceImageIds.length) {
    const assets = await prisma.mediaAsset.findMany({
      where: { id: { in: input.referenceImageIds } },
      select: { id: true, mimeType: true, personaId: true },
    });
    if (assets.length !== input.referenceImageIds.length)
      return { ok: false, error: "Une image de référence n'existe plus : rechargez la page." };
    if (assets.some((a) => !IMAGE.test(a.mimeType)))
      return { ok: false, error: "Les images de référence doivent être des images JPEG, PNG ou WebP." };
    if (assets.some((a) => a.personaId && a.personaId !== personaId))
      return { ok: false, error: "Une de ces images est rangée pour une autre persona." };
  }
  if (opts.dryRun) {
    const changed = changedMediaFields(before, input);
    return {
      ok: true,
      message: changed.length
        ? `Médias du personnage modifiés (${input.referenceImageIds.length} image(s) de référence).`
        : "Aucun changement dans les médias du personnage.",
    };
  }
  await prisma.$transaction([
    prisma.persona.update({
      where: { id: personaId },
      data: {
        referenceImageIds: input.referenceImageIds,
        loraUrl: input.loraUrl,
        loraTrigger: input.loraTrigger,
        loraScale: input.loraScale,
        mediaNotes: input.mediaNotes,
      },
    }),
    prisma.mediaAsset.updateMany({
      where: { id: { in: input.referenceImageIds } },
      data: { personaId, kind: "REFERENCE", origin: "HUMAN", teamKey: "dating" },
    }),
  ]);
  const changed = changedMediaFields(before, input);
  await audit({
    userId,
    action: "persona.media_updated",
    entityType: "Persona",
    entityId: personaId,
    metadata: {
      ...(opts.via ? { via: opts.via } : {}),
      changed,
      references: input.referenceImageIds.length,
      loraHost: urlHost(input.loraUrl),
      hasTrigger: Boolean(input.loraTrigger),
      loraScale: input.loraScale,
      mediaNotesLength: input.mediaNotes?.length ?? 0,
    },
  });
  return {
    ok: true,
    message: changed.length
      ? "Médias du personnage enregistrés : les agents s'en servent dès la prochaine production."
      : "Rien n'a changé dans les médias du personnage.",
  };
}
