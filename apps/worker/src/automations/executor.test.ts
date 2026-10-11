import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as TelegramModule from "@linkaffipro/telegram";
import type { MemberSnapshot } from "./context";

// Relances automatiques : les repères {prenom}, {canal}, {bot} sont remplacés à l'envoi du message privé, avec des
// valeurs échappées pour le HTML Telegram (un prénom « Tom <3 » ne doit pas faire refuser le message).

const h = vi.hoisted(() => ({
  enqueueDm: vi.fn(async (_input: Record<string, unknown>) => ({ outboundMessageId: "om1" })),
  notifyAdmin: vi.fn(async (_text: string) => true),
  outboundUpdate: vi.fn(async (_args: Record<string, unknown>) => ({})),
  resolveButtons: vi.fn(async (rows: unknown, ctx: Record<string, unknown>) => ({
    rows: ((rows ?? []) as Array<Array<Record<string, unknown>>>).map((r) =>
      r.map((b) =>
        b.type === "OFFER"
          ? {
              text: b.text,
              url: `https://t.me/${String(ctx.botUsername)}?start=oSLUG${String(ctx.ruleId)}`,
            }
          : { text: b.text, url: b.url },
      ),
    ),
    dropped: [] as string[],
  })),
  bot: { id: "bot1", name: "Casino Bot", username: "casinobot", isActive: true },
  step: null as null | {
    id: string;
    texts: Record<string, string>;
    buttons: unknown;
    mediaAssetId: string | null;
  },
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    bot: { findFirst: vi.fn(async () => h.bot) },
    sequence: { findFirst: vi.fn(async () => (h.step ? { steps: [h.step] } : null)) },
    outboundMessage: { update: h.outboundUpdate },
  },
  recordEvent: vi.fn(async () => undefined),
}));
vi.mock("./offer-links", () => ({ resolveAutomationButtons: h.resolveButtons }));
vi.mock("@linkaffipro/queue", () => ({ enqueueDm: h.enqueueDm }));
// Vrais `pickText` / `renderText` (messages du bot) ; seule la notification à l'admin est simulée.
vi.mock("@linkaffipro/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof TelegramModule>()),
  notifyAdmin: h.notifyAdmin,
}));
vi.mock("../approvals/telegram-actions", () => ({
  actingBotFor: vi.fn(async () => h.bot),
  apiForBot: vi.fn(),
}));

import { prismaExecutor } from "./executor";

function snapshot(over: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    memberId: "m1",
    firstName: "Léa",
    languageCode: "fr",
    telegramUserId: 42n,
    channelId: "ch1",
    channelTitle: "Casino VIP",
    campaignId: null,
    ctx: {
      channelId: "ch1",
      campaignId: null,
      languageCode: "fr",
      spendLevel: "NONE",
      inactiveDays: 0,
      categoryId: null,
    },
    ...over,
  } as MemberSnapshot;
}

const sentText = () => String(h.enqueueDm.mock.calls.at(-1)![0].text);

