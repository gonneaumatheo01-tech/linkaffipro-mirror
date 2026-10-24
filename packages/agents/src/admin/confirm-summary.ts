/**
 * « vrai <équipe> » et « niveau <équipe> <n> » (phase 25) : avant de demander OUI, le bot résume ce qui va se passer
 * (canaux concernés, quota, niveau, plafonds). Questions de 5 lignes au plus.
 */
import { AUTONOMY_LABELS } from "./team";
import { toTeamSettings } from "../missions/settings";
import { PROVIDER_LABELS } from "../orchestrator/budgets";
import { parseSportsSettings } from "../sports/settings";
import { TEAM_LABELS, type AgentsDeps, type ProviderKey, type TeamKey } from "../types";

export type TeamPlanSummary = {
  channels: string[];
  postsPerDay: number;
  simulation: boolean;
  level: 0 | 1 | 2;
  caps: string;
  sportsHours: number[];
};

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;

export async function teamPlanSummary(deps: Pick<AgentsDeps, "prisma">, team: TeamKey): Promise<TeamPlanSummary> {
  // Lecture seule (aucune équipe créée) : sans ligne enregistrée, valeurs par défaut des agents.
  const [row, plans] = await Promise.all([
    deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: team } }),
    deps.prisma.channelAgentPlan.findMany({ where: { teamKey: team, enabled: true }, select: { channelId: true, postsPerDay: true } }),
  ]);
  const settings = toTeamSettings(
    row ?? { teamKey: team, simulation: true, paused: false, autonomyLevel: 0, monthlyBudgetCents: {}, styleGuidelines: "", forbiddenWords: [], maxTextLength: 0, quietHours: [], settings: {} },
    null,
  );
  const ids = (plans as { channelId: string }[]).map((p) => p.channelId);
  const channels = ids.length
    ? ((await deps.prisma.channel.findMany({ where: { id: { in: ids }, isTest: false }, select: { id: true, title: true } })) as { id: string; title: string }[])
    : [];
  const real = new Set(channels.map((c) => c.id));
  const caps = Object.entries(settings.monthlyBudgetCents)
    .filter(([, c]) => typeof c === "number")
    .map(([p, c]) => `${PROVIDER_LABELS[p as ProviderKey] ?? p} ${eur(c as number)}`)
    .join(", ");
  return {
    channels: channels.map((c) => c.title),
    postsPerDay: (plans as { channelId: string; postsPerDay: number }[]).filter((p) => real.has(p.channelId)).reduce((s, p) => s + p.postsPerDay, 0),
    simulation: settings.simulation,
    level: settings.autonomyLevel,
    caps,
    sportsHours: parseSportsSettings(settings.settings).runHours,
  };
}

function channelsPhrase(list: string[]): string {
  if (!list.length) return "aucun canal n'a encore de plan actif (rien ne partira tant qu'un plan n'est pas activé)";
  const shown = list.slice(0, 4).join(", ");
  return `${list.length} canal${list.length > 1 ? "aux" : ""} : ${shown}${list.length > 4 ? `… (+${list.length - 4})` : ""}`;
}

/** Ce que fera l'équipe (une ligne) : canaux et quota, ou rôle de l'équipe Algorithme. */
function workLine(team: TeamKey, s: TeamPlanSummary): string {
  if (team === "algo") return "Elle ne publie rien : elle applique ses réglages (horaires, mélange, tests A/B) aux trois autres équipes.";
  if (team === "sports") return `Paris aux passages de ${s.sportsHours.map((h) => `${h} h`).join(", ")} sur ${channelsPhrase(s.channels)}.`;
  return `${s.postsPerDay} post${s.postsPerDay > 1 ? "s" : ""} par jour au plus sur ${channelsPhrase(s.channels)}.`;
}

function levelLine(level: 0 | 1 | 2): string {
  if (level === 0) return "Niveau 0 : tu valides chaque post avant qu'il parte.";
  if (level === 1) return "Niveau 1 : tu valides seulement les nouveautés (nouveau canal, nouveau format, doute).";
  return "Niveau 2 : autonomie totale, tu reçois seulement le rapport.";
}

export function liveQuestion(team: TeamKey, s: TeamPlanSummary): string {
  return [
    `Passer l'équipe ${TEAM_LABELS[team]} en vrai ? Ses posts partiront sur les vrais canaux (plus sur le canal Test).`,
    workLine(team, s),
    levelLine(s.level),
    s.caps ? `Plafonds du mois : ${s.caps}.` : "Aucun plafond de dépense réglé.",
    "Réponds OUI pour confirmer, « non » pour annuler (ou « plus tard »).",
  ].join("\n");
}

export function levelQuestion(team: TeamKey, level: 0 | 1 | 2, s: TeamPlanSummary): string {
  const where = s.simulation ? "en simulation (tout part sur le canal Test)" : "en vrai";
  return [
    `Passer l'équipe ${TEAM_LABELS[team]} au niveau ${level} (${AUTONOMY_LABELS[level]}) ? Elle est aujourd'hui au niveau ${s.level}, ${where}.`,
    levelLine(level),
    workLine(team, s),
    "Réponds OUI pour confirmer, « non » pour annuler (ou « plus tard »).",
  ].join("\n");
}
