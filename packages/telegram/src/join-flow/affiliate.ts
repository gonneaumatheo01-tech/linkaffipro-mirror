/**
 * Attribution des membres aux affiliés Link Affi (phase 13, contrat `docs/LINKAFFI-PARTENAIRES.md`) et événements à
 * envoyer à Link Affi depuis le flux d'adhésion.
 *
 * - Une demande d'adhésion (ou une entrée directe) par un lien LINKAFFI rattache le membre à la campagne Telegram de
 *   l'affilié, seulement si le membre n'a encore aucun affilié (premier affilié gagne, jamais écrasé automatiquement)
 *   et s'il n'était pas déjà dans le canal (dernière demande acceptée sans départ, ou membre selon Telegram).
 * - Un lien désactivé (campagne fermée par Link Affi, lien resté valable chez Telegram) ne rattache plus personne ;
 *   l'admission (provenance, exceptions de règle) ne change pas.
 * - Sinon rien n'est changé ; la raison est journalisée (`membership.affiliate_not_attributed`).
 * - Les événements (`join_requested`, `joined`…) passent par `emitLinkaffiEvent`, qui ne garde que ceux d'un membre
 *   rattaché, attribution en cours, sur le canal de sa campagne.
 */
import {
  affiliateAttributionDecision,
  affiliateAttributionEndsAt,
  type AffiliateAttributionDecision,
} from "@linkaffipro/core";
import type { EmitLinkaffiEventInput } from "@linkaffipro/queue";
import type { ChannelInfo, InviteLinkInfo, JoinFlowDeps, MembershipInfo } from "./deps";
import { OPEN_STATUSES } from "./rules";

/** Statuts Telegram d'une personne présente dans le canal. */
const IN_CHANNEL_STATUSES = new Set(["member", "administrator", "creator", "restricted"]);

/** Lien d'une campagne Telegram d'affilié Link Affi, avec sa clé. */
export type LinkaffiInviteLink = InviteLinkInfo & { kind: "LINKAFFI"; linkaffiCampaignKey: string };

export function isLinkaffiInviteLink(
  link: InviteLinkInfo | null | undefined,
): link is LinkaffiInviteLink {
  return !!link && link.kind === "LINKAFFI" && !!link.linkaffiCampaignKey;
}

/** Résultat de l'attribution d'une demande ou d'une entrée. */
export type AffiliateAttributionOutcome =
  /** Membre rattaché à la campagne du lien. */
  | { status: "attributed"; campaignKey: string; affiliateId: string | null; endsAt: Date | null }
  /**
   * Lien d'affilié, mais aucune attribution : déjà rattaché à un affilié, déjà dans le canal, ou lien désactivé (campagne
   * fermée par Link Affi alors que Telegram a refusé la révocation : seules les attributions passées restent).
   */
  | {
      status: "not_attributed";
      reason:
        | Exclude<
            Extract<AffiliateAttributionDecision, { attribute: false }>["reason"],
            "not_affiliate_link"
          >
        | "link_disabled";
    }
  /** Rien à décider : pas un lien d'affilié, décision déjà prise à la demande, ou déjà rattaché à cette campagne. */
  | { status: "skipped" };

/** La personne est-elle dans le canal selon Telegram ? Erreur (droits, réseau) : non (la base décide). */
async function inChannelForTelegram(
  api: {
    getChatMember(chatId: number | string, userId: number): Promise<{ status: string }>;
  } | null,
  chatId: bigint,
  telegramUserId: number,
): Promise<boolean> {
  if (!api) return false;
  try {
    const m = await api.getChatMember(Number(chatId), telegramUserId);
    return IN_CHANNEL_STATUSES.has(m.status);
  } catch {
    return false;
  }
}

/**
 * Attribue (ou non) le membre à l'affilié du lien de sa demande (`stage: "request"`) ou de son entrée directe dans le
 * canal (`stage: "join"`, sans demande : la mise à jour Telegram prouve qu'il n'y était pas). `latestBefore` : dernière
 * demande du membre sur ce canal AVANT celle-ci (pour une entrée, avant sa mise à jour).
 */
