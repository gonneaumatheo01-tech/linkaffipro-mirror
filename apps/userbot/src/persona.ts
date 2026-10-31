import { prisma } from "@linkaffipro/db";
/**
 * Persona d'un compte réel (phase 18) : règles pures du userbot. Un compte réel ne parle qu'en Rencontres : une persona
 * Casino ou Paris sportifs branchée sur un compte (choix refusé par le site, mais possible par un ancien formulaire ou
 * un script) fait SAUTER le tour (`persona_universe`, journalisé sans texte). L'univers et la fiche d'informations sont
 * tout de même transmis au moteur, comme le worker (`apps/worker/src/assistant/rules.ts`).
 */
import { effectiveIdentityKind, parsePersonaFaq, parsePersonaUniverse } from "@linkaffipro/core";
import type { PersonaInput } from "@linkaffipro/chat";
import { offerUsable } from "./offer-link";

export type UserbotPersonaRow = {
  id: string;
  name: string;
  isActive: boolean;
  identityKind: string;
  illusion: boolean;
  age: number | null;
  gender: PersonaInput["gender"];
  personality: string;
  tone: string;
  languages: string[];
  interests: string[];
  extraPrompt: string | null;
  styleExamples?: string | null;
  model: string | null;
  temperature: number | null;
  minExchangesBeforeOffer: number;
  requireInterest: boolean;
  maxOfferSends: number;
  followUpAfterHours: number;
  followUpsMax: number;
  offerPitch: string;
  offerButtonText: string;
  offerMediaAssetId: string | null;
  affiliateCampaignId: string | null;
  affiliateCampaign: { isActive: boolean; trackingUrlTemplate: string } | null;
  universe?: string | null;
  faq?: unknown;
};

/** Raison de ne pas répondre avec cette persona (null = tour permis). */
export function personaSkipReason(p: Pick<UserbotPersonaRow, "isActive" | "universe"> | null): string | null {
  if (!p) return "no_persona";
  if (!p.isActive) return "persona_inactive";
  if (parsePersonaUniverse(p.universe) !== "dating") return "persona_universe";
  return null;
}

export function toPersonaInput(p: UserbotPersonaRow, botName: string): PersonaInput {
  const usable = offerUsable(p.affiliateCampaign);
  return {
    name: p.name,
    identity: effectiveIdentityKind(p.universe, p.identityKind),
    illusion: p.illusion,
    age: p.age,
    gender: p.gender,
    personality: p.personality,
    tone: p.tone,
    languages: p.languages,
    interests: p.interests,
    extraPrompt: p.extraPrompt,
    styleExamples: p.styleExamples ?? null,
    model: p.model,
    temperature: p.temperature,
    minExchangesBeforeOffer: p.minExchangesBeforeOffer,
    requireInterest: p.requireInterest,
    maxOfferSends: p.maxOfferSends,
    followUpAfterHours: p.followUpAfterHours,
    followUpsMax: p.followUpsMax,
    offerPitch: p.offerPitch,
    offerButtonText: p.offerButtonText,
    // Comme le worker : sans offre exploitable le moteur ne parle jamais du lien (aucun ne pourrait partir).
    hasOffer: Boolean(p.affiliateCampaignId) && usable,
    offerMediaAssetId: usable ? p.offerMediaAssetId : null,
    channelTitle: null,
    botName,
    universe: parsePersonaUniverse(p.universe),
    faq: parsePersonaFaq(p.faq),
  };
}

/** Photos de chauffe de la persona (emplacements 1 a 5) : media a envoyer et description factuelle pour l'accroche. */
export async function loadFlirtPhotos(
  personaId: string,
): Promise<{ slot: number; assetId: string; description: string }[]> {
  // Certains harnais de test fournissent un client Prisma partiel : sans la table, aucune photo, jamais d'erreur.
  const table = prisma.personaFlirtMedia;
  if (!table) return [];
  return table.findMany({
    where: { personaId },
    orderBy: { slot: "asc" },
    select: { slot: true, assetId: true, description: true },
  });
}
