/**
 * Agent Expérimentation (équipe Algorithme, sans IA) : tests A/B propres sur les posts des agents.
 * - proposition (le lundi) : pour chaque canal à plan activé, un test de style de légende, d'horaire ou de mélange
 *   quand aucun test de ce type n'est en cours (jamais plus d'un actif par canal et par type) ; lancé tout de suite si
 *   l'équipe Algorithme est au niveau 1 ou 2, sinon laissé « proposé » ;
 * - clôture : à la date de fin, verdict au seuil de 5 % sur les fiches `PostInsight` du test ; pas assez de données →
 *   prolongé une fois, puis clos « pas de différence » ; un gagnant devient une recommandation.
 * Les missions tirent leur variante à leur création (`missions/lifecycle.ts`), Planification, Rédaction et Médiathèque
 * l'appliquent, Publication pose `Post.abGroupId = exp_<id>` et `abVariant`.
 */
import type { AgentDefinition, AgentsDeps } from "../../types";
import type { ActorRef } from "../../admin/team";
import { agentAudit, agentEvent, nowOf } from "../../admin/journal";
import { loadAlgoTeam, type AlgoSettings } from "../../algo/settings";
import { proposeRecommendation, recommendationFromExperiment } from "../synthese/proposals";
import { experimentVerdict, verdictSentence, type VariantData } from "./verdict";
import { parseVariants, shiftMix, type ExperimentKindName, type Mix, type Variants } from "./variants";

const DAY = 86_400_000;
export const OPEN_EXPERIMENT_STATUSES = ["PROPOSED", "RUNNING"] as const;
export const RETEST_AFTER_DAYS = 60;

type ExperimentRow = {
  id: string;
  teamKey: string;
  channelId: string | null;
  personaId: string | null;
  kind: ExperimentKindName;
  hypothesis: string;
  variants: unknown;
  metric: string;
  minSamples: number;
  status: string;
  startedAt: Date | null;
  endsAt: Date | null;
  result: unknown;
};

export type NewExperiment = {
  teamKey: string;
  channelId?: string | null;
  personaId?: string | null;
  kind: ExperimentKindName;
  hypothesis: string;
  variants: Variants;
  metric: string;
  start: boolean;
};

/** Crée un test (refusé si un test du même type est déjà ouvert sur ce canal ou cette persona). */
export async function createExperiment(deps: AgentsDeps, input: NewExperiment): Promise<{ ok: boolean; id?: string; message: string }> {
  const now = nowOf(deps);
  const { settings } = await loadAlgoTeam(deps.prisma);
  const open = await deps.prisma.experiment.findFirst({
    where: {
      kind: input.kind,
      status: { in: [...OPEN_EXPERIMENT_STATUSES] },
      ...(input.channelId ? { channelId: input.channelId } : { personaId: input.personaId ?? null }),
    },
  });
  if (open) return { ok: false, id: open.id, message: "Un test de ce type est déjà ouvert ici." };
  const row = await deps.prisma.experiment.create({
    data: {
      teamKey: input.teamKey,
      channelId: input.channelId ?? null,
      personaId: input.personaId ?? null,
      kind: input.kind,
      hypothesis: input.hypothesis,
      variants: JSON.parse(JSON.stringify(input.variants)),
      metric: input.metric,
      minSamples: settings.experimentMinSamples,
      status: input.start ? "RUNNING" : "PROPOSED",
      startedAt: input.start ? now : null,
      endsAt: input.start ? new Date(now.getTime() + settings.experimentDays * DAY) : null,
    },
  });
  await agentEvent(deps, "agents.algo.experiment_created", { experimentId: row.id, kind: input.kind, started: input.start }, { channelId: input.channelId ?? null });
  return { ok: true, id: row.id, message: input.start ? "Test lancé." : "Test proposé." };
}

/** Lance un test proposé (site ou Grand Chef). */
export async function startExperiment(deps: AgentsDeps, id: string, actor?: ActorRef): Promise<{ ok: boolean; message: string }> {
  const now = nowOf(deps);
  const exp = (await deps.prisma.experiment.findUnique({ where: { id } })) as ExperimentRow | null;
  if (!exp || exp.status !== "PROPOSED") return { ok: false, message: "Ce test n'est pas (ou plus) proposé." };
  const { settings } = await loadAlgoTeam(deps.prisma);
  const running = await deps.prisma.experiment.findFirst({
    where: { kind: exp.kind, status: "RUNNING", ...(exp.channelId ? { channelId: exp.channelId } : { personaId: exp.personaId }) },
  });
  if (running) return { ok: false, message: "Un test de ce type tourne déjà ici." };
  await deps.prisma.experiment.update({
    where: { id },
    data: { status: "RUNNING", startedAt: now, endsAt: new Date(now.getTime() + settings.experimentDays * DAY) },
  });
  await agentEvent(deps, "agents.algo.experiment_started", { experimentId: id, by: actor ? "HUMAN" : "GRAND_CHEF" }, { channelId: exp.channelId });
  if (actor) await agentAudit(deps, { userId: actor.userId ?? null, action: "agents.algo.experiment_started", entityType: "Experiment", entityId: id, metadata: { via: actor.via } });
  return { ok: true, message: "Test lancé." };
}

