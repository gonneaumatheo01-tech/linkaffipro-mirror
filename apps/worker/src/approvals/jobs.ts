import { prisma, recordEvent, type Prisma } from "@linkaffipro/db";
import { enqueueDm } from "@linkaffipro/queue";
import { dueReminderIndex, expirationOutcome, ruleFromRow, IMPLICIT_RULE, type RuleData } from "@linkaffipro/telegram";
import { baseLang, defaultText, pickText, renderText } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { approveMembership, declineMembership } from "./telegram-actions";

const BATCH = 50;

/** Réclame les demandes planifiées échues (verrou SKIP LOCKED) et les approuve. */
export async function runApprovalsTick(): Promise<{ claimed: number; approved: number }> {
  const ids = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Membership"
      WHERE status = 'SCHEDULED' AND "approveAt" IS NOT NULL AND "approveAt" <= NOW()
      ORDER BY "approveAt" ASC
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => r.id);
  });
  let approved = 0;
  for (const id of ids) {
    const outcome = await approveMembership(id);
    if (outcome === "approved" || outcome === "already") approved++;
  }
  if (ids.length > 0) logger.info({ claimed: ids.length, approved }, "approbations traitées");
  return { claimed: ids.length, approved };
}

async function ruleOf(m: { approvalRuleId: string | null; channelId: string; inviteLinkId: string | null }): Promise<RuleData> {
  if (m.approvalRuleId) {
    const row = await prisma.approvalRule.findUnique({ where: { id: m.approvalRuleId } });
    if (row) return ruleFromRow(row);
  }
  const def = await prisma.approvalRule.findFirst({ where: { channelId: m.channelId, isDefault: true, isActive: true } });
  return def ? ruleFromRow(def) : IMPLICIT_RULE;
}

/** Rappels des demandes en attente de gate (uniquement si le bot peut écrire au membre). */
export async function runReminders(now = new Date()): Promise<number> {
  const pending = await prisma.membership.findMany({
    where: { status: "PENDING_GATE" },
    include: { member: { select: { firstName: true, languageCode: true, botStates: { select: { botId: true, canDm: true } } } }, channel: { select: { title: true, language: true } } },
    take: 500,
  });
  let sent = 0;
  for (const m of pending) {
    const rule = await ruleOf(m);
    const idx = dueReminderIndex(rule, { requestedAt: m.requestedAt, remindersSent: m.remindersSent }, now);
    if (idx === null) continue;
    const source = (m.source ?? {}) as { botId?: string; gates?: Array<{ title: string; url: string }>; startUrl?: string };
    const botId = source.botId;
    if (!botId) continue;
    const state = m.member.botStates.find((s) => s.botId === botId);
    if (!state?.canDm) continue;
    const gates = source.gates ?? [];
    const lang = baseLang(m.member.languageCode ?? m.channel.language);
    const seq = await prisma.sequence.findFirst({ where: { trigger: "GATE_REMINDER", isActive: true, OR: [{ channelId: m.channelId }, { channelId: null }] }, orderBy: { channelId: "desc" }, include: { steps: { orderBy: { order: "asc" }, take: 1 } } });
    const texts = seq?.steps[0]?.texts && typeof seq.steps[0].texts === "object" ? (seq.steps[0].texts as Record<string, string>) : null;
    const template = pickText(texts, m.member.languageCode, m.channel.language) ?? defaultText("gateReminder", lang);
    const text = renderText(template, { prenom: m.member.firstName ?? "", canal: m.channel.title, liste_canaux: gates.map((g) => g.title).join(", ") });
    const buttons = gates.map((g) => [{ text: `${defaultText("joinLabel", lang)} ${g.title}`, url: g.url }]);
    if (source.startUrl) buttons.push([{ text: defaultText("joinedLabel", lang), url: source.startUrl }]);
    await enqueueDm({ botId, memberId: m.memberId, chatId: m.userChatId, kind: "GATE_REMINDER", text, buttons });
    await prisma.membership.update({ where: { id: m.id }, data: { remindersSent: { increment: 1 }, lastReminderAt: now } });
    await recordEvent({ type: "membership.reminder_sent", memberId: m.memberId, channelId: m.channelId, botId, payload: { membershipId: m.id, index: idx } as Prisma.InputJsonValue });
    sent++;
  }
  return sent;
}

/** Expiration des demandes non abouties selon la règle (DECLINE / APPROVE / KEEP). */
export async function runExpirations(now = new Date()): Promise<number> {
  const expired = await prisma.membership.findMany({ where: { status: { in: ["REQUESTED", "PENDING_GATE", "SCHEDULED"] }, expiresAt: { not: null, lte: now } }, take: 200 });
  let n = 0;
  for (const m of expired) {
    const rule = await ruleOf(m);
    const outcome = expirationOutcome(rule);
    if (outcome.declineNow) {
      const r = await declineMembership(m.id, { reason: "expiration" });
      if (r === "failed") continue;
    } else if (outcome.approveNow) {
      await prisma.membership.update({ where: { id: m.id }, data: { status: "SCHEDULED", approveAt: now, expiresAt: null } });
    } else {
      await prisma.membership.update({ where: { id: m.id }, data: { status: "EXPIRED" } });
    }
    await recordEvent({ type: "membership.expired", memberId: m.memberId, channelId: m.channelId, payload: { membershipId: m.id, action: rule.expireAction } });
    n++;
  }
  return n;
}
