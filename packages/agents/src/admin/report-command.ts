/**
 * Commande « rapport » (phase 25) : le rapport du jour du Grand Chef (celui de 9 h s'il est parti, sinon calculé à la
 * volée sans être enregistré) et le dernier rapport quotidien de l'Agent Ads. Lecture seule : aucun appel d'IA.
 */
import { esc, nowOf } from "./journal";
import { buildDailyReport } from "../orchestrator/reports";
import { ADS_TEAM_KEY } from "../agents/ads/recommendations";
import { parisDay } from "../rules/time";
import type { AgentsDeps } from "../types";

function linesOf(payload: unknown): string[] | null {
  const lines = (payload as { lines?: unknown } | null)?.lines;
  return Array.isArray(lines) && lines.every((l) => typeof l === "string") ? (lines as string[]) : null;
}

export async function dailyReportText(deps: AgentsDeps): Promise<string> {
  const now = nowOf(deps);
  const day = parisDay(now);
  const [recorded, ads] = await Promise.all([
    deps.prisma.event.findFirst({ where: { type: "agents.report.daily" }, orderBy: { occurredAt: "desc" }, select: { payload: true } }),
    deps.prisma.insightReport.findFirst({
      where: { teamKey: ADS_TEAM_KEY, NOT: { weekStart: { startsWith: "semaine-" } } },
      orderBy: { createdAt: "desc" },
      select: { weekStart: true, content: true },
    }),
  ]);
  const payload = recorded?.payload as { day?: unknown } | undefined;
  const chef = payload?.day === day ? linesOf(payload) : null;
  const lines = chef ?? (await buildDailyReport(deps)).lines;
  const out = [`📋 <b>Rapport des agents</b> (${day}${chef ? "" : ", calculé maintenant"})`, ...lines.map((l) => `• ${esc(l)}`)];
  const adsRow = ads as { weekStart: string; content: string } | null;
  if (adsRow?.content.trim()) {
    out.push("", `📣 <b>Pubs</b>${adsRow.weekStart === day ? "" : ` (rapport du ${esc(adsRow.weekStart)})`}`);
    out.push(...adsRow.content.split("\n").filter((l) => l.trim()).map((l) => `• ${esc(l)}`));
  } else out.push("", "📣 Pubs : aucun rapport encore (il part chaque matin à 9 h).");
  return out.join("\n");
}
