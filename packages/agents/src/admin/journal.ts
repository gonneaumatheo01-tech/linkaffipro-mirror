/**
 * Journal du dialogue admin et des demandes (chantier B) : `Event` (famille « Agents », jamais de texte de post ni de
 * secret) et `AuditLog` (chaque action humaine). Passe par `deps.prisma` (tests en mémoire) ; ne lève jamais.
 */
import type { AgentsDeps } from "../types";

export function nowOf(deps: Pick<AgentsDeps, "now">): Date {
  return deps.now ? deps.now() : new Date();
}

export async function agentEvent(
  deps: AgentsDeps,
  type: string,
  payload: Record<string, unknown>,
  refs: { channelId?: string | null } = {},
): Promise<void> {
  try {
    await deps.prisma.event.create({
      data: {
        type,
        occurredAt: nowOf(deps),
        channelId: refs.channelId ?? null,
        payload: JSON.parse(JSON.stringify(payload)),
      },
    });
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, type }, "[agents] événement non écrit");
  }
}

export async function agentAudit(
  deps: AgentsDeps,
  input: {
    userId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await deps.prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
      },
    });
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, action: input.action }, "[agents] audit non écrit");
  }
}

/** Identifiant Telegram de l'admin (`Setting` `admin.telegramUserId`), ou null. */
export async function adminTelegramId(deps: Pick<AgentsDeps, "prisma">): Promise<bigint | null> {
  const s = await deps.prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  if (!s || typeof s.value !== "string" || !/^\d+$/.test(s.value)) return null;
  return BigInt(s.value);
}

/** Compte du site lié à l'identifiant Telegram de l'admin (auteur des actions faites par Telegram), ou null. */
export async function telegramActorUserId(deps: Pick<AgentsDeps, "prisma">): Promise<string | null> {
  const id = await adminTelegramId(deps);
  if (!id) return null;
  const user = await deps.prisma.user.findFirst({ where: { telegramUserId: id, isActive: true } });
  return user?.id ?? null;
}

/** Lit un `Setting` JSON. */
export async function readSetting(deps: Pick<AgentsDeps, "prisma">, key: string): Promise<unknown> {
  const s = await deps.prisma.setting.findUnique({ where: { key } });
  return s ? s.value : undefined;
}

export async function writeSetting(deps: Pick<AgentsDeps, "prisma">, key: string, value: unknown): Promise<void> {
  const json = JSON.parse(JSON.stringify(value));
  await deps.prisma.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

/** Échappe un texte pour le HTML Telegram. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
