/**
 * Capacités du Chef Algorithme (phase 33) : appliquer / annuler un réglage proposé (bornes revérifiées par
 * `applyRecommendation`), lancer un test A/B sur un canal, rapport, question. L'équipe ne publie rien.
 */
import { nowOf } from "../../admin/journal";
import { applyRecommendation, undoRecommendation } from "../../algo/contracts";
import { experimentProposals, createExperiment } from "../../agents/experimentation/index";
import type { ExperimentKindName } from "../../agents/experimentation/variants";
import { algoApplied, algoProposed, recommendationLabel, targetNames } from "../../boss/facts";
import { channelRefs, matchNames } from "../../boss/resolve";
import { currentChannelPlan } from "../../control/channel-plan";
import type { AgentsDeps } from "../../types";
import { alt, defineCapability, done, failed, ok, orderActor, readAlgoBounds, refuse } from "./kit";

const T = "algo" as const;
const AGENTS = ["posts", "horaires", "conversations", "experimentation", "synthese"];

type NumP = { numero?: number };

export const appliquerReglage = defineCapability<NumP>({
  teamKey: T,
  key: "appliquer_reglage",
  description: "Appliquer un réglage proposé par l'équipe Algorithme (numéro de la liste de la semaine), dans les bornes",
  agents: ["synthese"],
  spec: { numero: { kind: "int", description: "Numéro du réglage proposé (1 = le premier)", min: 1, max: 20, optional: true } },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    const list = await algoProposed(deps);
    if (!list.length) return refuse("L'équipe Algorithme n'a aucun réglage en attente.", [alt("voir le rapport de l'équipe Algorithme", T, "rapport", {}), alt("lancer un test A/B sur un canal", T, "lancer_test_ab", {})]);
    if ((p.numero ?? 1) > list.length) return refuse(`Il n'y a que ${list.length} réglage${list.length > 1 ? "s" : ""} proposé${list.length > 1 ? "s" : ""}.`, list.slice(0, 4).map((_, i) => alt(`le réglage n°${i + 1}`, T, "appliquer_reglage", { numero: i + 1 })));
    return ok();
  },
  async plan(deps, p) {
    const list = await algoProposed(deps);
    const r = list[(p.numero ?? 1) - 1];
    if (!r) return [];
    const names = await targetNames(deps, list);
    return [{ stepKey: `appliquer_reglage:${r.id}`, capability: "appliquer_reglage", teamKey: T, summary: `appliquer : ${recommendationLabel(r, names, r.targetId)}`, params: { recommendationId: r.id } }];
  },
  async run(deps, order, step) {
    const r = await applyRecommendation(deps, String(step.params.recommendationId), orderActor(order));
    return r.ok || r.message === "Déjà appliquée." ? done(r.message) : failed(r.message);
  },
  async report(_deps, order) {
    return { ordre: order.number };
  },
});

export const annulerReglage = defineCapability<NumP>({
  teamKey: T,
  key: "annuler_reglage",
  description: "Annuler un réglage appliqué (le dernier par défaut) : retour à la valeur d'avant",
  agents: ["synthese"],
  spec: { numero: { kind: "int", description: "Numéro dans la liste des derniers appliqués (absent = le dernier)", min: 1, max: 20, optional: true } },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    const list = await algoApplied(deps);
    if (!list.length) return refuse("Aucun réglage appliqué à annuler.", [alt("voir les réglages proposés", T, "rapport", {})]);
    if ((p.numero ?? 1) > list.length) return refuse(`Il n'y a que ${list.length} réglage${list.length > 1 ? "s" : ""} appliqué${list.length > 1 ? "s" : ""}.`, list.slice(0, 4).map((_, i) => alt(`annuler le n°${i + 1}`, T, "annuler_reglage", { numero: i + 1 })));
    return ok();
  },
  async plan(deps, p) {
    const list = await algoApplied(deps);
    const r = list[(p.numero ?? 1) - 1];
    if (!r) return [];
    const names = await targetNames(deps, list);
    return [{ stepKey: `annuler_reglage:${r.id}`, capability: "annuler_reglage", teamKey: T, summary: `annuler : ${recommendationLabel(r, names, r.targetId)}`, params: { recommendationId: r.id } }];
  },
  async run(deps, order, step) {
    const r = await undoRecommendation(deps, String(step.params.recommendationId), orderActor(order));
    return r.ok ? done(r.message) : failed(r.message);
  },
  async report(_deps, order) {
    return { ordre: order.number };
  },
});

