/**
 * Phase 34, chantier A — point d'accroche du client EN PROCESSUS des opérations du site. Le chemin rapide de Kevin
 * tourne dans le webhook du site (`packages/telegram`, qui n'importe pas `apps/web`) : le site y pose son registre
 * (`apps/web/lib/site-ops/in-process.ts`, appel direct, sans réseau) ; le bot le lit au moment de l'appel.
 */
import type { SiteOpResult, SiteOpsClient } from "./contract";

let inProcess: SiteOpsClient | null = null;

export function setInProcessSiteOps(client: SiteOpsClient | null): void {
  inProcess = client;
}

export function inProcessSiteOpsPort(): SiteOpsClient | null {
  return inProcess;
}

/** Client qui délègue au registre posé par le site ; sans registre : « indisponible » (jamais d'exception). */
export const portSiteOps: SiteOpsClient = async (req) => {
  const c = inProcess;
  if (!c) return { ok: false, error: "", code: "unavailable" } satisfies SiteOpResult;
  return c(req);
};
