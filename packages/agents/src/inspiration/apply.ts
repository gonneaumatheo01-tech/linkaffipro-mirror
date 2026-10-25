/**
 * Phase 27, chantier C — application, annulation et bilan des propositions d'inspiration (règle 5).
 * - `applyInspiration` : par `applyRecommendation` (phase 21 : bornes revérifiées, valeur d'avant gardée). Deux cas
 *   propres à l'inspiration : les consignes du canal (`styleNotes`) sont recalculées sur la valeur ACTUELLE (ligne
 *   marquée remplacée, le texte humain gardé) ; le profil de style (`styleProfileId`) est posé ici (même référence, même
 *   univers, jamais un profil d'une autre référence). `AuditLog` `inspiration.applied`, puis une `Experiment` liée :
 *   A/B 14 jours sur le mélange ou l'horaire quand le canal a assez de trafic (2 × l'effectif minimal des tests de
 *   l'équipe Algorithme sur les 14 derniers jours), sinon « avant / après » 14 jours (type `REGLAGE_PERSONA`, jamais
 *   tiré par les missions ; chiffres déposés dans `result.samples`, comme l'agent Conversations) ;
 * - `undoInspiration` : remet les réglages d'origine (`undoRecommendation`), dans l'ordre inverse de l'application ;
 *   possible 30 jours ;
 * - `removeReference` : efface posts et profils, détache les profils des plans, garde les recommandations ;
 * - `inspirationReviews` (passage de nuit de l'équipe Algorithme) : clôt les « avant / après » arrivés à 14 jours, et
 *   pour chaque test clos envoie par Kevin « Depuis l'inspiration de @x : +12 % de vues sur Roulette, je garde ? »
 *   (oui garde, non annule) et l'écrit dans « Ce qui marche » (`InsightReport` `teamKey = "inspiration"`).
 */
import { Prisma } from "@linkaffipro/db";
import { agentAudit, agentEvent, nowOf } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import { applyRecommendation, undoRecommendation } from "../algo/contracts";
import { loadAlgoTeam } from "../algo/settings";
import { parisWeekStart, weekStartDate } from "../algo/week";
import { sameValue } from "../agents/synthese/apply";
import { createExperiment } from "../agents/experimentation";
import { experimentVerdict, verdictSentence, type VariantData } from "../agents/experimentation/verdict";
import { askHuman } from "../human/requests";
import { hhmmToMinutes } from "../rules/time";
import type { AgentsDeps } from "../types";
import { fr } from "./kevin";
import { channelUniverse, loadReferenceRow, referenceLabel } from "./kevin-refs";
import { INSPIRATION_SOURCE, mergeTaggedLine } from "./proposals";
import { INSPIRATION_LIMITS } from "./contract";
import { mixShiftPoints, parseMixValue } from "../agents/synthese/bounds";
import { effectiveMix } from "../algo/mix";

const DAY = 86_400_000;
/** « Annuler » reste possible 30 jours après l'application. */
export const INSPIRATION_UNDO_DAYS = 30;
/** Durée d'un test d'inspiration (A/B ou avant / après). */
export const INSPIRATION_TEST_DAYS = 14;
export const INSPIRATION_REPORT_TEAM = "inspiration";
export const INSPIRATION_KEEP_ACTION = "inspiration-keep";

type RecRow = {
  id: string;
  teamKey: string;
  target: string;
  targetId: string;
  field: string;
  before: unknown;
  after: unknown;
  evidence: unknown;
  status: string;
  appliedAt: Date | null;
  source?: string | null;
  referenceChannelId?: string | null;
};

export type ApplyInspirationResult = {
  ok: boolean;
  message: string;
  applied: string[];
  failed: { id: string; message: string }[];
  experimentId: string | null;
  experimentMode: "ab" | "avant_apres" | null;
};

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function loadRecs(deps: AgentsDeps, ids: readonly string[]): Promise<RecRow[]> {
  const rows = (await deps.prisma.recommendation.findMany({ where: { id: { in: [...ids] } } })) as RecRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is RecRow => !!r);
}

