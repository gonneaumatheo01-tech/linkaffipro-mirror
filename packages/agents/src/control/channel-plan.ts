/**
 * Plan d'un canal (`ChannelAgentPlan`) : UNE seule logique pour le site (fiche d'équipe, bloc « Plan par canal ») et
 * pour le Boss (phase 26 : activer / désactiver un canal, persona, quota de posts par jour, mélange vidéo / photo /
 * texte). Contrôles : canal de l'univers de l'équipe (ou canal Test), persona obligatoire pour un plan Rencontres
 * activé, persona et campagne existantes. Chaque écriture a son `AuditLog` (`agents.channel_plan_saved`).
 */
import { agentAudit } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import { DATING_DEFAULT_MIX } from "../chiefs/dating-format";
import { TEAM_OF_VERTICAL, type AgentsDeps, type TeamKey } from "../types";

export type ChannelPlanMix = { video: number; photo: number; text: number };

export type ChannelPlanData = {
  channelId: string;
  enabled: boolean;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  minSpacingMinutes: number;
  mix: ChannelPlanMix;
  personaId: string | null;
  campaignId: string | null;
  /** Sujets libres ; pour un canal Casino (phase 22), thèmes de l'équipe avec leur poids. */
  themes: string[] | Array<{ theme: string; weight: number }>;
};

export type ChannelPlanSaveResult = { ok: true } | { ok: false; error: string };

/** Univers d'une équipe (l'équipe Algorithme ne publie sur aucun canal). */
export const PLAN_TEAM_VERTICAL: Record<TeamKey, "DATING" | "CASINO" | "SPORTS" | null> = {
  dating: "DATING",
  casino: "CASINO",
  sports: "SPORTS",
  algo: null,
};

/** Plus grand quota qu'un plan accepte (mêmes bornes que le formulaire du site). */
export const PLAN_MAX_POSTS_PER_DAY = 24;

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as object;

/** Enregistre le plan complet d'un canal (création ou remplacement). */
export async function saveChannelPlanFor(
  deps: AgentsDeps,
  team: TeamKey,
  input: ChannelPlanData,
  actor: ActorRef,
): Promise<ChannelPlanSaveResult> {
  const vertical = PLAN_TEAM_VERTICAL[team];
  if (!vertical) return { ok: false, error: "L'équipe Algorithme ne publie sur aucun canal." };
  const channel = await deps.prisma.channel.findUnique({
    where: { id: input.channelId },
    select: { id: true, vertical: true, isTest: true },
  });
  if (!channel || (channel.vertical !== vertical && !channel.isTest))
    return { ok: false, error: "Ce canal n'est pas un canal de cette équipe." };
  if (!Number.isInteger(input.postsPerDay) || input.postsPerDay < 0 || input.postsPerDay > PLAN_MAX_POSTS_PER_DAY)
    return { ok: false, error: `Posts par jour : entre 0 et ${PLAN_MAX_POSTS_PER_DAY}.` };
  // Rencontres (phase 20) : chaque post est fait pour un personnage, un plan activé exige sa persona.
  if (team === "dating" && input.enabled && !input.personaId)
    return { ok: false, error: "Choisissez la persona du canal : elle est obligatoire pour un canal Rencontres." };
  if (input.personaId && !(await deps.prisma.persona.findUnique({ where: { id: input.personaId }, select: { id: true } })))
    return { ok: false, error: "Persona introuvable : rechargez la page." };
  if (input.campaignId && !(await deps.prisma.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true } })))
    return { ok: false, error: "Campagne introuvable : rechargez la page." };
  // Rencontres : plus de vidéos IA depuis le 29 octobre 2026 (part de vidéos ramenée à 0).
  const mix = team === "dating" ? { ...input.mix, video: 0 } : input.mix;
  if (team === "dating" && mix.photo + mix.text <= 0)
    return { ok: false, error: "Mélange : donnez une part aux photos ou aux textes (l'équipe Rencontres ne fait plus de vidéos)." };
  const data = {
    teamKey: team,
    enabled: input.enabled,
    postsPerDay: input.postsPerDay,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    minSpacingMinutes: input.minSpacingMinutes,
    mix: json(mix),
    personaId: input.personaId,
    campaignId: input.campaignId,
    themes: json(input.themes),
    updatedById: actor.userId ?? null,
  };
  await deps.prisma.channelAgentPlan.upsert({
    where: { channelId: input.channelId },
    create: { channelId: input.channelId, ...data },
    update: data,
  });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.channel_plan_saved",
    entityType: "ChannelAgentPlan",
    entityId: input.channelId,
    metadata: { teamKey: team, ...input, channelId: undefined, via: actor.via },
  });
  return { ok: true };
}

