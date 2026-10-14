/**
 * Règles pures de `POST /invite-links` et `PATCH /invite-links/{id}` (contrat `docs/LINKAFFI-PARTENAIRES.md` § 1) :
 * - une clé de campagne = un affilié : la même clé envoyée pour un autre affilié est refusée (409) ;
 * - idempotence : même clé + même canal = même lien (200, aucun nouvel appel à Telegram) ; les noms et la durée
 *   d'attribution envoyés de nouveau sont mis à jour (la durée vaut pour les prochaines attributions) ; un champ
 *   facultatif absent (`affiliateName`, `attributionDays` : `undefined`) ne change rien, `null` le vide (« à vie ») ;
 * - un lien désactivé ne revient jamais : même clé + même canal après désactivation = 409 (nouvelle campagne dans
 *   Link Affi, donc nouvelle clé) ;
 * - même clé pour un autre canal : nouveau lien pour ce canal (201).
 */

export type LinkaffiLinkRow = {
  id: string;
  channelId: string;
  isActive: boolean;
  telegramInviteLink: string;
  linkaffiAffiliateId: string | null;
  linkaffiCampaignName: string | null;
  linkaffiAffiliateName: string | null;
  attributionDays: number | null;
};

export type CreateRequest = {
  campaignKey: string;
  campaignName: string;
  affiliateId: string;
  /** Absent (`undefined`) : non précisé, rien ne change sur un lien existant ; `null` : pas de nom. */
  affiliateName?: string | null;
  channelId: string;
  /** Absent (`undefined`) : non précisé, rien ne change sur un lien existant ; `null` : à vie. */
  attributionDays?: number | null;
};

export type CreateDecision =
  | { kind: "create" }
  | {
      kind: "existing";
      link: LinkaffiLinkRow;
      /** Champs à mettre à jour (vide : rien n'a changé). */
      updates: Partial<
        Pick<LinkaffiLinkRow, "linkaffiCampaignName" | "linkaffiAffiliateName" | "attributionDays">
      >;
    }
  | { kind: "affiliate_mismatch"; link: LinkaffiLinkRow }
  | { kind: "disabled"; link: LinkaffiLinkRow };

/** Que faire d'une demande de lien, vu les liens LINKAFFI déjà enregistrés pour la même clé (tous canaux). */
export function decideInviteLinkCreation(
  req: CreateRequest,
  sameKey: readonly LinkaffiLinkRow[],
): CreateDecision {
  const other = sameKey.find(
    (l) => l.linkaffiAffiliateId !== null && l.linkaffiAffiliateId !== req.affiliateId,
  );
  if (other) return { kind: "affiliate_mismatch", link: other };
  const here = sameKey.find((l) => l.channelId === req.channelId);
  if (!here) return { kind: "create" };
  if (!here.isActive) return { kind: "disabled", link: here };
  const updates: Extract<CreateDecision, { kind: "existing" }>["updates"] = {};
  if (here.linkaffiCampaignName !== req.campaignName)
    updates.linkaffiCampaignName = req.campaignName;
  if (req.affiliateName !== undefined && here.linkaffiAffiliateName !== req.affiliateName)
    updates.linkaffiAffiliateName = req.affiliateName;
  if (req.attributionDays !== undefined && here.attributionDays !== req.attributionDays)
    updates.attributionDays = req.attributionDays;
  return { kind: "existing", link: here, updates };
}

export type DeactivateDecision =
  | { kind: "revoke" }
  | { kind: "already_inactive" }
  | { kind: "already_active" }
  | { kind: "reactivation_refused" };

/** `PATCH { isActive }` : désactiver (révocation chez Telegram), rien à faire, ou réactivation refusée. */
export function decideInviteLinkPatch(
  link: { isActive: boolean },
  isActive: boolean,
): DeactivateDecision {
  if (isActive)
    return link.isActive ? { kind: "already_active" } : { kind: "reactivation_refused" };
  return link.isActive ? { kind: "revoke" } : { kind: "already_inactive" };
}
