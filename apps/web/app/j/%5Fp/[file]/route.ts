import { MISS_CACHE_CONTROL, ROBOTS } from "@/lib/landing/headers";
import { serveLandingPhoto } from "@/lib/landing/serve";
import { landingAllowedForRequest } from "@/lib/routing";

/**
 * Photo du canal d'une page d'atterrissage (`/j/_p/<channelId>.jpg?v=<version>`, phase 15) : depuis la mémoire,
 * seulement pour un canal dont une page active affiche la photo ; gardée un an quand l'adresse porte la bonne version.
 */
export const dynamic = "force-dynamic";

/** Hôte qui ne sert pas les pages (adresse du site en production) : 404, comme une photo inconnue. */
function notHere(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": MISS_CACHE_CONTROL, "X-Robots-Tag": ROBOTS },
  });
}

function params(req: Request): { v: string | null; ifNoneMatch: string | null } {
  return {
    v: new URL(req.url).searchParams.get("v"),
    ifNoneMatch: req.headers.get("if-none-match"),
  };
}

export async function GET(req: Request, ctx: RouteContext<"/j/_p/[file]">) {
  if (!landingAllowedForRequest(req.headers)) return notHere();
  const { file } = await ctx.params;
  const { v, ifNoneMatch } = params(req);
  return serveLandingPhoto(file, v, ifNoneMatch, "GET");
}

export async function HEAD(req: Request, ctx: RouteContext<"/j/_p/[file]">) {
  if (!landingAllowedForRequest(req.headers)) return notHere();
  const { file } = await ctx.params;
  const { v, ifNoneMatch } = params(req);
  return serveLandingPhoto(file, v, ifNoneMatch, "HEAD");
}