/** Arrête un test (sans verdict). */
export async function cancelExperiment(deps: AgentsDeps, id: string, actor: ActorRef): Promise<{ ok: boolean; message: string }> {
  const exp = (await deps.prisma.experiment.findUnique({ where: { id } })) as ExperimentRow | null;
  if (!exp || !(OPEN_EXPERIMENT_STATUSES as readonly string[]).includes(exp.status)) return { ok: false, message: "Ce test n'est plus ouvert." };
  await deps.prisma.experiment.update({ where: { id }, data: { status: "CANCELLED", closedAt: nowOf(deps) } });
  await agentEvent(deps, "agents.algo.experiment_cancelled", { experimentId: id }, { channelId: exp.channelId });
  await agentAudit(deps, { userId: actor.userId ?? null, action: "agents.algo.experiment_cancelled", entityType: "Experiment", entityId: id, metadata: { via: actor.via } });
  return { ok: true, message: "Test arrêté." };
}

/** Données des deux variantes d'un test de posts, depuis les fiches. */
export async function experimentData(deps: Pick<AgentsDeps, "prisma">, exp: Pick<ExperimentRow, "id" | "metric" | "result">): Promise<{ A: VariantData; B: VariantData }> {
  // Réglage de persona : chiffres déposés par l'agent Conversations dans `result.samples` (chantier B).
  const pre = (exp.result as { samples?: { A?: VariantData; B?: VariantData } } | null)?.samples;
  if (pre?.A && pre?.B) return { A: pre.A, B: pre.B };
  const rows = (await deps.prisma.postInsight.findMany({ where: { experimentId: exp.id } })) as Array<{
    abVariant: string | null;
    viewsFinal: number;
    views24h: number | null;
    offerClicks: number;
    registrations: number;
  }>;
  const of = (v: "A" | "B"): VariantData => {
    const list = rows.filter((r) => r.abVariant === v);
    const trials = list.reduce((s, r) => s + r.viewsFinal, 0);
    const successes = list.reduce((s, r) => s + (exp.metric === "registrations" ? r.registrations : r.offerClicks), 0);
    if (exp.metric === "views24h") {
      const values = list.map((r) => r.views24h).filter((x): x is number => x !== null);
      return { samples: values.length, values };
    }
    return { samples: list.length, successes, trials };
  };
  return { A: of("A"), B: of("B") };
}

export type ClosedExperiment = { id: string; winner: "A" | "B" | "NONE" | null; extended: boolean; recommendationId: string | null; sentence: string };

/** Clôt les tests arrivés à leur date de fin. */
export async function closeExperiments(deps: AgentsDeps, opts: { force?: boolean } = {}): Promise<ClosedExperiment[]> {
  const now = nowOf(deps);
  const { settings } = await loadAlgoTeam(deps.prisma);
  const due = (await deps.prisma.experiment.findMany({
    where: { status: "RUNNING", ...(opts.force ? {} : { endsAt: { lte: now } }) },
  })) as ExperimentRow[];
  const out: ClosedExperiment[] = [];
  for (const exp of due) {
    const data = await experimentData(deps, exp);
    const v = experimentVerdict(exp.metric, data.A, data.B, { minSamples: exp.minSamples || settings.experimentMinSamples, alpha: settings.alpha });
    const prev = (exp.result && typeof exp.result === "object" ? exp.result : {}) as Record<string, unknown>;
    const sentence = verdictSentence(v, exp.metric);
    if (v.status === "insufficient" && !prev.extended && !opts.force) {
      await deps.prisma.experiment.update({
        where: { id: exp.id },
        data: { endsAt: new Date(now.getTime() + settings.experimentDays * DAY), result: JSON.parse(JSON.stringify({ ...prev, ...v, extended: true })) },
      });
      out.push({ id: exp.id, winner: null, extended: true, recommendationId: null, sentence });
      continue;
    }
    const winner = v.winner ?? "NONE";
    let recommendationId: string | null = null;
    if (winner === "A" || winner === "B") {
      const variants = parseVariants(exp.variants);
      const proposal = variants ? await recommendationFromExperiment(deps, exp, variants, winner, v) : null;
      if (proposal) recommendationId = (await proposeRecommendation(deps, proposal)).id;
    }
    await deps.prisma.experiment.update({
      where: { id: exp.id },
      data: { status: "CLOSED", closedAt: now, winner, recommendationId, result: JSON.parse(JSON.stringify({ ...prev, ...v, sentence })) },
    });
    await agentEvent(deps, "agents.algo.experiment_closed", { experimentId: exp.id, winner, p: v.p, recommendationId }, { channelId: exp.channelId });
    out.push({ id: exp.id, winner, extended: false, recommendationId, sentence });
  }
  return out;
}

type PlanRow = { channelId: string; teamKey: string; mix: unknown; windowStart: string; windowEnd: string };

