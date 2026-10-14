/**
 * Phase 13 (moteur, worker) sur la base réelle :
 * - acceptation, refus, expiration par le worker → événements « acceptée », « refusée », « expirée » pour Link Affi ;
 * - envoi signé à un récepteur HTTP local qui joue Link Affi (vérifie la signature HMAC du corps brut, l'identifiant
 *   `X-Event-Id` et les en-têtes `apikey` / `Authorization`) : échec puis réussite, abandon après 24 h (horloge
 *   simulée), aucun doublon, rien sans secret de signature ;
 * - alerte « Événements Link Affi en attente » au-delà d'une heure, une notification par 24 h au plus.
 * Aucun appel à Link Affi ni à Telegram (API Telegram simulée).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as QueueClient from "../../../../packages/queue/src/client";
import type * as TelegramModule from "@linkaffipro/telegram";
import { encrypt, verifyLinkaffiSignature } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { emitLinkaffiEvent } from "@linkaffipro/queue";
import { apiForBot } from "../../src/approvals/telegram-actions";
import { runApprovalsTick, runExpirations } from "../../src/approvals/jobs";
import {
  deliverLinkaffiEvent,
  NOT_CONFIGURED_MESSAGES,
  runLinkaffiEventsTick,
} from "../../src/linkaffi-events/delivery";
import { SCRUBBED_LINKAFFI_MEMBER, UNDELIVERABLE_MESSAGES } from "../../src/linkaffi-events/body";
import { processLinkaffiEvents } from "../../src/processors/linkaffi-events";
import { runAlerts } from "../../src/maintenance/alerts";
import { runPurge } from "../../src/maintenance/purge";
import { capturedJobs, createBotAndChannel, fakeJob, resetDb } from "./helpers";

// Ajout à la file `linkaffi-events` (emitLinkaffiEvent) : capturé en mémoire, jamais le Redis local.
vi.mock("../../../../packages/queue/src/client", async (importOriginal) => {
  const orig = await importOriginal<typeof QueueClient>();
  return {
    ...orig,
    enqueue: async (
      name: string,
      data: Record<string, unknown>,
      opts: Record<string, unknown> = {},
    ) => {
      (globalThis.__jobs ??= []).push({ queue: name, data, opts });
      return { id: opts.jobId };
    },
  };
});

// Notification Telegram de l'admin simulée : jamais d'appel réel.
const notified = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("@linkaffipro/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof TelegramModule>()),
  notifyAdmin: vi.fn(async (text: string) => {
    notified.texts.push(text);
    return true;
  }),
}));

const SECRET = "lap_whsec_integration_secret";
const ANON = "anon-jwt-de-test";
const ids = { bot: "", channel: "", link: "" };

/** Récepteur local qui joue la fonction Link Affi `telegram-events`. */
type Received = {
  eventId: string | undefined;
  raw: string;
  verified: boolean;
  headersOk: boolean;
  idMatches: boolean;
};
const receiver = {
  server: null as Server | null,
  url: "",
  received: [] as Received[],
  /** Réponses à donner, dans l'ordre ; ensuite `fallback`. */
  responses: [] as number[],
  fallback: 200,
};

function startReceiver(): Promise<void> {
  return new Promise((resolve) => {
    receiver.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const verified = verifyLinkaffiSignature(raw, SECRET, req.headers["x-signature"] as string);
        const eventId = req.headers["x-event-id"] as string | undefined;
        let idMatches = false;
        try {
          idMatches = (JSON.parse(raw) as { eventId?: string }).eventId === eventId;
        } catch {
          idMatches = false;
        }
        const headersOk =
          req.method === "POST" &&
          req.url === "/functions/v1/telegram-events" &&
          req.headers["content-type"] === "application/json" &&
          req.headers.apikey === ANON &&
          req.headers.authorization === `Bearer ${ANON}`;
        receiver.received.push({ eventId, raw, verified, headersOk, idMatches });
        // Comme Link Affi : signature refusée → 401 ; sinon la réponse prévue par le test.
        const status = !verified ? 401 : (receiver.responses.shift() ?? receiver.fallback);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(
          status === 401
            ? JSON.stringify({ error: "signature invalide" })
            : JSON.stringify({ ok: status < 300 }),
        );
      });
    });
    receiver.server.listen(0, "127.0.0.1", () => {
      const { port } = receiver.server!.address() as AddressInfo;
      receiver.url = `http://127.0.0.1:${port}/functions/v1/telegram-events`;
      resolve();
    });
  });
}

