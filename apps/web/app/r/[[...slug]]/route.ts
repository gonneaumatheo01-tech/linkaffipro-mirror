import { after } from "next/server";
import { buildRedirectEvent, logRedirect, redirectResponse, resolveTarget } from "@/lib/tracking";
import {
  assistantOfferSubIdOf,
  offerOpenRequest,
  recordAssistantOfferOpen,
  resolveAssistantOffer,
} from "@/lib/assistant/offer-redirect";

export const dynamic = "force-dynamic";

/**
 * Redirection go.goolink.eu : une requête en base, 302 immédiat, journalisation après la réponse.
 * `/a/<subId>` : lien d'offre envoyé par l'assistant de conversation (phase 17) ; un sub-ID inconnu suit le chemin
 * d'un lien inconnu.
 */
export async function GET(req: Request, ctx: RouteContext<"/r/[[...slug]]">) {
  const { slug } = await ctx.params;
  const parts = slug ?? [];
  const subId = assistantOfferSubIdOf(parts);
  if (subId) {
    const offer = await resolveAssistantOffer(subId);
    if (offer) {
      const request = offerOpenRequest(req);
      after(async () => {
        try {
          await recordAssistantOfferOpen(offer, request);
        } catch (err) {
          console.error("[assistant] ouverture du lien d'offre non enregistrée", err);
        }
      });
      return redirectResponse(offer.offer.target);
    }
  }
  const resolved = await resolveTarget(parts);
  const payload = buildRedirectEvent(req, resolved);
  after(async () => {
    await logRedirect(payload);
  });
  return redirectResponse(resolved.target);
}

export async function HEAD(_req: Request, ctx: RouteContext<"/r/[[...slug]]">) {
  const { slug } = await ctx.params;
  const parts = slug ?? [];
  const subId = assistantOfferSubIdOf(parts);
  if (subId) {
    // Rien n'est compté pour une requête HEAD.
    const offer = await resolveAssistantOffer(subId);
    if (offer) return redirectResponse(offer.offer.target);
  }
  const resolved = await resolveTarget(parts);
  return redirectResponse(resolved.target);
}