/** Profil de style posé sur le plan du canal (même référence, même univers). */
async function applyStyleProfile(deps: AgentsDeps, rec: RecRow, actor: ActorRef): Promise<{ ok: boolean; message: string }> {
  if (rec.status !== "PROPOSED") return { ok: false, message: rec.status === "APPLIED" ? "Déjà appliquée." : "Cette proposition n'est plus proposée." };
  const profileId = typeof rec.after === "string" ? rec.after : null;
  const profile = profileId ? ((await deps.prisma.styleProfile.findUnique({ where: { id: profileId } })) as { id: string; referenceChannelId: string; universe: string } | null) : null;
  if (!profile || profile.referenceChannelId !== rec.referenceChannelId) return { ok: false, message: "Ce profil de style n'existe plus." };
  const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: rec.targetId } })) as { styleProfileId?: string | null } | null;
  if (!plan) return { ok: false, message: "La cible de ce réglage n'existe plus." };
  const ch = await channelUniverse(deps, rec.targetId);
  // Canal Test : pas d'univers par nature, il prend celui du profil (choisi à la demande d'inspiration).
  const universe = ch?.universe ?? (ch?.isTest ? profile.universe || null : null);
  if (!universe || (profile.universe && profile.universe !== universe)) return { ok: false, message: "Ce profil n'est pas du même univers que le canal." };
  const before = plan.styleProfileId ?? null;
  if (before === profile.id) {
    await deps.prisma.recommendation.update({ where: { id: rec.id }, data: { status: "REJECTED", rejectedAt: nowOf(deps) } });
    return { ok: false, message: "Ce profil est déjà en place." };
  }
  await deps.prisma.channelAgentPlan.update({ where: { channelId: rec.targetId }, data: { styleProfileId: profile.id } });
  await deps.prisma.recommendation.update({
    where: { id: rec.id },
    data: { status: "APPLIED", appliedAt: nowOf(deps), appliedBy: "HUMAN", appliedById: actor.userId ?? null, before: before === null ? Prisma.DbNull : before, after: profile.id },
  });
  await agentEvent(deps, "agents.algo.recommendation_applied", { recommendationId: rec.id, target: rec.target, targetId: rec.targetId, field: rec.field, by: "HUMAN" });
  return { ok: true, message: "Réglage appliqué." };
}

/** Une recommandation : recalcul des consignes marquées sur la valeur actuelle, puis application bornée. */
async function applyOne(deps: AgentsDeps, rec: RecRow, actor: ActorRef): Promise<{ ok: boolean; message: string }> {
  if (rec.source !== INSPIRATION_SOURCE) return { ok: false, message: "Ce n'est pas une proposition d'inspiration." };
  if (rec.field === "styleProfileId") return applyStyleProfile(deps, rec, actor);
  if (rec.field === "styleNotes" && rec.status === "PROPOSED") {
    const ev = record(rec.evidence);
    const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: rec.targetId } })) as { styleNotes: string | null } | null;
    if (plan && typeof ev.tag === "string" && typeof ev.line === "string") {
      const after = mergeTaggedLine(plan.styleNotes, ev.tag, ev.line);
      await deps.prisma.recommendation.update({ where: { id: rec.id }, data: { after: json(after) ?? "" } });
    }
  }
  if (rec.field === "mix" && rec.status === "PROPOSED") {
    // Borne propre à l'inspiration, en plus de celle de l'équipe : 20 points par semaine au plus.
    const refusal = await weeklyMixRefusal(deps, rec);
    if (refusal) return { ok: false, message: refusal };
  }
  return applyRecommendation(deps, rec.id, actor);
}

/** Le mélange proposé dépasserait-il 20 points depuis le début de la semaine ? Rend la raison, ou null. */
async function weeklyMixRefusal(deps: AgentsDeps, rec: RecRow): Promise<string | null> {
  const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: rec.targetId } })) as { teamKey: string; mix: unknown } | null;
  const after = parseMixValue(rec.after);
  if (!plan || !after) return null;
  const first = (await deps.prisma.recommendation.findFirst({
    where: { target: "CHANNEL_PLAN", targetId: rec.targetId, field: "mix", status: "APPLIED", appliedAt: { gte: weekStartDate(nowOf(deps)) } },
    orderBy: { appliedAt: "asc" },
  })) as { before: unknown } | null;
  const base = effectiveMix(plan.teamKey, first ? first.before : plan.mix);
  const shift = mixShiftPoints(base, after);
  return shift > INSPIRATION_LIMITS.maxMixShiftPerWeek + 0.5
    ? `Le mélange bougerait de ${Math.round(shift)} points cette semaine (${INSPIRATION_LIMITS.maxMixShiftPerWeek} au plus pour une inspiration).`
    : null;
}