/** Telegram simulé pour les acceptations / refus du worker (demande retirée au choix). */
const telegramCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
const withdrawn = new Set<number>();
/** Acceptation refusée par Telegram (bot qui a perdu le droit d'accepter). */
const approvalRefused = new Set<number>();

let n = 0;
/** Membre rattaché à la campagne de Paul (canal de test), avec une demande au statut voulu. */
async function affiliateMember(
  membership: {
    status: "SCHEDULED" | "REQUESTED" | "APPROVED";
    approveAt?: Date;
    expiresAt?: Date;
    ruleId?: string;
  } = {
    status: "APPROVED",
  },
  user = 80_000 + ++n,
) {
  const member = await prisma.member.create({
    data: {
      telegramUserId: BigInt(user),
      firstName: `Nora${user}`,
      username: `nora${user}`,
      languageCode: "fr",
      linkaffiCampaignKey: "paulTG01",
      linkaffiAffiliateId: "aff-paul",
      affiliateAttributedAt: new Date(),
      affiliateInviteLinkId: ids.link,
    },
  });
  const ms = await prisma.membership.create({
    data: {
      code: `aff-${user}`,
      memberId: member.id,
      channelId: ids.channel,
      inviteLinkId: ids.link,
      status: membership.status,
      approveAt: membership.approveAt ?? null,
      expiresAt: membership.expiresAt ?? null,
      approvalRuleId: membership.ruleId ?? null,
      requestedAt: new Date(Date.now() - 60_000),
    },
  });
  return { member, ms, user };
}

async function setIntegration(data: { secret?: string | null; url?: string | null }) {
  const values = {
    webhookSecretEncrypted:
      data.secret === undefined ? encrypt(SECRET) : data.secret ? encrypt(data.secret) : null,
    eventsUrl: data.url === undefined ? receiver.url : data.url,
  };
  await prisma.integrationKey.upsert({
    where: { provider: "linkaffi" },
    create: { provider: "linkaffi", ...values },
    update: values,
  });
}

const savedAnon = process.env.LINKAFFI_ANON_KEY;

beforeAll(async () => {
  await resetDb();
  await prisma.linkaffiEvent.deleteMany();
  await prisma.integrationKey.deleteMany({ where: { provider: "linkaffi" } });
  await prisma.alert.deleteMany({ where: { kind: "linkaffi_events_stuck" } });
  const { bot, channel } = await createBotAndChannel({
    chatId: -100_914_001n,
    title: "Canal Roulette 🎰",
  });
  ids.bot = bot.id;
  ids.channel = channel.id;
  ids.link = (
    await prisma.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        telegramInviteLink: "https://t.me/+PaulWorker01",
        name: "Paul — Telegram",
        kind: "LINKAFFI",
        linkaffiCampaignKey: "paulTG01",
        linkaffiCampaignName: "Paul — Telegram",
        linkaffiAffiliateId: "aff-paul",
        linkaffiAffiliateName: "Paul",
      },
    })
  ).id;
  apiForBot(bot).config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    telegramCalls.push({ method, payload: p });
    if (method === "approveChatJoinRequest" && withdrawn.has(Number(p.user_id)))
      return {
        ok: false,
        error_code: 400,
        description: "Bad Request: HIDE_REQUESTER_MISSING",
      } as never;
    if (method === "approveChatJoinRequest" && approvalRefused.has(Number(p.user_id)))
      return {
        ok: false,
        error_code: 400,
        description: "Bad Request: CHAT_ADMIN_REQUIRED",
      } as never;
    if (method === "sendMessage")
      return {
        ok: true,
        result: {
          message_id: 1,
          date: 0,
          chat: { id: Number(p.chat_id), type: "private" },
          text: "",
        },
      } as never;
    return { ok: true, result: true } as never;
  });
  await startReceiver();
  process.env.LINKAFFI_ANON_KEY = ANON;
});

afterAll(async () => {
  if (savedAnon === undefined) delete process.env.LINKAFFI_ANON_KEY;
  else process.env.LINKAFFI_ANON_KEY = savedAnon;
  await new Promise<void>((r) => receiver.server?.close(() => r()));
  await prisma.linkaffiEvent.deleteMany();
  await prisma.integrationKey.deleteMany({ where: { provider: "linkaffi" } });
  await prisma.alert.deleteMany({ where: { kind: "linkaffi_events_stuck" } });
  await resetDb();
});