export async function attributeAffiliateFromLink(
  api: {
    getChatMember(chatId: number | string, userId: number): Promise<{ status: string }>;
  } | null,
  deps: Pick<JoinFlowDeps, "getMemberAffiliate" | "attributeAffiliate" | "recordEvent">,
  input: {
    stage: "request" | "join";
    memberId: string;
    telegramUserId: number;
    channel: Pick<ChannelInfo, "id" | "telegramChatId">;
    link: InviteLinkInfo | null;
    membershipId: string;
    latestBefore: Pick<MembershipInfo, "status" | "inviteLinkId"> | null;
    at: Date;
    botId: string;
  },
): Promise<AffiliateAttributionOutcome> {
  const { link } = input;
  if (!isLinkaffiInviteLink(link) || !deps.getMemberAffiliate || !deps.attributeAffiliate)
    return { status: "skipped" };
  const current = await deps.getMemberAffiliate(input.memberId);
  const before = input.latestBefore;
  // Déjà rattaché à la campagne de ce lien (entrée après sa demande, ou membre parti puis revenu par le même lien) :
  // rien à décider, rien à journaliser (il reste le membre de cette campagne).
  if (current?.campaignKey === link.linkaffiCampaignKey) return { status: "skipped" };
  // Entrée dans le canal après une demande faite par ce même lien : la décision a été prise à la demande.
  if (
    input.stage === "join" &&
    before &&
    before.inviteLinkId === link.id &&
    (before.status === "APPROVED" || OPEN_STATUSES.includes(before.status))
  )
    return { status: "skipped" };

  // Lien désactivé (campagne fermée par Link Affi, lien encore valable chez Telegram) : plus aucune attribution.
  const disabled = link.isActive === false;
  const memberAffiliateId = current?.affiliateId ?? current?.campaignKey ?? null;
  const alreadyInChannel =
    !disabled &&
    memberAffiliateId === null &&
    input.stage === "request" &&
    (before?.status === "APPROVED" ||
      (await inChannelForTelegram(api, input.channel.telegramChatId, input.telegramUserId)));
  const decision: AffiliateAttributionDecision | { attribute: false; reason: "link_disabled" } =
    disabled
      ? { attribute: false, reason: "link_disabled" }
      : affiliateAttributionDecision({
          isAffiliateLink: true,
          memberAffiliateId,
          alreadyInChannel,
        });
  const details = {
    membershipId: input.membershipId,
    inviteLinkId: link.id,
    campaignKey: link.linkaffiCampaignKey,
    campaignName: link.linkaffiCampaignName ?? null,
    affiliateId: link.linkaffiAffiliateId ?? null,
    affiliateName: link.linkaffiAffiliateName ?? null,
    stage: input.stage,
  };

  let outcome: AffiliateAttributionOutcome;
  if (decision.attribute) {
    const endsAt = affiliateAttributionEndsAt(input.at, link.attributionDays);
    const written = await deps.attributeAffiliate({
      memberId: input.memberId,
      campaignKey: link.linkaffiCampaignKey,
      affiliateId: link.linkaffiAffiliateId ?? null,
      inviteLinkId: link.id,
      attributedAt: input.at,
      endsAt,
    });
    outcome = written
      ? {
          status: "attributed",
          campaignKey: link.linkaffiCampaignKey,
          affiliateId: link.linkaffiAffiliateId ?? null,
          endsAt,
        }
      : // Une autre demande l'a rattaché entre-temps : premier affilié gagne.
        { status: "not_attributed", reason: "already_attributed" };
  } else {
    outcome = {
      status: "not_attributed",
      reason:
        decision.reason === "already_member" || decision.reason === "link_disabled"
          ? decision.reason
          : "already_attributed",
    };
  }

  if (outcome.status === "attributed")
    await deps.recordEvent({
      type: "member.affiliate_attributed",
      memberId: input.memberId,
      channelId: input.channel.id,
      botId: input.botId,
      payload: {
        ...details,
        attributedAt: input.at.toISOString(),
        endsAt: outcome.endsAt?.toISOString() ?? null,
      },
    });
  else if (outcome.status === "not_attributed")
    await deps.recordEvent({
      type: "membership.affiliate_not_attributed",
      memberId: input.memberId,
      channelId: input.channel.id,
      botId: input.botId,
      payload: {
        ...details,
        reason: outcome.reason,
        // Affilié déjà en place (premier affilié gagne).
        currentCampaignKey: current?.campaignKey ?? null,
        currentAffiliateId: current?.affiliateId ?? null,
      },
    });
  return outcome;
}

/**
 * `attributeAffiliateFromLink` sans jamais bloquer le flux d'adhésion : une erreur (base indisponible) est journalisée
 * et la demande suit son cours (accueil, acceptation), sans attribution.
 */
export async function attributeAffiliateSafely(
  ...args: Parameters<typeof attributeAffiliateFromLink>
): Promise<AffiliateAttributionOutcome> {
  try {
    return await attributeAffiliateFromLink(...args);
  } catch (err) {
    console.warn("[join-flow] attribution à l'affilié impossible", {
      membershipId: args[2].membershipId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "skipped" };
  }
}

/** Envoie un événement à Link Affi par la file (jamais d'erreur pour le flux d'adhésion). */
export async function emitLinkaffi(
  deps: Pick<JoinFlowDeps, "emitLinkaffiEvent">,
  input: EmitLinkaffiEventInput,
): Promise<void> {
  if (!deps.emitLinkaffiEvent) return;
  try {
    await deps.emitLinkaffiEvent(input);
  } catch (err) {
    console.warn("[join-flow] événement Link Affi non enregistré", {
      type: input.type,
      sourceId: input.sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
