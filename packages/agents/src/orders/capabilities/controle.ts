/**
 * Capacité de l'agent Contrôle qualité (phase 33) : « interdis le mot "gratuit" sur Zone Interdite ». Les mots
 * interdits vivent par équipe (`AgentTeamConfig.forbiddenWords`, lus par le Contrôle pour tous les canaux de
 * l'équipe) : il n'existe pas de liste par canal, le mot vaut donc pour tous les canaux de l'équipe du canal, et
 * Kevin le dit. Retirer le mot annule.
 */
import { agentAudit } from "../../admin/journal";
import { channelRefs, matchNames, teamOf } from "../../boss/resolve";
import { TEAM_LABELS, isTeamKey, type AgentsDeps, type TeamKey } from "../../types";
import { alt, defineCapability, done, ok, orderActor, refuse } from "./kit";

type WordP = { mot: string; canal?: string; equipe?: string; retirer?: boolean };

async function teamOfTarget(deps: AgentsDeps, p: WordP): Promise<{ team: TeamKey | null; channel: string | null }> {
  if (p.canal) {
    const c = matchNames(p.canal, await channelRefs(deps))[0];
    return { team: c && !c.isTest && c.team ? c.team : null, channel: c?.name ?? null };
  }
  const t = p.equipe ? teamOf(p.equipe) : null;
  return { team: t && t !== "all" ? t : null, channel: null };
}

async function wordsOf(deps: AgentsDeps, team: TeamKey): Promise<string[]> {
  const row = (await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: team } })) as { forbiddenWords?: unknown } | null;
  return Array.isArray(row?.forbiddenWords) ? (row!.forbiddenWords as unknown[]).filter((w): w is string => typeof w === "string") : [];
}

export const motInterdit = defineCapability<WordP>({
  teamKey: "transverse",
  key: "mot_interdit_canal",
  description: "Interdire (ou réautoriser) un mot dans les posts d'un canal : le Contrôle qualité le refuse ensuite pour toute l'équipe du canal",
  agents: ["controle"],
  spec: {
    mot: { kind: "string", description: "Le mot ou l'expression", maxLength: 60 },
    canal: { kind: "string", description: "Canal visé", optional: true, maxLength: 80 },
    equipe: { kind: "string", description: "Équipe visée (si pas de canal)", optional: true, maxLength: 40 },
    retirer: { kind: "bool", description: "true = réautoriser le mot", optional: true },
  },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    const { team } = await teamOfTarget(deps, p);
    if (team && team !== "algo") return ok();
    const refs = (await channelRefs(deps)).filter((c) => !c.isTest && c.team);
    return refuse(p.canal ? `Je ne trouve pas le canal « ${p.canal} » (ou il n'a pas d'équipe).` : "Pour quel canal ou quelle équipe ?", refs.slice(0, 4).map((c) => alt(`sur ${c.name}`, "transverse", "mot_interdit_canal", { ...p, canal: c.name, equipe: undefined })));
  },
  async plan(deps, p) {
    const { team, channel } = await teamOfTarget(deps, p);
    if (!team || !isTeamKey(team)) return [];
    const before = await wordsOf(deps, team);
    const w = p.mot.trim().toLowerCase();
    const after = p.retirer ? before.filter((x) => x.toLowerCase() !== w) : before.some((x) => x.toLowerCase() === w) ? before : [...before, w];
    return [
      {
        stepKey: `mot_interdit:${team}:${w}:${p.retirer ? "retirer" : "ajouter"}`,
        capability: "mot_interdit_canal",
        teamKey: "transverse",
        summary: `${p.retirer ? "réautoriser" : "interdire"} « ${w} »${channel ? ` (${channel})` : ""}`,
        clamped: channel ? [`il n'y a pas de liste par canal : le mot vaut pour tous les canaux ${TEAM_LABELS[team]}`] : [],
        params: { team, before, after },
      },
    ];
  },
  async run(deps, order, step) {
    const team = step.params.team as TeamKey;
    const after = (step.params.after as string[]) ?? [];
    await deps.prisma.agentTeamConfig.upsert({ where: { teamKey: team }, create: { teamKey: team, forbiddenWords: after }, update: { forbiddenWords: after, updatedById: order.createdById } });
    await agentAudit(deps, { userId: order.createdById, action: "agents.team.forbidden_words", entityType: "AgentTeamConfig", entityId: team, metadata: { before: step.params.before, after, orderId: order.id, via: orderActor(order).via } });
    return done(`Mots interdits de l'équipe ${TEAM_LABELS[team]} : ${after.join(", ") || "aucun"}.`);
  },
  async report(_deps, order) {
    return { ordre: order.number };
  },
});

export const CONTROLE_CAPABILITIES = [motInterdit];