beforeEach(() => {
  receiver.received.length = 0;
  receiver.responses.length = 0;
  receiver.fallback = 200;
});

describe("acceptations, refus et expirations par le worker", () => {
  it("acceptation planifiée → « acceptée » (une fois), enregistrée et mise en file", async () => {
    const { ms } = await affiliateMember({
      status: "SCHEDULED",
      approveAt: new Date(Date.now() - 1000),
    });
    await runApprovalsTick();
    const approved = await prisma.membership.findUniqueOrThrow({ where: { id: ms.id } });
    expect(approved.status).toBe("APPROVED");
    const eventId = `lap_join_approved_${ms.id}`;
    const row = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    expect(row).toMatchObject({
      type: "join_approved",
      campaignKey: "paulTG01",
      status: "PENDING",
    });
    // Même date que la demande acceptée : l'entrée (`chat_member`, datée à la seconde) sera datée après elle.
    expect(row.occurredAt).toEqual(approved.approvedAt);
    expect((row.body as { occurredAt: string }).occurredAt).toBe(
      approved.approvedAt!.toISOString(),
    );
    expect(capturedJobs("linkaffi-events").filter((j) => j.data.eventId === eventId)).toHaveLength(
      1,
    );
  });

  it("demande retirée par la personne au moment d'accepter → « expirée »", async () => {
    const { ms, user } = await affiliateMember({
      status: "SCHEDULED",
      approveAt: new Date(Date.now() - 1000),
    });
    withdrawn.add(user);
    await runApprovalsTick();
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: ms.id } })).status).toBe(
      "EXPIRED",
    );
    expect(
      await prisma.linkaffiEvent.count({ where: { eventId: `lap_join_expired_${ms.id}` } }),
    ).toBe(1);
  });

  it("expiration : « garder » → « expirée » ; « refuser » → « refusée » ; « accepter » → rien avant l'acceptation", async () => {
    const rule = (expireAction: "KEEP" | "DECLINE" | "APPROVE") =>
      prisma.approvalRule.create({
        data: {
          channelId: ids.channel,
          name: `Expiration ${expireAction}`,
          mode: "MANUAL",
          delaySeconds: 0,
          gateMode: "NONE",
          gateChannelIds: [],
          reminderAfterMinutes: [],
          maxReminders: 0,
          expireAfterHours: 1,
          expireAction,
          isActive: false,
        },
      });
    const past = new Date(Date.now() - 1000);
    const keep = await affiliateMember({
      status: "REQUESTED",
      expiresAt: past,
      ruleId: (await rule("KEEP")).id,
    });
    const decline = await affiliateMember({
      status: "REQUESTED",
      expiresAt: past,
      ruleId: (await rule("DECLINE")).id,
    });
    const approve = await affiliateMember({
      status: "REQUESTED",
      expiresAt: past,
      ruleId: (await rule("APPROVE")).id,
    });
    await runExpirations();
    expect(
      await prisma.linkaffiEvent.count({ where: { eventId: `lap_join_expired_${keep.ms.id}` } }),
    ).toBe(1);
    expect(
      await prisma.linkaffiEvent.count({
        where: { eventId: `lap_join_declined_${decline.ms.id}` },
      }),
    ).toBe(1);
    expect(await prisma.linkaffiEvent.count({ where: { memberId: approve.member.id } })).toBe(0);
    await runApprovalsTick();
    expect(
      await prisma.linkaffiEvent.count({
        where: { eventId: `lap_join_approved_${approve.ms.id}` },
      }),
    ).toBe(1);
  });

  it("acceptation impossible pour de bon (dernier essai refusé par Telegram) → « expirée », une seule fois", async () => {
    const { ms, user } = await affiliateMember({
      status: "SCHEDULED",
      approveAt: new Date(Date.now() - 1000),
    });
    approvalRefused.add(user);
    // Premier refus : nouvel essai prévu, rien pour Link Affi.
    await runApprovalsTick();
    let row = await prisma.membership.findUniqueOrThrow({ where: { id: ms.id } });
    expect(row).toMatchObject({ status: "SCHEDULED", attempts: 1 });
    expect(await prisma.linkaffiEvent.count({ where: { memberId: ms.memberId } })).toBe(0);
    // Troisième refus : abandon (FAILED) → « expirée » pour Link Affi, comme GET /members (FAILED = expirée).
    await runApprovalsTick();
    await runApprovalsTick();
    row = await prisma.membership.findUniqueOrThrow({ where: { id: ms.id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 3 });
    const events = await prisma.linkaffiEvent.findMany({ where: { memberId: ms.memberId } });
    expect(events.map((e) => [e.eventId, e.type])).toEqual([
      [`lap_join_expired_${ms.id}`, "join_expired"],
    ]);
    expect(
      capturedJobs("linkaffi-events").filter((j) => j.data.eventId === `lap_join_expired_${ms.id}`),
    ).toHaveLength(1);
    // Plus jamais repris : aucun second événement.
    await runApprovalsTick();
    expect(await prisma.linkaffiEvent.count({ where: { memberId: ms.memberId } })).toBe(1);
    approvalRefused.delete(user);
  });

  it("membre sans affilié : rien pour Link Affi", async () => {
    const plain = await prisma.member.create({
      data: { telegramUserId: 89_999n, firstName: "Sans" },
    });
    const ms = await prisma.membership.create({
      data: {
        code: "aff-plain",
        memberId: plain.id,
        channelId: ids.channel,
        status: "SCHEDULED",
        approveAt: new Date(Date.now() - 1000),
      },
    });
    await runApprovalsTick();
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: ms.id } })).status).toBe(
      "APPROVED",
    );
    expect(await prisma.linkaffiEvent.count({ where: { memberId: plain.id } })).toBe(0);
  });
});

