/**
 * Entrées du catalogue du Boss : équipes (pause, reprise, niveau, simulation ↔ vrai, plafonds, quota) et plan par
 * canal (activer, désactiver, persona, mélange). Exécution par les fonctions existantes (`setTeamPaused`,
 * `setAutonomyLevel`, `setSimulation`, `setTeamBudget`, `updateChannelPlan`, `setTeamPostsPerDay`). Bornes vérifiées
 * par le code à chaque exécution (y compris après OUI).
 */
import { esc } from "../admin/journal";
import { setAutonomyLevel, setSimulation, setTeamPaused, AUTONOMY_LABELS, isPausedAll } from "../admin/team";
import { setTeamBudget } from "../admin/budget";
import { teamPlanSummary } from "../admin/confirm-summary";
import { PROVIDER_LABELS } from "../orchestrator/budgets";
import { loadTeamSettings } from "../missions/settings";
import { loadAlgoTeam } from "../algo/settings";
import { currentChannelPlan, setTeamPostsPerDay, updateChannelPlan } from "../control/channel-plan";
import { TEAM_LABELS, type ProviderKey, type TeamKey } from "../types";
import type { BossAction, BossActionClass, BossDeps, BossReply } from "./contract";
import { actorRef, defineAction, eur, fromResult, lines, plural } from "./catalog-kit";
import { bool, int, num, oneOf, str } from "./params";
import { checkCap, checkLevel, checkQuota, resolveChannel, resolvePersona, resolveTeam, teamOf, type ChannelRef } from "./resolve";
import { stateFacts } from "./facts";

const TEAM_DESC = "Équipe nommée par l'admin : rencontres (dating), casino, paris sportifs, algorithme";

type TeamP = { equipe: string };

async function team(params: TeamP, allowAll = false): Promise<{ ok: true; team: TeamKey | "all" } | { ok: false; reply: BossReply }> {
  const r = resolveTeam(params.equipe, { allowAll });
  return r.ok ? { ok: true, team: r.value } : { ok: false, reply: r.reply };
}

async function oneTeam(params: TeamP): Promise<{ ok: true; team: TeamKey } | { ok: false; reply: BossReply }> {
  const r = await team(params);
  if (!r.ok) return r;
  if (r.team === "all") return { ok: false, reply: { reply: "Une seule équipe à la fois, s'il te plaît." } };
  return { ok: true, team: r.team };
}

export const etatEquipe = defineAction<TeamP>({
  key: "etat_equipe",
  description: "Dire où en est une équipe (pause, simulation ou vrai, niveau, posts du jour, canaux, quota)",
  theme: "etat",
  cls: "immediate",
  spec: { equipe: str(TEAM_DESC) },
  async execute(deps, p) {
    const t = await oneTeam(p);
    if (!t.ok) return t.reply;
    const [facts, plan] = await Promise.all([stateFacts(deps, t.team), teamPlanSummary(deps, t.team)]);
    return lines(
      ...facts.lines.slice(1).map(esc),
      t.team === "algo"
        ? "Elle ne publie rien : elle propose et applique des réglages aux autres équipes."
        : esc(`Canaux au plan activé : ${plan.channels.length ? plan.channels.slice(0, 6).join(", ") : "aucun"} · ${plan.postsPerDay} posts par jour au plus`),
      plan.caps ? esc(`Plafonds : ${plan.caps}`) : "Aucun plafond réglé.",
    );
  },
});

type ChannelP = { canal: string };

