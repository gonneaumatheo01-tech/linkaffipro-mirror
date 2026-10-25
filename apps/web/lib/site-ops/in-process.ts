/**
 * Phase 34, chantier A — client EN PROCESSUS des opérations du site pour le chemin rapide de Kevin (webhook du site) :
 * appel direct du registre, sans réseau ni signature, avec la même revérification du rôle en base que l'entrée
 * interne. Posé sur le point d'accroche de `@linkaffipro/agents` par `installInProcessSiteOps()` (route du webhook).
 */
import { setInProcessSiteOps, type SiteOpsClient } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { executeSiteOp, type SiteOpsDb } from "./execute";

export const inProcessSiteOps: SiteOpsClient = (req) =>
  executeSiteOp(prisma as unknown as SiteOpsDb, req, (msg, meta) => console.error(msg, meta));

let installed = false;

export function installInProcessSiteOps(): void {
  if (installed) return;
  installed = true;
  setInProcessSiteOps(inProcessSiteOps);
}
