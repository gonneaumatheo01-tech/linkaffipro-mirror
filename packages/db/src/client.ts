import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Options du client partagé. `omit` : colonnes lourdes jamais lues sans le demander explicitement
 * (`select: { photoSmall: true }`) : la petite photo d'un canal (octets JPEG, phase 15) ne sert qu'au cache des pages
 * d'atterrissage et à la route de la photo ; sans cela, chaque requête de canal sans `select` (liste des canaux, fiche,
 * création d'un lien…) la transférerait.
 */
export const PRISMA_OPTIONS = {
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  omit: { channel: { photoSmall: true } },
} satisfies Prisma.PrismaClientOptions;

function createClient() {
  return new PrismaClient(PRISMA_OPTIONS);
}

/** Type du client partagé (avec ses colonnes omises par défaut). */
export type Db = ReturnType<typeof createClient>;

/** Client Prisma partagé (une seule instance par process, y compris en dev avec rechargement). */
const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const prisma: Db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
