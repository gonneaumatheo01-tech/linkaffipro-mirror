/**
 * Écritures de la fiche Paris sportifs (phase 23, ADMIN, vérifié par les actions) : réglages de l'équipe dans
 * `AgentTeamConfig.settings.sports` (fusion, les autres clés sont gardées) et catégories de paris (`BetCategory`).
 * Chaque écriture a son `AuditLog`. Aucun appel au fournisseur de cotes, aucune mise en file : le Chef Paris relit
 * tout à son prochain passage.
 */
import { audit, prisma, type Prisma } from "@linkaffipro/db";
import {
  categoryChanges,
  mergeSportsSettings,
  parseSportsSettings,
  sameSportsSettings,
  stringList,
  type BetCategoryInput,
  type SportsSettings,
} from "./sports";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Enregistre les réglages s'ils ont changé ; `false` si rien n'a changé. */
export async function writeSportsSettings(next: SportsSettings, userId: string, via?: "WEB" | "TELEGRAM"): Promise<boolean> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "sports" }, select: { settings: true } });
  const before = parseSportsSettings(row?.settings);
  if (sameSportsSettings(before, next)) return false;
  const settings = json(mergeSportsSettings(row?.settings ?? null, next));
  await prisma.agentTeamConfig.upsert({
    where: { teamKey: "sports" },
    create: { teamKey: "sports", settings, updatedById: userId },
    update: { settings, updatedById: userId },
  });
  await audit({
    userId,
    action: "agents.sports_settings_saved",
    entityType: "AgentTeamConfig",
    entityId: "sports",
    metadata: json({ from: before, to: next, ...(via ? { via } : {}) }),
  });
  return true;
}

export async function loadCategoryKeys(): Promise<string[]> {
  const rows = await prisma.betCategory.findMany({ select: { key: true } });
  return rows.map((r) => r.key);
}

/** Crée ou modifie une catégorie ; renvoie son identifiant et les champs changés. */
export async function saveBetCategory(
  input: BetCategoryInput,
  userId: string,
  via?: "WEB" | "TELEGRAM",
): Promise<{ ok: true; id: string; changed: string[] } | { ok: false; error: string }> {
  const data = {
    name: input.name,
    sport: input.sport,
    marketTypes: json(input.marketTypes),
    leagues: json(input.leagues),
    bookmakers: json(input.bookmakers),
    minOdds: input.minOdds,
    maxOdds: input.maxOdds,
    picksPerDay: input.picksPerDay,
    channelIds: json(input.channelIds),
    campaignId: input.campaignId,
    minMinutesBeforeKickoff: input.minMinutesBeforeKickoff,
    maxOddsDriftPct: input.maxOddsDriftPct,
    active: input.active,
    sortOrder: input.sortOrder,
    updatedById: userId,
  };
  if (input.id) {
    const before = await prisma.betCategory.findUnique({ where: { id: input.id } });
    if (!before || before.key !== input.key) return { ok: false, error: "Catégorie introuvable : rechargez la page." };
    const changed = categoryChanges(
      {
        ...before,
        marketTypes: stringList(before.marketTypes),
        leagues: stringList(before.leagues),
        bookmakers: stringList(before.bookmakers),
        channelIds: stringList(before.channelIds),
      },
      input,
    );
    if (!changed.length) return { ok: true, id: before.id, changed };
    await prisma.betCategory.update({ where: { id: before.id }, data });
    await audit({
      userId,
      action: "agents.bet_category_saved",
      entityType: "BetCategory",
      entityId: before.id,
      metadata: json({ key: before.key, name: input.name, changed, active: input.active, ...(via ? { via } : {}) }),
    });
    return { ok: true, id: before.id, changed };
  }
  const created = await prisma.betCategory.create({ data: { key: input.key, ...data } });
  await audit({
    userId,
    action: "agents.bet_category_created",
    entityType: "BetCategory",
    entityId: created.id,
    metadata: json({ key: input.key, name: input.name, active: input.active, ...(via ? { via } : {}) }),
  });
  return { ok: true, id: created.id, changed: ["création"] };
}