/** Le canal a-t-il assez de trafic pour un A/B de 14 jours (règle de l'équipe Algorithme : effectif minimal par variante) ? */
export async function enoughTrafficForAb(deps: AgentsDeps, channelId: string): Promise<boolean> {
  const { settings } = await loadAlgoTeam(deps.prisma);
  const since = new Date(nowOf(deps).getTime() - INSPIRATION_TEST_DAYS * DAY);
  const posts = await deps.prisma.postInsight.count({ where: { channelId, sentAt: { gte: since } } });
  return posts >= 2 * settings.experimentMinSamples;
}

function middleHour(w: unknown): number | null {
  const r = record(w);
  const a = typeof r.windowStart === "string" ? hhmmToMinutes(r.windowStart) : null;
  const b = typeof r.windowEnd === "string" ? hhmmToMinutes(r.windowEnd) : null;
  if (a === null || b === null) return null;
  return Math.min(23, Math.floor((a + b) / 2 / 60));
}

/** Test lié à une application (A/B si possible, sinon avant / après). */
async function linkExperiment(deps: AgentsDeps, recs: RecRow[], refLabel: string, channelTitle: string): Promise<{ id: string | null; mode: "ab" | "avant_apres" | null }> {
  const first = recs[0];
  if (!first) return { id: null, mode: null };
  const channelId = first.targetId;
  const inspiration = { referenceChannelId: first.referenceChannelId ?? null, recommendationIds: recs.map((r) => r.id), appliedAt: nowOf(deps).toISOString(), reported: false };
  if (await enoughTrafficForAb(deps, channelId)) {
    const mixes = recs.filter((r) => r.field === "mix");
    const win = recs.find((r) => r.field === "window");
    let made: { ok: boolean; id?: string } | null = null;
    let mode: "ab" | null = null;
    if (mixes.length) {
      made = await createExperiment(deps, {
        teamKey: first.teamKey,
        channelId,
        kind: "MELANGE",
        hypothesis: `Le mélange inspiré de ${refLabel} fait plus cliquer sur ${channelTitle}.`,
        variants: { A: { label: "mélange d'avant", mix: record(mixes[0]!.before) as never }, B: { label: `inspiré de ${refLabel}`, mix: record(mixes.at(-1)!.after) as never } },
        metric: "offer_ctr",
        start: true,
      });
    } else if (win) {
      const a = middleHour(win.before);
      const b = middleHour(win.after);
      if (a !== null && b !== null && a !== b)
        made = await createExperiment(deps, {
          teamKey: first.teamKey,
          channelId,
          kind: "HORAIRE",
          hypothesis: `Publier vers ${b} h (heures de ${refLabel}) donne plus de vues qu'à ${a} h sur ${channelTitle}.`,
          variants: { A: { label: `${a} h`, hour: a }, B: { label: `${b} h (inspiration)`, hour: b } },
          metric: "views24h",
          start: true,
        });
    }
    if (made?.ok && made.id) {
      mode = "ab";
      await deps.prisma.experiment.update({ where: { id: made.id }, data: { recommendationId: first.id, result: json({ inspiration: { ...inspiration, mode } }) } });
      return { id: made.id, mode };
    }
  }
  const now = nowOf(deps);
  const { settings } = await loadAlgoTeam(deps.prisma);
  const row = await deps.prisma.experiment.create({
    data: {
      teamKey: first.teamKey,
      channelId,
      personaId: null,
      kind: "REGLAGE_PERSONA",
      hypothesis: `Inspiration de ${refLabel} sur ${channelTitle} : vues à 24 h avant / après (${INSPIRATION_TEST_DAYS} jours).`,
      variants: json({ A: { label: "avant" }, B: { label: `inspiré de ${refLabel}` } }),
      metric: "views24h",
      minSamples: settings.experimentMinSamples,
      status: "RUNNING",
      startedAt: now,
      endsAt: new Date(now.getTime() + INSPIRATION_TEST_DAYS * DAY),
      recommendationId: first.id,
      result: json({ inspiration: { ...inspiration, mode: "avant_apres" } }),
    },
  });
  await agentEvent(deps, "agents.algo.experiment_created", { experimentId: row.id, kind: "REGLAGE_PERSONA", started: true, inspiration: true }, { channelId });
  return { id: row.id, mode: "avant_apres" };
}

