import { prisma, recordEvent, toJsonValue, type Prisma } from "@linkaffipro/db";
import { chooseSubId, type SubIdSource } from "@linkaffipro/linkaffi";
import { normalizeMapping, parsePostback, postbackExternalId, type ParsedPostback, type PostbackMapping } from "./parse";

export type PostbackOutcome = { status: "ACCEPTED" | "IGNORED" | "ERROR"; message: string; playerEventId?: string };

type EndpointLike = { id: string; name: string; programId: string; mapping: unknown; isActive: boolean };

/** Campagne « directe » d'un endpoint : les joueurs sans sub-ID reconnu y sont rattachés. */
async function directCampaign(endpoint: EndpointLike) {
  const externalId = `postback:${endpoint.id}`;
  return prisma.affiliateCampaign.upsert({
    where: { programId_externalId: { programId: endpoint.programId, externalId } },
    create: { programId: endpoint.programId, externalId, name: `Postbacks directs — ${endpoint.name}`, trackingUrlTemplate: "", isActive: true },
    update: {},
    select: { id: true },
  });
}

/**
 * Applique un postback déjà lu (`parsed`) : joueur, événement idempotent, cumuls, rattachement par sub-ID,
 * événements plateforme. Règles communes à la synchro Link Affi : cumuls jamais décroissants,
 * un vrai sub-ID (postback) remplace un rattachement de secours, jamais l'inverse.
 */
