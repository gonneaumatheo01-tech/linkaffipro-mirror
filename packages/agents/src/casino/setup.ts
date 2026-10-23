/**
 * Questions de mise en route de l'équipe Casino (phase 22), posées une seule fois par le bot (`Setting`
 * `agents.casinoSetupAsked`, marqué avant, et seulement quand un canal casino existe) : pour chaque canal casino, le
 * choix de la campagne de son bouton Offre (CHOICE numéroté, réponse → `ChannelAgentPlan.campaignId`), puis une
 * demande de vidéos par thème des canaux (MEDIA « envoie 3 à 5 vidéos roulette avec #casino #roulette »). Un canal
 * sans thème : les 3 premiers thèmes de départ. Une question à la fois (file `HumanRequest`).
 */
import type { AgentsDeps } from "../types";
import { agentAudit, agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { CASINO_DEFAULT_THEMES } from "./contracts";
import { casinoChannels, casinoPlans } from "./data";
import { CASINO_DEFAULT_MIX } from "./format";

export const CASINO_SETUP_SETTING = "agents.casinoSetupAsked";
/** Vidéos demandées par thème à la mise en route (3 à 5). */
export const SETUP_VIDEOS_WANTED = 3;
/** Options d'un choix numéroté (au-delà, la fiche du canal sur le site). */
const MAX_CAMPAIGN_OPTIONS = 8;

export type SetupThemeAsk = { theme: string; channels: string[]; channelIds: string[]; defaulted: boolean };

/** Thèmes à demander (pur) : ceux des canaux, sinon les 3 premiers thèmes de départ ; regroupés par thème. */
export function setupThemeAsks(channels: ReadonlyArray<{ id?: string; title: string; themes: readonly string[] }>): SetupThemeAsk[] {
  const out: SetupThemeAsk[] = [];
  for (const c of channels) {
    const defaulted = c.themes.length === 0;
    const themes = defaulted ? CASINO_DEFAULT_THEMES.slice(0, 3) : c.themes;
    for (const theme of themes) {
      const a = out.find((x) => x.theme === theme);
      if (a) {
        if (!a.channels.includes(c.title)) a.channels.push(c.title);
        if (c.id && !a.channelIds.includes(c.id)) a.channelIds.push(c.id);
        a.defaulted &&= defaulted;
      } else out.push({ theme, channels: [c.title], channelIds: c.id ? [c.id] : [], defaulted });
    }
  }
  return out;
}

export async function ensureCasinoSetupQuestions(deps: AgentsDeps): Promise<{ queued: number }> {
  if ((await readSetting(deps, CASINO_SETUP_SETTING)) !== undefined) return { queued: 0 };
  const channels = (await casinoChannels(deps.prisma)).filter((c) => !c.isTest);
  if (!channels.length) return { queued: 0 };
  await writeSetting(deps, CASINO_SETUP_SETTING, { askedAt: nowOf(deps).toISOString() });
  const [plans, campaigns] = await Promise.all([
    casinoPlans(deps.prisma),
    deps.prisma.campaign.findMany({
      where: { vertical: "CASINO", status: { not: "ENDED" } },
      orderBy: { createdAt: "desc" },
      take: MAX_CAMPAIGN_OPTIONS,
      select: { id: true, name: true },
    }),
  ]);
  let queued = 0;
  if (campaigns.length)
    for (const c of channels) {
      if (plans.get(c.id)?.campaignId) continue;
      await askHuman(deps, {
        teamKey: "casino",
        kind: "CHOICE",
        key: `casino.channel.${c.id}.campaign`,
        question: `Quelle offre (campagne) pour le bouton des posts de « ${c.title} » ? Réponds par le numéro, ou « plus tard ».`,
        options: campaigns.map((x) => x.name),
        onAnswer: { action: "casino-channel-campaign", channelId: c.id, campaignIds: campaigns.map((x) => x.id), names: campaigns.map((x) => x.name), resume: false },
      });
      queued++;
    }
  const asks = setupThemeAsks(channels.map((c) => ({ id: c.id, title: c.title, themes: (plans.get(c.id)?.themes ?? []).map((t) => t.theme) })));
  for (const a of asks) {
    await askHuman(deps, {
      teamKey: "casino",
      kind: "MEDIA",
      key: `media.casino.setup.${a.theme}`,
      question: `Envoie 3 à 5 vidéos ${a.theme} au bot avec la légende #casino #${a.theme} (${a.channels.slice(0, 3).join(", ")}${a.defaulted ? ", thème de départ" : ""}). Réponds « plus tard » pour passer.`,
      expected: { count: SETUP_VIDEOS_WANTED, tags: ["casino", a.theme], channelIds: a.channelIds },
      onAnswer: { resume: false },
    });
    queued++;
  }
  await writeSetting(deps, CASINO_SETUP_SETTING, { askedAt: nowOf(deps).toISOString(), queued, channels: channels.length, defaultedThemes: asks.some((a) => a.defaulted) });
  await agentEvent(deps, "agents.casino.setup_queued", { queued, channels: channels.length });
  return { queued };
}

registerAnswerAction("casino-channel-campaign", async (deps, { value, actor, onAnswer }) => {
  const channelId = typeof onAnswer.channelId === "string" ? onAnswer.channelId : null;
  const names = Array.isArray(onAnswer.names) ? (onAnswer.names as unknown[]) : [];
  const ids = Array.isArray(onAnswer.campaignIds) ? (onAnswer.campaignIds as unknown[]) : [];
  const campaignId = ids[names.indexOf(value)];
  if (!channelId || typeof campaignId !== "string") return "Campagne introuvable : rien n'est enregistré.";
  const campaign = await deps.prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true } });
  if (!campaign) return "Cette campagne n'existe plus : choisis-la depuis la fiche du canal sur le site.";
  const plan = await deps.prisma.channelAgentPlan.findUnique({ where: { channelId }, select: { teamKey: true, campaignId: true } });
  if (plan && plan.teamKey !== "casino") return "Ce canal est suivi par une autre équipe : rien n'est changé.";
  if (plan) await deps.prisma.channelAgentPlan.update({ where: { channelId }, data: { campaignId } });
  else await deps.prisma.channelAgentPlan.create({ data: { channelId, teamKey: "casino", enabled: false, campaignId, mix: { ...CASINO_DEFAULT_MIX } } });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.casino.channel_campaign",
    entityType: "ChannelAgentPlan",
    entityId: channelId,
    metadata: { before: plan?.campaignId ?? null, after: campaignId, via: actor.via },
  });
  return `Bouton Offre : « ${campaign.name} » ✅`;
});
