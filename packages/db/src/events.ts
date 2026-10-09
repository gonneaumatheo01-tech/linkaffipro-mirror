import type { Prisma } from "@prisma/client";
import { prisma } from "./client";

export type EventInput = {
  type: string;
  occurredAt?: Date;
  memberId?: string | null;
  channelId?: string | null;
  botId?: string | null;
  payload?: Prisma.InputJsonValue;
};

/** Écrit un événement (append-only). Ne lève jamais : un échec de journalisation ne doit pas casser l'appelant. */
export async function recordEvent(input: EventInput): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        type: input.type,
        occurredAt: input.occurredAt ?? new Date(),
        memberId: input.memberId ?? null,
        channelId: input.channelId ?? null,
        botId: input.botId ?? null,
        payload: input.payload ?? {},
      },
    });
  } catch (err) {
    console.error("[events] échec d'écriture", input.type, err);
  }
}

export type AuditInput = {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
};

/** Journalise une action utilisateur. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
      },
    });
  } catch (err) {
    console.error("[audit] échec d'écriture", input.action, err);
  }
}
