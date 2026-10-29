/**
 * Capacités communes des équipes qui publient des posts (Rencontres, Casino ; phase 33) : programmer N jours de posts
 * sur des canaux (ou le canal Test), un post de test, changer le plan d'un canal. Les différences d'équipe (persona
 * Rencontres, médias du client et rotation Casino) passent par `PostsTeam`.
 * Production : missions créées par le Grand Chef depuis les dérogations (`orders/day-missions.ts`), chaîne habituelle.
 */
import { agentAudit, nowOf } from "../../admin/journal";
import { matchNames, personaRefs, type PersonaRef } from "../../boss/resolve";
import { currentChannelPlan, saveChannelPlanFor, type ChannelPlanData } from "../../control/channel-plan";
import { effectiveMix, MAX_MIX_POINTS_PER_PROPOSAL } from "../../algo/mix";
import { applyRecommendation } from "../../algo/contracts";
import { proposeRecommendation } from "../../agents/synthese/proposals";
import { createTestPostMission } from "../../missions/test-post";
import { loadTeamSettings } from "../../missions/settings";
import { checkBudgets } from "../../orchestrator/budgets";
import { falImageCents } from "../../providers/costs";
import { TEAM_LABELS, type AgentsDeps, type ProviderKey } from "../../types";
import type { Alternative, Capability, CapabilityCheck, CapabilityPlanContext, OrderRow, OrderStep } from "../contract";
import {
  F,
  alt,
  channelsLabel,
  clampMix,
  clampPerDay,
  clampWindow,
  defineCapability,
  done,
  failed,
  frRange,
  isHhmm,
  missionsReport,
  ok,
  orderActor,
  orderModeOf,
  readAlgoBounds,
  readOnly,
  refuse,
  resolvePeriod,
  resolveScope,
  settingTouches,
  touchesOf,
  windowAllowedFor,
  type Mix,
  type ScopeChannel,
} from "./kit";
import { attachMission, stepMission } from "./sports";

export type PostsTeamKey = "dating" | "casino";

export type ProgramPostsP = {
  canaux?: string[];
  test?: boolean;
  jours?: number;
  debut?: string;
  posts_par_jour?: number;
  format?: "video" | "photo" | "texte";
  video?: number;
  photo?: number;
  texte?: number;
  persona?: string;
  themes?: string[];
  fenetre_debut?: string;
  fenetre_fin?: string;
  campagne?: string;
  mode?: "simulation" | "vrai";
};

export type ResolvedThemes = { ok: true; themes: string[] } | { ok: false; check: CapabilityCheck };

/** Ce qui change d'une équipe à l'autre. */
export type PostsTeam = {
  teamKey: PostsTeamKey;
  agents: string[];
  usesPersona: boolean;
  defaultMix: Mix;
  /** Thèmes demandés → thèmes de l'équipe (Casino : thèmes de la médiathèque ; Rencontres : sujets libres). */
  themes(deps: AgentsDeps, p: ProgramPostsP): Promise<ResolvedThemes>;
  /** Contrôle propre à l'équipe (Casino : stock de médias pour la période). */
  extraCheck?(deps: AgentsDeps, p: ProgramPostsP, ctx: { channels: ScopeChannel[]; days: number; perDay: number; themes: string[]; mix: Mix }): Promise<CapabilityCheck>;
};

const FORMAT_OF: Record<string, "video" | "photo" | "text"> = { video: "video", photo: "photo", texte: "text" };

/** Mélange demandé (format seul = 100 % de ce format), ou null. */
export function wantedMix(p: Pick<ProgramPostsP, "format" | "video" | "photo" | "texte">): Mix | null {
  if (p.format) return { video: p.format === "video" ? 1 : 0, photo: p.format === "photo" ? 1 : 0, text: p.format === "texte" ? 1 : 0 };
  if (p.video === undefined && p.photo === undefined && p.texte === undefined) return null;
  const m = { video: p.video ?? 0, photo: p.photo ?? 0, text: p.texte ?? 0 };
  return m.video + m.photo + m.text > 0 ? m : null;
}

const share = (m: Mix, k: keyof Mix) => m[k] / Math.max(1e-9, m.video + m.photo + m.text);

