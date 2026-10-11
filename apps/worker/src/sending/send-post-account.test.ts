import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as QueueModule from "@linkaffipro/queue";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = {
    postUpdates: [] as Row[],
    settings: {} as Record<string, unknown>,
    events: [] as Row[],
    jobs: [] as Array<{ queue: string; data: Row; opts: Row }>,
  };
  const prisma = {
    post: {
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.postUpdates.push(data);
        return data;
      }),
    },
    mediaAsset: { findMany: vi.fn(async () => []) },
    postStats: { upsert: vi.fn(async () => undefined) },
    telegramUserSession: { update: vi.fn(async () => undefined) },
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        where.key in state.settings ? { value: state.settings[where.key] } : null,
      ),
      upsert: vi.fn(
        async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
          state.settings[where.key] = create.value;
        },
      ),
    },
  };
  return { state, prisma };
});

vi.mock("@linkaffipro/db", () => ({
  prisma: db.prisma,
  recordEvent: vi.fn(async (e: Row) => db.state.events.push(e)),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@linkaffipro/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof QueueModule>()),
  getRedis: () => ({}),
  enqueue: vi.fn(async (queue: string, data: Row, opts: Row = {}) => {
    db.state.jobs.push({ queue, data, opts });
    return { id: String(opts.jobId ?? "") };
  }),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  MtprotoAuthError,
  MtprotoFloodWait,
  MtprotoRpcError,
  type AccountChannel,
} from "@linkaffipro/mtproto";
import { MtprotoLockBusy } from "@linkaffipro/queue";
import {
  ALREADY_PUBLISHED_NOT_FOUND_MESSAGE,
  EMOJIS_DROPPED_MESSAGE,
  MAX_ACCOUNT_DEFERRALS,
  MAX_NETWORK_DEFERRALS,
  OTHER_CHANNEL_MESSAGE,
  sendPostAccount,
  waitLabel,
  type AccountPost,
  type AccountPostDeps,
  type DeferralCause,
} from "./send-post-account";

const NOW = new Date("2026-10-11T18:00:00Z");
const EMOJI = "5368324170671202286";

function post(over: Partial<AccountPost> = {}): AccountPost {
  return {
    id: "p1",
    code: "C1",
    channelId: "ch1",
    botId: "b1",
    status: "SENDING",
    scheduledAt: new Date("2026-10-11T17:59:00Z"),
    sentAt: null,
    telegramMessageIds: [],
    text: `Bonus <tg-emoji emoji-id="${EMOJI}">🎁</tg-emoji>`,
    mediaAssetIds: [],
    buttons: [],
    pinAfterSend: false,
    unpinPrevious: false,
    deleteAfterMinutes: null,
    disableNotification: false,
    protectContent: false,
    disableLinkPreview: true,
    attempts: 0,
    publisher: "ACCOUNT",
    channel: { id: "ch1", telegramChatId: -1001234567890n, title: "Canal" },
    ...over,
  } as AccountPost;
}

/** Reports déjà faits pour la programmation en cours, par cause (lus dans le journal en production). */
const deferred: Partial<Record<DeferralCause, number>> = {};
/** Canal où sont publiés les messages déjà enregistrés d'un message interrompu (journal en production). */
let partialChannel: string | null = null;
const channelCalls = { pins: [] as number[], found: [] as unknown[] };

/** Dépendances simulées : session active, verrou libre, canal qui répond selon `send`. */
function deps(
  send: AccountChannel["send"],
  over: Partial<AccountPostDeps> = {},
  findPublished: AccountChannel["findPublished"] = async () => null,
): AccountPostDeps {
  return {
    loadSession: async () => ({
      active: {
        id: "main",
        session: "s",
        creds: { apiId: 1, apiHash: "0123456789abcdef0123456789abcdef" },
      },
      reason: null,
    }),
    lock: (fn) => fn(),
    openChannel: (async (
      _input: unknown,
      _creds: unknown,
      fn: (ch: AccountChannel) => Promise<unknown>,
    ) =>
      fn({
        send,
        findPublished: async (step, opts) => {
          channelCalls.found.push(opts);
          return findPublished(step, opts);
        },
        pin: async (id) => {
          channelCalls.pins.push(id);
        },
        unpinAll: async () => undefined,
        deleteMessages: async () => undefined,
      })) as AccountPostDeps["openChannel"],
    paceChannel: async () => undefined,
    now: () => NOW,
    countDeferrals: async (_post, _seed, cause) => deferred[cause] ?? 0,
    partialChannelOf: async () => partialChannel,
    ...over,
  };
}

const lastUpdate = () => db.state.postUpdates[db.state.postUpdates.length - 1]!;

beforeEach(() => {
  for (const k of Object.keys(deferred)) delete deferred[k as DeferralCause];
  partialChannel = null;
  channelCalls.pins.length = 0;
  channelCalls.found.length = 0;
  db.state.postUpdates.length = 0;
  db.state.events.length = 0;
  db.state.jobs.length = 0;
  db.state.settings = {};
});

describe("sendPostAccount : règles d'envoi et de reprise", () => {
  it("emoji retiré par Telegram : publié, mais signalé et compte noté « sans Premium »", async () => {
    const out = await sendPostAccount(
      post(),
      deps(async () => ({ ids: [10], customEmojiSent: 1, customEmojiKept: 0 })),
    );
    expect(out).toEqual({ status: "sent", messageIds: [10] });
    expect(lastUpdate()).toMatchObject({ status: "SENT", lastError: EMOJIS_DROPPED_MESSAGE });
    expect(db.state.settings["mtproto.publishStatus"]).toMatchObject({ premium: false });
    expect(db.state.events.find((e) => e.type === "post.sent")?.payload).toMatchObject({
      publisher: "ACCOUNT",
      customEmoji: { sent: 1, kept: 0 },
    });
  });

  it("FLOOD_WAIT : report avec l'heure du nouvel essai (heure de Paris), sans changer le statut", async () => {
    const out = await sendPostAccount(
      post(),
      deps(async () => {
        throw new MtprotoFloodWait(120);
      }),
    );
    expect(out).toEqual({ status: "deferred", delayMs: 125_000 });
    expect(lastUpdate()).toEqual({
      lastError: "Telegram demande d'attendre 2 min : nouvel essai à 20:02.",
      attempts: { increment: 1 },
    });
    expect(db.state.jobs[0]).toMatchObject({
      queue: "telegram-send",
      data: { type: "post", postId: "p1" },
      opts: { delay: 125_000, attempts: 1 },
    });
  });

  it("attente de plus d'une heure, ou trop de reports : échec clair, aucun nouvel essai", async () => {
    const long = await sendPostAccount(
      post(),
      deps(async () => {
        throw new MtprotoFloodWait(7200);
      }),
    );
    expect(long.status).toBe("failed");
    expect(lastUpdate()).toMatchObject({ status: "FAILED" });
    expect(String(lastUpdate().lastError)).toMatch(/attente de 120 min : message non publié/);

    db.state.jobs.length = 0;
    deferred.busy = MAX_ACCOUNT_DEFERRALS;
    const tired = await sendPostAccount(
      post(),
      deps(
        async () => {
          throw new MtprotoLockBusy();
        },
        { lock: async () => Promise.reject(new MtprotoLockBusy()) },
      ),
    );
    expect(tired.status).toBe("failed");
    expect(String(lastUpdate().lastError)).toMatch(/après plusieurs essais : message non publié/);
    expect(db.state.jobs).toHaveLength(0);
  });

  it("panne réseau : quelques reports, puis échec", async () => {
    const boom = deps(async () => {
      throw new Error("Connection closed");
    });
    expect((await sendPostAccount(post({ attempts: 0 }), boom)).status).toBe("deferred");
    deferred.network = MAX_NETWORK_DEFERRALS;
    expect((await sendPostAccount(post({ attempts: 3 }), boom)).status).toBe("failed");
    expect(String(lastUpdate().lastError)).toBe(
      "Telegram ne répond pas au compte connecté : message non publié, reprogrammez-le.",
    );
  });

  it("publication interrompue après une étape : messages déjà publiés gardés dans l'échec", async () => {
    db.prisma.mediaAsset.findMany.mockResolvedValueOnce([
      {
        id: "m1",
        mimeType: "image/jpeg",
        bytes: Buffer.from([1]),
        filename: "a.jpg",
        width: null,
        height: null,
        duration: null,
      },
    ] as never);
    let n = 0;
    const out = await sendPostAccount(
      post({ text: "x".repeat(1100), mediaAssetIds: ["m1"] }),
      deps(async (step) => {
        n++;
        if (step.kind === "media") return { ids: [21], customEmojiSent: 0, customEmojiKept: 0 };
        throw new MtprotoRpcError("CHAT_WRITE_FORBIDDEN");
      }),
    );
    expect(out.status).toBe("failed");
    expect(n).toBe(2);
    // L'étape publiée est enregistrée aussitôt, puis gardée dans l'échec.
    expect(db.state.postUpdates[0]).toEqual({ telegramMessageIds: [21] });
    expect(lastUpdate()).toMatchObject({ status: "FAILED", telegramMessageIds: [21] });
    expect(String(lastUpdate().lastError)).toMatch(
      /^Publication interrompue après 1 message\(s\) : Le compte Telegram connecté n'a pas le droit de publier/,
    );
    expect(db.state.settings["mtproto.publishStatus"]).toMatchObject({
      channels: { ch1: { canPost: false } },
    });
  });

  it("session révoquée : échec, compte à reconnecter", async () => {
    const out = await sendPostAccount(
      post(),
      deps(async () => {
        throw new MtprotoAuthError("SESSION_REVOKED");
      }),
    );
    expect(out.status).toBe("failed");
    expect(db.prisma.telegramUserSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERROR" }) }),
    );
    expect(db.state.settings["mtproto.publishStatus"]).toMatchObject({ connected: false });
  });

  it("reprise : les étapes déjà publiées ne repartent pas", async () => {
    const sent: number[] = [];
    await sendPostAccount(
      post({ text: "y".repeat(1100), telegramMessageIds: [30] }),
      deps(async (step) => {
        sent.push(step.kind === "text" ? 1 : 0);
        return { ids: [31], customEmojiSent: 0, customEmojiKept: 0 };
      }, {}),
    );
    // Sans média, une seule étape (texte) : déjà publiée (1 identifiant) → rien n'est renvoyé.
    expect(sent).toEqual([]);
    expect(lastUpdate()).toMatchObject({ status: "SENT", telegramMessageIds: [30] });
  });
});

describe("sendPostAccount : étape déjà publiée (identifiant d'envoi déjà utilisé)", () => {
  it("coupure réseau puis RANDOM_ID_DUPLICATE : étape retrouvée → SENT, épinglée, suppression programmée", async () => {
    // 1er essai : la publication part, mais la connexion coupe avant la réponse.
    const first = await sendPostAccount(
      post({ pinAfterSend: true, deleteAfterMinutes: 30 }),
      deps(async () => {
        throw new Error("Connection closed");
      }),
    );
    expect(first.status).toBe("deferred");
    // 2e essai (même graine) : Telegram refuse le doublon ; le message est retrouvé dans le canal.
    db.state.jobs.length = 0;
    const second = await sendPostAccount(
      post({ attempts: 1, pinAfterSend: true, deleteAfterMinutes: 30 }),
      deps(
        async () => {
          throw new MtprotoRpcError("RANDOM_ID_DUPLICATE");
        },
        {},
        async () => ({ ids: [55], customEmojiSent: 1, customEmojiKept: 1 }),
      ),
    );
    expect(second).toEqual({ status: "sent", messageIds: [55] });
    expect(lastUpdate()).toMatchObject({
      status: "SENT",
      telegramMessageIds: [55],
      lastError: null,
    });
    expect(channelCalls.pins).toEqual([55]);
    // Recherche limitée aux messages publiés depuis l'heure prévue (moins une marge).
    expect(channelCalls.found[0]).toMatchObject({ exclude: [] });
    const notBefore = (channelCalls.found[0] as { notBefore: Date }).notBefore;
    expect(notBefore.getTime()).toBeLessThanOrEqual(new Date("2026-10-11T17:59:00Z").getTime());
    expect(db.state.jobs).toContainEqual(
      expect.objectContaining({
        queue: "telegram-send",
        data: { type: "delete-post", postId: "p1" },
        opts: expect.objectContaining({ delay: 30 * 60_000 }),
      }),
    );
    expect(db.state.events.find((e) => e.type === "post.sent")?.payload).toMatchObject({
      publisher: "ACCOUNT",
      messageIds: [55],
      alreadyPublishedSteps: 1,
    });
    expect(db.state.events.some((e) => e.type === "post.failed")).toBe(false);
  });

  it("RANDOM_ID_DUPLICATE et introuvable dans le canal : SENT avec une note, jamais en échec", async () => {
    const out = await sendPostAccount(
      post({ attempts: 1 }),
      deps(async () => {
        throw new MtprotoRpcError("RANDOM_ID_DUPLICATE");
      }),
    );
    expect(out).toEqual({ status: "sent", messageIds: [] });
    expect(lastUpdate()).toMatchObject({
      status: "SENT",
      lastError: ALREADY_PUBLISHED_NOT_FOUND_MESSAGE,
    });
    expect(ALREADY_PUBLISHED_NOT_FOUND_MESSAGE).not.toMatch(/random|RANDOM_ID/i);
    expect(db.state.events.some((e) => e.type === "post.failed")).toBe(false);
  });

  it("album retrouvé puis texte publié : les deux étapes enregistrées dans l'ordre", async () => {
    db.prisma.mediaAsset.findMany.mockResolvedValueOnce(
      ["m1", "m2"].map((id) => ({
        id,
        mimeType: "image/jpeg",
        bytes: Buffer.from([1]),
        filename: `${id}.jpg`,
        width: null,
        height: null,
        duration: null,
      })) as never,
    );
    const out = await sendPostAccount(
      post({ text: "z".repeat(1100), mediaAssetIds: ["m1", "m2"] }),
      deps(
        async (step) => {
          if (step.kind === "album") throw new MtprotoRpcError("RANDOM_ID_DUPLICATE");
          return { ids: [72], customEmojiSent: 0, customEmojiKept: 0 };
        },
        {},
        async () => ({ ids: [70, 71], customEmojiSent: 0, customEmojiKept: 0 }),
      ),
    );
    expect(out).toEqual({ status: "sent", messageIds: [70, 71, 72] });
  });
});

describe("sendPostAccount : reports comptés par programmation et par cause", () => {
  const busy = (over: Partial<AccountPostDeps> = {}) =>
    deps(
      async () => {
        throw new MtprotoLockBusy();
      },
      { lock: async () => Promise.reject(new MtprotoLockBusy()), ...over },
    );

  it("compteur cumulé élevé (message reprogrammé après un échec) : le report reste possible", async () => {
    const out = await sendPostAccount(post({ attempts: 12 }), busy());
    expect(out.status).toBe("deferred");
    expect(db.state.events.find((e) => e.type === "post.deferred")?.payload).toMatchObject({
      postId: "p1",
      publisher: "ACCOUNT",
      cause: "busy",
      seed: `post:p1:${new Date("2026-10-11T17:59:00Z").getTime()}`,
      delayMs: 60_000,
    });
  });

  it("des reports « session occupée » ne consomment pas ceux d'une coupure réseau", async () => {
    deferred.busy = 5;
    const out = await sendPostAccount(
      post({ attempts: 5 }),
      deps(async () => {
        throw new Error("Connection closed");
      }),
    );
    expect(out.status).toBe("deferred");
    expect(db.state.events.find((e) => e.type === "post.deferred")?.payload).toMatchObject({
      cause: "network",
    });
  });

  it("la graine de la programmation sert à compter (nouvelle heure = nouveau compte)", async () => {
    const seeds: string[] = [];
    await sendPostAccount(
      post({ scheduledAt: new Date("2026-10-12T08:00:00Z") }),
      busy({
        countDeferrals: async (_p, seed) => {
          seeds.push(seed);
          return 0;
        },
      }),
    );
    expect(seeds).toEqual([`post:p1:${new Date("2026-10-12T08:00:00Z").getTime()}`]);
  });

  it("attentes imposées : plafonnées à part", async () => {
    deferred.flood = MAX_ACCOUNT_DEFERRALS;
    const out = await sendPostAccount(
      post(),
      deps(async () => {
        throw new MtprotoFloodWait(30);
      }),
    );
    expect(out.status).toBe("failed");
    expect(String(lastUpdate().lastError)).toMatch(/après plusieurs essais/);
  });
});

describe("sendPostAccount : messages déjà publiés dans un autre canal", () => {
  it("canal changé après une publication interrompue : refus, rien n'est publié ni sauté", async () => {
    partialChannel = "ch_autre";
    const sent: unknown[] = [];
    const out = await sendPostAccount(
      post({ text: "w".repeat(1100), telegramMessageIds: [30] }),
      deps(async (step) => {
        sent.push(step);
        return { ids: [31], customEmojiSent: 0, customEmojiKept: 0 };
      }),
    );
    expect(out).toEqual({ status: "failed", error: OTHER_CHANNEL_MESSAGE });
    expect(sent).toHaveLength(0);
    expect(lastUpdate()).toMatchObject({ status: "FAILED", telegramMessageIds: [30] });
    // L'échec garde la trace du canal où ces messages sont vraiment publiés.
    expect(db.state.events.find((e) => e.type === "post.failed")?.payload).toMatchObject({
      messageIds: [30],
      messageChannelId: "ch_autre",
    });
  });

  it("même canal : la reprise saute les étapes faites (comportement inchangé)", async () => {
    partialChannel = "ch1";
    const out = await sendPostAccount(
      post({ text: "v".repeat(1100), telegramMessageIds: [30] }),
      deps(async () => ({ ids: [31], customEmojiSent: 0, customEmojiKept: 0 })),
    );
    expect(out.status).toBe("sent");
  });
});

describe("waitLabel", () => {
  it("secondes puis minutes", () => {
    expect(waitLabel(42)).toBe("42 s");
    expect(waitLabel(89)).toBe("89 s");
    expect(waitLabel(120)).toBe("2 min");
    expect(waitLabel(3600)).toBe("60 min");
  });
});