/**
 * Applique des propositions d'inspiration (dans l'ordre donné ; le mélange en deux pas passe dans l'ordre). Un échec
 * (borne, réglage déjà en place) n'arrête pas les autres. Journalisé ; une `Experiment` suit ce qui est appliqué.
 */
export async function applyInspiration(deps: AgentsDeps, recommendationIds: readonly string[], actor: ActorRef): Promise<ApplyInspirationResult> {
  const recs = await loadRecs(deps, recommendationIds);
  const applied: RecRow[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const rec of recs) {
    const r = await applyOne(deps, rec, actor);
    if (r.ok) applied.push(rec);
    else failed.push({ id: rec.id, message: r.message });
  }
  for (const id of recommendationIds) if (!recs.some((r) => r.id === id)) failed.push({ id, message: "Proposition introuvable." });
  if (!applied.length) return { ok: false, message: failed[0]?.message ?? "Rien à appliquer.", applied: [], failed, experimentId: null, experimentMode: null };
  const ref = applied[0]!.referenceChannelId ? await loadReferenceRow(deps, applied[0]!.referenceChannelId) : null;
  const refLabel = ref ? referenceLabel(ref) : "la référence";
  const byChannel = new Map<string, RecRow[]>();
  for (const r of applied) byChannel.set(r.targetId, [...(byChannel.get(r.targetId) ?? []), r]);
  let experimentId: string | null = null;
  let experimentMode: ApplyInspirationResult["experimentMode"] = null;
  for (const [channelId, list] of byChannel) {
    const ch = (await deps.prisma.channel.findUnique({ where: { id: channelId } })) as { title: string } | null;
    const e = await linkExperiment(deps, list, refLabel, ch?.title ?? "ce canal");
    experimentId ??= e.id;
    experimentMode ??= e.mode;
    await agentAudit(deps, {
      userId: actor.userId ?? null,
      action: "inspiration.applied",
      entityType: "ReferenceChannel",
      entityId: list[0]!.referenceChannelId ?? channelId,
      metadata: { via: actor.via, channelId, recommendationIds: list.map((r) => r.id), fields: list.map((r) => r.field), experimentId: e.id, experimentMode: e.mode },
    });
  }
  await agentEvent(deps, "agents.inspiration.applied", { recommendationIds: applied.map((r) => r.id), experimentId, experimentMode });
  return {
    ok: true,
    message: `${applied.length} réglage${applied.length > 1 ? "s" : ""} appliqué${applied.length > 1 ? "s" : ""}${failed.length ? `, ${failed.length} refusé${failed.length > 1 ? "s" : ""}` : ""}.`,
    applied: applied.map((r) => r.id),
    failed,
    experimentId,
    experimentMode,
  };
}

// ------------------------------------------------------------------------------------------------ annulation

export type UndoInspirationResult = { ok: boolean; message: string; undone: string[]; failed: { id: string; message: string }[] };