async function resolvePersonaParam(deps: AgentsDeps, raw: string | undefined): Promise<{ ok: true; persona: PersonaRef | null } | { ok: false; list: PersonaRef[] }> {
  if (!raw) return { ok: true, persona: null };
  const refs = await personaRefs(deps);
  const found = matchNames(raw, refs);
  if (found.length === 1) return { ok: true, persona: found[0]! };
  if (found.length > 1) {
    const exact = found.find((f) => f.name.toLowerCase() === raw.toLowerCase());
    return exact ? { ok: true, persona: exact } : { ok: false, list: found };
  }
  return { ok: false, list: [] };
}

async function resolveCampaign(deps: AgentsDeps, raw: string | undefined): Promise<{ ok: true; id: string | null; name: string | null } | { ok: false; list: Array<{ id: string; name: string }> }> {
  if (!raw) return { ok: true, id: null, name: null };
  const rows = (await deps.prisma.campaign.findMany({ select: { id: true, name: true }, take: 200 })) as Array<{ id: string; name: string }>;
  const found = matchNames(raw, rows);
  return found.length === 1 ? { ok: true, id: found[0]!.id, name: found[0]!.name } : { ok: false, list: found.length ? found : rows.slice(0, 3) };
}

/** Persona par défaut : celle du plan du canal, sinon la première persona active de l'univers. */
async function defaultPersona(deps: AgentsDeps, channels: readonly ScopeChannel[]): Promise<string | null> {
  for (const c of channels) {
    const { plan } = await currentChannelPlan(deps, c.id);
    if (plan.personaId) return plan.personaId;
  }
  const refs = (await personaRefs(deps)).filter((r) => r.isActive);
  return (refs.find((r) => r.universe === "DATING" || r.universe === "dating") ?? refs[0])?.id ?? null;
}

/** Vidéos : Casino seulement (médias du client) ; les Rencontres n'ont plus de vidéos IA depuis le 29 octobre 2026. */
const allowsVideo = (T: PostsTeamKey) => T !== "dating";
const formatValues = (T: PostsTeamKey) => (allowsVideo(T) ? ["video", "photo", "texte"] : ["photo", "texte"]);
const formatLabel = (T: PostsTeamKey) => (allowsVideo(T) ? "video, photo ou texte" : "photo ou texte");

const PHOTO_ESTIMATE_CENTS = falImageCents(1, "portrait");

