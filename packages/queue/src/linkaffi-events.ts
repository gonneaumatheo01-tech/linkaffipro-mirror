import {
  buildLinkaffiEvent,
  isAffiliateAttributionActive,
  type LinkaffiEventType,
} from "@linkaffipro/core";
import { prisma, toJsonValue } from "@linkaffipro/db";
import { enqueue } from "./client";

/**
 * Événement d'un membre d'affilié Link Affi à envoyer à la fonction `telegram-events` (phase 13, contrat
 * `docs/LINKAFFI-PARTENAIRES.md` § 2). Appelé partout où le fait se produit (bot, worker, site) ; ne lève jamais
 * d'erreur pour l'appelant (un échec d'écriture est journalisé et renvoyé).
 *
 * Règles :
 * - seulement pour un membre rattaché à une campagne Telegram d'affilié, attribution en cours (durée de la campagne) ;
 * - événements d'adhésion (`join_*`, `joined`, `left`) : seulement pour le canal de la campagne de l'affilié (le lien
 *   d'invitation qui l'a amené) ; `offer_clicked` : tout clic d'offre du membre (c'est lui qui crédite l'affilié) ;
 * - `eventId` stable (`lap_<type>_<sourceId>`) : un même fait n'est jamais enregistré ni envoyé deux fois ;
 * - l'événement est toujours enregistré (rattrapage par `GET /members`) ; l'envoi part par la file `linkaffi-events`
 *   (le passage périodique reprend ceux dont l'ajout à la file a échoué).
 */
export type EmitLinkaffiEventInput = {
  type: LinkaffiEventType;
  /** Demande d'adhésion (Membership.id) pour `join_*` / `joined` / `left`, clic (Click.id) pour `offer_clicked`. */
  sourceId: string;
  memberId: string;
  /** Canal du fait (canal de la demande ; pour un clic, canal du message s'il est connu). */
  channelId?: string | null;
  occurredAt?: Date;
  data?: Record<string, unknown>;
};

export type EmitLinkaffiEventResult =
  | { status: "queued" | "already"; eventId: string }
  | {
      status: "skipped";
      reason:
        | "not_attributed"
        | "attribution_ended"
        | "other_channel"
        | "anonymized"
        | "member_not_found";
    }
  | { status: "error"; error: string };

export async function emitLinkaffiEvent(
  input: EmitLinkaffiEventInput,
): Promise<EmitLinkaffiEventResult> {
  try {
    const now = input.occurredAt ?? new Date();
    const member = await prisma.member.findUnique({
      where: { id: input.memberId },
      select: {
        telegramUserId: true,
        username: true,
        firstName: true,
        languageCode: true,
        anonymizedAt: true,
        linkaffiCampaignKey: true,
        affiliateAttributionEndsAt: true,
        affiliateInviteLink: { select: { channelId: true } },
      },
    });
    if (!member) return { status: "skipped", reason: "member_not_found" };
    if (member.anonymizedAt) return { status: "skipped", reason: "anonymized" };
    if (!member.linkaffiCampaignKey) return { status: "skipped", reason: "not_attributed" };
    if (!isAffiliateAttributionActive(member, now))
      return { status: "skipped", reason: "attribution_ended" };
    const campaignChannelId = member.affiliateInviteLink?.channelId ?? null;
    if (
      input.type !== "offer_clicked" &&
      input.channelId &&
      campaignChannelId &&
      input.channelId !== campaignChannelId
    )
      return { status: "skipped", reason: "other_channel" };
    const channelId = input.channelId ?? campaignChannelId;
    const channel = channelId
      ? await prisma.channel.findUnique({
          where: { id: channelId },
          select: { id: true, title: true },
        })
      : null;
    const body = buildLinkaffiEvent({
      type: input.type,
      sourceId: input.sourceId,
      occurredAt: now,
      campaignKey: member.linkaffiCampaignKey,
      channel: channel ?? { id: channelId ?? "", title: "" },
      member: {
        telegramUserId: member.telegramUserId,
        username: member.username,
        firstName: member.firstName,
        languageCode: member.languageCode,
      },
      data: input.data,
    });
    const existing = await prisma.linkaffiEvent.findUnique({
      where: { eventId: body.eventId },
      select: { id: true },
    });
    if (existing) return { status: "already", eventId: body.eventId };
    try {
      await prisma.linkaffiEvent.create({
        data: {
          eventId: body.eventId,
          type: body.type,
          occurredAt: now,
          campaignKey: body.campaignKey,
          memberId: input.memberId,
          channelId: channel?.id ?? null,
          body: toJsonValue(body),
        },
      });
    } catch (err) {
      // Deux appels simultanés pour le même fait : l'identifiant unique garde une seule ligne.
      if ((err as { code?: string }).code === "P2002")
        return { status: "already", eventId: body.eventId };
      throw err;
    }
    await enqueue(
      "linkaffi-events",
      { type: "deliver", eventId: body.eventId },
      { jobId: `linkaffi-event:${body.eventId}` },
    ).catch((err: unknown) =>
      console.warn(
        "[linkaffi-events] ajout à la file impossible, le passage périodique reprendra",
        {
          eventId: body.eventId,
          error: err instanceof Error ? err.message : String(err),
        },
      ),
    );
    return { status: "queued", eventId: body.eventId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[linkaffi-events] événement non enregistré", {
      type: input.type,
      sourceId: input.sourceId,
      error,
    });
    return { status: "error", error };
  }
}