/** Annule une recommandation d'inspiration appliquée (consignes marquées : seule la ligne est retirée si le texte a bougé). */
async function undoOne(deps: AgentsDeps, rec: RecRow, actor: ActorRef): Promise<{ ok: boolean; message: string }> {
  if (rec.status !== "APPLIED") return { ok: false, message: "Seul un réglage appliqué peut être annulé." };
  if (rec.appliedAt && nowOf(deps).getTime() - new Date(rec.appliedAt).getTime() > INSPIRATION_UNDO_DAYS * DAY)
    return { ok: false, message: `Appliqué il y a plus de ${INSPIRATION_UNDO_DAYS} jours : je ne l'annule plus (modifie-le à la main).` };
  const finish = async () => {
    await deps.prisma.recommendation.update({ where: { id: rec.id }, data: { status: "UNDONE", undoneAt: nowOf(deps), undoneById: actor.userId ?? null } });
    await agentEvent(deps, "agents.algo.recommendation_undone", { recommendationId: rec.id, target: rec.target, targetId: rec.targetId, field: rec.field });
    await agentAudit(deps, { userId: actor.userId ?? null, action: "agents.algo.recommendation_undone", entityType: "Recommendation", entityId: rec.id, metadata: { via: actor.via, field: rec.field } });
    return { ok: true, message: "Réglage annulé : la valeur d'avant est remise." };
  };
  if (rec.field === "styleProfileId") {
    const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: rec.targetId } })) as { styleProfileId?: string | null } | null;
    if (!plan) return { ok: false, message: "La cible de ce réglage n'existe plus." };
    if ((plan.styleProfileId ?? null) !== rec.after) return { ok: false, message: "Le profil de style a été changé depuis : je ne l'écrase pas." };
    await deps.prisma.channelAgentPlan.update({ where: { channelId: rec.targetId }, data: { styleProfileId: typeof rec.before === "string" ? rec.before : null } });
    return finish();
  }
  if (rec.field === "styleNotes") {
    const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: rec.targetId } })) as { styleNotes: string | null } | null;
    const tag = record(rec.evidence).tag;
    if (plan && typeof tag === "string" && !sameValue(plan.styleNotes, rec.after)) {
      // Le texte a bougé depuis (autre consigne ajoutée) : seule la ligne de cette proposition est retirée.
      await deps.prisma.channelAgentPlan.update({ where: { channelId: rec.targetId }, data: { styleNotes: mergeTaggedLine(plan.styleNotes, tag, null) } });
      return finish();
    }
  }
  return undoRecommendation(deps, rec.id, actor);
}

/**
 * « Kevin, annule l'inspiration » : toutes les propositions appliquées d'une référence (identifiant de référence), ou
 * celles données (identifiants de recommandations). Ordre inverse de l'application.
 */
export async function undoInspiration(deps: AgentsDeps, target: string | readonly string[], actor: ActorRef): Promise<UndoInspirationResult> {
  const recs =
    typeof target === "string"
      ? ((await deps.prisma.recommendation.findMany({ where: { source: INSPIRATION_SOURCE, referenceChannelId: target, status: "APPLIED" } })) as RecRow[])
      : (await loadRecs(deps, target)).filter((r) => r.source === INSPIRATION_SOURCE);
  if (!recs.length) return { ok: false, message: "Aucun réglage d'inspiration appliqué à annuler.", undone: [], failed: [] };
  recs.sort((a, b) => (b.appliedAt?.getTime() ?? 0) - (a.appliedAt?.getTime() ?? 0) || recs.indexOf(b) - recs.indexOf(a));
  const undone: string[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const rec of recs) {
    const r = await undoOne(deps, rec, actor);
    if (r.ok) undone.push(rec.id);
    else failed.push({ id: rec.id, message: r.message });
  }
  // Tests liés : arrêtés (plus rien à mesurer).
  if (undone.length) {
    const exps = (await deps.prisma.experiment.findMany({ where: { status: { in: ["PROPOSED", "RUNNING"] } } })) as { id: string; result: unknown }[];
    for (const e of exps) {
      const ids = record(record(e.result).inspiration).recommendationIds;
      if (Array.isArray(ids) && ids.some((id) => undone.includes(id as string)))
        await deps.prisma.experiment.update({ where: { id: e.id }, data: { status: "CANCELLED", closedAt: nowOf(deps) } });
    }
    await agentAudit(deps, { userId: actor.userId ?? null, action: "inspiration.undone", entityType: "Recommendation", entityId: undone[0]!, metadata: { via: actor.via, recommendationIds: undone } });
  }
  return {
    ok: undone.length > 0,
    message: undone.length
      ? `${undone.length} réglage${undone.length > 1 ? "s" : ""} remis comme avant${failed.length ? ` ; ${failed.length} non annulé${failed.length > 1 ? "s" : ""} : ${failed[0]!.message}` : ""}.`
      : (failed[0]?.message ?? "Rien à annuler."),
    undone,
    failed,
  };
}

// ------------------------------------------------------------------------------------------------ retrait