export function programPosts(team: PostsTeam): Capability<ProgramPostsP> {
  const T = team.teamKey;
  const label = TEAM_LABELS[T];
  const replayOf = (p: ProgramPostsP) => ({ teamKey: T, key: "programmer_posts", params: p as Record<string, unknown> });
  return defineCapability<ProgramPostsP>({
    teamKey: T,
    key: "programmer_posts",
    description:
      T === "dating"
        ? "Programmer des posts Rencontres sur un ou des canaux (ou le canal Test) pendant N jours : posts par jour, format ou mélange, persona, thèmes, fenêtre horaire, bouton d'offre"
        : "Programmer des posts Casino sur un ou des canaux (ou le canal Test) pendant N jours, avec les médias fournis par le client seulement : posts par jour, format ou mélange, thèmes de la médiathèque, fenêtre, bouton d'offre",
    agents: team.agents,
    spec: {
      canaux: F.canaux,
      test: F.test,
      jours: F.jours,
      debut: F.debut,
      posts_par_jour: { kind: "int", description: "Posts par jour (ramené au maximum réglé)", min: 1, max: 500, optional: true },
      format: { kind: "enum", description: `Un seul format : ${formatLabel(T)}`, values: formatValues(T), optional: true },
      ...(allowsVideo(T) ? { video: { kind: "int" as const, description: "Part de vidéos du mélange", min: 0, max: 100, optional: true } } : {}),
      photo: { kind: "int", description: "Part de photos du mélange", min: 0, max: 100, optional: true },
      texte: { kind: "int", description: "Part de textes du mélange", min: 0, max: 100, optional: true },
      ...(team.usesPersona ? { persona: { kind: "string" as const, description: "Prénom de la persona", optional: true, maxLength: 60 } } : {}),
      themes: { kind: "list", description: T === "casino" ? "Thèmes de la médiathèque casino (roulette, machines à sous…)" : "Sujets des posts", optional: true, maxItems: 8 },
      fenetre_debut: F.fenetreDebut,
      fenetre_fin: F.fenetreFin,
      campagne: { kind: "string", description: "Campagne du bouton d'offre (facultatif)", optional: true, maxLength: 80 },
      mode: F.mode,
    },
    refine: (p) => {
      if ((p.fenetre_debut && !isHhmm(p.fenetre_debut)) || (p.fenetre_fin && !isHhmm(p.fenetre_fin))) return "fenêtre : HH:MM attendu";
      if (!!p.fenetre_debut !== !!p.fenetre_fin) return "fenêtre : début et fin";
      if (p.fenetre_debut && p.fenetre_fin && p.fenetre_debut >= p.fenetre_fin) return "fenêtre : le début doit précéder la fin";
      return null;
    },
    limits: { maxDays: 30, channels: "team", modes: ["simulation", "real"] },
    async check(deps, p) {
      const scope = await resolveScope(deps, p, T, replayOf(p));
      if (!scope.ok) return refuse(scope.reason, scope.alternatives);
      if (!allowsVideo(T) && (p.format === "video" || (p.video ?? 0) > 0))
        return refuse("L'équipe Rencontres ne fait plus de vidéos : photos ou textes seulement.", [
          alt("des photos à la place", T, "programmer_posts", { ...p, format: "photo", video: undefined }),
          alt("des posts texte seulement", T, "programmer_posts", { ...p, format: "texte", video: undefined }),
        ]);
      const mix = wantedMix(p) ?? team.defaultMix;
      const needsMedia = mix.video + mix.photo > 0;
      let personaId: string | null = null;
      if (team.usesPersona) {
        const r = await resolvePersonaParam(deps, p.persona);
        if (!r.ok) {
          const refs = r.list.length ? r.list : (await personaRefs(deps)).filter((x) => x.isActive);
          return refuse(
            r.list.length ? `Plusieurs personas correspondent à « ${p.persona} ».` : `Je ne trouve pas la persona « ${p.persona} ».`,
            [
              ...refs.slice(0, 3).map((x) => alt(`avec ${x.name}`, T, "programmer_posts", { ...p, persona: x.name })),
              alt("des posts texte sans persona", T, "programmer_posts", { ...p, persona: undefined, format: "texte", video: undefined, photo: undefined, texte: undefined }),
            ],
          );
        }
        personaId = r.persona?.id ?? (await defaultPersona(deps, scope.channels));
        if (needsMedia && !personaId)
          return refuse("Les photos Rencontres ont besoin d'une persona, et il n'y en a aucune (Conversations → Personas).", [
            alt("des posts texte seulement", T, "programmer_posts", { ...p, format: "texte", video: undefined, photo: undefined, texte: undefined }),
          ]);
      }
      const c = await resolveCampaign(deps, p.campagne);
      if (!c.ok)
        return refuse(`Je ne trouve pas la campagne « ${p.campagne} » pour le bouton d'offre.`, [
          ...c.list.slice(0, 3).map((x) => alt(`bouton de la campagne ${x.name}`, T, "programmer_posts", { ...p, campagne: x.name })),
          alt("sans bouton d'offre imposé", T, "programmer_posts", { ...p, campagne: undefined }),
        ]);
      const th = await team.themes(deps, p);
      if (!th.ok) return th.check;
      // Plafond de dépense (Rencontres : photos générées).
      if (T === "dating" && mix.photo > 0 && (await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: T } }))) {
        const settings = await loadTeamSettings(deps.prisma, T);
        const providers: ProviderKey[] = ["image"];
        const over = await checkBudgets(deps, settings, providers, nowOf(deps));
        if (over) return refuse(over.reason ?? "Plafond de dépense atteint.", [alt("des posts texte seulement", T, "programmer_posts", { ...p, format: "texte" })]);
      }
      if (team.extraCheck) {
        const bounds = await readAlgoBounds(deps);
        const period = resolvePeriod(p, { now: nowOf(deps), period: null });
        const perDay = Math.min(p.posts_par_jour ?? 2, bounds.maxPostsPerDay);
        return team.extraCheck(deps, p, { channels: scope.channels, days: period.days, perDay, themes: th.themes, mix });
      }
      return ok();
    },
    async plan(deps, p, ctx) {
      return planPosts(deps, team, p, ctx);
    },
    async run() {
      // Les dérogations sont posées par le Grand Chef ; les missions sont créées chaque jour par le plan du jour.
      return done(`Posts ${label} programmés.`);
    },
    async report(deps, order) {
      return missionsReport(deps, order);
    },
  });
}

