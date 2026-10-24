/**
 * Écriture des seuils de l'Agent Ads (`Setting` `agents.ads.thresholds`, phase 24), avec son `AuditLog` (valeurs
 * avant / après). ADMIN seulement (vérifié par l'action). Lu par le moteur à son prochain passage.
 */
import type { AdsThresholds } from "@linkaffipro/agents";
import { audit, prisma, type Prisma } from "@linkaffipro/db";
import { ADS_THRESHOLDS_KEY, parseAdsThresholds } from "./thresholds";

export async function saveAdsThresholds(input: AdsThresholds, userId: string): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: ADS_THRESHOLDS_KEY }, select: { value: true } });
  const before = parseAdsThresholds(row?.value);
  const value = input as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: ADS_THRESHOLDS_KEY },
    create: { key: ADS_THRESHOLDS_KEY, value },
    update: { value },
  });
  await audit({
    userId,
    action: "agents.ads_thresholds_saved",
    entityType: "Setting",
    entityId: ADS_THRESHOLDS_KEY,
    metadata: { before, after: input } as unknown as Prisma.InputJsonValue,
  });
}
