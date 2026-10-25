/**
 * Phase 29, chantier B — chiffres INTERNES pour croiser la veille (règle 7) : toujours lus par les fonctions de l'agent
 * Ads (`loadAdsContext`, `weeklyFacts`), jamais recalculés ici. Rien de lisible (aucune dépense pub, base indisponible)
 * → null : le Stratège dit qu'il n'a pas de chiffres internes, il n'en invente pas.
 */
import { loadAdsContext } from "../agents/ads/analysis";
import { weeklyFacts } from "../agents/ads/run";
import { ADS_VERTICAL_LABELS, ADS_VERTICALS } from "../agents/ads/thresholds";
import type { Market } from "./contract";
import type { AnalystsBrainDeps, InternalFigure } from "./reasoning";

const MARKET_OF_LABEL = new Map<string, Market>(ADS_VERTICALS.map((v) => [ADS_VERTICAL_LABELS[v], v as Market]));

/** Chiffres des 7 derniers jours par univers (dépense, gains, retour sur dépense pub, variations), ou null. */
export async function loadInternalFigures(deps: AnalystsBrainDeps, now: Date): Promise<InternalFigure[] | null> {
  if (deps.internalFigures) return deps.internalFigures(now);
  try {
    const ctx = await loadAdsContext(deps.prisma, now, { cohorts: false });
    const facts = weeklyFacts(ctx, []);
    const out: InternalFigure[] = [];
    for (const v of facts.verticals) {
      const market = MARKET_OF_LABEL.get(v.label);
      if (!market) continue;
      out.push({ market, label: v.label, spend: v.spend, gains: v.gains, roas: v.roas, gainsChangePct: v.gainsChangePct, spendChangePct: v.spendChangePct });
    }
    return out.length ? out : null;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[analystes] chiffres internes illisibles");
    return null;
  }
}

export const internalFor = (figures: readonly InternalFigure[] | null, market: Market | null | undefined) =>
  (figures ?? []).filter((f) => !market || f.market === market);
