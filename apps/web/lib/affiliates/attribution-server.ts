/**
 * Correction manuelle de l'affilié d'un membre (fiche membre, phase 13) : écriture en base et journal. Le contrôle du
 * rôle (ADMIN) est fait par l'action serveur qui appelle ces fonctions (app/(admin)/members/[id]/actions.ts).
 * Chaque correction écrit un événement (`Event`, chronologie du membre) et une ligne du journal de l'équipe
 * (`AuditLog` `member.affiliate_changed` / `member.affiliate_removed`), avec le motif et l'état d'avant.
 */
import { audit, prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import {
  attributionSnapshot,
  attributionToCampaign,
  NO_AFFILIATE,
  parseReason,
  type MemberAffiliateFields,
} from "./attribution";
import { affiliateLabel, campaignLabel } from "./scope";

export type AttributionResult = { ok: true; message: string } | { ok: false; error: string };

const memberSelect = {
  id: true,
  anonymizedAt: true,
  linkaffiCampaignKey: true,
  linkaffiAffiliateId: true,
  affiliateAttributedAt: true,
  affiliateAttributionEndsAt: true,
  affiliateInviteLinkId: true,
} as const;

function fieldsOf(m: MemberAffiliateFields): MemberAffiliateFields {
  return {
    linkaffiCampaignKey: m.linkaffiCampaignKey,
    linkaffiAffiliateId: m.linkaffiAffiliateId,
    affiliateAttributedAt: m.affiliateAttributedAt,
    affiliateAttributionEndsAt: m.affiliateAttributionEndsAt,
    affiliateInviteLinkId: m.affiliateInviteLinkId,
  };
}

/** Rattache le membre à une autre campagne Telegram d'affilié (ou à une première, s'il n'en avait pas). */
export async function changeMemberAffiliate(input: {
  memberId: string;
  inviteLinkId: string;
  reason: unknown;
  userId: string;
  now?: Date;
}): Promise<AttributionResult> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  const member = await prisma.member.findUnique({
    where: { id: input.memberId },
    select: memberSelect,
  });
  if (!member) return { ok: false, error: "Ce membre n'existe plus." };
  if (member.anonymizedAt)
    return { ok: false, error: "Ce membre est anonymisé : son affilié ne se change plus." };
  const link = await prisma.inviteLink.findFirst({
    where: { id: input.inviteLinkId, kind: "LINKAFFI", linkaffiCampaignKey: { not: null } },
    select: {
      id: true,
      linkaffiCampaignKey: true,
      linkaffiCampaignName: true,
      linkaffiAffiliateId: true,
      linkaffiAffiliateName: true,
      attributionDays: true,
      channel: { select: { title: true } },
    },
  });
  if (!link?.linkaffiCampaignKey)
    return { ok: false, error: "Choisissez une campagne d'affilié dans la liste." };
  if (member.affiliateInviteLinkId === link.id)
    return { ok: false, error: "Ce membre est déjà rattaché à cette campagne." };
  const before = fieldsOf(member);
  const after = attributionToCampaign(
    { ...link, linkaffiCampaignKey: link.linkaffiCampaignKey },
    input.now ?? new Date(),
  );
  await prisma.member.update({ where: { id: member.id }, data: after });
  const who = affiliateLabel(link.linkaffiAffiliateId, link.linkaffiAffiliateName);
  const campaign = campaignLabel({
    campaignName: link.linkaffiCampaignName,
    campaignKey: link.linkaffiCampaignKey,
  });
  const metadata = toJsonValue({
    from: attributionSnapshot(before),
    to: attributionSnapshot(after),
    reason: reason.reason,
  });
  await recordEvent({
    type: "member.affiliate_changed",
    memberId: member.id,
    payload: toJsonValue({
      from: attributionSnapshot(before),
      to: attributionSnapshot(after),
      reason: reason.reason,
      by: input.userId,
    }),
  });
  await audit({
    userId: input.userId,
    action: "member.affiliate_changed",
    entityType: "Member",
    entityId: member.id,
    metadata,
  });
  return {
    ok: true,
    message: `Membre rattaché à ${who} (campagne ${campaign}, canal ${link.channel.title}).`,
  };
}

/** Retire l'affilié du membre. */
export async function removeMemberAffiliate(input: {
  memberId: string;
  reason: unknown;
  userId: string;
}): Promise<AttributionResult> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  const member = await prisma.member.findUnique({
    where: { id: input.memberId },
    select: memberSelect,
  });
  if (!member) return { ok: false, error: "Ce membre n'existe plus." };
  if (!member.linkaffiCampaignKey && !member.linkaffiAffiliateId)
    return { ok: false, error: "Ce membre n'est rattaché à aucun affilié." };
  const before = fieldsOf(member);
  await prisma.member.update({ where: { id: member.id }, data: NO_AFFILIATE });
  await recordEvent({
    type: "member.affiliate_removed",
    memberId: member.id,
    payload: toJsonValue({
      from: attributionSnapshot(before),
      reason: reason.reason,
      by: input.userId,
    }),
  });
  await audit({
    userId: input.userId,
    action: "member.affiliate_removed",
    entityType: "Member",
    entityId: member.id,
    metadata: toJsonValue({ from: attributionSnapshot(before), reason: reason.reason }),
  });
  return { ok: true, message: "Affilié retiré : ce membre n'est plus rattaché à un affilié." };
}
