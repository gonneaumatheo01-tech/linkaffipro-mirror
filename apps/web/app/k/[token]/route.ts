import { prisma } from "@linkaffipro/db";
import type { AgentsDeps } from "@linkaffipro/agents";
import { apiUser } from "@/lib/ai/api-user";
import { openAuthLink } from "@/lib/boss-inputs/auth-link-route";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /k/<jeton> : lien d'autorisation envoyé par Kevin (phase 34), usage unique, 15 minutes. Chemin public
 * (`lib/routing.ts`) : le jeton fait foi, la sécurité du compte reste à la page de connexion et aux routes OAuth.
 */
export async function GET(_req: Request, ctx: RouteContext<"/k/[token]">) {
  const { token } = await ctx.params;
  return openAuthLink(token, {
    links: { prisma: prisma as unknown as AgentsDeps["prisma"], appBaseUrl: env.appBaseUrl },
    user: apiUser,
    baseUrl: env.appBaseUrl,
  });
}
