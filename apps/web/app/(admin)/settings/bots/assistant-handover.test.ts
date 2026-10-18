import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {}, recordEvent: vi.fn() }));
vi.mock("@linkaffipro/telegram", async () => {
  // Seule la règle pure du choix du bot principal sert ici (même choix que pour un canal nouveau).
  const { choosePrimaryBot } =
    await import("../../../../../../packages/telegram/src/channels/primary-bot");
  return { choosePrimaryBot };
});

import { planAssistantHandover, type HandoverChannel } from "./assistant-handover";

// Passage d'un bot en assistant de conversation : qui reprend son rôle de bot principal et ses messages à venir.

const lea = { id: "lea", vertical: "DATING", mode: "STANDARD" };
const max = { id: "max", vertical: "CASINO", mode: "STANDARD" };
const zoe = { id: "zoe", vertical: "DATING", mode: "STANDARD" };
const otherAssistant = { id: "hugo", vertical: "DATING", mode: "ASSISTANT" };

const channel = (over: Partial<HandoverChannel>): HandoverChannel => ({
  id: "c1",
  title: "Rencontres",
  vertical: "DATING",
  primaryBotId: "lea",
  admins: [lea, max, zoe],
  ...over,
});

describe("reprise par un bot normal", () => {
  it("bot principal remplacé (même univers d'abord), messages à venir repris par ce bot", () => {
    const plan = planAssistantHandover(
      "lea",
      [channel({})],
      [
        { id: "p1", channelId: "c1", status: "SCHEDULED", publisher: "BOT", isTemplate: false },
        { id: "p2", channelId: "c1", status: "DRAFT", publisher: "ACCOUNT", isTemplate: false },
      ],
    );
    expect(plan.primaries).toEqual([{ channelId: "c1", botId: "zoe" }]);
    expect(plan.posts).toEqual([
      { postId: "p1", botId: "zoe" },
      { postId: "p2", botId: "zoe" },
    ]);
    expect(plan.stuck).toEqual([]);
  });

  it("un autre bot principal déjà choisi reste, et reprend les messages", () => {
    const plan = planAssistantHandover(
      "lea",
      [channel({ primaryBotId: "max" })],
      [{ id: "p1", channelId: "c1", status: "SCHEDULED", publisher: "BOT", isTemplate: false }],
    );
    expect(plan.primaries).toEqual([]);
    expect(plan.posts).toEqual([{ postId: "p1", botId: "max" }]);
  });

  it("jamais un autre assistant ; aucun bot normal : canal sans bot principal, messages bloquants", () => {
    const plan = planAssistantHandover(
      "lea",
      [channel({ admins: [lea, otherAssistant] })],
      [
        { id: "p1", channelId: "c1", status: "SCHEDULED", publisher: "BOT", isTemplate: false },
        { id: "p2", channelId: "c1", status: "DRAFT", publisher: "ACCOUNT", isTemplate: false },
        { id: "p3", channelId: "c1", status: "DRAFT", publisher: "BOT", isTemplate: true },
      ],
    );
    expect(plan.primaries).toEqual([{ channelId: "c1", botId: null }]);
    expect(plan.posts).toEqual([]);
    // Publié par le compte connecté, ou modèle : pas besoin du bot.
    expect(plan.stuck).toEqual([{ postId: "p1", channelId: "c1", channelTitle: "Rencontres" }]);
  });

  it("messages annulés ou échoués : repris par le bot normal, comme les messages programmés", () => {
    const plan = planAssistantHandover(
      "lea",
      [channel({})],
      [
        { id: "p1", channelId: "c1", status: "CANCELLED", publisher: "BOT", isTemplate: false },
        { id: "p2", channelId: "c1", status: "FAILED", publisher: "BOT", isTemplate: false },
      ],
    );
    expect(plan.posts).toEqual([
      { postId: "p1", botId: "zoe" },
      { postId: "p2", botId: "zoe" },
    ]);
  });

  it("aucun bot normal : un message annulé ou échoué ne bloque pas (sa reprogrammation choisira un autre bot)", () => {
    const plan = planAssistantHandover(
      "lea",
      [channel({ admins: [lea, otherAssistant] })],
      [
        { id: "p1", channelId: "c1", status: "CANCELLED", publisher: "BOT", isTemplate: false },
        { id: "p2", channelId: "c1", status: "FAILED", publisher: "BOT", isTemplate: false },
        { id: "p3", channelId: "c1", status: "DRAFT", publisher: "BOT", isTemplate: false },
      ],
    );
    expect(plan.posts).toEqual([]);
    expect(plan.stuck.map((s) => s.postId)).toEqual(["p3"]);
  });
});
