import { parseAdsPeriod } from "@/lib/agents/ads/display";
import { figuresCsv, recommendationsCsv } from "@/lib/agents/ads/csv";
import { loadAdsAnalysis, loadAdsRecommendations } from "@/lib/agents/ads/queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Exports CSV de la page Agent Ads : `?type=recommandations` (toutes, 5 000 au plus) ou `?type=chiffres&periode=…`
 * (une ligne par campagne, groupe et pub, période courante et période d'avant).
 */
export async function GET(req: Request) {
  await requireUser();
  const sp = new URL(req.url).searchParams;
  const day = new Date().toISOString().slice(0, 10);
  let csv: string;
  let name: string;
  if (sp.get("type") === "chiffres") {
    const period = parseAdsPeriod(sp.get("periode"));
    const r = await loadAdsAnalysis(period);
    if (!r.ok) return new Response(`Chiffres indisponibles pour l'instant : ${r.error}`, { status: 503 });
    csv = figuresCsv(r.analysis);
    name = `agent-ads-chiffres-${period}-${day}.csv`;
  } else {
    csv = recommendationsCsv(await loadAdsRecommendations(5000));
    name = `agent-ads-recommandations-${day}.csv`;
  }
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
