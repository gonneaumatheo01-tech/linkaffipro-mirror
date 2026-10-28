/**
 * Phase 31, chantier D — fiche des agents de l'équipe Prospection pour Kevin (« qu'a fait le Sourceur ? », « que va
 * faire le Pipeline ? ») : ce qu'ils ont fait (7 derniers jours) et ce qu'ils vont faire, en LECTURE SEULE, chiffres
 * lus en base. Appelé par `orders/agents-dict.ts` (`agentCard`).
 */
import { nowOf } from "../admin/journal";
import { parisMinutes, parisWeekday } from "../rules/time";
import type { AgentsDeps } from "../types";
import { PROSPECTION_SETTINGS } from "./contract";
import { PROSPECTION_DISCOVERY_WINDOW } from "./jobs";
import { prospectionEnabled } from "./kevin-read";
import { plural } from "./kevin-texts";
import { numberSetting } from "./score/settings";

export const PROSPECTION_AGENT_KEYS = ["chef-prospection", "sourceur", "enrichisseur", "evaluateur", "pipeline-prospection", "veilleur", "valorisateur"] as const;

async function count(deps: AgentsDeps, type: string, since: Date): Promise<number> {
  return deps.prisma.prospectEvent.count({ where: { type, createdAt: { gte: since } } as never });
}

export async function prospectionAgentCard(deps: AgentsDeps, key: string): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const now = nowOf(deps);
  const week = new Date(now.getTime() - 7 * 86400_000);
  const enabled = await prospectionEnabled(deps);
  const lines: string[] = [];
  if (!enabled) lines.push("La prospection est en pause pour le moment : rien ne tourne.");
  const runs = (await deps.prisma.prospectSourceRun.findMany({ where: { started: { gte: week } } as never, orderBy: { started: "desc" }, take: 200 })) as Array<{ sourceType: string; found: number; newCount: number; started: Date }>;
  const found = runs.reduce((s, r) => s + r.newCount, 0);
  const [enriched, scored, presented] = await Promise.all([count(deps, "ENRICHED", week), count(deps, "SCORED", week), count(deps, "PRESENTED", week)]);
  const qualified = await deps.prisma.prospect.count({ where: { status: "QUALIFIED" } as never });
  const dossiers = await deps.prisma.prospect.count({ where: { dossierAt: { gte: week } } as never });
  const topHour = await numberSetting(deps, PROSPECTION_SETTINGS.dailyTopHour.key, PROSPECTION_SETTINGS.dailyTopHour.value);
  const nightNext = parisMinutes(now) < PROSPECTION_DISCOVERY_WINDOW.startHour * 60 ? "cette nuit" : "la nuit prochaine";
  const topNext = parisMinutes(now) < topHour * 60 ? `aujourd'hui à ${topHour} h` : `demain à ${topHour} h`;
  const facts = { actif: enabled, jours: 7, heureDecouverte: PROSPECTION_DISCOVERY_WINDOW.startHour, finDecouverte: PROSPECTION_DISCOVERY_WINDOW.endHour, heureListe: topHour, recherches7Jours: runs.length, nouveaux7Jours: found, lus7Jours: enriched, notes7Jours: scored, presentes7Jours: presented, aContacter: qualified, dossiers7Jours: dossiers };
  switch (key) {
    case "sourceur":
      lines.push(`Ces 7 jours : ${plural(runs.length, "recherche", "recherches")}, ${plural(found, "nouveau canal trouvé", "nouveaux canaux trouvés")}.`);
      lines.push(`Prochaine recherche : ${nightNext}, entre ${PROSPECTION_DISCOVERY_WINDOW.startHour} h et ${PROSPECTION_DISCOVERY_WINDOW.endHour} h.`);
      break;
    case "enrichisseur":
      lines.push(`Ces 7 jours : ${plural(enriched, "canal lu", "canaux lus")}.`);
      lines.push("Il lit en continu les canaux trouvés, les tiens d'abord.");
      break;
    case "evaluateur":
      lines.push(`Ces 7 jours : ${plural(scored, "canal noté", "canaux notés")}, ${plural(dossiers, "dossier écrit", "dossiers écrits")}. ${plural(qualified, "canal à contacter", "canaux à contacter")} en ce moment.`);
      break;
    case "pipeline-prospection":
      lines.push(`Ces 7 jours : ${plural(presented, "canal présenté", "canaux présentés")} dans tes listes.`);
      lines.push(`Prochaine liste : ${topNext}${parisWeekday(now) === 7 || (parisWeekday(now) === 1 && parisMinutes(now) < topHour * 60) ? ", avec le point de la semaine juste avant" : ""}.`);
      break;
    case "veilleur":
    case "valorisateur": {
      // Phase 32 : fiche des agents de la prospection avancée (`kevin-advanced-view.ts`).
      const { advancedAgentCard } = await import("./kevin-advanced-view");
      const card = await advancedAgentCard(deps, key, now);
      Object.assign(facts, card.facts);
      lines.push(...card.lines);
      break;
    }
    default:
      lines.push(`Ces 7 jours : ${plural(found, "nouveau canal trouvé", "nouveaux canaux trouvés")}, ${plural(enriched, "lu", "lus")}, ${plural(presented, "présenté", "présentés")}. ${plural(qualified, "canal à contacter", "canaux à contacter")}.`);
      lines.push(`Prochaine liste : ${topNext}.`);
  }
  return { facts, lines };
}
