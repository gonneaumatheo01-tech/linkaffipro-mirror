/**
 * Phase 35 : catégories de paris en clés internes (`sports/themes.json`) au lieu des identifiants de SportsGameOdds.
 *   pnpm agents:migrate-bet-categories [--dry-run]
 * En production (la base n'est pas exposée) : railway ssh --service web -- pnpm agents:migrate-bet-categories --dry-run
 * Un thème remplace ses marchés seulement s'ils sont TOUS dans la catégorie (même sens qu'avant) ; le reste est gardé
 * tel quel et listé (« sans correspondance »). Relançable sans risque : une catégorie déjà migrée ne change plus.
 * Chaque modification est notée dans le journal des agents (`AuditLog`).
 */
import { migrateCategoryMarketTypes, SPORTS_THEMES } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";

const dryRun = process.argv.includes("--dry-run");
const rows = await prisma.betCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
let changed = 0;
for (const c of rows) {
  const before = Array.isArray(c.marketTypes) ? (c.marketTypes as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const m = migrateCategoryMarketTypes(before, SPORTS_THEMES);
  const label = `${c.name} (${c.key})`;
  if (!m.changed) {
    console.log(`= ${label} : rien à changer${m.unmatched.length ? ` ; sans correspondance : ${m.unmatched.join(", ")}` : ""}`);
    continue;
  }
  changed++;
  console.log(`${dryRun ? "~" : "✓"} ${label} : ${m.converted.map((x) => x.theme).join(", ") || "(aucun thème)"}${m.unmatched.length ? ` ; sans correspondance (gardés) : ${m.unmatched.join(", ")}` : ""}`);
  if (dryRun) continue;
  await prisma.$transaction([
    prisma.betCategory.update({ where: { id: c.id }, data: { marketTypes: m.marketTypes } }),
    prisma.auditLog.create({
      data: { action: "agents.sports.category_markets_migrated", entityType: "BetCategory", entityId: c.id, metadata: { before, after: m.marketTypes, unmatched: m.unmatched } },
    }),
  ]);
}
console.log(`${rows.length} catégorie(s), ${changed} ${dryRun ? "à migrer (essai à blanc, rien n'est écrit)" : "migrée(s)"}.`);
await prisma.$disconnect();