describe("envoi signé à Link Affi (récepteur local)", () => {
  beforeAll(async () => {
    await prisma.linkaffiEvent.deleteMany();
    await setIntegration({});
  });

  it("échec (500) puis réussite : même identifiant, même corps signé, puis plus rien (aucun doublon)", async () => {
    const { member, ms } = await affiliateMember();
    const emitted = await emitLinkaffiEvent({
      type: "joined",
      sourceId: ms.id,
      memberId: member.id,
      channelId: ids.channel,
    });
    expect(emitted).toEqual({ status: "queued", eventId: `lap_joined_${ms.id}` });
    // Même fait signalé deux fois : une seule ligne, une seule tâche.
    expect(
      await emitLinkaffiEvent({
        type: "joined",
        sourceId: ms.id,
        memberId: member.id,
        channelId: ids.channel,
      }),
    ).toEqual({ status: "already", eventId: `lap_joined_${ms.id}` });
    const eventId = `lap_joined_${ms.id}`;
    expect(capturedJobs("linkaffi-events").filter((j) => j.data.eventId === eventId)).toHaveLength(
      1,
    );

    receiver.responses.push(500);
    const t0 = new Date(Date.now() + 1000);
    // La tâche `deliver` mise en file par l'enregistrement.
    expect(
      await processLinkaffiEvents(fakeJob({ type: "deliver" as const, eventId })),
    ).toMatchObject({
      outcome: "retry",
      status: 500,
    });
    let row = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 1, lastStatus: 500 });
    expect(row.lastError).toContain("Réponse 500 de Link Affi");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Pas encore l'heure du nouvel essai : rien.
    expect((await runLinkaffiEventsTick({ now: t0 })).due).toBe(0);
    expect(receiver.received).toHaveLength(1);

    const t1 = new Date(row.nextAttemptAt.getTime() + 1000);
    expect(await runLinkaffiEventsTick({ now: t1 })).toMatchObject({ due: 1, sent: 1 });
    row = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    expect(row).toMatchObject({
      status: "SENT",
      attempts: 2,
      lastStatus: 200,
      lastError: null,
      sentAt: t1,
    });
    expect(
      (await prisma.integrationKey.findUniqueOrThrow({ where: { provider: "linkaffi" } }))
        .lastEventSentAt,
    ).toEqual(t1);

    // Ce que Link Affi a reçu : deux fois le même événement, signé et identifié, corps du contrat.
    expect(receiver.received).toHaveLength(2);
    for (const r of receiver.received)
      expect(r).toMatchObject({ eventId, verified: true, headersOk: true, idMatches: true });
    expect(receiver.received[1]!.raw).toBe(receiver.received[0]!.raw);
    expect(Object.keys(JSON.parse(receiver.received[0]!.raw))).toEqual([
      "eventId",
      "type",
      "occurredAt",
      "campaignKey",
      "channel",
      "member",
      "data",
    ]);
    expect(JSON.parse(receiver.received[0]!.raw)).toMatchObject({
      eventId,
      type: "joined",
      campaignKey: "paulTG01",
      channel: { id: ids.channel, title: "Canal Roulette 🎰" },
      member: {
        telegramUserId: String(member.telegramUserId),
        username: member.username,
        firstName: member.firstName,
        languageCode: "fr",
      },
      data: {},
    });

    // Envoyé : plus jamais renvoyé (passage suivant, tâche rejouée).
    expect((await runLinkaffiEventsTick({ now: new Date(t1.getTime() + 3_600_000) })).due).toBe(0);
    expect(await deliverLinkaffiEvent(eventId)).toEqual({ outcome: "already" });
    expect(receiver.received).toHaveLength(2);
  });

  it("Link Affi en panne : le passage s'arrête au premier échec, puis tout part dans l'ordre", async () => {
    await prisma.linkaffiEvent.deleteMany();
    const a = await affiliateMember();
    const b = await affiliateMember();
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: a.ms.id,
      memberId: a.member.id,
      channelId: ids.channel,
    });
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: b.ms.id,
      memberId: b.member.id,
      channelId: ids.channel,
    });
    receiver.fallback = 503;
    const t0 = new Date(Date.now() + 1000);
    expect(await runLinkaffiEventsTick({ now: t0 })).toMatchObject({
      due: 2,
      retried: 1,
      stoppedEarly: true,
    });
    expect(receiver.received).toHaveLength(1);
    receiver.fallback = 200;
    const r = await runLinkaffiEventsTick({ now: new Date(t0.getTime() + 60_000) });
    expect(r).toMatchObject({ due: 2, sent: 2 });
    expect(receiver.received.map((x) => x.eventId)).toEqual([
      `lap_joined_${a.ms.id}`,
      `lap_joined_${a.ms.id}`,
      `lap_joined_${b.ms.id}`,
    ]);
  });

  it("rattrapage : les événements partent dans l'ordre des faits, pas dans l'ordre d'enregistrement", async () => {
    await prisma.linkaffiEvent.deleteMany();
    const a = await affiliateMember();
    const b = await affiliateMember();
    const t = Date.now();
    // Enregistré en premier, mais fait plus récent (ex. « entrée » enregistrée avant « acceptée » du même instant).
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: a.ms.id,
      memberId: a.member.id,
      channelId: ids.channel,
      occurredAt: new Date(t),
    });
    await emitLinkaffiEvent({
      type: "join_approved",
      sourceId: b.ms.id,
      memberId: b.member.id,
      channelId: ids.channel,
      occurredAt: new Date(t - 10_000),
    });
    expect(await runLinkaffiEventsTick({ now: new Date(t + 1000) })).toMatchObject({
      due: 2,
      sent: 2,
    });
    expect(receiver.received.map((x) => x.eventId)).toEqual([
      `lap_join_approved_${b.ms.id}`,
      `lap_joined_${a.ms.id}`,
    ]);
  });

  it("signature refusée (mauvais secret enregistré) : statut 401 et raison lisible, nouvel essai prévu", async () => {
    await prisma.linkaffiEvent.deleteMany();
    await setIntegration({ secret: "un-autre-secret" });
    const { member, ms } = await affiliateMember();
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: ms.id,
      memberId: member.id,
      channelId: ids.channel,
    });
    const out = await deliverLinkaffiEvent(`lap_joined_${ms.id}`, {
      now: new Date(Date.now() + 1000),
    });
    expect(out).toEqual({ outcome: "retry", status: 401 });
    const row = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_joined_${ms.id}` },
    });
    expect(row.lastError).toBe('Réponse 401 de Link Affi : {"error":"signature invalide"}');
    expect(row.lastError).not.toContain("un-autre-secret");
    expect(receiver.received[0]!.verified).toBe(false);
    await setIntegration({});
  });

  it("abandon après 24 h (horloge simulée) : FAILED, journal, plus aucun essai", async () => {
    await prisma.linkaffiEvent.deleteMany();
    const { member, ms } = await affiliateMember();
    await emitLinkaffiEvent({
      type: "left",
      sourceId: ms.id,
      memberId: member.id,
      channelId: ids.channel,
    });
    const eventId = `lap_left_${ms.id}`;
    receiver.fallback = 503;
    const t0 = new Date(Date.now() + 1000);
    expect(await deliverLinkaffiEvent(eventId, { now: t0 })).toMatchObject({ outcome: "retry" });
    // Dernier essai possible juste avant les 24 h : le suivant tomberait après, abandonné à cet essai.
    const r1 = await runLinkaffiEventsTick({
      now: new Date(t0.getTime() + 24 * 3_600_000 - 30_000),
    });
    expect(r1).toMatchObject({ abandoned: 0, due: 1, retried: 0, failed: 1 });
    let row = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 2, lastStatus: 503 });
    const failed = await prisma.event.findFirst({
      where: { type: "linkaffi_event.failed", memberId: member.id },
    });
    expect(failed?.payload).toMatchObject({
      eventId,
      type: "left",
      campaignKey: "paulTG01",
      attempts: 2,
    });
    const before = receiver.received.length;
    expect(
      (await runLinkaffiEventsTick({ now: new Date(t0.getTime() + 25 * 3_600_000) })).due,
    ).toBe(0);
    expect(await deliverLinkaffiEvent(eventId)).toEqual({ outcome: "already" });
    expect(receiver.received).toHaveLength(before);

    // Événement resté plus de 24 h sans essai (secret absent, worker arrêté) : abandonné par le passage, sans essai.
    const other = await affiliateMember();
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: other.ms.id,
      memberId: other.member.id,
      channelId: ids.channel,
    });
    const r2 = await runLinkaffiEventsTick({ now: new Date(Date.now() + 25 * 3_600_000) });
    expect(r2.abandoned).toBe(1);
    row = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_joined_${other.ms.id}` },
    });
    expect(row).toMatchObject({ status: "FAILED", attempts: 0 });
    expect(receiver.received).toHaveLength(before);
  });

  it("sans secret de signature : rien n'est envoyé, l'événement attend avec la raison", async () => {
    await prisma.linkaffiEvent.deleteMany();
    await setIntegration({ secret: null });
    const { member, ms } = await affiliateMember();
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: ms.id,
      memberId: member.id,
      channelId: ids.channel,
    });
    const eventId = `lap_joined_${ms.id}`;
    expect(await runLinkaffiEventsTick({ now: new Date(Date.now() + 1000) })).toMatchObject({
      notConfigured: true,
      due: 0,
    });
    expect(await deliverLinkaffiEvent(eventId)).toEqual({ outcome: "not_configured" });
    const row = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    expect(row).toMatchObject({
      status: "PENDING",
      attempts: 0,
      lastError: NOT_CONFIGURED_MESSAGES.no_secret,
    });
    expect(receiver.received).toHaveLength(0);
    // Secret créé : l'événement part au passage suivant.
    await setIntegration({});
    expect(await runLinkaffiEventsTick({ now: new Date(Date.now() + 2000) })).toMatchObject({
      sent: 1,
    });
    expect(receiver.received[0]).toMatchObject({ eventId, verified: true });
  });
});

