/**
 * Rapport quotidien du Grand Chef (9 h Paris) : une ligne par équipe (publiés et refusés la veille, en attente, dépense
 * du mois et plafond). Enregistré comme `Event` `agents.report.daily` (`{ day, lines }`, le site affiche les 3
 * derniers) et envoyé à l'admin, sauf si `Setting` `agents.dailyReport` vaut « non ». Une fois par jour.
 */
import { escapeHtml } from "@linkaffipro/core";
import { agentEvent, nowOf } from "../admin/journal";
import { FALLBACK_EVENT } from "../agents/media-ia/fallback";
import { countFallbacks } from "../chiefs/dating-format";
import { loadTeamSettings } from "../missions/settings";
import { monthUsage, totalCents } from "../missions/usage";
import { addDaysToDay, parisDay, parisDayStart, parisParts } from "../rules/time";
import { TEAM_KEYS, TEAM_LABELS, type AgentsDeps } from "../types";

export const REPORT_HOUR = 9;
export const REPORT_LAST_DAY_KEY = "agents.report.lastDay";
export const DAILY_REPORT_SETTING = "agents.dailyReport";

export type TeamReportFigures = {
  label: string;
  published: number;
  waiting: number;
  refused: number;
  failed: number;
  spentCents: number;
  capCents: number | null;
  simulation: boolean;
  paused: boolean;
  /** Replis Dating de la veille (vidéo → photo, photo → texte). */
  fallbacks?: { video: number; photo: number };
};

const eur = (c: number) => `${(c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Une ligne de rapport (pur). */
export function reportLine(f: TeamReportFigures): string {
  const parts = [
    `${f.published} publié${f.published > 1 ? "s" : ""}`,
    `${f.waiting} en attente`,
    `${f.refused} refusé${f.refused > 1 ? "s" : ""}`,
  ];
  if (f.failed) parts.push(`${f.failed} en échec`);
  if (f.fallbacks?.video) parts.push(`${f.fallbacks.video} vidéo${f.fallbacks.video > 1 ? "s" : ""} remplacée${f.fallbacks.video > 1 ? "s" : ""} par une photo`);
  if (f.fallbacks?.photo) parts.push(`${f.fallbacks.photo} photo${f.fallbacks.photo > 1 ? "s" : ""} remplacée${f.fallbacks.photo > 1 ? "s" : ""} par un texte`);
  const spend = f.capCents ? `${eur(f.spentCents)} / ${eur(f.capCents)} ce mois` : `${eur(f.spentCents)} ce mois`;
  const flags = [f.simulation ? "simulation" : null, f.paused ? "en pause" : null].filter(Boolean).join(", ");
  return `${f.label} : ${parts.join(", ")} ; ${spend}${flags ? ` (${flags})` : ""}`;
}

/** Le rapport doit-il partir maintenant (pur) ? À partir de 9 h Paris, une fois par jour. */
export function reportDue(now: Date, lastDay: string | null): boolean {
  return parisParts(now).hour >= REPORT_HOUR && lastDay !== parisDay(now);
}

export async function buildDailyReport(deps: AgentsDeps): Promise<{ day: string; lines: string[] }> {
  const now = nowOf(deps);
  const day = parisDay(now);
  const since = parisDayStart(addDaysToDay(day, -1));
  const until = parisDayStart(day);
  const lines: string[] = [];
  for (const teamKey of TEAM_KEYS) {
    const settings = await loadTeamSettings(deps.prisma, teamKey);
    const [published, refused, failed, waiting, usage] = await Promise.all([
      deps.prisma.agentMission.count({ where: { teamKey, status: "DONE", updatedAt: { gte: since, lt: until } } }),
      deps.prisma.agentMission.count({ where: { teamKey, status: "CANCELLED", updatedAt: { gte: since, lt: until } } }),
      deps.prisma.agentMission.count({ where: { teamKey, status: { in: ["FAILED", "BLOCKED_BUDGET"] }, updatedAt: { gte: since, lt: until } } }),
      deps.prisma.agentMission.count({ where: { teamKey, status: { in: ["WAITING_VALIDATION", "WAITING_HUMAN"] } } }),
      monthUsage(deps.prisma, teamKey, now),
    ]);
    const fallbackEvents =
      teamKey === "dating"
        ? await deps.prisma.event.findMany({ where: { type: FALLBACK_EVENT, occurredAt: { gte: since, lt: until } }, select: { payload: true } })
        : [];
    const fallbacks = countFallbacks(fallbackEvents.map((e) => ({ from: (e.payload as { from?: string } | null)?.from as "video" | "photo" | "text" })));
    const caps = Object.values(settings.monthlyBudgetCents).filter((n): n is number => typeof n === "number");
    lines.push(
      reportLine({
        label: TEAM_LABELS[teamKey],
        published,
        refused,
        failed,
        waiting,
        spentCents: totalCents(usage),
        capCents: caps.length ? caps.reduce((a, b) => a + b, 0) : null,
        simulation: settings.simulation,
        paused: settings.paused,
        fallbacks,
      }),
    );
  }
  return { day, lines };
}

function reportEnabled(v: unknown): boolean {
  if (v === false) return false;
  if (typeof v === "string" && ["false", "non", "no", "off"].includes(v.trim().toLowerCase())) return false;
  if (v && typeof v === "object" && (v as { enabled?: unknown }).enabled === false) return false;
  return true;
}

/** Rapport du jour s'il est dû (ou `force`) : enregistré, puis envoyé à l'admin si le client le veut. */
export async function sendDailyReport(deps: AgentsDeps, opts: { force?: boolean } = {}): Promise<{ sent: boolean; recorded: boolean; day: string | null }> {
  const now = nowOf(deps);
  const last = await deps.prisma.setting.findUnique({ where: { key: REPORT_LAST_DAY_KEY } });
  const lastDay = typeof last?.value === "string" ? last.value : null;
  if (!opts.force && !reportDue(now, lastDay)) return { sent: false, recorded: false, day: null };
  const report = await buildDailyReport(deps);
  // Marqué avant l'envoi : jamais deux rapports le même jour, même si l'envoi échoue.
  await deps.prisma.setting.upsert({
    where: { key: REPORT_LAST_DAY_KEY },
    create: { key: REPORT_LAST_DAY_KEY, value: report.day },
    update: { value: report.day },
  });
  await agentEvent(deps, "agents.report.daily", { day: report.day, lines: report.lines });
  const pref = await deps.prisma.setting.findUnique({ where: { key: DAILY_REPORT_SETTING } });
  if (!deps.admin || !reportEnabled(pref?.value)) return { sent: false, recorded: true, day: report.day };
  try {
    await deps.admin.send([`📋 <b>Rapport des agents</b> (${report.day})`, ...report.lines.map((l) => `• ${escapeHtml(l)}`)].join("\n"));
    return { sent: true, recorded: true, day: report.day };
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[agents] rapport non envoyé");
    return { sent: false, recorded: true, day: report.day };
  }
}
