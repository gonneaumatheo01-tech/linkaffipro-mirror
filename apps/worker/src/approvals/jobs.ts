import { prisma, recordEvent, toJsonValue, type Prisma } from "@linkaffipro/db";
import { emitLinkaffiEvent, enqueueDm } from "@linkaffipro/queue";
import {
  dueReminderIndex,
  expirationOutcome,
  ruleDelayText,
  ruleForMembershipWithDb,
  type RuleData,
} from "@linkaffipro/telegram";
import { baseLang, defaultText, pickText, renderHtmlText } from "@linkaffipro/telegram";
import {
  createPrismaGateLinkDeps,
  gateProblemsOf,
  resolveGateLinks,
  type ChannelInfo,
  type GateLinkDeps,
} from "@linkaffipro/telegram";
import { logger } from "../logger";
import { apiForBot, approveMembership, declineMembership } from "./telegram-actions";

const BATCH = 50;

/** Réclame les demandes planifiées échues (verrou SKIP LOCKED) et les approuve. Canal désactivé : rien n'est fait (phase 8). */
export async function runApprovalsTick(): Promise<{ claimed: number; approved: number }> {
  const ids = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT m.id FROM "Membership" m
      JOIN "Channel" c ON c.id = m."channelId" AND c."isActive"
      WHERE m.status = 'SCHEDULED' AND m."approveAt" IS NOT NULL AND m."approveAt" <= NOW()
      ORDER BY m."approveAt" ASC
      LIMIT ${BATCH}
      FOR UPDATE OF m SKIP LOCKED`;
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

/**
 * Règle d'une demande (même relecture que le bot, phase 11) : la règle appliquée à son arrivée, avec ses canaux à
 * rejoindre effectifs (jamais le canal d'où vient la personne, aucun si l'accueil n'en a pas demandé). Sans règle :
 * aucun rappel, expiration « garder » (comme l'ancienne règle implicite).
 */
async function ruleOf(m: {
  approvalRuleId: string | null;
  channelId: string;
  inviteLinkId: string | null;
  source: unknown;
}): Promise<RuleData> {
  return ruleForMembershipWithDb(m);
}

/** Liens des canaux à rejoindre côté worker : API de chaque bot par le cache du worker, échecs dans son journal. */
const gateLinkDeps: GateLinkDeps = createPrismaGateLinkDeps({
  apiFor: async (botId) => {
    const bot = await prisma.bot.findFirst({
      where: { id: botId, isActive: true },
      select: { id: true, tokenEncrypted: true },
    });
    return bot ? apiForBot(bot) : null;
  },
  warn: (message, details) => logger.warn(details, message),
});

const channelInfoSelect = {
  id: true,
  title: true,
  username: true,
  language: true,
  telegramChatId: true,
  primaryBotId: true,
  isActive: true,
} as const;

/**
 * Liens des canaux à rejoindre recalculés au moment du rappel (canaux effectifs de la règle : `rule` vient de `ruleOf`) (jamais la liste de l'accueil telle quelle : vide si les
 * droits manquaient alors, ou périmée si un bot a perdu ses droits) : lien GATE existant et valide, sinon création par
 * le bot de la demande puis par nos bots administrateurs du canal à rejoindre. La demande garde les liens à jour.
 */
export async function refreshReminderGates(
  m: {
    id: string;
    memberId: string;
    channelId: string;
    source: Record<string, unknown>;
    channel: { title: string };
  },
  rule: RuleData,
  botId: string,
  deps: GateLinkDeps = gateLinkDeps,
) {
  const ids = rule.gateChannelIds.filter((id) => id !== m.channelId);
  const rows = ids.length
    ? await prisma.channel.findMany({ where: { id: { in: ids } }, select: channelInfoSelect })
    : [];
  const gateChannels = ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((c): c is ChannelInfo => !!c);
  const bot = await prisma.bot.findFirst({
    where: { id: botId, isActive: true },
    select: { id: true, username: true, tokenEncrypted: true },
  });
  const first = bot ? { botId: bot.id, username: bot.username, api: apiForBot(bot) } : null;
  const { gates, missing } = await resolveGateLinks(
    deps,
    { id: m.channelId, title: m.channel.title },
    gateChannels,
    first,
  );
  const before = gateProblemsOf(m.source);
  await prisma.membership.update({
    where: { id: m.id },
    data: { source: toJsonValue({ ...m.source, gates, gateLinksMissing: missing }) },
  });
  if (
    missing.length > 0 &&
    before.map((p) => p.channelId).join() !== missing.map((p) => p.channelId).join()
  )
    await recordEvent({
      type: "membership.gate_links_missing",
      memberId: m.memberId,
      channelId: m.channelId,
      botId,
      payload: toJsonValue({ membershipId: m.id, stage: "reminder", missing }),
    });
  return { gateChannels, gates, missing, botUsername: bot?.username ?? null };
}

type PendingReminder = Awaited<ReturnType<typeof pendingReminders>>[number];

function pendingReminders() {
  return prisma.membership.findMany({
    where: { status: "PENDING_GATE", channel: { isActive: true } },
    include: {
      member: {
        select: {
          firstName: true,
          languageCode: true,
          botStates: { select: { botId: true, canDm: true } },
        },
      },
      channel: { select: { title: true, language: true } },
    },
    take: 500,
  });
}

/**
 * Rappel d'une demande (si échu et si le bot peut écrire au membre) : liens recalculés, texte en HTML Telegram avec les
 * valeurs échappées (un prénom « Tom <3 » ne fait plus refuser le message). Renvoie vrai si un rappel est parti.
 */
async function sendReminder(m: PendingReminder, now: Date): Promise<boolean> {
  const rule = await ruleOf(m);
  const idx = dueReminderIndex(
    rule,
    { requestedAt: m.requestedAt, remindersSent: m.remindersSent },
    now,
  );
  if (idx === null) return false;
  const source = (m.source ?? {}) as Record<string, unknown> & {
    botId?: string;
    startUrl?: string;
  };
  const botId = source.botId;
  if (!botId) return false;
  const state = m.member.botStates.find((s) => s.botId === botId);
  if (!state?.canDm) return false;
  const { gateChannels, gates, botUsername } = await refreshReminderGates(
    { ...m, source },
    rule,
    botId,
  );
  const lang = baseLang(m.member.languageCode ?? m.channel.language);
  const seq = await prisma.sequence.findFirst({
    where: {
      trigger: "GATE_REMINDER",
      isActive: true,
      OR: [{ channelId: m.channelId }, { channelId: null }],
    },
    orderBy: { channelId: "desc" },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
  const texts =
    seq?.steps[0]?.texts && typeof seq.steps[0].texts === "object"
      ? (seq.steps[0].texts as Record<string, string>)
      : null;
  const template =
    pickText(texts, m.member.languageCode, m.channel.language) ?? defaultText("gateReminder", lang);
  // {liste_canaux} : tous les canaux de la règle, même ceux restés sans lien (le membre sait lesquels rejoindre).
  const text = renderHtmlText(template, {
    prenom: m.member.firstName ?? "",
    canal: m.channel.title,
    liste_canaux: gateChannels.map((g) => g.title).join(", "),
    delai: ruleDelayText(rule, lang),
    bot: botUsername ? `@${botUsername}` : "",
  });
  const buttons = gates.map((g) => [
    { text: `${defaultText("joinLabel", lang)} ${g.title}`, url: g.url },
  ]);
  if (source.startUrl)
    buttons.push([{ text: defaultText("joinedLabel", lang), url: source.startUrl }]);
  await enqueueDm({
    botId,
    memberId: m.memberId,
    chatId: m.userChatId,
    kind: "GATE_REMINDER",
    text,
    buttons,
    mediaAssetId: seq?.steps[0]?.mediaAssetId ?? null,
  });
  await prisma.membership.update({
    where: { id: m.id },
    data: { remindersSent: { increment: 1 }, lastReminderAt: now },
  });
  await recordEvent({
    type: "membership.reminder_sent",
    memberId: m.memberId,
    channelId: m.channelId,
    botId,
    payload: { membershipId: m.id, index: idx, gates: gates.length } as Prisma.InputJsonValue,
  });
  return true;
}

/**
 * Rappels des demandes en attente de gate (uniquement si le bot peut écrire au membre). Une demande en erreur (bot
 * impossible à ouvrir, base) est journalisée et n'arrête jamais les rappels des autres demandes.
 */
export async function runReminders(now = new Date()): Promise<number> {
  let sent = 0;
  for (const m of await pendingReminders()) {
    try {
      if (await sendReminder(m, now)) sent++;
    } catch (err) {
      logger.error(
        { membershipId: m.id, err: err instanceof Error ? err.message : String(err) },
        "rappel impossible pour cette demande",
      );
    }
  }
  return sent;
}

/**
 * Expiration des demandes non abouties selon la règle (DECLINE / APPROVE / KEEP). L'expiration ne concerne que les
 * demandes qui attendent l'équipe (REQUESTED) ou la personne (PENDING_GATE). Une demande dont l'acceptation est
 * planifiée (SCHEDULED avec une heure d'acceptation : canaux confirmés par « ✅ J'ai rejoint », délai sans canaux à
 * rejoindre, personne venue du bouton « canal à rejoindre » d'un autre canal) attend le délai que le bot lui a annoncé
 * (« accès dans 2 jours ») : elle n'expire jamais, même si l'expiration de la règle tombe avant ou en même temps que
 * l'acceptation (sinon elle serait refusée, ou laissée de côté, avant son acceptation).
 */
export async function runExpirations(now = new Date()): Promise<number> {
  const expired = await prisma.membership.findMany({
    where: {
      status: { in: ["REQUESTED", "PENDING_GATE", "SCHEDULED"] },
      expiresAt: { not: null, lte: now },
      channel: { isActive: true },
      NOT: { status: "SCHEDULED", approveAt: { not: null } },
    },
    take: 200,
  });
  let n = 0;
  for (const m of expired) {
    const rule = await ruleOf(m);
    const outcome = expirationOutcome(rule);
    if (outcome.declineNow) {
      const r = await declineMembership(m.id, { reason: "expiration" });
      if (r === "failed") continue;
    } else if (outcome.approveNow) {
      await prisma.membership.update({
        where: { id: m.id },
        data: { status: "SCHEDULED", approveAt: now, expiresAt: null },
      });
    } else {
      await prisma.membership.update({ where: { id: m.id }, data: { status: "EXPIRED" } });
    }
    await recordEvent({
      type: "membership.expired",
      memberId: m.memberId,
      channelId: m.channelId,
      payload: { membershipId: m.id, action: rule.expireAction },
    });
    // Link Affi (phase 13) : expiration sans refus ni acceptation → « expirée » (le refus envoie déjà « refusée »,
    // l'acceptation enverra « acceptée »).
    if (!outcome.declineNow && !outcome.approveNow)
      await emitLinkaffiEvent({
        type: "join_expired",
        sourceId: m.id,
        memberId: m.memberId,
        channelId: m.channelId,
        occurredAt: now,
      });
    n++;
  }
  return n;
}