describe("relance : repères remplacés dans le message privé", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.bot = { id: "bot1", name: "Casino Bot", username: "casinobot", isActive: true };
    h.step = null;
  });

  it("message de la relance : {prenom}, {canal} et {bot} remplacés ; mot inconnu laissé tel quel", async () => {
    await prismaExecutor(snapshot(), { ruleId: "rule1", ruleName: "R" }).sendMessage({
      type: "send_message",
      text: "Bonjour <b>{prenom}</b>, bienvenue sur {canal} ({bot}) {inconnu}",
    });
    expect(sentText()).toBe("Bonjour <b>Léa</b>, bienvenue sur Casino VIP (Casino Bot) {inconnu}");
    expect(h.enqueueDm.mock.calls[0]![0]).toMatchObject({
      botId: "bot1",
      memberId: "m1",
      kind: "AUTOMATION",
    });
  });

  it("message du bot envoyé par une relance : mêmes repères remplacés", async () => {
    h.step = {
      id: "st1",
      texts: { fr: "Salut {prenom} ! {canal} via {bot}" },
      buttons: [],
      mediaAssetId: null,
    };
    await prismaExecutor(snapshot(), { ruleId: "rule1", ruleName: "R" }).sendSequence({
      type: "send_sequence",
      trigger: "APPROVED",
    });
    expect(sentText()).toBe("Salut Léa ! Casino VIP via Casino Bot");
  });

  it("prénom, canal et bot échappés : « < » et « & » ne cassent pas le HTML Telegram", async () => {
    h.bot = { ...h.bot, name: "Bot & Co" };
    const s = snapshot({ firstName: "Tom <3", channelTitle: "Paris & Cie" });
    await prismaExecutor(s, { ruleId: "rule1", ruleName: "R" }).sendMessage({
      type: "send_message",
      text: "Bonjour {prenom} ({canal}, {bot})",
    });
    expect(sentText()).toBe("Bonjour Tom &lt;3 (Paris &amp; Cie, Bot &amp; Co)");
    h.step = {
      id: "st1",
      texts: { fr: "Salut {prenom} de {canal}" },
      buttons: [],
      mediaAssetId: null,
    };
    await prismaExecutor(s, { ruleId: "rule1", ruleName: "R" }).sendSequence({
      type: "send_sequence",
      trigger: "APPROVED",
    });
    expect(sentText()).toBe("Salut Tom &lt;3 de Paris &amp; Cie");
  });

  it("membre sans prénom : le repère disparaît", async () => {
    await prismaExecutor(snapshot({ firstName: null }), {
      ruleId: "rule1",
      ruleName: "R",
    }).sendMessage({
      type: "send_message",
      text: "Bonjour {prenom} !",
    });
    expect(sentText()).toBe("Bonjour  !");
  });

  it("notification à l'équipe : {prenom} et {canal} remplacés, échappés", async () => {
    await prismaExecutor(snapshot({ firstName: "Tom <3" }), {
      ruleId: "rule1",
      ruleName: "R",
    }).notifyTeam({
      type: "notify_team",
      text: "{prenom} a cliqué sur {canal}",
    });
    expect(String(h.notifyAdmin.mock.calls[0]![0])).toContain("Tom &lt;3 a cliqué sur Casino VIP");
  });
});

describe("relance : messages rattachés à la relance, bouton « Offre (campagne) »", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.bot = { id: "bot1", name: "Casino Bot", username: "casinobot", isActive: true };
    h.step = { id: "st1", texts: { fr: "Accepté" }, buttons: [], mediaAssetId: null };
  });

  it("bouton Offre → lien du bot de la relance (identifiant de suivi créé au clic) ; lien simple inchangé", async () => {
    const detail = await prismaExecutor(snapshot(), { ruleId: "rule1", ruleName: "R" }).sendMessage(
      {
        type: "send_message",
        text: "Bonjour",
        buttons: [
          [
            {
              text: "Voir l'offre",
              type: "OFFER",
              campaignId: "camp1",
              affiliateCampaignId: "aff1",
            },
          ],
          [{ text: "Site", url: "https://exemple.fr" }],
        ],
      },
    );
    expect(h.resolveButtons).toHaveBeenCalledWith(expect.any(Array), {
      ruleId: "rule1",
      ruleName: "R",
      botUsername: "casinobot",
    });
    expect(h.enqueueDm.mock.calls[0]![0].buttons).toEqual([
      [{ text: "Voir l'offre", url: "https://t.me/casinobot?start=oSLUGrule1" }],
      [{ text: "Site", url: "https://exemple.fr" }],
    ]);
    expect(detail).toBe("message via @casinobot");
  });

  it("chaque message privé de la relance est rattaché à la relance (envoyés par relance)", async () => {
    const exec = prismaExecutor(snapshot(), { ruleId: "rule1", ruleName: "R" });
    await exec.sendMessage({ type: "send_message", text: "Bonjour" });
    await exec.sendSequence({ type: "send_sequence", trigger: "APPROVED" });
    expect(h.outboundUpdate).toHaveBeenCalledTimes(2);
    expect(h.outboundUpdate.mock.calls[0]![0]).toEqual({
      where: { id: "om1" },
      data: { automationRuleId: "rule1" },
    });
  });

  it("bouton Offre dont le lien est désactivé : message envoyé sans lui, signalé au journal", async () => {
    h.resolveButtons.mockResolvedValueOnce({ rows: [], dropped: ["Voir l'offre"] });
    const detail = await prismaExecutor(snapshot(), { ruleId: "rule1", ruleName: "R" }).sendMessage(
      {
        type: "send_message",
        text: "Bonjour",
        buttons: [
          [
            {
              text: "Voir l'offre",
              type: "OFFER",
              campaignId: "camp1",
              affiliateCampaignId: "aff1",
            },
          ],
        ],
      },
    );
    expect(h.enqueueDm.mock.calls[0]![0].buttons).toEqual([]);
    expect(detail).toBe(
      "message via @casinobot (bouton « Voir l'offre » non envoyé : lien désactivé dans Campagnes → Liens)",
    );
  });
});
