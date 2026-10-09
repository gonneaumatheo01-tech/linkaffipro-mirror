/** Statistiques par catégorie de messages (fonctions pures, testées) et slug de catégorie. */

export type CategoryTotals = {
  categoryId: string | null;
  name: string;
  color: string;
  posts: number;
  clicks: number;
  uniqueClickers: number;
  offerClicks: number;
  reactions: number;
  registrations: number;
  ftds: number;
  deposits: number;
  depositAmount: number;
};

export type CategoryRow = CategoryTotals & {
  avg: { clicks: number; uniqueClickers: number; offerClicks: number; reactions: number; registrations: number; ftds: number; deposits: number; depositAmount: number };
};

/** Moyenne par message, arrondie à 2 décimales ; 0 si aucun message. */
export function perPost(total: number, posts: number): number {
  if (posts <= 0) return 0;
  return Math.round((total / posts) * 100) / 100;
}

/** Ajoute les moyennes par message à chaque ligne, triée par nombre de messages puis par nom. */
export function withAverages(rows: CategoryTotals[]): CategoryRow[] {
  return rows
    .map((r) => ({
      ...r,
      avg: {
        clicks: perPost(r.clicks, r.posts),
        uniqueClickers: perPost(r.uniqueClickers, r.posts),
        offerClicks: perPost(r.offerClicks, r.posts),
        reactions: perPost(r.reactions, r.posts),
        registrations: perPost(r.registrations, r.posts),
        ftds: perPost(r.ftds, r.posts),
        deposits: perPost(r.deposits, r.posts),
        depositAmount: perPost(r.depositAmount, r.posts),
      },
    }))
    .sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name, "fr"));
}

export type PostStatLike = {
  categoryId: string | null;
  stats: { clicks: number; uniqueClickers: number; offerClicks: number; reactionsTotal: number; registrations: number; ftds: number; deposits: number; depositAmount: unknown } | null;
};

/** Regroupe des messages envoyés par catégorie (les messages sans catégorie vont dans « Sans catégorie »). */
export function groupByCategory(posts: PostStatLike[], categories: Array<{ id: string; name: string; color: string }>): CategoryTotals[] {
  const map = new Map<string | null, CategoryTotals>();
  const base = (id: string | null, name: string, color: string): CategoryTotals => ({ categoryId: id, name, color, posts: 0, clicks: 0, uniqueClickers: 0, offerClicks: 0, reactions: 0, registrations: 0, ftds: 0, deposits: 0, depositAmount: 0 });
  for (const c of categories) map.set(c.id, base(c.id, c.name, c.color));
  for (const p of posts) {
    const key = p.categoryId && map.has(p.categoryId) ? p.categoryId : null;
    let row = map.get(key);
    if (!row) {
      row = base(null, "Sans catégorie", "#94a3b8");
      map.set(null, row);
    }
    row.posts++;
    if (p.stats) {
      row.clicks += p.stats.clicks;
      row.uniqueClickers += p.stats.uniqueClickers;
      row.offerClicks += p.stats.offerClicks;
      row.reactions += p.stats.reactionsTotal;
      row.registrations += p.stats.registrations;
      row.ftds += p.stats.ftds;
      row.deposits += p.stats.deposits;
      row.depositAmount += Number(p.stats.depositAmount);
    }
  }
  return [...map.values()].filter((r) => r.posts > 0 || r.categoryId !== null);
}

/** Slug d'une catégorie : minuscules, sans accents, tirets. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "categorie";
}

/** Rend un slug unique parmi ceux déjà pris (suffixe -2, -3…). */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base}-${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base}-${Date.now()}`;
}

export const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Début de la période (fonction hors rendu pour rester pure côté React). */
export function sinceFor(range: string, now: number = Date.now()): Date {
  return new Date(now - (RANGE_DAYS[range] ?? 30) * 24 * 3600 * 1000);
}
