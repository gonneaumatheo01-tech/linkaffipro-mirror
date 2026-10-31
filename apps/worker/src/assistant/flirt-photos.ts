import { prisma } from "@linkaffipro/db";

/**
 * Photos de chauffe de la persona (emplacements 1 a 5) : media a envoyer et description factuelle pour l'accroche.
 * Chargees a part de la persona pour ne pas alourdir les requetes qui la lisent.
 */
export async function loadFlirtPhotos(
  personaId: string,
): Promise<{ slot: number; assetId: string; description: string }[]> {
  // Certains harnais de test fournissent un client Prisma partiel : sans la table, aucune photo, jamais d'erreur.
  const table = prisma.personaFlirtMedia;
  if (!table) return [];
  return table.findMany({
    where: { personaId },
    orderBy: { slot: "asc" },
    select: { slot: true, assetId: true, description: true },
  });
}
