/** Relecture de la phase 25 : utilisation d'un média datée à l'heure d'envoi prévue (« jamais deux canaux le même jour »). */
import { describe, expect, it, vi } from "vitest";
import type * as Db from "@linkaffipro/db";

vi.mock("@linkaffipro/db", async (importOriginal) => {
  const orig = await importOriginal<typeof Db>();
  return {
    ...orig,
    createAgentPost: vi.fn(async (db: { post: { create(a: unknown): Promise<{ id: string }> } }, input: Record<string, unknown>) => {
      const post = await db.post.create({ data: { channelId: input.channelId, botId: "bot", status: "SCHEDULED", scheduledAt: input.scheduledAt, text: input.text, mediaAssetIds: input.mediaAssetIds, agentMissionId: input.agentMissionId } });
      return { postId: post.id, botId: "bot", publisher: "BOT", trackingLinkId: null };
    }),
  };
});

import { createEngineKit } from "../../testing/engine-kit";
import { buildContext } from "../../missions/context";
import type { Mission } from "../../types";
import { agent } from "./index";

describe("publication : date d'utilisation d'un média", () => {
  it("casino : MediaUsage.usedAt = créneau d'envoi (lendemain), pas l'heure de création", async () => {
    const kit = createEngineKit({ start: new Date("2026-10-23T21:30:00Z") });
    const t = kit.prisma._model;
    t("channel").rows.push({ id: "c1", title: "Casino VIP", vertical: "CASINO", isTest: false, isActive: true, language: "fr", type: "CHANNEL", telegramChatId: -1003n });
    t("agentTeamConfig").rows.push({ id: "cfg", teamKey: "casino", enabled: true, simulation: true, paused: false, autonomyLevel: 2, monthlyBudgetCents: {}, settings: {}, styleGuidelines: "", forbiddenWords: [], maxTextLength: 900, quietHours: [], consecutiveFailures: 0 });
    t("channelAgentPlan").rows.push({ id: "plan", channelId: "c1", teamKey: "casino", enabled: true, postsPerDay: 4, windowStart: "00:00", windowEnd: "24:00", minSpacingMinutes: 0, mix: {}, personaId: null, campaignId: null, themes: [] });
    t("agentMission").rows.push({ id: "m1", teamKey: "casino", kind: "POST", channelId: "c1", status: "RUNNING", currentStep: 0, steps: [], payload: {}, costCents: 0, postId: null, isTest: false, attempts: 0 });
    const slot = "2026-10-24T10:00:00.000Z";
    const mission: Mission = {
      id: "m1",
      teamKey: "casino",
      kind: "POST",
      channelId: "c1",
      status: "RUNNING",
      currentStep: 0,
      steps: [],
      payload: { text: "<b>Roulette ce soir</b>", mediaAssetId: "v1", format: "video", slot },
      costCents: 0,
      postId: null,
      scheduledFor: null,
      isTest: false,
      attempts: 0,
    };
    const ctx = await buildContext(kit.deps, "casino");
    const r = await agent.run(mission, ctx);
    expect(r.ok).toBe(true);
    const usage = kit.t("mediaUsage");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ assetId: "v1", channelId: "c1" });
    expect((usage[0]!.usedAt as Date).toISOString()).toBe(slot);
  });
});
