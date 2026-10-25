/**
 * Écritures de la page Agents → Kevin (ADMIN seulement) : plafond mensuel de l'IA du Boss (`Setting` `boss.budget`,
 * journal `boss.budget_saved`) et prénom affiché (`Setting` `boss.name`, journal `boss.name_saved`).
 */
import { audit, prisma } from "@linkaffipro/db";
import { BOSS_BUDGET_KEY, BOSS_NAME_KEY, parseBossBudget, parseBossName } from "./boss";

export async function saveBossBudget(monthlyCents: number, userId: string, via?: "WEB" | "TELEGRAM"): Promise<void> {
  const before = parseBossBudget((await prisma.setting.findUnique({ where: { key: BOSS_BUDGET_KEY } }))?.value);
  const value = { monthlyCents };
  await prisma.setting.upsert({ where: { key: BOSS_BUDGET_KEY }, create: { key: BOSS_BUDGET_KEY, value }, update: { value } });
  await audit({ userId, action: "boss.budget_saved", entityType: "Setting", entityId: BOSS_BUDGET_KEY, metadata: { before, after: monthlyCents, ...(via ? { via } : {}) } });
}

export async function saveBossName(name: string, userId: string, via?: "WEB" | "TELEGRAM"): Promise<void> {
  const before = parseBossName((await prisma.setting.findUnique({ where: { key: BOSS_NAME_KEY } }))?.value);
  await prisma.setting.upsert({ where: { key: BOSS_NAME_KEY }, create: { key: BOSS_NAME_KEY, value: name }, update: { value: name } });
  await audit({ userId, action: "boss.name_saved", entityType: "Setting", entityId: BOSS_NAME_KEY, metadata: { before, after: name, ...(via ? { via } : {}) } });
}
