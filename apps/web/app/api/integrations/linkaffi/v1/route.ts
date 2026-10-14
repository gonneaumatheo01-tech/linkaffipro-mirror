import { linkaffiNotFound } from "@/lib/integrations/linkaffi/handler";

export const dynamic = "force-dynamic";

/**
 * Racine de l'API d'intégration Link Affi (`/api/integrations/linkaffi/v1`, sans adresse) : 404 en JSON avec la liste
 * des adresses disponibles (le `[...path]` voisin ne couvre pas la racine).
 */
const notFound = linkaffiNotFound();

export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
export const PUT = notFound;
export const DELETE = notFound;