async function planPosts(deps: AgentsDeps, team: PostsTeam, p: ProgramPostsP, ctx: CapabilityPlanContext): Promise<OrderStep[]> {
  const T = team.teamKey;
  const scope = await resolveScope(deps, p, T, { teamKey: T, key: "programmer_posts", params: p as Record<string, unknown> });
  if (!scope.ok) return [];
  const period = resolvePeriod(p, ctx);
  const bounds = await readAlgoBounds(deps);
  const clamped = [...period.clamped];
  let perDayRaw = p.posts_par_jour;
  if (perDayRaw === undefined) {
    const first = scope.channels.find((c) => !c.isTest);
    perDayRaw = first ? (await currentChannelPlan(deps, first.id)).plan.postsPerDay || 2 : 2;
  }
  const per = clampPerDay(perDayRaw, bounds.maxPostsPerDay, "posts", "du canal");
  if (per.note) clamped.push(per.note);
  const wanted = wantedMix(p);
  const th = await team.themes(deps, p);
  const themes = th.ok ? th.themes : [];
  let personaId: string | null = null;
  if (team.usesPersona) {
    const r = await resolvePersonaParam(deps, p.persona);
    personaId = (r.ok ? r.persona?.id : null) ?? (await defaultPersona(deps, scope.channels));
  }
  const c = await resolveCampaign(deps, p.campagne);
  const campaignId = c.ok ? c.id : null;
  // Mode qui s'appliquera : « pour de faux » sur un vrai canal = dérogation de test (publication sur le canal Test avec
  // l'en-tête habituel, le plan de base du canal continue).
  const mode = orderModeOf(p, ctx);
  const simulated = mode !== "real";
  const realChannels = scope.channels.filter((c) => !c.isTest);
  // Lecture seule (`loadTeamSettings` créerait la ligne de l'équipe si elle manquait).
  const row = (await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: T } })) as { simulation?: boolean; autonomyLevel?: number } | null;
  const settings = { simulation: row?.simulation !== false, autonomyLevel: Number(row?.autonomyLevel ?? 0) };
  if (realChannels.length && !simulated && settings.simulation) clamped.push(`l'équipe ${TEAM_LABELS[T]} est en simulation : les posts iront sur le canal Test tant qu'elle n'est pas passée en vrai`);
  if (realChannels.length && simulated) clamped.push(`pour de faux : les posts partent sur le canal Test, ${channelsLabel(realChannels)} garde son plan habituel`);
  if (realChannels.length && !simulated && settings.autonomyLevel === 0) clamped.push("niveau 0 : chaque post attend ta validation avant de partir");
  const overrides: NonNullable<OrderStep["overrides"]> = [];
  let photos = 0;
  for (const ch of scope.channels) {
    let mix: Mix | null = wanted;
    const format: string | null = p.format ? FORMAT_OF[p.format]! : null;
    if (mix && !p.format && !ch.isTest) {
      const base = effectiveMix(T, (await currentChannelPlan(deps, ch.id)).plan.mix);
      const m = clampMix(mix, base, bounds.maxMixShiftPoints);
      if (m.note) clamped.push(`${ch.title} : ${m.note}`);
      mix = m.mix;
    }
    let windowStart: string | null = p.fenetre_debut ?? null;
    let windowEnd: string | null = p.fenetre_fin ?? null;
    if (windowStart && windowEnd) {
      const w = clampWindow(windowStart, windowEnd, windowAllowedFor(bounds, ch.id));
      if (w.note) clamped.push(`${ch.title} : ${w.note}`);
      windowStart = w.start;
      windowEnd = w.end;
    }
    if (format === null && !mix && ch.isTest) mix = { ...team.defaultMix };
    const m = mix ?? team.defaultMix;
    const total = per.value * period.days;
    photos += format === "photo" ? total : format ? 0 : Math.round(total * share(m, "photo"));
    overrides.push({
      channelId: ch.id,
      teamKey: T,
      fromDay: period.start,
      toDay: period.toDay,
      postsPerDay: per.value,
      themes: themes.length ? themes : null,
      mix: format ? null : mix,
      format,
      windowStart,
      windowEnd,
      personaId,
      isTest: ch.isTest || simulated,
    });
  }
  // Rencontres : photos générées (estimation) ; Casino : médias du client, aucune dépense.
  const costCents = T === "dating" ? photos * PHOTO_ESTIMATE_CENTS : 0;
  const what = p.format ? ({ video: "vidéos", photo: "photos", texte: "textes" } as const)[p.format] : "posts";
  return [
    {
      stepKey: `programmer_posts:${scope.channels.map((x) => x.id).join(",")}`,
      capability: "programmer_posts",
      teamKey: T,
      summary: `${per.value} ${what} par jour sur ${channelsLabel(scope.channels)}, ${frRange(period.start, period.toDay)}${themes.length ? ` (thèmes : ${themes.join(", ")})` : ""}${simulated ? ", pour de faux" : ", en vrai"}`,
      overrides,
      touches: touchesOf(scope.channels),
      clamped,
      costCents,
      params: { campaignId, personaId, perDay: per.value, fromDay: period.start, toDay: period.toDay, mode, themes },
    },
  ];
}