describe("alerte « Événements Link Affi en attente »", () => {
  it("plus d'une heure d'attente : une alerte, une notification ; condition revenue dans les 24 h : rouverte en silence", async () => {
    await prisma.linkaffiEvent.deleteMany();
    await setIntegration({ secret: null });
    const { member, ms } = await affiliateMember();
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: ms.id,
      memberId: member.id,
      channelId: ids.channel,
    });
    await runLinkaffiEventsTick();
    await prisma.linkaffiEvent.updateMany({
      data: { createdAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    notified.texts.length = 0;
    const now = new Date();
    await runAlerts(now);
    const alerts = await prisma.alert.findMany({ where: { kind: "linkaffi_events_stuck" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toContain("1 événement de membre d'affilié attend");
    expect(alerts[0]!.message).toContain(NOT_CONFIGURED_MESSAGES.no_secret.slice(0, 40));
    const notes = () => notified.texts.filter((t) => t.includes("Événements Link Affi en attente"));
    expect(notes()).toHaveLength(1);

    // Événement parti : alerte résolue. Puis de nouveau bloqué dans les 24 h : rouverte sans nouvelle notification.
    await prisma.linkaffiEvent.updateMany({ data: { status: "SENT" } });
    await runAlerts(new Date(now.getTime() + 5 * 60_000));
    expect(
      (await prisma.alert.findFirstOrThrow({ where: { kind: "linkaffi_events_stuck" } }))
        .resolvedAt,
    ).not.toBeNull();
    await prisma.linkaffiEvent.updateMany({ data: { status: "PENDING" } });
    await runAlerts(new Date(now.getTime() + 10 * 60_000));
    const after = await prisma.alert.findMany({ where: { kind: "linkaffi_events_stuck" } });
    expect(after).toHaveLength(1);
    expect(after[0]!.resolvedAt).toBeNull();
    expect(notes()).toHaveLength(1);
    await setIntegration({});
  });
});

/** Suppression d'un membre comme la fiche membre → Supprimer (identité effacée, `anonymizedAt`). */
async function anonymize(memberId: string, at = new Date()) {
  await prisma.member.update({
    where: { id: memberId },
    data: {
      firstName: null,
      lastName: null,
      username: null,
      languageCode: null,
      isPremium: false,
      telegramUserId: -BigInt(Math.floor(Math.random() * 1e12) + 1),
      anonymizedAt: at,
    },
  });
}

describe("membre supprimé ou affilié retiré avant l'envoi", () => {
  beforeAll(async () => {
    await prisma.linkaffiEvent.deleteMany();
    await setIntegration({});
  });

  it("Link Affi en panne, puis membre supprimé : rien ne part, événement abandonné et effacé", async () => {
    const { member, ms } = await affiliateMember();
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: ms.id,
      memberId: member.id,
      channelId: ids.channel,
    });
    const eventId = `lap_joined_${ms.id}`;
    receiver.fallback = 503;
    const t0 = new Date(Date.now() + 1000);
    expect(await deliverLinkaffiEvent(eventId, { now: t0 })).toMatchObject({ outcome: "retry" });
    expect(receiver.received).toHaveLength(1);
    receiver.fallback = 200;
    await anonymize(member.id);
    const pending = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    // Nouvel essai (tâche ou passage) : le membre est relu, rien n'est envoyé.
    const t1 = new Date(pending.nextAttemptAt.getTime() + 1000);
    expect(await deliverLinkaffiEvent(eventId, { now: t1 })).toEqual({ outcome: "cancelled" });
    expect(await runLinkaffiEventsTick({ now: t1 })).toMatchObject({ due: 0, sent: 0 });
    expect(receiver.received).toHaveLength(1);
    const row = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    expect(row).toMatchObject({
      status: "FAILED",
      lastError: UNDELIVERABLE_MESSAGES.member_deleted,
    });
    expect((row.body as { member: unknown }).member).toEqual(SCRUBBED_LINKAFFI_MEMBER);
    expect(JSON.stringify(row.body)).not.toContain(`Nora`);
    expect(JSON.stringify(row.body)).not.toContain(String(member.telegramUserId));
    // Le reste du corps est gardé (suivi) : type, campagne, canal.
    expect(row.body).toMatchObject({
      type: "joined",
      campaignKey: "paulTG01",
      channel: { id: ids.channel },
    });
  });

  it("membre supprimé alors que rien ne peut partir (secret absent) : le passage efface l'événement quand même", async () => {
    await setIntegration({ secret: null });
    const { member, ms } = await affiliateMember();
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: ms.id,
      memberId: member.id,
      channelId: ids.channel,
    });
    const eventId = `lap_joined_${ms.id}`;
    await anonymize(member.id);
    expect(await runLinkaffiEventsTick({ now: new Date(Date.now() + 1000) })).toMatchObject({
      notConfigured: true,
      cancelled: 1,
    });
    const row = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId } });
    expect(row.status).toBe("FAILED");
    expect((row.body as { member: unknown }).member).toEqual(SCRUBBED_LINKAFFI_MEMBER);
    // Secret créé ensuite : toujours rien.
    await setIntegration({});
    expect(await runLinkaffiEventsTick({ now: new Date(Date.now() + 2000) })).toMatchObject({
      due: 0,
      sent: 0,
    });
    expect(receiver.received).toHaveLength(0);
  });

  it("affilié retiré ou changé par un administrateur : plus rien n'est envoyé à l'ancien affilié", async () => {
    const removed = await affiliateMember();
    const changed = await affiliateMember();
    const kept = await affiliateMember();
    for (const x of [removed, changed, kept])
      await emitLinkaffiEvent({
        type: "joined",
        sourceId: x.ms.id,
        memberId: x.member.id,
        channelId: ids.channel,
      });
    await prisma.member.update({
      where: { id: removed.member.id },
      data: {
        linkaffiCampaignKey: null,
        linkaffiAffiliateId: null,
        affiliateAttributedAt: null,
        affiliateAttributionEndsAt: null,
        affiliateInviteLinkId: null,
      },
    });
    await prisma.member.update({
      where: { id: changed.member.id },
      data: { linkaffiCampaignKey: "marcTG01", linkaffiAffiliateId: "aff-marc" },
    });
    const r = await runLinkaffiEventsTick({ now: new Date(Date.now() + 1000) });
    expect(r).toMatchObject({ cancelled: 2, sent: 1 });
    expect(receiver.received.map((x) => x.eventId)).toEqual([`lap_joined_${kept.ms.id}`]);
    for (const x of [removed, changed]) {
      const row = await prisma.linkaffiEvent.findUniqueOrThrow({
        where: { eventId: `lap_joined_${x.ms.id}` },
      });
      expect(row).toMatchObject({
        status: "FAILED",
        lastError: UNDELIVERABLE_MESSAGES.affiliate_changed,
      });
      // Membre toujours là : le corps reste tel qu'enregistré.
      expect((row.body as { member: { firstName: string } }).member.firstName).toBe(
        x.member.firstName,
      );
    }
  });
});