function mixOf(v: unknown): Mix {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && x > 0 ? x : 0);
  const m = { video: n(r.video), photo: n(r.photo), text: n(r.text) };
  return m.video + m.photo + m.text > 0 ? m : { video: 0, photo: 0, text: 1 };
}

/** Tests proposés pour un canal (pur) : style, horaire (2 heures du plan), mélange quand les formats manquent de données. */
export function experimentProposals(plan: PlanRow, opts: { formatsInsufficient: boolean; bestHour: number | null; settings: AlgoSettings }): Array<Omit<NewExperiment, "start">> {
  const out: Array<Omit<NewExperiment, "start">> = [];
  out.push({
    teamKey: plan.teamKey,
    channelId: plan.channelId,
    kind: "STYLE_LEGENDE",
    hypothesis: "Une légende qui pose une question fait plus cliquer qu'une affirmation.",
    variants: {
      A: { label: "question", style: "Termine la légende par une question courte adressée au lecteur." },
      B: { label: "affirmation", style: "Écris la légende comme une affirmation directe, sans question." },
    },
    metric: "offer_ctr",
  });
  const s = Number(plan.windowStart.slice(0, 2));
  const e = plan.windowEnd === "24:00" ? 24 : Number(plan.windowEnd.slice(0, 2));
  if (Number.isFinite(s) && Number.isFinite(e) && e - s >= 4) {
    const a = opts.bestHour !== null && opts.bestHour >= s && opts.bestHour < e ? opts.bestHour : Math.min(e - 1, s + Math.floor((e - s) / 3));
    const b = a + 2 < e ? a + 2 : Math.max(s, a - 2);
    if (a !== b)
      out.push({
        teamKey: plan.teamKey,
        channelId: plan.channelId,
        kind: "HORAIRE",
        hypothesis: `Publier vers ${a} h donne plus de vues à 24 h que vers ${b} h.`,
        variants: { A: { label: `${a} h`, hour: a }, B: { label: `${b} h`, hour: b } },
        metric: "views24h",
      });
  }
  if (opts.formatsInsufficient) {
    const mix = mixOf(plan.mix);
    const toward = plan.teamKey === "dating" ? "video" : "photo";
    const shifted = shiftMix(mix, toward, opts.settings.maxMixShiftPoints);
    if (JSON.stringify(shifted) !== JSON.stringify(mix))
      out.push({
        teamKey: plan.teamKey,
        channelId: plan.channelId,
        kind: "MELANGE",
        hypothesis: `Plus de ${toward === "video" ? "vidéos" : "photos"} fait plus cliquer.`,
        variants: { A: { label: "mélange actuel", mix }, B: { label: `plus de ${toward === "video" ? "vidéos" : "photos"}`, mix: shifted } },
        metric: "offer_ctr",
      });
  }
  return out;
}

/** Propose (et lance selon le niveau) les tests manquants des canaux à plan activé. */
export async function proposeExperiments(
  deps: AgentsDeps,
  hints: { formatsInsufficient?: ReadonlySet<string>; bestHour?: ReadonlyMap<string, number> } = {},
): Promise<{ created: string[] }> {
  const { settings, level } = await loadAlgoTeam(deps.prisma);
  const plans = (await deps.prisma.channelAgentPlan.findMany({
    where: { enabled: true, teamKey: { in: ["dating", "casino", "sports"] } },
    select: { channelId: true, teamKey: true, mix: true, windowStart: true, windowEnd: true },
  })) as PlanRow[];
  const created: string[] = [];
  for (const plan of plans) {
    for (const p of experimentProposals(plan, {
      formatsInsufficient: hints.formatsInsufficient?.has(plan.channelId) ?? false,
      bestHour: hints.bestHour?.get(plan.channelId) ?? null,
      settings,
    })) {
      // Un test déjà tranché ces 60 derniers jours sur ce canal n'est pas relancé.
      const recent = await deps.prisma.experiment.findFirst({
        where: { channelId: plan.channelId, kind: p.kind, status: "CLOSED", closedAt: { gte: new Date(nowOf(deps).getTime() - RETEST_AFTER_DAYS * DAY) } },
      });
      if (recent) continue;
      const r = await createExperiment(deps, { ...p, start: level >= 1 });
      if (r.ok && r.id) created.push(r.id);
    }
  }
  return { created };
}

/** État des tests (pour le rapport et le Chef). */
export async function experimentsState(deps: Pick<AgentsDeps, "prisma">): Promise<{ running: number; proposed: number }> {
  const [running, proposed] = await Promise.all([
    deps.prisma.experiment.count({ where: { status: "RUNNING" } }),
    deps.prisma.experiment.count({ where: { status: "PROPOSED" } }),
  ]);
  return { running, proposed };
}

export const agent: AgentDefinition = {
  key: "experimentation",
  async run(_mission, ctx) {
    const closed = await closeExperiments(ctx);
    return { ok: true, summary: `${closed.length} test(s) relu(s)` };
  },
};