const KINDS: Record<string, ExperimentKindName> = { legende: "STYLE_LEGENDE", horaire: "HORAIRE", melange: "MELANGE" };

type AbP = { canal: string; type?: "legende" | "horaire" | "melange"; jours?: number };

async function channelOf(deps: AgentsDeps, raw: string) {
  const refs = (await channelRefs(deps)).filter((c) => !c.isTest && c.team && c.team !== "algo");
  return { found: matchNames(raw, refs), refs };
}

export const lancerTestAb = defineCapability<AbP>({
  teamKey: T,
  key: "lancer_test_ab",
  description: "Lancer un test A/B sur un canal (style de légende, horaire ou mélange) pendant N jours (7 à 30)",
  agents: ["experimentation"],
  spec: {
    canal: { kind: "string", description: "Titre du canal", maxLength: 80 },
    type: { kind: "enum", description: "legende, horaire ou melange", values: ["legende", "horaire", "melange"], optional: true },
    jours: { kind: "int", description: "Durée du test (7 à 30 jours)", min: 1, max: 365, optional: true },
  },
  limits: { maxDays: 30, modes: ["simulation", "real"] },
  async check(deps, p) {
    const { found, refs } = await channelOf(deps, p.canal);
    if (found.length !== 1) return refuse(found.length ? `Plusieurs canaux correspondent à « ${p.canal} ».` : `Je ne trouve pas le canal « ${p.canal} ».`, (found.length ? found : refs).slice(0, 4).map((c) => alt(`test sur ${c.name}`, T, "lancer_test_ab", { ...p, canal: c.name })));
    const kind = KINDS[p.type ?? "legende"]!;
    const open = await deps.prisma.experiment.findFirst({ where: { channelId: found[0]!.id, kind, status: { in: ["PROPOSED", "RUNNING"] } } });
    if (open) return refuse(`Un test de ce type est déjà ouvert sur ${found[0]!.name}.`, Object.entries(KINDS).filter(([, k]) => k !== kind).map(([t]) => alt(`un test ${t} à la place`, T, "lancer_test_ab", { ...p, type: t })));
    return ok();
  },
  async plan(deps, p) {
    const { found } = await channelOf(deps, p.canal);
    const c = found[0];
    if (!c) return [];
    const days = Math.min(30, Math.max(7, p.jours ?? 14));
    const clamped = p.jours && p.jours !== days ? [`${p.jours} jours → ${days} (un test dure de 7 à 30 jours)`] : [];
    return [{ stepKey: `lancer_test_ab:${c.id}:${p.type ?? "legende"}`, capability: "lancer_test_ab", teamKey: T, summary: `test A/B ${p.type ?? "legende"} sur ${c.name} pendant ${days} jours`, clamped, params: { channelId: c.id, kind: KINDS[p.type ?? "legende"], days } }];
  },
  async run(deps, _order, step) {
    const channelId = String(step.params.channelId);
    const kind = step.params.kind as ExperimentKindName;
    const { team, plan } = await currentChannelPlan(deps, channelId);
    if (!team) return failed("Ce canal n'a pas d'équipe.");
    const settings = await readAlgoBounds(deps);
    const proposal = experimentProposals(
      { channelId, teamKey: team, mix: plan.mix, windowStart: plan.windowStart, windowEnd: plan.windowEnd } as Parameters<typeof experimentProposals>[0],
      { formatsInsufficient: kind === "MELANGE", bestHour: null, settings },
    ).find((x) => x.kind === kind);
    if (!proposal) return failed("Ce test n'est pas possible sur ce canal (fenêtre trop courte ou mélange déjà au plus loin).");
    const existing = await deps.prisma.experiment.findFirst({ where: { channelId, kind, status: "RUNNING" } });
    if (existing) return done("Test déjà en cours.");
    const r = await createExperiment(deps, { ...proposal, start: true });
    if (!r.ok || !r.id) return failed(r.message);
    const now = nowOf(deps);
    await deps.prisma.experiment.update({ where: { id: r.id }, data: { endsAt: new Date(now.getTime() + Number(step.params.days ?? 14) * 86_400_000) } });
    return done(`Test lancé pour ${Number(step.params.days ?? 14)} jours.`);
  },
  async report(_deps, order) {
    return { ordre: order.number };
  },
});

