import { prisma } from "@linkaffipro/db";
/**
 * Persona d'un compte réel (phase 18 + 36) : un compte réel peut être Rencontres, Paris sportifs (VIP manager) ou Casino.
 * L'univers et la fiche d'informations sont transmis au moteur, comme le worker (`apps/worker/src/assistant/rules.ts`).
 */
import { effectiveIdentityKind, isVipManager, parsePersonaFaq, parsePersonaUniverse } from "@linkaffipro/core";
import { parseSuggestedFollowUpHours, type PersonaInput } from "@linkaffipro/chat";
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
  suggestedFollowUpHours?: unknown;
  offerPitch: string;
  offerButtonText: string;
  offerMediaAssetId: string | null;
  affiliateCampaignId: string | null;
  affiliateCampaign: { isActive: boolean; trackingUrlTemplate: string } | null;
  universe?: string | null;
  faq?: unknown;
  responseDelayMinSec?: number | null;
  responseDelayMaxSec?: number | null;
  bookmakers?: readonly {
    bookmakerKey: string;
    label: string;
    priority: number;
    inviteLinkId: string | null;
    inviteLink: { telegramInviteLink: string | null } | null;
  }[];
};

/** Raison de ne pas répondre avec cette persona (null = tour permis). */
export function personaSkipReason(p: Pick<UserbotPersonaRow, "isActive"> | null): string | null {
  if (!p) return "no_persona";
  if (!p.isActive) return "persona_inactive";
  return null;
}

export function toPersonaInput(p: UserbotPersonaRow, botName: string): PersonaInput {
  const universe = parsePersonaUniverse(p.universe);
  const books = vipBookmakers(p);
  const hasBookmakerOffer = books.length > 0;
  const usable = hasBookmakerOffer || offerUsable(p.affiliateCampaign);
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
    suggestedFollowUpHours: parseSuggestedFollowUpHours(p.suggestedFollowUpHours),
    offerPitch: p.offerPitch,
    offerButtonText: p.offerButtonText,
    hasOffer: (Boolean(p.affiliateCampaignId) || hasBookmakerOffer) && usable,
    offerMediaAssetId: usable ? p.offerMediaAssetId : null,
    channelTitle: null,
    botName,
    universe,
    faq: parsePersonaFaq(p.faq),
    vipManager: isVipManager(universe, p.identityKind),
    bookmakers: books.length
      ? books.map((pb) => ({
          bookmakerKey: pb.bookmakerKey,
          label: pb.label,
          priority: pb.priority,
          hasInviteLink: Boolean(pb.inviteLinkId && pb.inviteLink?.telegramInviteLink),
        }))
      : undefined,
    responseDelay:
      p.responseDelayMinSec != null && p.responseDelayMaxSec != null
        ? { minSec: p.responseDelayMinSec, maxSec: p.responseDelayMaxSec }
        : null,
  };
}

function vipBookmakers(p: UserbotPersonaRow) {
  if (!p.bookmakers?.length) return [];
  const universe = parsePersonaUniverse(p.universe);
  if (!isVipManager(universe, p.identityKind)) return [];
  return [...p.bookmakers].sort((a, b) => a.priority - b.priority);
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
