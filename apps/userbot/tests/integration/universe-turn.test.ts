// Compte réel d'un gérant du VIP (Paris sportifs : Mehdi) sur une base PostgreSQL réelle : réponse, panne de l'IA
// (aucun message d'attente, nouvel essai), messages reçus pendant un redémarrage, tour d'un ancien process resté sur
// « attends je reviens 2 sec », passage à l'équipe, conversation reprise par l'équipe. Fausse IA et faux Telegram :
// aucun réseau. Une persona Rencontres (Léa) n'est jamais touchée par ce balayage.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Chat from "@linkaffipro/chat";
import type { TelegramClient } from "telegram";
import type * as Rules from "../../src/assistant-rules";

const llm = vi.hoisted(() => ({
  fail: false,
  next: [] as Array<Record<string, unknown>>,
  prompts: [] as string[],
}));

vi.mock("@linkaffipro/chat", async (importOriginal) => {
  const chat = await importOriginal<typeof Chat>();
  return {
    ...chat,
    createVeniceClient: () =>
      chat.createFakeLlm((req) => {
        llm.prompts.push(req.messages.map((m) => m.content).join("\n"));
        if (llm.fail) return new Error("Venice indisponible (503)");
        return (llm.next.shift() ?? { messages: ["oe tkt frero"] }) as never;
      }),
  };
});

vi.mock("../../src/settings", async () => {
  const { parseAssistantConfig } = await import("@linkaffipro/chat");
  return {
    loadUserbotSettings: async () => ({ config: parseAssistantConfig({}), apiKey: "cle-de-test" }),
  };
});

// Le balayage prend les messages tout de suite, et cherche les tours d'un ancien process dès le démarrage du test.
vi.mock("../../src/assistant-rules", async (importOriginal) => ({
  ...(await importOriginal<typeof Rules>()),
  SWEEP_MIN_AGE_MS: 0,
  DEAD_TURN_CHECK_AFTER_START_MS: 0,
}));

const { prisma } = await import("@linkaffipro/db");
const { drainUniverseTurns, handleIncomingPrivate, sweepUniverseNow } = await import(
  "../../src/turn"
);
type TurnAccount = Parameters<typeof handleIncomingPrivate>[0];

if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
  throw new Error("tests d'intégration : base de test uniquement (DATABASE_URL avec « linkaffipro_test »)");

/** Faux Telegram : messages envoyés gardés dans l'ordre. */
function fakeClient() {
  const sent: string[] = [];
  let id = 5_000;
  const client = {
    async sendMessage(_peer: unknown, opts: { message: string }) {
      sent.push(opts.message);
      return { id: id++ };
    },
    async sendFile(_peer: unknown, opts: { caption?: string }) {
      sent.push(opts.caption ?? "");
      return { id: id++ };
    },
    async invoke() {
      return undefined;
    },
    async markAsRead() {
      return undefined;
    },
    async getInputEntity(x: unknown) {
      return x;
    },
    async getDialogs() {
      return [];
    },
  };
  return { client: client as unknown as TelegramClient, sent };
}

const TAG = `ubit${Date.now().toString(36)}`;
let seq = 0;
const uniq = () => `${TAG}${++seq}`;

