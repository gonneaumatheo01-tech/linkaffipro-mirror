/**
 * Phase 33, chantier C — « pourquoi rien n'est sorti ? » : le code cherche la cause dans un ordre fixe (canal en
 * pause, équipe en pause, équipe pour de faux, plan désactivé, quota atteint, hors fenêtre, budget, stock de médias
 * vide, aucune cote dans la fourchette, validation en attente, échec) et rend la première trouvée avec le moyen de la
 * lever (une question). Lecture seule.
 */
import { nowOf } from "../../admin/journal";
import { unusedSourceCount } from "../../agents/mediatheque/stock";
import { casinoStock } from "../../casino/contracts";
import { parsePayload, parseSteps } from "../../missions/mission";
import { monthUsage } from "../../missions/usage";
import { budgetState, PROVIDER_LABELS } from "../../orchestrator/budgets";
import { hasOddsKey } from "../../providers/odds-registry";
import { hhmmToMinutes, parisDay } from "../../rules/time";
import { AGENT_LABELS, isAgentKey, isTeamKey, TEAM_OF_VERTICAL, type AgentsDeps, type ProviderKey, type TeamKey } from "../../types";
import { dayLabel, hhmmLabel, hourLabel, overridesOf, readTeamState, SLOT_MINUTES, slotRange, type DaySlot, type ViewResult } from "./common";
import { failureText } from "./done";
import { categoriesForChannel } from "./sports";

export const WHY_CAUSES = [
  "canal_pause",
  "equipe_pause",
  "pour_de_faux",
  "plan_desactive",
  "quota",
  "hors_fenetre",
  "budget",
  "stock_vide",
  "aucune_cote",
  "validation",
  "echec",
] as const;
export type WhyCause = (typeof WHY_CAUSES)[number] | "a_venir" | "inconnue";

export type WhyFinding = { cause: WhyCause; text: string; lever: string };

type MissionRow = { id: string; teamKey: string; kind: string; status: string; currentStep: number; steps: unknown; payload: unknown; scheduledFor: Date | null; lastError: string | null; postId: string | null; createdAt: Date };

