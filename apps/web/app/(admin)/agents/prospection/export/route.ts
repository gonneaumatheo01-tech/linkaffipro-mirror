import { prospectsCsv } from "@/lib/agents/prospection/csv";
import { parseProspectFilters } from "@/lib/agents/prospection/filters";
import { EXPORT_MAX, loadProspectTable, loadScope } from "@/lib/agents/prospection/queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Export CSV des canaux de la Prospection, avec les filtres de la page (`?pays=FR&niveau=A…`, 5 000 lignes au plus).
 * Jamais un canal hors Europe (hors périmètre de pays). Kevin donne l'adresse `/agents/prospection?export=csv`, qui
 * renvoie ici. Réservé aux personnes connectées.
 */
export async function GET(req: Request) {
  await requireUser();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const filters = parseProspectFilters(sp);
  const scope = await loadScope();
  const { rows } = await loadProspectTable(filters, scope, EXPORT_MAX);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(prospectsCsv(rows, scope), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospection-canaux-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
