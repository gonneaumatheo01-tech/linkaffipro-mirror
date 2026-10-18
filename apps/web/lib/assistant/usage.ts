/**
 * Dépense de l'IA de conversation (table `AiConversationUsage`) : coût du mois en cours à Paris (le plafond mensuel
 * compare cette somme, contrat docs/ASSISTANT-CONVERSATION.md § 2), nombre d'appels et de conversations du mois.
 */
import { parisMonthStart } from "@linkaffipro/chat";
import { prisma } from "@linkaffipro/db";

/** Somme des coûts estimés depuis le début du mois à Paris (euros, 4 décimales). */
export async function monthCostEur(now = new Date()): Promise<number> {
  const agg = await prisma.aiConversationUsage.aggregate({
    where: { createdAt: { gte: parisMonthStart(now) } },
    _sum: { costEur: true },
  });
  return Math.round(Number(agg._sum.costEur ?? 0) * 10_000) / 10_000;
}

export type AssistantMonthUsage = {
  costEur: number;
  /** Appels à l'IA du mois (réussis ou non, essais compris). */
  calls: number;
  /** Appels en échec du mois. */
  failed: number;
  /** Conversations qui ont coûté au moins un appel ce mois-ci. */
  conversations: number;
};

/** Usage du mois à Paris : coût, appels, échecs, conversations distinctes. */
export async function monthUsage(now = new Date()): Promise<AssistantMonthUsage> {
  const where = { createdAt: { gte: parisMonthStart(now) } };
  const [agg, failed, conversations] = await Promise.all([
    prisma.aiConversationUsage.aggregate({
      where,
      _sum: { costEur: true },
      _count: { _all: true },
    }),
    prisma.aiConversationUsage.count({ where: { ...where, ok: false } }),
    prisma.aiConversationUsage.groupBy({
      by: ["conversationId"],
      where: { ...where, conversationId: { not: null } },
    }),
  ]);
  return {
    costEur: Math.round(Number(agg._sum.costEur ?? 0) * 10_000) / 10_000,
    calls: agg._count._all,
    failed,
    conversations: conversations.length,
  };
}
