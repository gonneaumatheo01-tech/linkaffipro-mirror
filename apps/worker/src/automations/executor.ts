import { GRAPH_SEQUENCE_LABELS, renderActionText, type AutomationAction } from "@linkaffipro/core";
import { prisma, recordEvent } from "@linkaffipro/db";
import { enqueueDm, type DmButton } from "@linkaffipro/queue";
import { notifyAdmin, pickText, renderText } from "@linkaffipro/telegram";
import { actingBotFor, apiForBot } from "../approvals/telegram-actions";
import type { ActionExecutor } from "./engine";
import type { MemberSnapshot } from "./context";

/** Bot utilisé pour écrire au membre : bot de l'action, sinon bot agissant du canal, sinon bot casino, sinon premier bot actif. */
async function pickBot(snapshot: MemberSnapshot, botId?: string | null) {
  if (botId) {
    const b = await prisma.bot.findFirst({ where: { id: botId, isActive: true } });
    if (b) return b;
  }
  if (snapshot.channelId) {
    const b = await actingBotFor(snapshot.channelId);
    if (b) return b;
  }
  return (await prisma.bot.findFirst({ where: { vertical: "CASINO", isActive: true } })) ?? (await prisma.bot.findFirst({ where: { isActive: true } }));
}

/** Exécuteur réel (Prisma, file Telegram, notification admin). */
export function prismaExecutor(snapshot: MemberSnapshot, opts: { ruleName: string; test?: boolean }): ActionExecutor {
  const vars = { prenom: snapshot.firstName ?? "", canal: snapshot.channelTitle ?? "", bot: "" };
  return {
    async sendMessage(a) {
      const bot = await pickBot(snapshot, a.botId);
      if (!bot) throw new Error("Aucun bot actif pour envoyer le message.");
      const text = renderActionText(a.text, { ...vars, bot: bot.name });
      const buttons: DmButton[][] = (a.buttons ?? []).map((row) => row.map((b) => ({ text: b.text, url: b.url })));
      await enqueueDm({ botId: bot.id, memberId: snapshot.memberId, kind: opts.test ? "TEST" : "AUTOMATION", text, buttons, mediaAssetId: a.mediaAssetId ?? null });
      return `message via @${bot.username}`;
    },
    async sendSequence(a) {
      const bot = await pickBot(snapshot);
      if (!bot) throw new Error("Aucun bot actif.");
      const seq = await prisma.sequence.findFirst({
        where: { trigger: a.trigger, isActive: true, OR: [{ channelId: snapshot.channelId, botId: bot.id }, { channelId: snapshot.channelId, botId: null }, { channelId: null, botId: bot.id }, { channelId: null, botId: null }] },
        orderBy: [{ channelId: "desc" }, { botId: "desc" }],
        include: { steps: { orderBy: { order: "asc" }, take: 1 } },
      });
      const step = seq?.steps[0];
      if (!step) throw new Error(`Aucun message du bot « ${GRAPH_SEQUENCE_LABELS[a.trigger]} » actif pour ce canal.`);
      const texts = (step.texts ?? {}) as Record<string, string>;
      const raw = pickText(texts, snapshot.languageCode, null);
      if (!raw) throw new Error(`Message du bot « ${GRAPH_SEQUENCE_LABELS[a.trigger]} » sans texte.`);
      const text = renderText(raw, { prenom: snapshot.firstName ?? "", canal: snapshot.channelTitle ?? "", bot: bot.name });
      const buttons = Array.isArray(step.buttons) ? (step.buttons as DmButton[][]) : [];
      await enqueueDm({ botId: bot.id, memberId: snapshot.memberId, kind: opts.test ? "TEST" : "AUTOMATION", text, buttons, sequenceStepId: step.id, mediaAssetId: step.mediaAssetId ?? null });
      return `message du bot « ${GRAPH_SEQUENCE_LABELS[a.trigger]} » via @${bot.username}`;
    },
    async tag(a) {
      const m = await prisma.member.findUnique({ where: { id: snapshot.memberId }, select: { tags: true } });
      const tags = Array.isArray(m?.tags) ? (m!.tags as string[]) : [];
      if (!tags.includes(a.tag)) await prisma.member.update({ where: { id: snapshot.memberId }, data: { tags: [...tags, a.tag] } });
      return `étiquette « ${a.tag} »`;
    },
    async suggestChannel(a) {
      const channel = await prisma.channel.findUnique({ where: { id: a.channelId }, select: { id: true, title: true, username: true, language: true } });
      if (!channel) throw new Error("Canal à proposer introuvable.");
      const bot = await pickBot(snapshot);
      if (!bot) throw new Error("Aucun bot actif.");
      let link = await prisma.inviteLink.findFirst({ where: { channelId: channel.id, kind: { in: ["MANUAL", "GATE"] }, isActive: true, name: "automation" }, select: { telegramInviteLink: true } });
      if (!link) {
        const actor = (await actingBotFor(channel.id)) ?? bot;
        let url: string | null = null;
        try {
          const created = await apiForBot(actor).createChatInviteLink(Number((await prisma.channel.findUnique({ where: { id: channel.id }, select: { telegramChatId: true } }))!.telegramChatId), { name: "automation", creates_join_request: true });
          url = created.invite_link;
        } catch {
          url = channel.username ? `https://t.me/${channel.username}` : null;
        }
        if (!url) throw new Error("Impossible de créer un lien d'invitation pour ce canal (bot non administrateur ?).");
        link = await prisma.inviteLink.create({ data: { channelId: channel.id, botId: actor.id, telegramInviteLink: url, name: "automation", kind: "MANUAL", createsJoinRequest: true, language: channel.language }, select: { telegramInviteLink: true } }).catch(() => ({ telegramInviteLink: url! }));
      }
      const text = renderActionText(a.text ?? "On te propose aussi de rejoindre <b>{canal_propose}</b> :", { ...vars, bot: bot.name, canal_propose: channel.title });
      await enqueueDm({ botId: bot.id, memberId: snapshot.memberId, kind: opts.test ? "TEST" : "AUTOMATION", text, buttons: [[{ text: `➕ ${channel.title}`, url: link.telegramInviteLink }]] });
      return `canal « ${channel.title} » proposé`;
    },
    async notifyTeam(a) {
      const who = snapshot.firstName ? `${snapshot.firstName} (${snapshot.memberId})` : snapshot.memberId;
      const text = `🤖 <b>Relance automatique « ${opts.ruleName} »</b>\n${renderActionText(a.text, vars)}\nMembre : ${who}`;
      if (opts.test) return "notification (test, non envoyée)";
      const ok = await notifyAdmin(text);
      if (!ok) throw new Error("Notification Telegram impossible (admin non configuré).");
      await recordEvent({ type: "automation.notify_team", memberId: snapshot.memberId, payload: { rule: opts.ruleName } });
      return "équipe prévenue";
    },
  };
}

export type { AutomationAction };
