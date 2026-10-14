import { linkaffiNotFound } from "@/lib/integrations/linkaffi/handler";

export const dynamic = "force-dynamic";

/**
 * Adresse inconnue sous l'API d'intégration Link Affi : 404 en JSON (jamais une page du site), clé vérifiée et appel
 * journalisé comme pour les autres routes (`integration.linkaffi.unknown_route`).
 */
const notFound = linkaffiNotFound();

export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
export const PUT = notFound;
export const DELETE = notFound;
