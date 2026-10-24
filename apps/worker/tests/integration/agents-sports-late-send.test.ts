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
import { createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

let calls: TelegramCall[] = [];
let channelId = "";
let botId = "";
let categoryId = "";

beforeEach(async () => {
  await resetDb();
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