/** Retire une référence : posts lus et profils effacés, profils détachés des plans, recommandations gardées (historique). */
export async function removeReference(deps: AgentsDeps, id: string, actor: ActorRef): Promise<{ ok: boolean; message: string }> {
  const ref = await loadReferenceRow(deps, id);
  if (!ref) return { ok: false, message: "Ce canal d'inspiration n'existe pas (ou est déjà retiré)." };
  const profiles = (await deps.prisma.styleProfile.findMany({ where: { referenceChannelId: id } })) as { id: string }[];
  const profileIds = profiles.map((p) => p.id);
  const detached = profileIds.length
    ? await deps.prisma.channelAgentPlan.updateMany({ where: { styleProfileId: { in: profileIds } }, data: { styleProfileId: null } })
    : { count: 0 };
  const posts = await deps.prisma.referencePost.deleteMany({ where: { referenceChannelId: id } });
  await deps.prisma.styleProfile.deleteMany({ where: { referenceChannelId: id } });
  await deps.prisma.recommendation.updateMany({ where: { source: INSPIRATION_SOURCE, referenceChannelId: id, status: "PROPOSED" }, data: { status: "REJECTED", rejectedAt: nowOf(deps) } });
  // Profil effacé et détaché : la proposition de style appliquée n'a plus rien à annuler (close comme annulée).
  await deps.prisma.recommendation.updateMany({
    where: { source: INSPIRATION_SOURCE, referenceChannelId: id, status: "APPLIED", field: "styleProfileId" },
    data: { status: "UNDONE", undoneAt: nowOf(deps), undoneById: actor.userId ?? null },
  });
  await deps.prisma.referenceChannel.update({ where: { id }, data: { removedAt: nowOf(deps), postCount: 0, targetChannelIds: [], nextReadAt: null } });
  await agentAudit(deps, { userId: actor.userId ?? null, action: "inspiration.reference_removed", entityType: "ReferenceChannel", entityId: id, metadata: { via: actor.via, posts: posts.count, profiles: profileIds.length, detached: detached.count } });
  await agentEvent(deps, "agents.inspiration.reference_removed", { referenceChannelId: id, posts: posts.count });
  return { ok: true, message: `${referenceLabel(ref)} retiré : ${posts.count} post${posts.count > 1 ? "s" : ""} lu${posts.count > 1 ? "s" : ""} et son profil de style effacés.` };
}

// ------------------------------------------------------------------------------------------------ bilan à 14 jours

type ExpRow = { id: string; channelId: string | null; status: string; metric: string; minSamples: number; endsAt: Date | null; startedAt: Date | null; result: unknown; winner: string | null };

async function viewsIn(deps: AgentsDeps, channelId: string, from: Date, to: Date): Promise<number[]> {
  const rows = (await deps.prisma.postInsight.findMany({ where: { channelId, sentAt: { gte: from, lt: to } } })) as { views24h: number | null }[];
  return rows.map((r) => r.views24h).filter((v): v is number => typeof v === "number");
}

/** Variation en % de B par rapport à A (pur), ou null. */
export function changePct(a: number | null, b: number | null): number | null {
  if (a === null || b === null || a <= 0) return null;
  return Math.round(((b - a) / a) * 100);
}

/** Phrase du bilan (pur). */
export function reviewSentence(refLabel: string, channelTitle: string, pct: number | null, enough: boolean): string {
  if (!enough || pct === null) return `Depuis l'inspiration de ${refLabel} sur ${channelTitle} : pas encore assez de posts pour conclure. Je garde ?`;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `Depuis l'inspiration de ${refLabel} : ${sign}${fr(Math.abs(pct))} % de vues sur ${channelTitle}, je garde ?`;
}

