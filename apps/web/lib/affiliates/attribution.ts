/**
 * Correction manuelle de l'affilié d'un membre (fiche membre, ADMIN seulement, phase 13) : règles pures, testées dans
 * attribution.test.ts. L'écriture (base, journal) est dans attribution-server.ts.
 *
 * - « Changer d'affilié » : choix parmi les campagnes Telegram d'affiliés existantes (liens LINKAFFI) ; le membre
 *   prend la clé, l'affilié et le lien de cette campagne, rattaché à la date du changement, pour la durée de la
 *   campagne (à vie sans durée).
 * - « Retirer l'attribution » : plus aucun affilié (le membre n'envoie plus d'événements à Link Affi et ses clics
 *   d'offre ne portent plus de clé).
 * - Un motif est obligatoire (journal `member.affiliate_changed` / `member.affiliate_removed`).
 */
import { affiliateAttributionEndsAt } from "@linkaffipro/core";

export const REASON_MIN = 3;
export const REASON_MAX = 500;

export type ReasonResult = { ok: true; reason: string } | { ok: false; error: string };

/** Motif saisi : obligatoire, 3 à 500 caractères (espaces en trop retirés). */
export function parseReason(raw: unknown): ReasonResult {
  const reason = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (reason.length < REASON_MIN)
    return {
      ok: false,
      error: "Indiquez le motif de la correction (quelques mots) : il est gardé dans le journal.",
    };
  if (reason.length > REASON_MAX)
    return { ok: false, error: `Le motif est trop long : ${REASON_MAX} caractères au plus.` };
  return { ok: true, reason };
}

/** Champs de l'affilié d'un membre (`Member`). */
export type MemberAffiliateFields = {
  linkaffiCampaignKey: string | null;
  linkaffiAffiliateId: string | null;
  affiliateAttributedAt: Date | null;
  affiliateAttributionEndsAt: Date | null;
  affiliateInviteLinkId: string | null;
};

/** Aucun affilié. */
export const NO_AFFILIATE: MemberAffiliateFields = {
  linkaffiCampaignKey: null,
  linkaffiAffiliateId: null,
  affiliateAttributedAt: null,
  affiliateAttributionEndsAt: null,
  affiliateInviteLinkId: null,
};

/** Rattachement à une campagne choisie par un ADMIN, à la date du changement. */
export function attributionToCampaign(
  link: {
    id: string;
    linkaffiCampaignKey: string;
    linkaffiAffiliateId: string | null;
    attributionDays: number | null;
  },
  now: Date,
): MemberAffiliateFields {
  return {
    linkaffiCampaignKey: link.linkaffiCampaignKey,
    linkaffiAffiliateId: link.linkaffiAffiliateId,
    affiliateAttributedAt: now,
    affiliateAttributionEndsAt: affiliateAttributionEndsAt(now, link.attributionDays),
    affiliateInviteLinkId: link.id,
  };
}

/** Instantané pour le journal (dates en texte ISO). */
export function attributionSnapshot(f: MemberAffiliateFields): Record<string, string | null> {
  return {
    campaignKey: f.linkaffiCampaignKey,
    affiliateId: f.linkaffiAffiliateId,
    inviteLinkId: f.affiliateInviteLinkId,
    attributedAt: f.affiliateAttributedAt?.toISOString() ?? null,
    endsAt: f.affiliateAttributionEndsAt?.toISOString() ?? null,
  };
}