export async function applyParsedPostback(endpoint: EndpointLike, parsed: ParsedPostback): Promise<PostbackOutcome> {
  const click = parsed.subId
    ? await prisma.click.findUnique({
        where: { subId: parsed.subId },
        select: { id: true, memberId: true, postId: true, trackingLink: { select: { affiliateCampaignId: true } } },
      })
    : null;
  const campaignId = click?.trackingLink.affiliateCampaignId ?? (await directCampaign(endpoint)).id;

  const existing = await prisma.player.findUnique({
    where: { affiliateCampaignId_externalPlayerId: { affiliateCampaignId: campaignId, externalPlayerId: parsed.externalPlayerId } },
  });
  const externalId = postbackExternalId(parsed);
  if (existing) {
    const dup = await prisma.playerEvent.findUnique({ where: { playerId_externalId: { playerId: existing.id, externalId } }, select: { id: true } });
    if (dup) return { status: "IGNORED", message: "Événement déjà reçu (doublon ignoré).", playerEventId: dup.id };
  }

  const incoming = { subId: parsed.subId, subIdSource: (parsed.subId ? "postback" : null) as SubIdSource, updatedAt: parsed.occurredAt };
  const chosen = existing
    ? chooseSubId({ subId: existing.subId, subIdSource: existing.subIdSource as SubIdSource, updatedAt: existing.updatedAt }, incoming)
    : { subId: incoming.subId, subIdSource: incoming.subIdSource };
  const amount = parsed.amount ?? 0;
  const prevCount = existing?.depositCount ?? 0;
  const prevTotal = Number(existing?.depositTotal ?? 0);
  const prevNgr = Number(existing?.ngr ?? 0);

  const data: Prisma.PlayerUncheckedUpdateInput & Prisma.PlayerUncheckedCreateInput = {
    affiliateCampaignId: campaignId,
    externalPlayerId: parsed.externalPlayerId,
    subId: chosen.subId ?? null,
    subIdSource: chosen.subIdSource ?? null,
    clickId: click?.id ?? existing?.clickId ?? null,
    memberId: click?.memberId ?? existing?.memberId ?? null,
    currency: parsed.currency || existing?.currency || "EUR",
    lastEventAt: parsed.occurredAt,
    raw: toJsonValue({ ...(existing?.raw && typeof existing.raw === "object" ? (existing.raw as Record<string, unknown>) : {}), lastPostback: { event: parsed.eventRaw, at: parsed.occurredAt.toISOString() } }),
  };
  const events: Array<{ type: string; amount?: number }> = [];
  switch (parsed.eventType) {
    case "REGISTRATION":
      data.registeredAt = existing?.registeredAt ?? parsed.occurredAt;
      if (!existing?.registeredAt) events.push({ type: "player.registered" });
      break;
    case "FTD":
      data.registeredAt = existing?.registeredAt ?? parsed.occurredAt;
      if (!existing?.ftdAt) {
        data.ftdAt = parsed.occurredAt;
        data.ftdAmount = parsed.amount;
        events.push({ type: "player.ftd", amount });
      }
      data.depositCount = Math.max(prevCount, existing?.ftdAt ? prevCount : prevCount + 1);
      data.depositTotal = prevTotal + (existing?.ftdAt ? 0 : amount);
      if (!existing?.ftdAt && amount > 0) events.push({ type: "player.deposit", amount });
      break;
    case "DEPOSIT":
    case "REDEPOSIT":
      data.registeredAt = existing?.registeredAt ?? parsed.occurredAt;
      data.depositCount = prevCount + 1;
      data.depositTotal = prevTotal + amount;
      if (parsed.eventType === "REDEPOSIT" || existing?.ftdAt) data.redepositCount = (existing?.redepositCount ?? 0) + 1;
      if (!existing?.ftdAt) {
        data.ftdAt = parsed.occurredAt;
        data.ftdAmount = parsed.amount;
        events.push({ type: "player.ftd", amount });
      }
      events.push({ type: "player.deposit", amount });
      break;
    case "NGR":
      data.ngr = prevNgr + (parsed.amount ?? 0);
      events.push({ type: "player.ngr_updated", amount: parsed.amount ?? 0 });
      break;
    case "OTHER":
      break;
  }

  const player = existing
    ? await prisma.player.update({ where: { id: existing.id }, data })
    : await prisma.player.create({ data });
  const pe = await prisma.playerEvent.create({
    data: { playerId: player.id, type: parsed.eventType, amount: parsed.amount, currency: parsed.currency, occurredAt: parsed.occurredAt, externalId, raw: toJsonValue({ source: "postback", endpointId: endpoint.id, event: parsed.eventRaw }) },
  });
  for (const e of events) {
    await recordEvent({ type: e.type, occurredAt: parsed.occurredAt, memberId: player.memberId ?? null, payload: { playerId: player.id, externalPlayerId: parsed.externalPlayerId, amount: e.amount ?? null, subId: player.subId, postId: click?.postId ?? null, via: "postback" } });
  }
  return { status: "ACCEPTED", message: `${parsed.eventType} enregistré${player.memberId ? " (membre rattaché)" : parsed.subId ? " (sub-ID inconnu, joueur sans membre)" : ""}.`, playerEventId: pe.id };
}

/** Lit puis applique un postback brut, et journalise toujours le résultat. */
export async function handlePostback(endpoint: EndpointLike, params: Record<string, string | string[] | undefined>, ipHash: string | null): Promise<PostbackOutcome> {
  let outcome: PostbackOutcome;
  let mapping: PostbackMapping | null = null;
  try {
    mapping = normalizeMapping(endpoint.mapping);
    const parsed = parsePostback(params, mapping);
    outcome = await applyParsedPostback(endpoint, parsed);
  } catch (err) {
    outcome = { status: "ERROR", message: err instanceof Error ? err.message : "Erreur inconnue" };
  }
  try {
    await prisma.postbackLog.create({ data: { endpointId: endpoint.id, ipHash, raw: toJsonValue(params), status: outcome.status, message: outcome.message, playerEventId: outcome.playerEventId ?? null } });
    await prisma.postbackEndpoint.update({ where: { id: endpoint.id }, data: { lastReceivedAt: new Date() } });
  } catch (err) {
    console.error("[postback] journalisation impossible", err);
  }
  return outcome;
}