// ------------------------------------------------------------------------------------------------ post_unique

type OnePostP = { format?: "video" | "photo" | "texte"; persona?: string };

export function postUnique(team: PostsTeam): Capability<OnePostP> {
  const T = team.teamKey;
  return defineCapability<OnePostP>({
    teamKey: T,
    key: "post_unique",
    description: `Produire un seul post de test ${TEAM_LABELS[T]} tout de suite sur le canal Test (${allowsVideo(T) ? "vidéo, photo ou texte" : "photo ou texte"})`,
    agents: team.agents,
    spec: {
      format: { kind: "enum", description: formatLabel(T), values: formatValues(T), optional: true },
      ...(team.usesPersona ? { persona: { kind: "string" as const, description: "Prénom de la persona (facultatif)", optional: true, maxLength: 60 } } : {}),
    },
    limits: { maxDays: 1, maxPerDay: 1, channels: "test", modes: ["simulation"] },
    async check(deps, p) {
      const test = await deps.prisma.channel.findFirst({ where: { isTest: true, isActive: true }, select: { id: true } });
      if (!test) return refuse("Il n'y a pas de canal Test : coche « canal de test » sur un canal (page Canaux).", []);
      if (team.usesPersona && p.persona) {
        const r = await resolvePersonaParam(deps, p.persona);
        if (!r.ok) {
          const refs = r.list.length ? r.list : (await personaRefs(deps)).filter((x) => x.isActive);
          return refuse(`Je ne trouve pas la persona « ${p.persona} ».`, [
            ...refs.slice(0, 3).map((x) => alt(`avec ${x.name}`, T, "post_unique", { ...p, persona: x.name })),
            alt("un post texte sans persona", T, "post_unique", { format: "texte" }),
          ]);
        }
      }
      return ok();
    },
    async plan(_deps, p) {
      return [{ stepKey: "post_unique", capability: "post_unique", teamKey: T, summary: `un post de test${p.format ? ` (${p.format})` : ""} sur le canal Test, pour de faux`, touches: { channelIds: [], testOnly: true }, params: { format: p.format ?? null, persona: p.persona ?? null }, costCents: T === "dating" && p.format === "photo" ? PHOTO_ESTIMATE_CENTS : 0 }];
    },
    async run(deps, order, step) {
      const already = await stepMission(deps, order.id, step.stepKey);
      if (already) return done("Post de test déjà lancé.", { missionIds: [already] });
      let personaId: string | null = null;
      if (typeof step.params.persona === "string") {
        const r = await resolvePersonaParam(deps, step.params.persona);
        personaId = r.ok ? (r.persona?.id ?? null) : null;
      }
      const format = typeof step.params.format === "string" ? FORMAT_OF[step.params.format] : undefined;
      const r = await createTestPostMission(deps, { teamKey: T, byUserId: order.createdById, ...(format ? { format } : {}), personaId });
      if (!r.ok) return failed(r.reason);
      await attachMission(deps, r.missionId, order, step.stepKey);
      return done("Post de test lancé sur le canal Test.", { missionIds: [r.missionId] });
    },
    async report(deps, order) {
      return missionsReport(deps, order);
    },
  });
}

// ------------------------------------------------------------------------------------------------ changer_plan

/** Changements demandés pour le plan d'un canal (seules les valeurs dites ; le reste est relu au moment d'écrire). */
type PlanChanges = {
  enabled?: boolean;
  postsPerDay?: number;
  mix?: Mix;
  window?: { start: string; end: string };
  personaId?: string;
  campaignId?: string | null;
  themes?: ChannelPlanData["themes"];
};

type PlanChangeP = {
  canal: string;
  actif?: boolean;
  posts_par_jour?: number;
  video?: number;
  photo?: number;
  texte?: number;
  persona?: string;
  campagne?: string;
  themes?: string[];
  fenetre_debut?: string;
  fenetre_fin?: string;
};