describe("purge de conservation et événements Link Affi", () => {
  it("efface l'identité des membres supprimés, abandonne leurs envois, supprime les événements trop anciens", async () => {
    await prisma.linkaffiEvent.deleteMany();
    await prisma.setting.deleteMany({ where: { key: "retention.months" } });
    await setIntegration({});
    const now = new Date();
    // 1. Membre supprimé à sa demande (fiche membre) après l'envoi : corps gardé chez nous jusqu'à la purge.
    const deleted = await affiliateMember();
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: deleted.ms.id,
      memberId: deleted.member.id,
      channelId: ids.channel,
    });
    expect(await runLinkaffiEventsTick({ now: new Date(now.getTime() + 1000) })).toMatchObject({
      sent: 1,
    });
    await anonymize(deleted.member.id);
    const sentBefore = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_joined_${deleted.ms.id}` },
    });
    // 2. Membre inactif depuis plus de 24 mois, avec un événement encore en attente : anonymisé par la purge.
    const old = new Date(now.getTime() - 25 * 30 * 86_400_000);
    const inactive = await affiliateMember();
    await emitLinkaffiEvent({
      type: "left",
      sourceId: inactive.ms.id,
      memberId: inactive.member.id,
      channelId: ids.channel,
    });
    await prisma.membership.update({
      where: { id: inactive.ms.id },
      data: { requestedAt: old },
    });
    await prisma.member.update({ where: { id: inactive.member.id }, data: { lastSeenAt: old } });
    // 3. Membre actif : un événement de plus de 24 mois (supprimé), un récent (gardé tel quel).
    const active = await affiliateMember();
    await emitLinkaffiEvent({
      type: "join_requested",
      sourceId: active.ms.id,
      memberId: active.member.id,
      channelId: ids.channel,
      occurredAt: old,
    });
    await emitLinkaffiEvent({
      type: "joined",
      sourceId: active.ms.id,
      memberId: active.member.id,
      channelId: ids.channel,
    });

    const result = await runPurge(now);
    expect(result).toMatchObject({ linkaffiEventsDeleted: 1 });
    expect(result.linkaffiEventsScrubbed).toBe(2);
    expect(
      (await prisma.member.findUniqueOrThrow({ where: { id: inactive.member.id } })).anonymizedAt,
    ).not.toBeNull();

    const sentAfter = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_joined_${deleted.ms.id}` },
    });
    // Déjà envoyé : reste « envoyé », sans identité ; date de mise à jour inchangée (compteurs du site).
    expect(sentAfter.status).toBe("SENT");
    expect((sentAfter.body as { member: unknown }).member).toEqual(SCRUBBED_LINKAFFI_MEMBER);
    expect(sentAfter.updatedAt).toEqual(sentBefore.updatedAt);
    const pendingAfter = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_left_${inactive.ms.id}` },
    });
    expect(pendingAfter).toMatchObject({
      status: "FAILED",
      lastError: UNDELIVERABLE_MESSAGES.member_deleted,
    });
    expect((pendingAfter.body as { member: unknown }).member).toEqual(SCRUBBED_LINKAFFI_MEMBER);
    expect(
      await prisma.linkaffiEvent.count({
        where: { eventId: `lap_join_requested_${active.ms.id}` },
      }),
    ).toBe(0);
    const recent = await prisma.linkaffiEvent.findUniqueOrThrow({
      where: { eventId: `lap_joined_${active.ms.id}` },
    });
    expect(recent.status).toBe("PENDING");
    expect((recent.body as { member: { firstName: string } }).member.firstName).toBe(
      active.member.firstName,
    );

    // Relancée : rien de plus.
    expect(await runPurge(now)).toMatchObject({
      linkaffiEventsScrubbed: 0,
      linkaffiEventsDeleted: 0,
    });
    expect(receiver.received.map((x) => x.eventId)).toEqual([`lap_joined_${deleted.ms.id}`]);
  });
});
