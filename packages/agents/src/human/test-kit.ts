/**
 * Outils des tests du chantier B (demandes, validations, dialogue admin) : base en mémoire, messager admin simulé,
 * file simulée, horloge réglable. Jamais importé par le code de production.
 */
import { vi } from "vitest";
import { createFakePrisma, type FakePrisma } from "../testing/fake-prisma";
import type { AdminButton, AgentsDeps } from "../types";

export const ADMIN_TG_ID = 4242n;
/** Clé AES-256 de test (32 octets en base64). */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

export type SentAdminMessage = {
  html: string;
  messageId: number;
  buttons?: AdminButton[][];
  mediaAssetId?: string | null;
  replyToMessageId?: number;
};

export function createTestKit(start = new Date("2026-10-23T08:00:00Z")) {
  process.env.APP_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const prisma: FakePrisma = createFakePrisma({
    setting: [{ key: "admin.telegramUserId", value: ADMIN_TG_ID.toString() }],
  });
  let now = start;
  let nextId = 100;
  const sent: SentAdminMessage[] = [];
  const admin = {
    send: vi.fn(async (html: string, opts: Omit<SentAdminMessage, "html" | "messageId"> = {}) => {
      const messageId = nextId++;
      sent.push({ html, messageId, ...opts });
      return { messageId };
    }),
    deleteMessage: vi.fn(async () => undefined),
  };
  const enqueue = { orchestrator: vi.fn(async () => undefined), step: vi.fn(async () => undefined) };
  const deps: AgentsDeps = { prisma, now: () => now, enqueue, admin };
  return {
    prisma,
    deps,
    admin,
    enqueue,
    sent,
    tables: (name: string) => (prisma._tables[name] ?? []) as Record<string, unknown>[],
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    async mission(data: Record<string, unknown> = {}) {
      return prisma.agentMission.create({ data: { teamKey: "dating", status: "RUNNING", ...data } as never });
    },
  };
}

/** Tout le journal (Event + AuditLog) en texte : sert à vérifier qu'un secret n'y figure jamais. */
export function journalText(kit: ReturnType<typeof createTestKit>): string {
  return JSON.stringify([kit.tables("event"), kit.tables("auditLog")], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
