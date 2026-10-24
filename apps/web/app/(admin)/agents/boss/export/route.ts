import { unmetCsv } from "@/lib/agents/boss";
import { loadBossUnmet } from "@/lib/agents/boss-queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Export CSV des besoins non couverts de Kevin (bouton « Exporter » de /agents/boss), du plus fréquent au moins fréquent. */
export async function GET() {
  await requireUser();
  const csv = unmetCsv(await loadBossUnmet(5000));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kevin-besoins-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