export async function whyNothing(deps: AgentsDeps, input: { channelId: string; day?: string | null; slot?: DaySlot | null }): Promise<ViewResult & { cause: WhyCause; findings: WhyFinding[] }> {
  const now = nowOf(deps);
  const day = input.day ?? parisDay(now);
  const slot = input.slot ?? null;
  const channel = (await deps.prisma.channel.findUnique({ where: { id: input.channelId }, select: { id: true, title: true, vertical: true, isTest: true, isActive: true } })) as {
    id: string;
    title: string;
    vertical: string | null;
    isTest: boolean;
    isActive: boolean;
  } | null;
  if (!channel) return { cause: "inconnue", findings: [], facts: { canal: null }, lines: ["Je ne trouve pas ce canal."] };
  const name = channel.title;
  const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: channel.id } })) as {
    teamKey: string;
    enabled: boolean;
    postsPerDay: number;
    windowStart: string;
    windowEnd: string;
    mix: unknown;
    personaId: string | null;
  } | null;
  const ovs = await overridesOf(deps, channel.id, day);
  const ov = ovs[ovs.length - 1] ?? null;
  const vertical = channel.vertical as keyof typeof TEAM_OF_VERTICAL | null;
  const team: TeamKey | null = ov && isTeamKey(ov.teamKey) ? ov.teamKey : plan && isTeamKey(plan.teamKey) ? plan.teamKey : vertical ? (TEAM_OF_VERTICAL[vertical] ?? null) : null;
  const findings: WhyFinding[] = [];
  const add = (cause: WhyCause, text: string, lever: string) => findings.push({ cause, text, lever });
  const when = `${dayLabel(day, now)}${slot ? ` ${slot === "matin" ? "matin" : slot === "soir" ? "soir" : slot === "apres-midi" ? "après-midi" : slot}` : ""}`;

  const missions = (await deps.prisma.agentMission.findMany({ where: { channelId: channel.id, planDay: day }, orderBy: { createdAt: "asc" }, take: 200 })) as MissionRow[];
  const range = slotRange(day, slot);
  const inSlot = (m: MissionRow) => !slot || (m.scheduledFor ? m.scheduledFor >= range.from && m.scheduledFor < range.to : m.createdAt >= range.from && m.createdAt < range.to);
  const relevant = missions.filter(inSlot);
  const state = team ? await readTeamState(deps, team) : null;

  // 1. Canal en pause.
  if (!ov && plan && !plan.enabled && team !== "sports") add("canal_pause", `Les agents sont arrêtés sur ${name}.`, `Je les relance sur ${name} ?`);
  // 2. Équipe en pause.
  if (state?.pausedAll) add("equipe_pause", "Tous les agents sont en pause.", "Je relance tout ?");
  else if (state?.paused) add("equipe_pause", `L'équipe ${state.label} est en pause${state.pausedReason ? ` (${state.pausedReason})` : ""}.`, `Je relance l'équipe ${state.label} ?`);
  else if (state && !state.enabled) add("equipe_pause", `L'équipe ${state.label} est désactivée.`, `Tu veux que je la réactive ?`);
  // 3. Pour de faux : les posts partent sur le canal Test, jamais sur ce canal.
  if (state && state.simulation && !channel.isTest && !ov) add("pour_de_faux", `L'équipe ${state.label} travaille pour de faux : ses posts partent sur le canal Test, pas sur ${name}.`, `Tu veux la passer en vrai ?`);
  // 4. Plan désactivé (aucun plan, aucune catégorie, aucun ordre).
  let perDay = 0;
  let sportsCats: Awaited<ReturnType<typeof categoriesForChannel>>["categories"] = [];
  if (team === "sports") {
    sportsCats = (await categoriesForChannel(deps, channel.id, day)).categories;
    perDay = ov?.picksPerDay ?? sportsCats.reduce((n, c) => n + c.picksPerDay, 0);
    if (!sportsCats.length) add("plan_desactive", `Aucune catégorie de paris active ne vise ${name}.`, "Tu veux que j'active une catégorie pour ce canal ?");
  } else {
    perDay = ov ? (ov.postsPerDay ?? 0) : (plan?.postsPerDay ?? 0);
    if (!plan && !ov) add("plan_desactive", `${name} n'a pas de plan : aucun agent n'y travaille.`, "Tu veux que je lui règle un plan ? Dis-moi combien de posts par jour.");
  }
  // 5. Quota atteint (ou à zéro).
  if ((plan || ov || sportsCats.length) && perDay === 0) add("quota", `Le quota de ${name} est à 0 par jour.`, "Tu veux que je le remonte ?");
  else if (perDay > 0 && missions.filter((m) => m.status !== "CANCELLED").length >= perDay && slot && !relevant.length)
    add("quota", `Le quota du jour (${perDay}) était déjà pris par les posts d'autres moments de la journée.`, "Tu veux un post de plus par jour ?");
  // 6. Hors fenêtre.
  const ws = hhmmToMinutes(ov?.windowStart ?? (team === "sports" ? null : plan?.windowStart));
  const we = hhmmToMinutes(ov?.windowEnd ?? (team === "sports" ? null : plan?.windowEnd));
  if (slot && ws !== null && we !== null) {
    const [a, b] = SLOT_MINUTES[slot];
    if (b <= ws || a >= we) add("hors_fenetre", `La fenêtre de ${name} va de ${hhmmLabel(ov?.windowStart ?? plan?.windowStart)} à ${hhmmLabel(ov?.windowEnd ?? plan?.windowEnd)} : rien n'est prévu ${when}.`, "Tu veux que je change la fenêtre ?");
  } else if (slot && team === "sports" && state) {
    const hours = ((state.settings.settings as { sports?: { runHours?: number[] } }).sports?.runHours ?? [10, 15, 18]).filter((h) => typeof h === "number");
    const [a, b] = SLOT_MINUTES[slot];
    if (hours.length && !hours.some((h) => h * 60 >= a && h * 60 < b)) add("hors_fenetre", `L'équipe Paris passe à ${hours.map((h) => `${h} h`).join(", ")} : aucun passage ${when}.`, "Tu veux que je regarde les matchs maintenant, sans rien publier ?");
  }
  // 7. Budget.
  const blocked = missions.find((m) => m.status === "BLOCKED_BUDGET");
  if (blocked) add("budget", `Bloqué par le plafond du mois : ${failureText(blocked.lastError)}.`, "Tu veux que je monte le plafond ?");
  else if (state) {
    const usage = await monthUsage(deps.prisma, state.teamKey, now);
    for (const p of ["video", "image", "llm"] as ProviderKey[]) {
      const cap = state.settings.monthlyBudgetCents[p];
      const spent = usage.find((u) => u.provider === p)?.cents ?? 0;
      if (cap !== undefined && !budgetState(state.teamKey, p, spent, cap).allowed && cap > 0) {
        add("budget", `Le plafond ${PROVIDER_LABELS[p]} de l'équipe ${state.label} est atteint pour ce mois.`, "Tu veux que je le monte ?");
        break;
      }
    }
  }
  // 8. Stock de médias vide.
  if (team === "dating" && (ov?.personaId ?? plan?.personaId)) {
    const personaId = (ov?.personaId ?? plan?.personaId)!;
    const mix = (plan?.mix ?? {}) as Record<string, unknown>;
    if (Number(mix.video ?? 0) > 0 && (await unusedSourceCount(deps, personaId)) === 0) {
      const persona = (await deps.prisma.persona.findUnique({ where: { id: personaId }, select: { name: true } })) as { name: string } | null;
      add("stock_vide", `Plus aucune vidéo source pas encore utilisée pour ${persona?.name ?? "la persona"} : les vidéos passent en photo ou en texte.`, "Tu m'envoies quelques vidéos ?");
    }
  } else if (team === "casino") {
    const rows = await casinoStock(deps.prisma as never, { now, channelId: channel.id });
    if (rows.length && rows.every((r) => r.state === "empty")) add("stock_vide", `Plus aucun média pas encore utilisé dans les thèmes de ${name}.`, `Tu m'envoies des vidéos avec #casino et le thème ?`);
  }
  // 9. Aucune cote dans la fourchette.
  if (team === "sports") {
    const noPick = missions.map((m) => parsePayload(m.payload)).find((p) => p.noPick === true);
    if (noPick) add("aucune_cote", `Au dernier passage, aucun pari ne passait les critères (${String(noPick.noPickReason ?? "rien d'intéressant")}).`, "Tu veux que je regarde les matchs candidats maintenant ?");
    else if (!(deps as { providers?: { odds?: unknown } }).providers?.odds && !(await hasOddsKey(deps.prisma)) && !state?.simulation) add("aucune_cote", "Je n'ai pas de clé de cotes : l'équipe Paris ne peut rien chercher.", "Tu m'envoies la clé quand tu l'as ?");
  }
  // 10. Validation en attente.
  const waiting = relevant.find((m) => m.status === "WAITING_VALIDATION");
  if (waiting) {
    const v = (await deps.prisma.agentValidation.findFirst({ where: { missionId: waiting.id, status: "PENDING" } })) as { number: number } | null;
    add("validation", v ? `Le post n°${v.number} attend ta validation.` : "Un post attend ta validation.", v ? `Je le publie ? Réponds « ok ${v.number} ».` : "Tu veux le voir ?");
  }
  // 11. Échec.
  const failed = relevant.find((m) => m.status === "FAILED");
  if (failed) {
    const step = parseSteps(failed.steps)[failed.currentStep];
    add("echec", `Un post a raté${step && isAgentKey(step.agent) ? ` à l'étape ${AGENT_LABELS[step.agent]}` : ""} : ${failureText(failed.lastError ?? step?.error)}.`, "Tu veux un post de test pour vérifier que tout repart ?");
  }

  if (!findings.length) {
    const next = missions.filter((m) => m.scheduledFor && m.scheduledFor > now && m.status !== "CANCELLED").sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime())[0];
    if (next) add("a_venir", `Rien de bloqué sur ${name} : le prochain part à ${hourLabel(next.scheduledFor!)}.`, "");
    else if (missions.some((m) => m.status === "PENDING" || m.status === "RUNNING")) add("a_venir", `Rien de bloqué sur ${name} : des posts sont en préparation.`, "");
    else add("inconnue", `Je ne vois aucun blocage sur ${name} ${when}.`, "Tu veux que je te montre le plan du jour ?");
  }
  const main = findings[0]!;
  const facts = { canal: name, jour: day, moment: slot, cause: main.cause, autres: findings.slice(1, 3).map((f) => f.cause), quotaParJour: perDay, prevus: missions.length };
  const lines = [main.text, ...(main.lever ? [main.lever] : [])];
  return { cause: main.cause, findings, facts, lines };
}
