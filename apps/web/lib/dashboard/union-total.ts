import { EMPTY_TOTALS, addTotals, type StatTotals } from "./metrics";

/**
 * Ligne Total « toutes campagnes » de l'onglet Campagnes, jour par jour (fonction pure, testée) :
 * - les jours où le worker a écrit la ligne sans doublon (« campaigns » ou « campaigns:<univers> »), elle fait foi
 *   (un joueur d'une offre partagée par deux campagnes n'y compte qu'une fois) ;
 * - les autres jours (pas encore recalculés depuis la phase 8 : le recalcul horaire ne reprend que 3 jours), somme des
 *   lignes par campagne de ce jour.
 * Ainsi le Total couvre toujours toute la période, et n'est jamais plus petit qu'une seule ligne.
 */
export function unionTotal(
  unionByDay: ReadonlyMap<string, StatTotals> | undefined,
  rowsByDay: ReadonlyArray<ReadonlyMap<string, StatTotals>>,
): StatTotals {
  const days = new Set<string>(unionByDay?.keys() ?? []);
  for (const m of rowsByDay) for (const d of m.keys()) days.add(d);
  let total = EMPTY_TOTALS;
  for (const d of days) {
    const u = unionByDay?.get(d);
    if (u) {
      total = addTotals(total, u);
      continue;
    }
    for (const m of rowsByDay) {
      const r = m.get(d);
      if (r) total = addTotals(total, r);
    }
  }
  return total;
}

/** Somme d'une série journalière (totaux d'une dimension sur la période). */
export function sumDays(byDay: ReadonlyMap<string, StatTotals> | undefined): StatTotals {
  let total = EMPTY_TOTALS;
  for (const t of byDay?.values() ?? []) total = addTotals(total, t);
  return total;
}