async function algoFacts(deps: AgentsDeps): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const [proposed, applied, running, report] = await Promise.all([
    algoProposed(deps),
    algoApplied(deps),
    deps.prisma.experiment.findMany({ where: { status: "RUNNING" }, select: { hypothesis: true, endsAt: true, channelId: true }, take: 10 }) as Promise<Array<{ hypothesis: string; endsAt: Date | null; channelId: string | null }>>,
    deps.prisma.insightReport.findFirst({ where: { teamKey: T }, orderBy: { createdAt: "desc" }, select: { weekStart: true, stats: true } }) as Promise<{ weekStart: string; stats: unknown } | null>,
  ]);
  const names = await targetNames(deps, [...proposed, ...applied]);
  const facts = {
    reglagesProposes: proposed.map((r) => recommendationLabel(r, names, r.targetId)),
    reglagesAppliques: applied.slice(0, 5).map((r) => recommendationLabel(r, names, r.targetId)),
    testsEnCours: running.map((r) => ({ hypothese: r.hypothesis, fin: r.endsAt?.toISOString() ?? null })),
    dernierRapport: report ? { semaine: report.weekStart, chiffres: report.stats } : null,
  };
  const lines = [
    proposed.length ? `Réglages proposés : ${facts.reglagesProposes.slice(0, 4).map((l, i) => `${i + 1}. ${l}`).join(" · ")}` : "Aucun réglage proposé en attente.",
    applied.length ? `Derniers appliqués : ${facts.reglagesAppliques.slice(0, 3).join(" · ")}` : null,
    running.length ? `Tests A/B en cours : ${running.length}` : "Aucun test A/B en cours.",
    report ? `Dernier rapport : semaine du ${report.weekStart}` : null,
  ].filter((l): l is string => !!l);
  return { facts, lines };
}

function askCap(key: "rapport" | "question", description: string) {
  return defineCapability<{ sujet?: string }>({
    teamKey: T,
    key,
    description,
    agents: AGENTS,
    spec: { sujet: { kind: "string", description: "La question telle que posée", optional: true, maxLength: 200 } },
    limits: { modes: ["simulation", "real"] },
    async check() {
      return ok();
    },
    async plan(_deps, p) {
      return [{ stepKey: key, capability: key, teamKey: T, summary: key === "rapport" ? "rapport de l'équipe Algorithme" : "question à l'équipe Algorithme", params: { sujet: p.sujet ?? null } }];
    },
    async run(deps) {
      return done((await algoFacts(deps)).lines.join("\n"));
    },
    async report(deps) {
      return (await algoFacts(deps)).facts;
    },
  });
}

export const ALGO_CAPABILITIES = [
  appliquerReglage,
  annulerReglage,
  lancerTestAb,
  askCap("rapport", "Rapport de l'équipe Algorithme : réglages proposés et appliqués, tests en cours, dernier rapport"),
  askCap("question", "Répondre à une question sur l'équipe Algorithme (preuves, expériences en cours)"),
];
