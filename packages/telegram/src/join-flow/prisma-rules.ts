/**
 * Règles d'adhésion relues en base (phase 11), partagées par le webhook (flux d'adhésion), le site (renvoi de
 * l'accueil) et le worker (rappels, expirations) : une seule résolution selon la provenance, une seule façon de relire
 * la règle d'une demande enregistrée (`loadRuleForMembership`).
 */
import { provenanceOfLink, type ProvenanceLink } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  loadRuleForMembership,
  resolveRuleForProvenance,
  type MembershipRuleInput,
  type RuleData,
  type RuleLoaders,
  type ScopedRuleRow,
} from "./rules";

/**
 * Règles actives d'un canal (règle par défaut et exceptions). À égalité de niveau et d'ordre, la plus récemment
 * modifiée passe d'abord (comme la règle par défaut relue avant la phase 11).
 */
export async function activeChannelRules(channelId: string): Promise<ScopedRuleRow[]> {
  return prisma.approvalRule.findMany({
    where: { channelId, isActive: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
}

/** Règle d'une nouvelle demande d'après son lien d'invitation (null : lien inconnu ou aucun lien). */
export async function resolveRuleWithDb(
  channelId: string,
  link: ProvenanceLink | null,
): Promise<RuleData> {
  return resolveRuleForProvenance(
    await activeChannelRules(channelId),
    provenanceOfLink(link),
    channelId,
  );
}

const prismaRuleLoaders: RuleLoaders = {
  ruleById: (id) => prisma.approvalRule.findUnique({ where: { id } }),
  channelRules: activeChannelRules,
  linkById: (id) =>
    prisma.inviteLink.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        sourceChannelId: true,
        adPlatform: true,
        // Lien d'affilié Link Affi (phase 13) : exceptions « un affilié précis ».
        linkaffiCampaignKey: true,
        linkaffiCampaignName: true,
        linkaffiAffiliateId: true,
        linkaffiAffiliateName: true,
      },
    }),
};

/** Règle d'une demande enregistrée (voir `loadRuleForMembership`), relue en base. */
export async function ruleForMembershipWithDb(m: MembershipRuleInput): Promise<RuleData> {
  return loadRuleForMembership(m, prismaRuleLoaders);
}