export function changePlan(team: PostsTeam): Capability<PlanChangeP> {
  const T = team.teamKey;
  const replay = (p: PlanChangeP) => ({ teamKey: T, key: "changer_plan", params: p as Record<string, unknown> });
  async function channelOf(deps: AgentsDeps, p: PlanChangeP) {
    return resolveScope(deps, { canaux: [p.canal] }, T, replay(p));
  }
  return defineCapability<PlanChangeP>({
    teamKey: T,
    key: "changer_plan",
    description: `Changer durablement le plan d'un canal ${TEAM_LABELS[T]} : activer, posts par jour, mélange, ${team.usesPersona ? "persona, " : "thèmes, "}bouton d'offre, fenêtre horaire`,
    agents: ["planification", "mediatheque"],
    spec: {
      canal: { kind: "string", description: "Titre du canal", maxLength: 80 },
      actif: { kind: "bool", description: "true = agents activés sur le canal", optional: true },
      posts_par_jour: { kind: "int", description: "Posts par jour", min: 0, max: 500, optional: true },
      ...(allowsVideo(T) ? { video: { kind: "int" as const, description: "Part de vidéos", min: 0, max: 100, optional: true } } : {}),
      photo: { kind: "int", description: "Part de photos", min: 0, max: 100, optional: true },
      texte: { kind: "int", description: "Part de textes", min: 0, max: 100, optional: true },
      ...(team.usesPersona ? { persona: { kind: "string" as const, description: "Prénom de la persona", optional: true, maxLength: 60 } } : {}),
      campagne: { kind: "string", description: "Campagne du bouton d'offre", optional: true, maxLength: 80 },
      themes: { kind: "list", description: "Thèmes du canal", optional: true, maxItems: 8 },
      fenetre_debut: F.fenetreDebut,
      fenetre_fin: F.fenetreFin,
    },
    refine: (p) => {
      if ((p.fenetre_debut && !isHhmm(p.fenetre_debut)) || (p.fenetre_fin && !isHhmm(p.fenetre_fin))) return "fenêtre : HH:MM attendu";
      if (!!p.fenetre_debut !== !!p.fenetre_fin) return "fenêtre : début et fin";
      return null;
    },
    limits: { channels: "team", modes: ["simulation", "real"] },
    async check(deps, p) {
      const scope = await channelOf(deps, p);
      if (!scope.ok) return refuse(scope.reason, scope.alternatives.filter((a) => !a.capability?.params.test));
      if (scope.channels.every((c) => c.isTest)) return refuse("Le canal Test n'a pas de plan durable : un ordre « comme si » suffit.", [alt("programmer des posts sur le canal Test", T, "programmer_posts", { test: true, jours: 1 })]);
      if (!allowsVideo(T) && (p.video ?? 0) > 0) return refuse("L'équipe Rencontres ne fait plus de vidéos : photos ou textes seulement.", [alt("sans part de vidéos", T, "changer_plan", { ...p, video: undefined })]);
      if (team.usesPersona && p.persona) {
        const r = await resolvePersonaParam(deps, p.persona);
        if (!r.ok) return refuse(`Je ne trouve pas la persona « ${p.persona} ».`, (await personaRefs(deps)).slice(0, 3).map((x) => alt(`avec ${x.name}`, T, "changer_plan", { ...p, persona: x.name })));
      }
      if (p.campagne) {
        const c = await resolveCampaign(deps, p.campagne);
        if (!c.ok) return refuse(`Je ne trouve pas la campagne « ${p.campagne} ».`, c.list.slice(0, 3).map((x) => alt(`campagne ${x.name}`, T, "changer_plan", { ...p, campagne: x.name })));
      }
      if (p.themes?.length) {
        const th = await team.themes(deps, { themes: p.themes });
        if (!th.ok) return th.check;
      }
      return ok();
    },
    async plan(deps, p) {
      const scope = await channelOf(deps, p);
      if (!scope.ok) return [];
      const ch = scope.channels[0]!;
      // Aperçu seulement (récapitulatif) : les valeurs écrites sont recalculées au moment de `run`, à partir du plan
      // tel qu'il est alors (rien de figé à la préparation : relecture du 25 octobre).
      const { plan } = await currentChannelPlan(deps, ch.id);
      const bounds = await readAlgoBounds(deps);
      const clamped: string[] = [];
      const changes: PlanChanges = {};
      const after: ChannelPlanData = { ...plan };
      if (p.actif !== undefined) after.enabled = changes.enabled = p.actif;
      if (p.posts_par_jour !== undefined) {
        after.postsPerDay = changes.postsPerDay = Math.min(p.posts_par_jour, bounds.maxPostsPerDay);
        if (after.postsPerDay !== p.posts_par_jour) clamped.push(`${p.posts_par_jour} posts par jour → ${after.postsPerDay}, le maximum du canal`);
      }
      const w = wantedMix(p);
      if (w) {
        changes.mix = w;
        const m = clampMix(w, effectiveMix(T, plan.mix), Math.min(bounds.maxMixShiftPoints, MAX_MIX_POINTS_PER_PROPOSAL));
        if (m.note) clamped.push(m.note.replace(/\(\d+ points au plus par semaine\)/, `(${MAX_MIX_POINTS_PER_PROPOSAL} points au plus d'un coup, ${bounds.maxMixShiftPoints} par semaine)`));
        after.mix = m.mix;
      }
      if (p.fenetre_debut && p.fenetre_fin) {
        changes.window = { start: p.fenetre_debut, end: p.fenetre_fin };
        const win = clampWindow(p.fenetre_debut, p.fenetre_fin, windowAllowedFor(bounds, ch.id));
        if (win.note) clamped.push(win.note);
        after.windowStart = win.start;
        after.windowEnd = win.end;
      }
      if (team.usesPersona && p.persona) {
        const r = await resolvePersonaParam(deps, p.persona);
        if (r.ok && r.persona) after.personaId = changes.personaId = r.persona.id;
      }
      if (p.campagne) {
        const c = await resolveCampaign(deps, p.campagne);
        if (c.ok) after.campaignId = changes.campaignId = c.id;
      }
      if (p.themes?.length) {
        const th = await team.themes(deps, { themes: p.themes });
        if (th.ok) after.themes = changes.themes = T === "casino" ? th.themes.map((theme) => ({ theme, weight: 1 })) : th.themes;
      }
      return [
        {
          stepKey: `changer_plan:${ch.id}`,
          capability: "changer_plan",
          teamKey: T,
          summary: `plan de ${ch.title} : ${after.postsPerDay} posts par jour, ${after.windowStart}-${after.windowEnd}${after.enabled ? "" : ", agents désactivés"}`,
          clamped,
          touches: settingTouches([ch.id], false),
          params: { channelId: ch.id, changes: JSON.parse(JSON.stringify(changes)) },
        },
      ];
    },
    async run(deps, order, step) {
      const channelId = String(step.params.channelId ?? "");
      const changes = (step.params.changes ?? null) as PlanChanges | null;
      if (!channelId || !changes) return failed("Plan manquant.");
      const actor = orderActor(order);
      const messages: string[] = [];
      let applied = 0;
      let refused = 0;
      // 1. Réglages directs (agents activés, persona, campagne, thèmes, arrêt à 0 post) sur le plan tel qu'il est maintenant.
      const direct: Partial<ChannelPlanData> = {};
      if (changes.enabled !== undefined) direct.enabled = changes.enabled;
      if (changes.personaId) direct.personaId = changes.personaId;
      if (changes.campaignId) direct.campaignId = changes.campaignId;
      if (changes.themes) direct.themes = changes.themes;
      if (changes.postsPerDay === 0) direct.postsPerDay = 0;
      const current = await currentChannelPlan(deps, channelId);
      if (Object.keys(direct).length || !current.exists) {
        const before = current.plan;
        const r = await saveChannelPlanFor(deps, T, { ...before, ...direct }, actor);
        if (!r.ok) return failed(r.error);
        await agentAudit(deps, {
          userId: order.createdById,
          action: "agents.order.plan_changed",
          entityType: "ChannelAgentPlan",
          entityId: channelId,
          metadata: { orderId: order.id, before: JSON.parse(JSON.stringify(Object.fromEntries(Object.keys(direct).map((k) => [k, (before as Record<string, unknown>)[k] ?? null])))), after: JSON.parse(JSON.stringify(direct)) },
        });
        messages.push("Plan du canal mis à jour.");
        applied++;
      }
      // 2. Quota, mélange, fenêtre : recommandations appliquées (bornes revérifiées, mélange suivi sur la semaine toutes
      //    sources confondues, annulables en un clic ou par « annule le réglage »).
      const { plan } = await currentChannelPlan(deps, channelId);
      const bounds = await readAlgoBounds(deps);
      const recs: Array<{ field: string; before: unknown; after: unknown }> = [];
      if (typeof changes.postsPerDay === "number" && changes.postsPerDay >= 1) recs.push({ field: "postsPerDay", before: plan.postsPerDay, after: Math.min(changes.postsPerDay, bounds.maxPostsPerDay) });
      if (changes.mix) {
        const base = effectiveMix(T, plan.mix);
        recs.push({ field: "mix", before: plan.mix, after: clampMix(changes.mix, base, Math.min(bounds.maxMixShiftPoints, MAX_MIX_POINTS_PER_PROPOSAL)).mix });
      }
      if (changes.window) {
        const win = clampWindow(changes.window.start, changes.window.end, windowAllowedFor(bounds, channelId));
        recs.push({ field: "window", before: { windowStart: plan.windowStart, windowEnd: plan.windowEnd }, after: { windowStart: win.start, windowEnd: win.end } });
      }
      for (const r of recs) {
        const rec = await proposeRecommendation(deps, {
          teamKey: T,
          target: "CHANNEL_PLAN",
          targetId: channelId,
          field: r.field,
          before: r.before,
          after: r.after,
          evidence: { source: "admin", orderId: order.id },
          expectedGain: "Réglage demandé par l'admin à Kevin.",
          size: "SMALL",
        });
        if (rec.skipped) continue;
        const a = await applyRecommendation(deps, rec.id, actor);
        if (a.ok) applied++;
        else if (!/déjà en place/i.test(a.message)) refused++;
        messages.push(a.message);
      }
      if (!applied && refused) return failed(messages.join(" "));
      return done(messages.join(" ") || "Ce réglage est déjà en place.");
    },
    async report(_deps, order) {
      return { ordre: order.number };
    },
  });
}

