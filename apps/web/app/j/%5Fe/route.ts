import { after } from "next/server";
import { beaconRequestInfo, readBeaconBody, recordLandingBeacon } from "@/lib/landing/events";
import { ROBOTS } from "@/lib/landing/headers";
import { landingAllowedForRequest } from "@/lib/routing";

/**
 * Envoi des visites, clics et ouvertures de Telegram par les pages d'atterrissage (`/j/_e`, `navigator.sendBeacon`,
 * phase 15). Réponse 204 immédiate ; vérification, pays, empreinte et mise en file `landing-events` après la réponse
 * (`after()`), jamais d'écriture en base ici. Venu de l'hôte du site en production (`landingAllowedForRequest`) :
 * 204 et rien d'autre (aucune visite de l'équipe comptée, aucune page servie là).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": ROBOTS };
  if (!landingAllowedForRequest(req.headers)) return new Response(null, { status: 204, headers });
  const info = beaconRequestInfo(req);
  const raw = await readBeaconBody(req);
  after(() => recordLandingBeacon(raw, info));
  return new Response(null, { status: 204, headers });
}
