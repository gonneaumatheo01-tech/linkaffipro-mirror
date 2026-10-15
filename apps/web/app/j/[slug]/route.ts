import { landingNotOnThisHost, serveLandingPage } from "@/lib/landing/serve";
import { landingAllowedForRequest } from "@/lib/routing";

/**
 * Page d'atterrissage publique (phase 15) : `https://go.goolink.eu/j/<slug>?src=<source>`, servie depuis la mémoire
 * (aucune requête à la base pour une page connue), sans redirection ni écriture. Sur l'hôte du site seulement en
 * développement et en local (`landingAllowedForRequest`). Les visites et clics sont envoyés par la page elle-même
 * (`/j/_e`).
 */
export const dynamic = "force-dynamic";

function params(req: Request): { src: string | null; ifNoneMatch: string | null } {
  return {
    src: new URL(req.url).searchParams.get("src"),
    ifNoneMatch: req.headers.get("if-none-match"),
  };
}

export async function GET(req: Request, ctx: RouteContext<"/j/[slug]">) {
  if (!landingAllowedForRequest(req.headers)) return landingNotOnThisHost("GET");
  const { slug } = await ctx.params;
  const { src, ifNoneMatch } = params(req);
  return serveLandingPage(slug, src, ifNoneMatch, "GET");
}

export async function HEAD(req: Request, ctx: RouteContext<"/j/[slug]">) {
  if (!landingAllowedForRequest(req.headers)) return landingNotOnThisHost("HEAD");
  const { slug } = await ctx.params;
  const { src, ifNoneMatch } = params(req);
  return serveLandingPage(slug, src, ifNoneMatch, "HEAD");
}
