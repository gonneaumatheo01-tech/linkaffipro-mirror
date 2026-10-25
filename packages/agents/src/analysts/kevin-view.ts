/**
 * Phase 29, chantier C — fiche des agents de l'équipe Analystes pour Kevin (« qu'a fait la veille ? », « que va faire
 * le Rapporteur ? ») : ce qu'ils ont fait (7 derniers jours) et ce qu'ils vont faire, en LECTURE SEULE, chiffres lus
 * en base. Appelé par `orders/agents-dict.ts` (`agentCard`).
 */
import { nowOf } from "../admin/journal";
import { parisWeekday } from "../rules/time";
import type { AgentsDeps } from "../types";
import { ANALYSTS_TEAM_KEY, MARKET_ANALYSIS_SOURCE } from "./contract";
import { analystsEnabled, analystsScheduleSettings } from "./kevin-state";
import { shortDate } from "./kevin-texts";

const WEEKDAYS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export const ANALYSTS_AGENT_KEYS = ["chef-analystes", "veille", "compliance", "stratege", "rapporteur"] as const;

export function isAnalystsAgentKey(key: string): boolean {
  return (ANALYSTS_AGENT_KEYS as readonly string[]).includes(key);
}

/** Prochain rapport de la semaine (jour et heure réglés, heure de Paris), en mots. */
async function nextWeeklyText(deps: AgentsDeps): Promise<string> {
  const s = await analystsScheduleSettings(deps);
  const today = parisWeekday(nowOf(deps));
  const when = today === s.weeklyDay ? "aujourd'hui" : `${WEEKDAYS[s.weeklyDay]}`;
  return `${when} à ${s.weeklyHour} h`;
}

export async function analystsAgentCard(deps: AgentsDeps, key: string): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const now = nowOf(deps);
  const week = new Date(now.getTime() - 7 * 86400_000);
  const enabled = await analystsEnabled(deps);
  const lines: string[] = [];
  const facts: Record<string, unknown> = { actif: enabled };
  if (!enabled) lines.push("La veille du marché est coupée pour le moment : rien ne tourne.");
  const sources = (await deps.prisma.trendSource.findMany({ take: 500 })) as Array<{ isActive: boolean; lastScrapedAt: Date | null; nextScrapeAt: Date | null }>;
  const active = sources.filter((s) => s.isActive);
  const entries = await deps.prisma.trendEntry.count({ where: { createdAt: { gte: week } } });
  const rules = (await deps.prisma.complianceRule.findMany({ where: { isActive: true }, take: 2000 })) as Array<{ riskLevel: string; createdAt: Date; updatedAt: Date; lastVerifiedAt: Date }>;
  const newRules = rules.filter((r) => r.createdAt >= week).length;
  const risky = rules.filter((r) => r.riskLevel === "HIGH" || r.riskLevel === "BAN").length;
  const recos = await deps.prisma.recommendation.count({ where: { teamKey: ANALYSTS_TEAM_KEY, source: MARKET_ANALYSIS_SOURCE, status: "PROPOSED" } });
  const last = (await deps.prisma.strategyReport.findFirst({ where: { reportType: "WEEKLY" }, orderBy: { createdAt: "desc" } })) as { createdAt: Date; sentAt: Date | null; title: string } | null;
  const briefings = await deps.prisma.strategyReport.count({ where: { reportType: "ON_DEMAND", createdAt: { gte: week } } });
  const next = active.map((s) => s.nextScrapeAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const weekly = await nextWeeklyText(deps);
  Object.assign(facts, { sourcesSuivies: active.length, entrees7Jours: entries, reglesActives: rules.length, reglesARisque: risky, nouvellesRegles7Jours: newRules, propositionsOuvertes: recos, briefings7Jours: briefings });
  switch (key) {
    case "veille":
      lines.push(`Ces 7 jours : ${plural(entries, "contenu gardé", "contenus gardés")} sur ${plural(active.length, "source suivie", "sources suivies")}.`);
      lines.push(next ? `Prochaine lecture : ${next <= now ? "dans l'heure" : `le ${shortDate(next)}`}.` : "Aucune lecture prévue pour le moment.");
      break;
    case "compliance":
      lines.push(`${plural(rules.length, "règle suivie", "règles suivies")}, dont ${risky} à risque élevé ou de bannissement. ${plural(newRules, "nouvelle", "nouvelles")} ces 7 jours.`);
      lines.push("Elle revérifie chaque jour les règles vues il y a plus de 30 jours et te prévient tout de suite d'un risque de bannissement.");
      break;
    case "stratege":
      lines.push(`${plural(recos, "proposition ouverte", "propositions ouvertes")} en ce moment.`);
      lines.push(`Prochaine synthèse : ${weekly}, juste avant le rapport.`);
      break;
    case "rapporteur":
      lines.push(last ? `Dernier rapport : ${last.title}, ${last.sentAt ? `envoyé le ${shortDate(last.sentAt)}` : "pas encore envoyé"}.` : "Pas encore de rapport du marché.");
      lines.push(`Prochain rapport : ${weekly}. ${plural(briefings, "briefing", "briefings")} ces 7 jours.`);
      break;
    default:
      lines.push(`Ces 7 jours : ${plural(entries, "contenu gardé", "contenus gardés")}, ${plural(newRules, "nouvelle règle", "nouvelles règles")}, ${plural(recos, "proposition ouverte", "propositions ouvertes")}.`);
      lines.push(`Prochain rapport du marché : ${weekly}.`);
  }
  return { facts, lines };
}
