import { prisma } from "@linkaffipro/db";
import { executeSiteOp, type SiteOpsDb } from "@/lib/site-ops/execute";
import { handleSiteOpsPost } from "@/lib/site-ops/endpoint";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Phase 34 : entrée interne des opérations du site pour Kevin (worker). Protégée par la signature HMAC (pas par la
 * session, chemin public dans `lib/routing.ts`) ; le rôle de l'acteur est relu en base ; jamais de pile en réponse.
 */
export async function POST(req: Request) {
  return handleSiteOpsPost(req, { run: (r) => executeSiteOp(prisma as unknown as SiteOpsDb, r, (msg, meta) => console.error(msg, meta)) });
}
