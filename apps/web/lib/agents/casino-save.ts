/**
 * Écritures de la fiche d'équipe Casino (phase 22, ADMIN, vérifié par les actions) : liste des thèmes, seuil de
 * manque, rotation, rangés dans `AgentTeamConfig.settings.casino` sans toucher aux autres clés. Chaque écriture a son
 * `AuditLog`. Aucun appel d'IA, aucune mise en file : le moteur relit ces réglages à son prochain passage.
 */
import { audit, prisma, type Prisma } from "@linkaffipro/db";
import { mergeCasinoSettings, parseCasinoSettings, type CasinoSettings } from "./casino";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function readCasinoSettingsRaw(): Promise<{ raw: unknown; settings: CasinoSettings }> {
  const row = await prisma.agentTeamConfig.findUnique({
    where: { teamKey: "casino" },
    select: { settings: true },
  });
  return { raw: row?.settings ?? null, settings: parseCasinoSettings(row?.settings) };
}

/** Enregistre les réglages Casino (fusion) et journalise `action` avec `metadata`. */
export async function writeCasinoSettings(
  next: CasinoSettings,
  userId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { raw } = await readCasinoSettingsRaw();
  const settings = json(mergeCasinoSettings(raw, next));
  await prisma.agentTeamConfig.upsert({
    where: { teamKey: "casino" },
    create: { teamKey: "casino", settings, updatedById: userId },
    update: { settings, updatedById: userId },
  });
  await audit({
    userId,
    action,
    entityType: "AgentTeamConfig",
    entityId: "casino",
    metadata: json(metadata),
  });
}
