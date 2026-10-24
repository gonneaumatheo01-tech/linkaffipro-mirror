/**
 * État des demandes SECRET pour le masquage avant journalisation (`TelegramDeps.agentsAdminState`) : la demande de
 * clé en cours (sa clé et le message de la question) et les messages (questions, rappels) de TOUTES les demandes
 * SECRET, quel que soit leur statut (une clé collée en réponse à une demande expirée, passée ou en file est masquée).
 */
import { askedMessageIdsOf } from "@linkaffipro/agents";
import type { Db as PrismaClient } from "@linkaffipro/db";
import type { AgentsAdminState } from "../ports";

export async function readSecretRequestsState(prisma: Pick<PrismaClient, "humanRequest">): Promise<AgentsAdminState> {
  const rows = await prisma.humanRequest.findMany({
    where: { kind: "SECRET" },
    select: { key: true, status: true, telegramMessageId: true, onAnswer: true, askedAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const pending = rows
    .filter((r) => r.status === "PENDING")
    .sort((a, b) => (a.askedAt?.getTime() ?? 0) - (b.askedAt?.getTime() ?? 0))[0];
  const ids = new Set<number>();
  for (const r of rows) for (const id of askedMessageIdsOf(r)) ids.add(id);
  return {
    isAdmin: true,
    secretPending: !!pending,
    pendingSecret: pending ? { key: pending.key, telegramMessageId: pending.telegramMessageId ?? null } : null,
    secretMessageIds: [...ids],
  };
}