async function makeAccount(universe: "sports" | "dating") {
  const program = await prisma.affiliateProgram.create({ data: { name: `Prog ${uniq()}` } });
  const campaign = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: uniq(),
      name: "Celsius",
      isActive: true,
      trackingUrlTemplate: "https://celsius.test/?s={subid}",
    },
  });
  const persona = await prisma.persona.create({
    data: {
      name: universe === "sports" ? "Mehdi" : "Lea",
      gender: universe === "sports" ? "M" : "F",
      universe,
      identityKind: universe === "sports" ? "VIP_MANAGER" : "GIRL",
      isActive: true,
      minExchangesBeforeOffer: 1,
      requireInterest: false,
      offerPitch: "Le VIP est gratuit pour les joueurs de nos bookmakers partenaires.",
      responseDelayMinSec: 1,
      responseDelayMaxSec: 1,
      ...(universe === "sports"
        ? {
            bookmakers: {
              create: [
                {
                  bookmakerKey: "celsius",
                  label: "Celsius Casino",
                  priority: 1,
                  affiliateCampaignId: campaign.id,
                },
              ],
            },
          }
        : {}),
    },
  });
  const bot = await prisma.bot.create({
    data: {
      name: `Fantome ${uniq()}`,
      username: `${uniq()}_bot`,
      telegramBotId: BigInt(Date.now()) * 100n + BigInt(++seq),
      tokenEncrypted: "x",
      vertical: universe === "sports" ? "SPORTS" : "DATING",
      webhookSecret: uniq(),
    },
  });
  const row = await prisma.telegramUserAccount.create({
    data: {
      label: persona.name,
      phone: `+33${Date.now()}${++seq}`,
      sessionEncrypted: "x",
      status: "ACTIVE",
      isActive: true,
      personaId: persona.id,
      botId: bot.id,
    },
  });
  const tg = fakeClient();
  const account: TurnAccount = {
    id: row.id,
    label: persona.name,
    botId: bot.id,
    personaId: persona.id,
    client: tg.client,
  };
  return { account, sent: tg.sent, botId: bot.id };
}

let memberSeq = 0;
function incoming(text: string, telegramUserId: bigint, messageId = ++memberSeq) {
  return {
    telegramUserId,
    telegramMessageId: messageId,
    text,
    media: null,
    firstName: "Test",
    lastName: null,
    username: null,
    languageCode: "fr",
    peer: Number(telegramUserId),
  };
}

const newUserId = () => BigInt(7_000_000_000) + BigInt(Date.now() % 1_000_000) * 100n + BigInt(++memberSeq);

async function conversationOf(botId: string, telegramUserId: bigint) {
  return prisma.conversation.findFirstOrThrow({
    where: { botId, member: { telegramUserId } },
  });
}

