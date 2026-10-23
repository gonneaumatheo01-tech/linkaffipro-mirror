/**
 * « Produire un pari de test » (phase 23) : mission BET sur le canal Test, en simulation, avec le faux fournisseur de
 * cotes (fixtures recalées sur l'heure) ; un seul pari. Catégorie imposée, sinon la première active, sinon la
 * première tout court. Capture : agent Capture (page locale ou site), sinon image de repli soumise à validation.
 */
import type { CreateMissionResult } from "../missions/lifecycle";
import type { AgentsDeps } from "../types";
import { toCategory } from "./data";
import { createBetMission } from "./missions";

export async function createTestBet(deps: AgentsDeps, input: { categoryId?: string | null; byUserId: string | null }): Promise<CreateMissionResult> {
  const row = input.categoryId
    ? await deps.prisma.betCategory.findUnique({ where: { id: input.categoryId } })
    : ((await deps.prisma.betCategory.findFirst({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })) ??
      (await deps.prisma.betCategory.findFirst({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })));
  if (!row) return { ok: false, reason: "Aucune catégorie de paris : créez-en une dans Agents → Paris sportifs." };
  return createBetMission(deps, { category: toCategory(row as unknown as Record<string, unknown>), createdBy: "HUMAN", createdById: input.byUserId, isTest: true, oddsSource: "fake", reason: "pari de test" });
}