export type ChannelPlanPatch = Partial<Pick<ChannelPlanData, "enabled" | "postsPerDay" | "personaId" | "mix">>;

type PlanRow = {
  channelId: string;
  teamKey: string;
  enabled: boolean;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  minSpacingMinutes: number;
  mix: unknown;
  personaId: string | null;
  campaignId: string | null;
  themes: unknown;
};

function mixOf(v: unknown): ChannelPlanMix | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  const m = { video: n(o.video), photo: n(o.photo), text: n(o.text) };
  return m.video + m.photo + m.text > 0 ? m : null;
}

/** Plan actuel d'un canal (ou les valeurs par défaut d'un plan neuf), et l'équipe qui le porte. */
export async function currentChannelPlan(
  deps: Pick<AgentsDeps, "prisma">,
  channelId: string,
): Promise<{ team: TeamKey | null; plan: ChannelPlanData; exists: boolean }> {
  const [row, channel] = await Promise.all([
    deps.prisma.channelAgentPlan.findUnique({ where: { channelId } }) as Promise<PlanRow | null>,
    deps.prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, vertical: true, isTest: true } }),
  ]);
  const vertical = channel?.vertical as keyof typeof TEAM_OF_VERTICAL | null | undefined;
  const team = (row?.teamKey as TeamKey | undefined) ?? (vertical && TEAM_OF_VERTICAL[vertical]) ?? null;
  const plan: ChannelPlanData = {
    channelId,
    enabled: row?.enabled ?? false,
    postsPerDay: row?.postsPerDay ?? 3,
    windowStart: row?.windowStart ?? "09:00",
    windowEnd: row?.windowEnd ?? "22:00",
    minSpacingMinutes: row?.minSpacingMinutes ?? 90,
    mix: mixOf(row?.mix) ?? (team === "dating" ? { ...DATING_DEFAULT_MIX } : { video: 0, photo: 0, text: 1 }),
    personaId: row?.personaId ?? null,
    campaignId: row?.campaignId ?? null,
    themes: (Array.isArray(row?.themes) ? row!.themes : []) as ChannelPlanData["themes"],
  };
  return { team, plan, exists: !!row };
}

/** Change une partie du plan d'un canal (le reste est gardé) par la même logique que le site. */
export async function updateChannelPlan(
  deps: AgentsDeps,
  channelId: string,
  patch: ChannelPlanPatch,
  actor: ActorRef,
): Promise<ChannelPlanSaveResult & { before?: ChannelPlanData; after?: ChannelPlanData }> {
  const { team, plan } = await currentChannelPlan(deps, channelId);
  if (!team) return { ok: false, error: "Ce canal n'appartient à aucune équipe d'agents (univers inconnu)." };
  if (patch.mix && !mixOf(patch.mix)) return { ok: false, error: "Mélange : donnez une part à au moins un type de post." };
  const after: ChannelPlanData = { ...plan, ...patch, mix: patch.mix ? mixOf(patch.mix)! : plan.mix };
  const r = await saveChannelPlanFor(deps, team, after, actor);
  return r.ok ? { ok: true, before: plan, after } : r;
}

/** Quota de posts par jour de tous les canaux au plan activé d'une équipe. Rend le nombre de canaux changés. */
export async function setTeamPostsPerDay(
  deps: AgentsDeps,
  team: TeamKey,
  postsPerDay: number,
  actor: ActorRef,
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const plans = (await deps.prisma.channelAgentPlan.findMany({ where: { teamKey: team, enabled: true }, select: { channelId: true } })) as {
    channelId: string;
  }[];
  if (!plans.length) return { ok: false, error: "Aucun canal de cette équipe n'a de plan activé." };
  let changed = 0;
  for (const p of plans) {
    const r = await updateChannelPlan(deps, p.channelId, { postsPerDay }, actor);
    if (!r.ok) return { ok: false, error: r.error };
    changed++;
  }
  return { ok: true, changed };
}
