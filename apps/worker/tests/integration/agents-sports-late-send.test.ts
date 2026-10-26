/**
 * Relecture de la phase 25 (base réelle) : un post de pari réclamé par le scheduler à moins de N minutes du coup
 * d'envoi n'est jamais envoyé (post CANCELLED, pari SKIPPED « trop tard ») ; à l'heure, il part normalement.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { BET_TOO_LATE_REASON } from "../../src/sending/bet-kickoff";
import { approveAllQa, createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

let calls: TelegramCall[] = [];
let channelId = "";
let botId = "";
let categoryId = "";

beforeEach(async () => {
  await resetDb();
  // Phase 30 : QA Global simulé qui approuve au point d'envoi (le verrou reste actif).
  await approveAllQa();
  await prisma.bettingPick.deleteMany();
  const { bot, channel } = await createBotAndChannel();
  channelId = channel.id;
  botId = bot.id;
  const cat = await prisma.betCategory.upsert({
    where: { key: "it-tard" },
    create: { key: "it-tard", name: "Tard (test)", marketTypes: [], leagues: [], bookmakers: ["sportaza"], minOdds: 1.5, maxOdds: 3.5, picksPerDay: 1, channelIds: [channel.id], active: false, minMinutesBeforeKickoff: 30, sortOrder: 98 },
    update: { minMinutesBeforeKickoff: 30, active: false },
  });
  categoryId = cat.id;
  calls = installFakeTelegram((await apiForBot(bot.id)).api);
});

async function betPost(kickoffInMinutes: number) {
  const mission = await prisma.agentMission.create({ data: { teamKey: "sports", kind: "BET", channelId, status: "DONE" } });
  const post = await prisma.post.create({
    data: { code: `T${Math.random().toString(36).slice(2, 9)}`, channelId, botId, status: "SCHEDULED", scheduledAt: new Date(Date.now() - 60_000), text: "Pari", agentMissionId: mission.id, buttons: [] },
  });
  const pick = await prisma.bettingPick.create({
    data: {
      missionId: mission.id,
      categoryId,
      eventId: "ev",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      league: "EPL",
      kickoffAt: new Date(Date.now() + kickoffInMinutes * 60_000),
      marketId: "shots_onGoal-all-game-ou-over",
      marketLabel: "Tirs cadrés",
      selectionLabel: "Plus de 8,5",
      line: 8.5,
      bookmaker: "sportaza",
      odds: 2,
      status: "PUBLISHED",
      postId: post.id,
    },
  });
  await prisma.agentMission.update({ where: { id: mission.id }, data: { postId: post.id } });
  return { post, pick };
}

describe("post de pari envoyé trop tard", () => {
  it("réclamé à N − 1 min du coup d'envoi : non envoyé, annulé, pari écarté « trop tard »", async () => {
    const { post, pick } = await betPost(29.5);
    await processScheduler(fakeJob({ type: "tick" as const }));
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    expect(calls.filter((c) => /^send/.test(c.method))).toHaveLength(0);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await prisma.bettingPick.findUniqueOrThrow({ where: { id: pick.id } })).toMatchObject({ status: "SKIPPED", skipReason: BET_TOO_LATE_REASON });
  });

  it("à l'heure (2 h avant) : envoyé", async () => {
    const { post, pick } = await betPost(120);
    await processScheduler(fakeJob({ type: "tick" as const }));
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: "SENT" });
    expect(await prisma.bettingPick.findUniqueOrThrow({ where: { id: pick.id } })).toMatchObject({ status: "PUBLISHED" });
  });
});

describe("message d'agent déjà programmé : pause et retour en simulation (relecture phase 25)", () => {
  async function agentPost(real: boolean) {
    const target = real
      ? await prisma.channel.create({ data: { telegramChatId: -1009988776655n, title: "Vrai canal", type: "CHANNEL", language: "fr", primaryBotId: botId, isTest: false } })
      : { id: channelId };
    const mission = await prisma.agentMission.create({ data: { teamKey: "casino", kind: "POST", channelId: target.id, status: "DONE" } });
    return prisma.post.create({
      data: { code: `A${Math.random().toString(36).slice(2, 9)}`, channelId: target.id, botId, status: "SCHEDULED", scheduledAt: new Date(Date.now() - 60_000), text: "Agent", agentMissionId: mission.id, buttons: [] },
    });
  }

  it("équipe en pause à l'échéance : aucun envoi, message retenu 30 min ; message humain envoyé", async () => {
    await prisma.agentTeamConfig.create({ data: { teamKey: "casino", simulation: false, paused: true } });
    const post = await agentPost(true);
    const human = await prisma.post.create({ data: { code: `H${Math.random().toString(36).slice(2, 9)}`, channelId, botId, status: "SCHEDULED", scheduledAt: new Date(Date.now() - 60_000), text: "Humain", buttons: [] } });
    await processScheduler(fakeJob({ type: "tick" as const }));
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    await processTelegramSend(fakeJob({ type: "post" as const, postId: human.id }));
    const held = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(held).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(held.scheduledAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: human.id } })).toMatchObject({ status: "SENT" });
  });

  it("équipe repassée en simulation : message vers un vrai canal annulé, rien n'est envoyé", async () => {
    await prisma.agentTeamConfig.create({ data: { teamKey: "casino", simulation: true } });
    const post = await agentPost(true);
    await processScheduler(fakeJob({ type: "tick" as const }));
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    expect(calls.filter((c) => /^send/.test(c.method))).toHaveLength(0);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await prisma.event.count({ where: { type: "agents.post.cancelled_simulation" } })).toBe(1);
  });
});