async function messages(conversationId: string) {
  return prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

const metaOf = (m: { meta: unknown }) => (m.meta ?? {}) as Record<string, unknown>;

afterAll(async () => {
  await drainUniverseTurns(0);
  await prisma.$disconnect();
});

describe("compte réel du gérant du VIP (Mehdi)", () => {
  let mehdi: Awaited<ReturnType<typeof makeAccount>>;

  beforeAll(async () => {
    mehdi = await makeAccount("sports");
  });

  beforeEach(() => {
    llm.fail = false;
    llm.next = [];
    llm.prompts = [];
    mehdi.sent.length = 0;
  });

  it("répond, et ses messages sont marqués traités (jamais repris comme un tour interrompu)", async () => {
    const user = newUserId();
    llm.next.push({ messages: ["oe tkt c gratuit, t'as deja un compte sur Celsius Casino ?"] });
    await handleIncomingPrivate(mehdi.account, incoming("salut je veux le vip", user));
    expect(mehdi.sent).toHaveLength(1);
    expect(mehdi.sent[0]).toContain("Celsius Casino");
    const conv = await conversationOf(mehdi.botId, user);
    expect(conv.assistantTurns).toBe(1);
    expect(conv.retryAt).toBeNull();
    const [inbound] = (await messages(conv.id)).filter((m) => m.direction === "IN");
    expect(inbound!.turnId).toMatch(/^ub_[0-9a-f]{8}_/);
    expect(inbound!.claimedAt).toBeNull();
    expect(metaOf(inbound!).turnDone).toBe(true);
  });

  it("panne de l'IA : aucun « attends je reviens », nouvel essai qui répond", async () => {
    const user = newUserId();
    llm.fail = true;
    await handleIncomingPrivate(mehdi.account, incoming("ca marche comment ?", user));
    expect(mehdi.sent).toEqual([]);
    let conv = await conversationOf(mehdi.botId, user);
    expect(conv.retryAt).not.toBeNull();
    expect(conv.retryAt!.getTime()).toBeGreaterThan(Date.now());
    // Messages rendus pour le nouvel essai.
    expect((await messages(conv.id)).filter((m) => m.turnId === null)).toHaveLength(1);
    expect(
      await prisma.conversationEvent.count({ where: { conversationId: conv.id, type: "ai_failed" } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.event.count({
        where: { type: "conversation.ai_failed", payload: { path: ["conversationId"], equals: conv.id } },
      }),
    ).toBeGreaterThan(0);

    // Heure du nouvel essai passée (sans attendre 45 s) : le balayage reprend la conversation.
    llm.fail = false;
    llm.next.push({ messages: ["tu t'inscris sur Celsius Casino et tu rejoins le vip, c gratuit"] });
    await prisma.conversation.update({ where: { id: conv.id }, data: { retryAt: new Date(Date.now() - 1_000) } });
    await sweepUniverseNow(mehdi.account);
    await vi.waitFor(() => expect(mehdi.sent).toHaveLength(1), { timeout: 30_000, interval: 200 });
    await vi.waitFor(
      async () => {
        conv = await conversationOf(mehdi.botId, user);
        expect(conv.retryAt).toBeNull();
        expect(conv.assistantTurns).toBe(1);
      },
      { timeout: 10_000, interval: 200 },
    );
    expect(mehdi.sent[0]).not.toMatch(/attends|je reviens|2 sec/i);
  });

  it("message reçu pendant un redémarrage : repris par le balayage", async () => {
    const user = newUserId();
    llm.next.push({ messages: ["oe frero"] }, { messages: ["t'as un compte sur Celsius Casino ?"] });
    await handleIncomingPrivate(mehdi.account, incoming("yo", user));
    expect(mehdi.sent).toHaveLength(1);
    const conv = await conversationOf(mehdi.botId, user);
    // Reçu par Telegram pendant que le service redémarrait : enregistré, jamais pris par un tour.
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "IN", author: "MEMBER", text: "c'est quoi le vip ?" },
    });
    await sweepUniverseNow(mehdi.account);
    await vi.waitFor(() => expect(mehdi.sent).toHaveLength(2), { timeout: 30_000, interval: 200 });
    await vi.waitFor(
      async () =>
        expect((await messages(conv.id)).filter((m) => m.direction === "IN" && metaOf(m).turnDone !== true)).toEqual([]),
      { timeout: 10_000, interval: 200 },
    );
  });

  it("ancien tour resté sur « attends je reviens 2 sec » : ses messages sont repris, jamais une question déjà répondue", async () => {
    const member = await prisma.member.create({ data: { telegramUserId: newUserId() } });
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    const conv = await prisma.conversation.create({
      data: {
        botId: mehdi.botId,
        memberId: member.id,
        personaId: mehdi.account.personaId,
        stage: "PROPOSAL",
        assistantTurns: 2,
        memberMessages: 3,
        lastInboundAt: at(6),
        lastAssistantAt: at(5),
      },
    });
    // Conversation d'avant la correction : une question répondue, puis deux messages gardés par l'ancien tour.
    const answered = await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "IN", author: "MEMBER", text: "tu connais Celsius ?", turnId: "ub_ancien-1", createdAt: at(12) },
    });
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "OUT", author: "ASSISTANT", text: "oe c notre partenaire", turnId: "ub_ancien-1", createdAt: at(11) },
    });
    const kept1 = await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "IN", author: "MEMBER", text: "Je connais", turnId: "ub_ancien-2", createdAt: at(6) },
    });
    const kept2 = await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "IN", author: "MEMBER", text: "J'ai pas de compte", turnId: "ub_ancien-2", createdAt: at(6) },
    });
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "OUT", author: "ASSISTANT", text: "attends je reviens 2 sec", turnId: "ub_ancien-2", meta: { fixedKey: "retryLater" }, createdAt: at(5) },
    });
    llm.next.push({ messages: ["ok je t'envoie le lien de Celsius Casino"] });
    await sweepUniverseNow(mehdi.account);
    await vi.waitFor(() => expect(mehdi.sent.length).toBeGreaterThan(0), { timeout: 30_000, interval: 200 });
    await vi.waitFor(
      async () => {
        const rows = await messages(conv.id);
        const k1 = rows.find((m) => m.id === kept1.id)!;
        const k2 = rows.find((m) => m.id === kept2.id)!;
        expect(k1.turnId).toMatch(/^ub_[0-9a-f]{8}_/);
        expect(k2.turnId).toBe(k1.turnId);
        expect(metaOf(k1)).toMatchObject({ turnDone: true, crashes: 1 });
      },
      { timeout: 10_000, interval: 200 },
    );
    const old = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: answered.id } });
    expect(old.turnId).toBe("ub_ancien-1");
    expect(metaOf(old).turnDone).toBe(true);
    // Le modèle ne voit jamais l'ancien message d'attente (il l'imiterait).
    expect(llm.prompts.at(-1)).not.toContain("attends je reviens 2 sec");
    expect(llm.prompts.at(-1)).toContain("J'ai pas de compte");
  });

  it("passage à l'équipe enregistré : plus de réponse ensuite pour un motif grave", async () => {
    const user = newUserId();
    llm.next.push({ messages: ["..."], handoff: { needed: true, reason: "money" } });
    await handleIncomingPrivate(mehdi.account, incoming("tu peux me preter 200 balles ?", user));
    expect(mehdi.sent).toHaveLength(1);
    const conv = await conversationOf(mehdi.botId, user);
    expect(conv.needsHumanAt).not.toBeNull();
    expect(conv.needsHumanReason).toBe("money");
    expect(
      await prisma.conversationEvent.count({ where: { conversationId: conv.id, type: "needs_human" } }),
    ).toBe(1);
    mehdi.sent.length = 0;
    await handleIncomingPrivate(mehdi.account, incoming("alors ?", user));
    expect(mehdi.sent).toEqual([]);
    const last = (await messages(conv.id)).filter((m) => m.direction === "IN").at(-1)!;
    expect(metaOf(last).turnDone).toBe(true);
  });

  it("conversation reprise par l'équipe : aucune réponse, message traité (jamais repris plus tard)", async () => {
    const user = newUserId();
    llm.next.push({ messages: ["oe"] });
    await handleIncomingPrivate(mehdi.account, incoming("salut", user));
    const conv = await conversationOf(mehdi.botId, user);
    await prisma.conversation.update({ where: { id: conv.id }, data: { status: "HUMAN" } });
    mehdi.sent.length = 0;
    await handleIncomingPrivate(mehdi.account, incoming("t la ?", user));
    await sweepUniverseNow(mehdi.account);
    expect(mehdi.sent).toEqual([]);
    const last = (await messages(conv.id)).filter((m) => m.direction === "IN").at(-1)!;
    expect(metaOf(last).turnDone).toBe(true);
  });
});

describe("persona Rencontres (Léa)", () => {
  it("jamais touchée par le balayage du compte Casino / Paris", async () => {
    const lea = await makeAccount("dating");
    const member = await prisma.member.create({ data: { telegramUserId: newUserId() } });
    const conv = await prisma.conversation.create({
      data: { botId: lea.botId, memberId: member.id, personaId: lea.account.personaId },
    });
    const msg = await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "IN", author: "MEMBER", text: "coucou", createdAt: new Date(Date.now() - 60_000) },
    });
    await sweepUniverseNow(lea.account);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const after = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(after.turnId).toBeNull();
    expect(lea.sent).toEqual([]);
  });
});
