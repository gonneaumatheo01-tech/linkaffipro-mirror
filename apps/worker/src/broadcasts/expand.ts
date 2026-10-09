import { prisma, recordEvent, toJsonValue, type Prisma } from "@linkaffipro/db";
import { aggregatePlayers, computeSpendLevel, matchesSpendLevels, parseSegment, parseSpendThresholds, withReachableBy, buildMemberWhere } from "@linkaffipro/core";
import { enqueue } from "@linkaffipro/queue";
import { logger } from "../logger";
import { resolveBroadcastButtons } from "./buttons";
import { abAllows, splitAOf, type AbContext } from "./ab";

export const BATCH_SIZE = 500;

/**
 * Développe un envoi groupé en `OutboundMessage` (kind BROADCAST) par destinataire, par lots, et enfile
 * un job `dm` par message (jobId `dm-<id>`, donc idempotent). Rejouable : les membres déjà servis sont ignorés.
 */
export async function expandBroadcast(broadcastId: string): Promise<{ targeted: number; created: number }> {
  const b = await prisma.broadcast.findUnique({ where: { id: broadcastId }, include: { bot: { select: { username: true } } } });
  if (!b) return { targeted: 0, created: 0 };
  if (b.status === "CANCELLED" || b.status === "SENT") return { targeted: b.targeted, created: 0 };
  if (b.status !== "SENDING") {
    await prisma.broadcast.update({ where: { id: b.id }, data: { status: "SENDING", startedAt: b.startedAt ?? new Date() } });
  }

  const segment = parseSegment(b.segment);
  const where = withReachableBy(buildMemberWhere(segment), b.botId) as Prisma.MemberWhereInput;
  const thresholds = parseSpendThresholds((await prisma.setting.findUnique({ where: { key: "spend.thresholds" } }).catch(() => null))?.value);
  const needLevel = !!segment.spendLevels;
  const postCode = b.buttons && Array.isArray(b.buttons) && (b.buttons as unknown[]).length > 0 ? await containerPostCode(b.id) : "";
  const buttons = resolveBroadcastButtons(b.buttons, { trackingBaseUrl: process.env.TRACKING_BASE_URL ?? "https://go.goolink.eu", botUsername: b.bot.username, postCode });

  const ab = await abContext(b);
  const already = new Set((await prisma.outboundMessage.findMany({ where: { broadcastId: b.id }, select: { memberId: true } })).map((m) => m.memberId));
  let cursor: string | undefined;
  let targeted = already.size;
  let created = 0;
  for (;;) {
    const members = await prisma.member.findMany({
      where,
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, players: needLevel ? { select: { registeredAt: true, depositCount: true, depositTotal: true } } : false },
    });
    if (members.length === 0) break;
    cursor = members[members.length - 1]!.id;
    for (const m of members) {
      if (already.has(m.id)) continue;
      if (!abAllows(ab, m.id)) continue;
      if (needLevel) {
        const players = (m.players ?? []).map((p) => ({ registeredAt: p.registeredAt, depositCount: p.depositCount, depositTotal: Number(p.depositTotal) }));
        if (!matchesSpendLevels(computeSpendLevel(aggregatePlayers(players), thresholds), segment)) continue;
      }
      const om = await prisma.outboundMessage.create({
        data: { botId: b.botId, memberId: m.id, kind: "BROADCAST", broadcastId: b.id, text: b.text, buttons: toJsonValue(buttons), mediaAssetId: b.mediaAssetId ?? null },
        select: { id: true },
      });
      await enqueue("telegram-send", { type: "dm", outboundMessageId: om.id }, { jobId: `dm-${om.id}`, attempts: 3, backoff: { type: "exponential", delay: 2000 } });
      already.add(m.id);
      targeted++;
      created++;
    }
    if (members.length < BATCH_SIZE) break;
  }

  const final = targeted === 0 ? { status: "SENT" as const, finishedAt: new Date() } : {};
  await prisma.broadcast.update({ where: { id: b.id }, data: { targeted, ...final } });
  await recordEvent({ type: "broadcast.expanded", botId: b.botId, payload: toJsonValue({ broadcastId: b.id, targeted, created }) });
  logger.info({ broadcastId: b.id, targeted, created }, "envoi groupé développé");
  return { targeted, created };
}

/**
 * Contexte A/B d'un envoi : variante A ou B (répartition déterministe par hachage du membre et du groupe),
 * ou envoi « au reste » (`abVariant = REST`) qui exclut tous les membres déjà servis par le test.
 */
async function abContext(b: { id: string; abGroupId: string | null; abVariant: string | null; abSplit: number | null }): Promise<AbContext> {
  if (!b.abGroupId) return null;
  if (b.abVariant === "REST") {
    const served = await prisma.outboundMessage.findMany({ where: { broadcast: { abGroupId: b.abGroupId, id: { not: b.id } } }, select: { memberId: true } });
    return { mode: "rest", excluded: new Set(served.map((m) => m.memberId)) };
  }
  const letter = b.abVariant === "B" ? "B" : "A";
  return { mode: "variant", groupId: b.abGroupId, letter, splitA: splitAOf(letter, b.abSplit) };
}

/** Code du message « conteneur » (Post SENT) qui porte les boutons Offre d'un envoi groupé ; vide s'il n'existe pas. */
async function containerPostCode(broadcastId: string): Promise<string> {
  const post = await prisma.post.findFirst({ where: { templateName: `broadcast:${broadcastId}` }, select: { code: true } });
  return post?.code ?? "";
}