/** Passage de nuit (équipe Algorithme) : clôt les « avant / après » dus, puis fait le bilan des tests d'inspiration clos. */
export async function inspirationReviews(deps: AgentsDeps): Promise<{ closed: number; reported: number }> {
  const now = nowOf(deps);
  const { settings } = await loadAlgoTeam(deps.prisma);
  const exps = ((await deps.prisma.experiment.findMany({ where: { status: { in: ["RUNNING", "CLOSED"] } }, take: 500 })) as ExpRow[]).filter(
    (e) => record(record(e.result).inspiration).recommendationIds && record(record(e.result).inspiration).reported !== true,
  );
  let closed = 0;
  let reported = 0;
  for (const e of exps) {
    const insp = record(record(e.result).inspiration);
    let result = record(e.result);
    let winner = e.winner;
    if (e.status === "RUNNING") {
      if (insp.mode !== "avant_apres" || !e.endsAt || new Date(e.endsAt).getTime() > now.getTime() || !e.channelId) continue;
      const start = e.startedAt ? new Date(e.startedAt) : new Date(now.getTime() - INSPIRATION_TEST_DAYS * DAY);
      const A: VariantData = { samples: 0, values: await viewsIn(deps, e.channelId, new Date(start.getTime() - INSPIRATION_TEST_DAYS * DAY), start) };
      const B: VariantData = { samples: 0, values: await viewsIn(deps, e.channelId, start, new Date(e.endsAt)) };
      A.samples = A.values!.length;
      B.samples = B.values!.length;
      const v = experimentVerdict("views24h", A, B, { minSamples: e.minSamples || settings.experimentMinSamples, alpha: settings.alpha });
      // Avant / après : « B » est l'après ; le verdict compare deux moyennes (même test que les A/B de vues).
      winner = v.winner ?? "NONE";
      result = { ...result, ...v, samples: { A, B }, sentence: verdictSentence(v, "views24h") };
      await deps.prisma.experiment.update({ where: { id: e.id }, data: { status: "CLOSED", closedAt: now, winner, result: json(result) } });
      closed++;
    }
    const A = record(result.A);
    const B = record(result.B);
    const pct = changePct(typeof A.value === "number" ? A.value : null, typeof B.value === "number" ? B.value : null);
    const enough = result.status === "decided";
    const ref = typeof insp.referenceChannelId === "string" ? await loadReferenceRow(deps, insp.referenceChannelId) : null;
    const ch = e.channelId ? ((await deps.prisma.channel.findUnique({ where: { id: e.channelId } })) as { title: string } | null) : null;
    const refLabel = ref ? referenceLabel(ref) : "la référence";
    const sentence = reviewSentence(refLabel, ch?.title ?? "ce canal", pct, enough);
    const ids = (insp.recommendationIds as unknown[]).filter((x): x is string => typeof x === "string");
    await askHuman(deps, {
      teamKey: "algo",
      kind: "CONFIRM",
      key: `inspiration.keep.${e.id}`,
      question: `${sentence}\nRéponds oui (je garde) ou non (je remets les réglages d'avant), ou « plus tard ».`,
      onAnswer: { action: INSPIRATION_KEEP_ACTION, experimentId: e.id, referenceChannelId: insp.referenceChannelId ?? null, recommendationIds: ids, buttonYes: "Je garde" },
    });
    const weekStart = parisWeekStart(now);
    const prev = (await deps.prisma.insightReport.findUnique({ where: { teamKey_weekStart: { teamKey: INSPIRATION_REPORT_TEAM, weekStart } } })) as { content: string; stats: unknown } | null;
    const line = sentence.replace(/, je garde \?$/, ".").replace(/ Je garde \?$/, "");
    const items = Array.isArray(record(prev?.stats).results) ? (record(prev?.stats).results as unknown[]) : [];
    const stats = { results: [...items, { experimentId: e.id, referenceChannelId: insp.referenceChannelId ?? null, channelId: e.channelId, changePct: pct, enough, mode: insp.mode ?? null, sentence: line }] };
    const content = [prev?.content, line].filter(Boolean).join("\n");
    await deps.prisma.insightReport.upsert({
      where: { teamKey_weekStart: { teamKey: INSPIRATION_REPORT_TEAM, weekStart } },
      create: { teamKey: INSPIRATION_REPORT_TEAM, weekStart, content, stats: json(stats) },
      update: { content, stats: json(stats) },
    });
    await deps.prisma.experiment.update({ where: { id: e.id }, data: { result: json({ ...result, inspiration: { ...insp, reported: true, changePct: pct } }) } });
    await agentEvent(deps, "agents.inspiration.review", { experimentId: e.id, changePct: pct, enough }, { channelId: e.channelId });
    reported++;
  }
  return { closed, reported };
}
