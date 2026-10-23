/**
 * Stock de la médiathèque casino : par canal casino et par thème du canal, vidéos fournies par le client non utilisées
 * sur ce canal depuis la durée de rotation ; « manque » sous le seuil (3). Le stock compte les vidéos : ce sont elles
 * que l'équipe demande (les images servent de repli).
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import type { CasinoStockRow } from "./contracts";
import { casinoChannels, casinoPlans, channelThemes, loadCasinoAssets, loadUsages } from "./data";
import { stockState, unusedCount, type CasinoAsset, type CasinoUsage } from "./pick";
import { loadCasinoSettings, type CasinoSettings } from "./settings";
import type { WeightedTheme } from "./rotation";

/** Lignes de stock (pur). */
export function stockRows(
  channels: ReadonlyArray<{ id: string; title: string; themes: readonly WeightedTheme[] }>,
  assets: readonly CasinoAsset[],
  usages: readonly CasinoUsage[],
  settings: Pick<CasinoSettings, "lowStock" | "rotationDays">,
  now: Date,
): CasinoStockRow[] {
  const out: CasinoStockRow[] = [];
  for (const c of channels)
    for (const t of c.themes) {
      const unused = unusedCount(assets, usages, { channelId: c.id, now, rotationDays: settings.rotationDays, theme: t.theme });
      out.push({ channelId: c.id, channelTitle: c.title, theme: t.theme, unused, state: stockState(unused, settings.lowStock) });
    }
  return out;
}

export async function computeCasinoStock(prisma: PrismaClient, opts: { now?: Date; channelId?: string } = {}): Promise<CasinoStockRow[]> {
  const now = opts.now ?? new Date();
  const [settings, channels, plans, assets] = await Promise.all([
    loadCasinoSettings(prisma),
    casinoChannels(prisma, opts.channelId),
    casinoPlans(prisma),
    loadCasinoAssets(prisma),
  ]);
  const usages = await loadUsages(prisma, assets.map((a) => a.id));
  return stockRows(
    channels.map((c) => ({ id: c.id, title: c.title, themes: channelThemes(plans.get(c.id), settings) })),
    assets,
    usages,
    settings,
    now,
  );
}