export const etatCanal = defineAction<ChannelP>({
  key: "etat_canal",
  description: "Dire où en est un canal (plan activé ou non, posts par jour, persona, mélange vidéo / photo / texte)",
  theme: "canaux",
  cls: "immediate",
  spec: { canal: str("Titre du canal (ou prénom de sa persona)") },
  async execute(deps, p) {
    const c = await resolveChannel(deps, { actionKey: "etat_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const { team: t, plan, exists } = await currentChannelPlan(deps, c.value.id);
    const persona = plan.personaId ? ((await deps.prisma.persona.findUnique({ where: { id: plan.personaId }, select: { name: true } })) as { name: string } | null) : null;
    if (!exists) return lines(`<b>${esc(c.value.name)}</b> : aucun plan d'agents pour ce canal.`, t ? `Équipe : ${TEAM_LABELS[t]}. Dis « active ${esc(c.value.name)} » pour le lancer.` : null);
    return lines(
      `<b>${esc(c.value.name)}</b>${c.value.isTest ? " (canal Test)" : ""} : plan ${plan.enabled ? "activé ▶️" : "désactivé ⏸"}${t ? ` · ${TEAM_LABELS[t]}` : ""}`,
      `${plural(plan.postsPerDay, "post")} par jour entre ${plan.windowStart} et ${plan.windowEnd} · mélange vidéo ${plan.mix.video} / photo ${plan.mix.photo} / texte ${plan.mix.text}`,
      persona ? `Persona : ${esc(persona.name)}` : t === "dating" ? "Persona : aucune (obligatoire pour activer)" : null,
    );
  },
});

export const pause = defineAction<TeamP>({
  key: "pause",
  description: "Mettre en pause une équipe (rencontres, casino, paris sportifs, algorithme) ou tout",
  theme: "equipes",
  cls: "immediate",
  spec: { equipe: str(`${TEAM_DESC}, ou « tout »`) },
  async execute(deps, p, actor) {
    const t = await team(p, true);
    if (!t.ok) return t.reply;
    return fromResult(await setTeamPaused(deps, t.team, true, actorRef(actor), "pause demandée à Kevin"));
  },
});

export const reprise = defineAction<TeamP>({
  key: "reprise",
  description: "Faire reprendre le travail à une équipe en pause, ou lever la pause générale",
  theme: "equipes",
  cls: "immediate",
  spec: { equipe: str(`${TEAM_DESC}, ou « tout »`) },
  async execute(deps, p, actor) {
    const t = await team(p, true);
    if (!t.ok) return t.reply;
    const r = await setTeamPaused(deps, t.team, false, actorRef(actor));
    const still = t.team !== "all" && (await isPausedAll(deps)) ? "\nAttention : la pause générale est toujours active (dis « reprends tout »)." : "";
    return { reply: esc(r.message) + still };
  },
});

type LevelP = { equipe: string; niveau: number };

async function currentLevel(deps: BossDeps, t: TeamKey): Promise<0 | 1 | 2> {
  return (await loadTeamSettings(deps.prisma, t)).autonomyLevel;
}

export const niveau = defineAction<LevelP>({
  key: "niveau",
  description: "Changer le niveau d'autonomie d'une équipe : 0 je valide tout, 1 je valide les nouveautés, 2 autonomie totale",
  theme: "equipes",
  cls: "confirm",
  spec: { equipe: str(TEAM_DESC), niveau: int("Niveau voulu : 0, 1 ou 2", 0, 2) },
  refine: (p) => checkLevel(p.niveau),
  async classify(deps, p): Promise<BossActionClass> {
    const t = teamOf(p.equipe);
    if (!t || t === "all") return "immediate";
    return p.niveau < (await currentLevel(deps, t)) ? "immediate" : "confirm";
  },
  async summarize(deps, p) {
    const t = teamOf(p.equipe) as TeamKey;
    const now = await currentLevel(deps, t);
    return `Passer l'équipe ${TEAM_LABELS[t]} du niveau ${now} au niveau ${p.niveau} (${AUTONOMY_LABELS[p.niveau as 0 | 1 | 2]}) ?\nPlus le niveau est haut, moins tu valides avant publication.`;
  },
  async execute(deps, p, actor) {
    const t = await oneTeam(p);
    if (!t.ok) return t.reply;
    const err = checkLevel(p.niveau);
    if (err) return { reply: err };
    if ((await currentLevel(deps, t.team)) === p.niveau) return { reply: `L'équipe ${TEAM_LABELS[t.team]} est déjà au niveau ${p.niveau}.` };
    return fromResult(await setAutonomyLevel(deps, t.team, p.niveau as 0 | 1 | 2, actorRef(actor)));
  },
});

type SimP = { equipe: string; mode: "simulation" | "vrai" };

export const simulation = defineAction<SimP>({
  key: "simulation",
  description: "Passer une équipe en vrai (posts sur les vrais canaux) ou la remettre en simulation (canal Test)",
  theme: "equipes",
  cls: "confirm",
  spec: { equipe: str(TEAM_DESC), mode: oneOf("« vrai » = vrais canaux, « simulation » = canal Test", ["simulation", "vrai"]) },
  async classify(_deps, p) {
    return p.mode === "simulation" ? "immediate" : "confirm";
  },
  async summarize(deps, p) {
    const t = teamOf(p.equipe) as TeamKey;
    const s = await teamPlanSummary(deps, t);
    const where = s.channels.length ? `${s.channels.length} canal${s.channels.length > 1 ? "aux" : ""} (${s.channels.slice(0, 3).join(", ")})` : "aucun canal au plan activé";
    return `Passer l'équipe ${TEAM_LABELS[t]} en vrai ? Ses posts partiront sur les vrais canaux : ${where}.\nNiveau ${s.level}, ${s.postsPerDay} posts par jour au plus${s.caps ? `, plafonds : ${s.caps}` : ""}.`;
  },
  async execute(deps, p, actor) {
    const t = await oneTeam(p);
    if (!t.ok) return t.reply;
    const s = await teamPlanSummary(deps, t.team);
    const wantSim = p.mode === "simulation";
    if (s.simulation === wantSim) return { reply: `L'équipe ${TEAM_LABELS[t.team]} est déjà ${wantSim ? "en simulation" : "en vrai"}.` };
    return fromResult(await setSimulation(deps, t.team, wantSim, actorRef(actor)));
  },
});

const POSTES: Record<string, ProviderKey> = { video: "video", image: "image", ia: "llm", cotes: "odds", captures: "screenshot" };
type CapP = { equipe: string; poste: "video" | "image" | "ia" | "cotes" | "captures"; euros: number };

async function currentCap(deps: BossDeps, t: TeamKey, provider: ProviderKey): Promise<number | undefined> {
  return (await loadTeamSettings(deps.prisma, t)).monthlyBudgetCents[provider];
}

export const plafond = defineAction<CapP>({
  key: "plafond",
  description: "Changer le plafond mensuel d'une équipe pour un poste (vidéo, image, IA, cotes, captures), en euros",
  theme: "equipes",
  cls: "confirm",
  spec: {
    equipe: str(`${TEAM_DESC} (vidéo et image : rencontres ; cotes : paris sportifs)`),
    poste: oneOf("Poste de dépense", ["video", "image", "ia", "cotes", "captures"]),
    euros: num("Nouveau plafond mensuel en euros (0 = aucune dépense)", 0, 100_000),
  },
  refine: (p) => checkCap(p.euros),
  async classify(deps, p) {
    const t = teamOf(p.equipe);
    if (!t || t === "all") return "immediate";
    const cur = await currentCap(deps, t, POSTES[p.poste]!);
    // Sans plafond, la dépense n'a pas de limite : en poser un est une baisse.
    return cur !== undefined && Math.round(p.euros * 100) > cur ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const t = teamOf(p.equipe) as TeamKey;
    const provider = POSTES[p.poste]!;
    const cur = await currentCap(deps, t, provider);
    return `Monter le plafond ${PROVIDER_LABELS[provider]} de l'équipe ${TEAM_LABELS[t]} de ${cur === undefined ? "aucun" : eur(cur)} à ${eur(Math.round(p.euros * 100))} par mois ?\nL'équipe pourra dépenser jusqu'à ce montant chez le fournisseur.`;
  },
  async execute(deps, p, actor) {
    const t = await oneTeam(p);
    if (!t.ok) return t.reply;
    const err = checkCap(p.euros);
    if (err) return { reply: err };
    const provider = POSTES[p.poste]!;
    await setTeamBudget(deps, t.team, provider, Math.round(p.euros * 100), actorRef(actor));
    return { reply: `Plafond ${PROVIDER_LABELS[provider]} de l'équipe ${TEAM_LABELS[t.team]} : ${eur(Math.round(p.euros * 100))} par mois ✅` };
  },
});

type QuotaP = { cible: string; posts_par_jour: number };

/** Équipe ou canal visé par « quota » (pur côté équipe, base pour le canal). */
async function quotaTarget(deps: BossDeps, p: QuotaP): Promise<{ ok: true; team: TeamKey } | { ok: true; channel: ChannelRef } | { ok: false; reply: BossReply }> {
  const t = teamOf(p.cible);
  if (t && t !== "all") return { ok: true, team: t };
  const c = await resolveChannel(deps, { actionKey: "quota_posts", params: p, field: "cible" }, p.cible);
  return c.ok ? { ok: true, channel: c.value } : { ok: false, reply: c.reply };
}

async function maxPosts(deps: BossDeps): Promise<number> {
  return (await loadAlgoTeam(deps.prisma)).settings.maxPostsPerDay;
}

export const quotaPosts = defineAction<QuotaP>({
  key: "quota_posts",
  description: "Changer le nombre de posts par jour d'un canal (ou de tous les canaux d'une équipe)",
  theme: "canaux",
  cls: "confirm",
  spec: {
    cible: str("Titre du canal, prénom de la persona du canal, ou nom de l'équipe"),
    posts_par_jour: int("Nombre de posts par jour voulu", 0, 48),
  },
  async classify(deps, p) {
    const target = await quotaTarget(deps, p);
    if (!target.ok) return "immediate";
    if ("team" in target) {
      const s = await teamPlanSummary(deps, target.team);
      const n = Math.max(1, s.channels.length);
      return p.posts_par_jour * n > s.postsPerDay ? "confirm" : "immediate";
    }
    const { plan } = await currentChannelPlan(deps, target.channel.id);
    return p.posts_par_jour > plan.postsPerDay ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const target = await quotaTarget(deps, p);
    if (target.ok && "channel" in target) {
      const { plan } = await currentChannelPlan(deps, target.channel.id);
      return `Passer ${target.channel.name} de ${plural(plan.postsPerDay, "post")} à ${plural(p.posts_par_jour, "post")} par jour ?\nPlus de posts = plus de production (et de dépense pour les vidéos).`;
    }
    const t = target.ok && "team" in target ? target.team : "dating";
    return `Mettre ${plural(p.posts_par_jour, "post")} par jour sur chaque canal au plan activé de l'équipe ${TEAM_LABELS[t]} ?\nPlus de posts = plus de production (et de dépense pour les vidéos).`;
  },
  async execute(deps, p, actor) {
    const err = checkQuota(p.posts_par_jour, await maxPosts(deps));
    if (err) return { reply: err };
    const target = await quotaTarget(deps, p);
    if (!target.ok) return target.reply;
    if ("team" in target) {
      const r = await setTeamPostsPerDay(deps, target.team, p.posts_par_jour, actorRef(actor));
      if (!r.ok) return { reply: esc(r.error) };
      return { reply: `${TEAM_LABELS[target.team]} : ${plural(p.posts_par_jour, "post")} par jour sur ${plural(r.changed, "canal", "canaux")} ✅` };
    }
    const r = await updateChannelPlan(deps, target.channel.id, { postsPerDay: p.posts_par_jour }, actorRef(actor));
    if (!r.ok) return { reply: esc(r.error) };
    return { reply: `${esc(target.channel.name)} : ${plural(p.posts_par_jour, "post")} par jour ✅` };
  },
});

type PlanP = { canal: string; actif: boolean };

export const planCanal = defineAction<PlanP>({
  key: "plan_canal",
  description: "Activer ou désactiver le travail des agents sur un canal",
  theme: "canaux",
  cls: "confirm",
  spec: { canal: str("Titre du canal (ou prénom de sa persona)"), actif: bool("true = activer, false = désactiver") },
  async classify(_d, p) {
    return p.actif ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const c = await resolveChannel(deps, { actionKey: "plan_canal", params: p, field: "canal" }, p.canal);
    const name = c.ok ? c.value.name : p.canal;
    const plan = c.ok ? (await currentChannelPlan(deps, c.value.id)).plan : null;
    return `Activer les agents sur ${name} ?\n${plan ? `${plural(plan.postsPerDay, "post")} par jour entre ${plan.windowStart} et ${plan.windowEnd} (simulation et niveau de l'équipe inchangés).` : "Le canal recevra des posts de son équipe."}`;
  },
  async execute(deps, p, actor) {
    const c = await resolveChannel(deps, { actionKey: "plan_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const { plan } = await currentChannelPlan(deps, c.value.id);
    if (plan.enabled === p.actif) return { reply: `${esc(c.value.name)} : déjà ${p.actif ? "activé" : "désactivé"}.` };
    const r = await updateChannelPlan(deps, c.value.id, { enabled: p.actif }, actorRef(actor));
    if (!r.ok) return { reply: esc(r.error) };
    return { reply: `${esc(c.value.name)} : agents ${p.actif ? "activés ▶️" : "désactivés ⏸"}` };
  },
});

type PersonaP = { canal: string; persona: string };

export const personaCanal = defineAction<PersonaP>({
  key: "persona_canal",
  description: "Choisir la persona (le personnage) d'un canal Rencontres",
  theme: "canaux",
  cls: "confirm",
  spec: { canal: str("Titre du canal"), persona: str("Prénom de la persona") },
  async summarize(deps, p) {
    return `Donner la persona ${p.persona} au canal ${p.canal} ?\nLes prochains posts de ce canal seront faits pour ce personnage.`;
  },
  async execute(deps, p, actor) {
    const c = await resolveChannel(deps, { actionKey: "persona_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const pe = await resolvePersona(deps, { actionKey: "persona_canal", params: p, field: "persona" }, p.persona);
    if (!pe.ok) return pe.reply;
    const r = await updateChannelPlan(deps, c.value.id, { personaId: pe.value.id }, actorRef(actor));
    if (!r.ok) return { reply: esc(r.error) };
    return { reply: `${esc(c.value.name)} : persona ${esc(pe.value.name)} ✅` };
  },
});

type MixP = { canal: string; video: number; photo: number; texte: number };

export const melangeCanal = defineAction<MixP>({
  key: "melange_canal",
  description: "Changer le mélange vidéo / photo / texte des posts d'un canal (parts relatives)",
  theme: "canaux",
  cls: "confirm",
  spec: {
    canal: str("Titre du canal"),
    video: int("Part de vidéos", 0, 100),
    photo: int("Part de photos", 0, 100),
    texte: int("Part de textes", 0, 100),
  },
  refine: (p) => (p.video + p.photo + p.texte > 0 ? null : "mélange vide"),
  async classify(deps, p) {
    const c = await resolveChannel(deps, { actionKey: "melange_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return "immediate";
    const { plan } = await currentChannelPlan(deps, c.value.id);
    const share = (m: { video: number; photo: number; text: number }) => m.video / Math.max(1, m.video + m.photo + m.text);
    // Plus de vidéos = plus de dépense : à confirmer.
    return share({ video: p.video, photo: p.photo, text: p.texte }) > share(plan.mix) ? "confirm" : "immediate";
  },
  async summarize(_deps, p) {
    return `Mélange de ${p.canal} : vidéo ${p.video} / photo ${p.photo} / texte ${p.texte} ?\nPlus de vidéos = plus de dépense chez le fournisseur.`;
  },
  async execute(deps, p, actor) {
    const c = await resolveChannel(deps, { actionKey: "melange_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const r = await updateChannelPlan(deps, c.value.id, { mix: { video: p.video, photo: p.photo, text: p.texte } }, actorRef(actor));
    if (!r.ok) return { reply: esc(r.error) };
    return { reply: `${esc(c.value.name)} : mélange vidéo ${p.video} / photo ${p.photo} / texte ${p.texte} ✅` };
  },
});

export const TEAM_ACTIONS: BossAction[] = [
  etatEquipe,
  etatCanal,
  pause,
  reprise,
  niveau,
  simulation,
  plafond,
  quotaPosts,
  planCanal,
  personaCanal,
  melangeCanal,
] as unknown as BossAction[];