/** Rendu commun « question » d'une équipe : lignes + faits. */
export function questionCapability(
  teamKey: PostsTeamKey,
  agents: string[],
  description: string,
  facts: (deps: AgentsDeps) => Promise<{ facts: Record<string, unknown>; lines: string[] }>,
): Capability<{ sujet?: string }> {
  return defineCapability<{ sujet?: string }>({
    teamKey,
    key: "question",
    description,
    agents,
    spec: { sujet: { kind: "string", description: "La question telle que posée", optional: true, maxLength: 200 } },
    limits: { modes: ["simulation", "real"] },
    async check() {
      return ok();
    },
    async plan(_deps, p) {
      return [{ stepKey: "question", capability: "question", teamKey, summary: `question à l'équipe ${TEAM_LABELS[teamKey]}`, touches: readOnly(), params: { sujet: p.sujet ?? null } }];
    },
    async run(deps) {
      return done((await facts(deps)).lines.join("\n"));
    },
    async report(deps) {
      return (await facts(deps)).facts;
    },
  });
}

/** Faits des missions du jour d'une équipe (statuts, validations en attente). */
export async function teamDayFacts(deps: AgentsDeps, teamKey: string): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const now = nowOf(deps);
  const since = new Date(now.getTime() - 24 * 3600_000);
  const rows = (await deps.prisma.agentMission.findMany({ where: { teamKey, createdAt: { gte: since } }, select: { status: true, lastError: true } })) as Array<{ status: string; lastError: string | null }>;
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  const validations = await deps.prisma.agentValidation.count({ where: { teamKey, status: "PENDING" } });
  const facts = { missions24h: rows.length, faites: by("DONE"), enEchec: by("FAILED"), enAttenteValidation: by("WAITING_VALIDATION"), validationsEnAttente: validations, erreurs: [...new Set(rows.map((r) => r.lastError).filter(Boolean))].slice(0, 3) };
  const lines = [
    `Dernières 24 h : ${rows.length} mission${rows.length > 1 ? "s" : ""}, ${facts.faites} faite${facts.faites > 1 ? "s" : ""}, ${facts.enEchec} en échec.`,
    validations ? `${validations} validation${validations > 1 ? "s" : ""} en attente.` : "Aucune validation en attente.",
    facts.erreurs.length ? `Erreurs : ${facts.erreurs.join(" ; ")}` : null,
  ].filter((l): l is string => !!l);
  return { facts, lines };
}

export type { OrderRow, Alternative };
