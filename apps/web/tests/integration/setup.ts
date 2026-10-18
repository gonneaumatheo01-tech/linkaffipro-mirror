import { vi } from "vitest";
import type * as QueueModule from "@linkaffipro/queue";

declare global {
  var __afterPromises: Promise<unknown>[] | undefined;
  /** Tâches BullMQ capturées par le mock de `@linkaffipro/queue` (aucun Redis réel pendant les tests). */
  var __jobs: Array<{ queue: string; data: Record<string, unknown>; opts: Record<string, unknown> }> | undefined;
}

// Hors d'une requête Next, `after()` lève : on exécute le rappel tout de suite et on garde sa promesse
// pour que les tests puissent attendre les écritures (`flushAfter()` dans helpers.ts).
vi.mock("next/server", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    after: (fn: () => unknown | Promise<unknown>) => {
      const p = Promise.resolve().then(fn);
      (globalThis.__afterPromises ??= []).push(p.catch(() => undefined));
    },
  };
});

// Files BullMQ : aucun worker ne tourne pendant les tests et le Redis local peut être partagé avec un worker
// de développement. On capture donc les tâches en mémoire ; `enqueueDm` écrit toujours l'`OutboundMessage`
// en base (c'est ce que les tests vérifient), comme l'implémentation réelle.
vi.mock("@linkaffipro/queue", async (importOriginal) => {
  const orig = await importOriginal<typeof QueueModule>();
  const { prisma } = await import("@linkaffipro/db");
  const jobs = (globalThis.__jobs ??= []);
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
    // Tour de l'assistant de conversation (phase 17) : même tâche que l'implémentation réelle (anti-rebond).
    enqueueChatTurn: async (conversationId: string, opts: { delayMs?: number } = {}) => {
      push(
        "chat",
        { type: "turn", conversationId },
        {
          delay: opts.delayMs ?? orig.CHAT_TURN_DEBOUNCE_MS,
          deduplication: { id: `turn-${conversationId}`, extend: true, replace: true, keepLastIfActive: true },
        },
      );
    },
    emitAutomationEvent: async (trigger: string, memberId: string | null | undefined, context: Record<string, unknown> = {}) => {
      if (memberId) push("automations", { type: "event", trigger, memberId, context });
    },
    getRedis: () => {
      throw new Error("Redis n'est pas disponible dans les tests d'intégration web");
    },
    getQueue: () => {
      throw new Error("getQueue n'est pas disponible dans les tests d'intégration web");
    },
    closeQueues: async () => undefined,
  };
});
