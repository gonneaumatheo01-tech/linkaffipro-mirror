import { vi } from "vitest";
import type * as QueueModule from "@linkaffipro/queue";

declare global {
  /** Tâches BullMQ capturées par le mock de `@linkaffipro/queue` (aucun Redis réel pendant les tests). */
  var __jobs: Array<{ queue: string; data: Record<string, unknown>; opts: Record<string, unknown> }> | undefined;
}

/** Redis minimal en mémoire pour le limiteur de débit (`RateLimiter` : incr / pexpire / pttl). */
function fakeRedis() {
  const store = new Map<string, { n: number; expiresAt: number }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (e && e.expiresAt <= Date.now()) store.delete(k);
    return store.get(k);
  };
  return {
    async incr(k: string) {
      const e = live(k) ?? { n: 0, expiresAt: Number.POSITIVE_INFINITY };
      e.n++;
      store.set(k, e);
      return e.n;
    },
    async pexpire(k: string, ms: number) {
      const e = live(k);
      if (e) e.expiresAt = Date.now() + ms;
      return e ? 1 : 0;
    },
    async pttl(k: string) {
      const e = live(k);
      return e ? Math.max(0, e.expiresAt - Date.now()) : -2;
    },
    async ping() {
      return "PONG";
    },
    async quit() {
      return "OK";
    },
  };
}

// Files BullMQ : aucun worker BullMQ ne tourne pendant les tests (les processeurs sont appelés directement) et le
// Redis local peut être partagé avec un worker de développement. On capture donc les tâches en mémoire ;
// `enqueueDm` écrit toujours l'`OutboundMessage` en base, comme l'implémentation réelle.
vi.mock("@linkaffipro/queue", async (importOriginal) => {
  const orig = await importOriginal<typeof QueueModule>();
  const { prisma } = await import("@linkaffipro/db");
  const jobs = (globalThis.__jobs ??= []);
  const redis = fakeRedis();
  const push = (queue: string, data: Record<string, unknown>, opts: Record<string, unknown> = {}) => {
    jobs.push({ queue, data, opts });
    return { id: typeof opts.jobId === "string" ? opts.jobId : undefined };
  };
  const enqueueDm: typeof orig.enqueueDm = async (input) => {
    const om = await prisma.outboundMessage.create({
      data: {
        botId: input.botId,
        memberId: input.memberId,
        chatId: input.chatId ?? null,
        kind: input.kind,
        text: input.text,
        buttons: (input.buttons ?? []) as never,
        sequenceStepId: input.sequenceStepId ?? null,
        postId: input.postId ?? null,
        mediaAssetId: input.mediaAssetId ?? null,
      },
      select: { id: true },
    });
    push("telegram-send", { type: "dm", outboundMessageId: om.id }, { jobId: `dm:${om.id}`, delay: input.delayMs ?? 0 });
    return { outboundMessageId: om.id };
  };
  return {
    ...orig,
    enqueue: async (name: string, data: Record<string, unknown>, opts: Record<string, unknown> = {}) => push(name, data, opts),
    enqueueDm,
    emitAutomationEvent: async (trigger: string, memberId: string | null | undefined, context: Record<string, unknown> = {}) => {
      if (memberId) push("automations", { type: "event", trigger, memberId, context });
    },
    getRedis: () => redis,
    getQueue: () => {
      throw new Error("getQueue n'est pas disponible dans les tests d'intégration du worker");
    },
    closeQueues: async () => undefined,
  };
});
