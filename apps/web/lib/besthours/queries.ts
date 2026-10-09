import { prisma } from "@linkaffipro/db";
import { bestSlotFor, parseChannelBestHours, type BestSlot, type ChannelBestHours } from "./types";

export type { BestSlot, ChannelBestHours } from "./types";

/** Carte des meilleurs horaires d'un canal (calculée par le worker), ou null si jamais calculée. */
export async function loadBestHours(channelId: string): Promise<ChannelBestHours | null> {
  const s = await prisma.setting.findUnique({ where: { key: `besthours.${channelId}` } });
  return s ? parseChannelBestHours(s.value) : null;
}

/** Date du dernier calcul (toutes chaînes), ou null. */
export async function loadBestHoursUpdatedAt(): Promise<Date | null> {
  const s = await prisma.setting.findUnique({ where: { key: "besthours.updatedAt" } });
  if (!s || typeof s.value !== "string") return null;
  const d = new Date(s.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Créneaux recommandés pour le formulaire de message : par canal, puis par catégorie (`all` + chaque catégorie
 * qui a sa propre recommandation). Le formulaire choisit la clé de la catégorie sélectionnée, sinon `all`.
 */
export async function loadBestSlots(
  channelIds: string[],
): Promise<Record<string, Record<string, BestSlot>>> {
  if (channelIds.length === 0) return {};
  const rows = await prisma.setting.findMany({
    where: { key: { in: channelIds.map((id) => `besthours.${id}`) } },
  });
  const out: Record<string, Record<string, BestSlot>> = {};
  for (const row of rows) {
    const data = parseChannelBestHours(row.value);
    if (!data) continue;
    const slots: Record<string, BestSlot> = {};
    for (const key of Object.keys(data.categories)) {
      const slot = bestSlotFor(data, key === "all" ? null : key, { fallbackToAll: false });
      if (slot) slots[key] = slot;
    }
    if (Object.keys(slots).length > 0) out[data.channelId] = slots;
  }
  return out;
}
