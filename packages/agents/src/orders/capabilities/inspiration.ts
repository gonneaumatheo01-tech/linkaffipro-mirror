/**
 * Capacités de l'équipe Inspiration (phase 27, branchée sur les ordres en phase 33) : analyser un canal qui marche
 * pour un de nos canaux, appliquer / annuler les propositions (bornes de l'équipe Algorithme), question.
 * `analyser_canal` passe par l'entrée existante de Kevin (même chemin, mêmes garde-fous : un lien privé n'est suivi
 * qu'après accord, une lecture à la fois).
 */
import { applyInspiration, undoInspiration } from "../../inspiration/apply";
import { activeReferences, referenceLabel, targetIdsOf, type ReferenceRow } from "../../inspiration/kevin-refs";
import { inspirationProposals } from "../../inspiration/proposals";
import { channelRefs, matchNames } from "../../boss/resolve";
import type { AgentsDeps } from "../../types";
import { alt, defineCapability, done, failed, ok, orderActor, refuse } from "./kit";

const T = "inspiration" as const;
const AGENTS = ["posts", "synthese", "redaction"];

async function findRef(deps: AgentsDeps, raw: string | undefined): Promise<{ ref: ReferenceRow | null; refs: ReferenceRow[] }> {
  const refs = await activeReferences(deps);
  if (!raw) return { ref: refs[0] ?? null, refs };
  const clean = raw.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "").trim();
  const items = refs.map((r) => ({ ...r, id: r.id, name: r.username ?? r.title ?? r.id, extra: [r.title ?? "", r.username ?? ""].filter(Boolean) }));
  const found = matchNames(clean, items);
  return { ref: (found[0] as ReferenceRow | undefined) ?? null, refs };
}

type AnalyseP = { canal: string; canal_cible: string };

export const analyserCanal = defineCapability<AnalyseP>({
  teamKey: T,
  key: "analyser_canal",
  description: "Lire et analyser un canal Telegram qui marche (lien t.me ou @nom) pour qu'un de nos canaux s'en inspire",
  agents: AGENTS,
  spec: {
    canal: { kind: "string", description: "Canal à analyser : lien t.me/…, @nom", maxLength: 200 },
    canal_cible: { kind: "string", description: "Notre canal qui doit s'en inspirer", maxLength: 80 },
  },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    const refs = (await channelRefs(deps)).filter((c) => !c.isTest);
    const found = matchNames(p.canal_cible, refs);
    if (found.length !== 1)
      return refuse(found.length ? `Plusieurs de nos canaux correspondent à « ${p.canal_cible} ».` : `Je ne trouve pas notre canal « ${p.canal_cible} ».`, (found.length ? found : refs).slice(0, 4).map((c) => alt(`pour ${c.name}`, T, "analyser_canal", { ...p, canal_cible: c.name })));
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: `analyser_canal:${p.canal}`, capability: "analyser_canal", teamKey: T, summary: `analyser ${p.canal} pour ${p.canal_cible}`, params: { canal: p.canal, canal_cible: p.canal_cible } }];
  },
  async run(deps, order, step) {
    // Même entrée que la phrase dite à Kevin (import différé : pas de cycle entre le registre et le catalogue).
    const { analyserCanal: action } = await import("../../boss/catalog-inspiration");
    const params = { canal: String(step.params.canal), canal_cible: String(step.params.canal_cible) };
    const parsed = action.parse(params);
    if (!parsed.ok) return failed(parsed.error);
    const r = await action.execute(deps as never, parsed.params, { userId: order.createdById, via: "TELEGRAM" });
    if (r.followUp) await r.followUp();
    return done(r.reply);
  },
  async report(_deps, order) {
    return { ordre: order.number };
  },
});

type ApplyP = { reference?: string; canal_cible?: string; numeros?: string };

function parseNumbers(raw: string | undefined, max: number): number[] {
  if (!raw || /tout|toutes|all/i.test(raw)) return Array.from({ length: max }, (_, i) => i + 1);
  return [...new Set([...raw.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n >= 1 && n <= max))];
}

async function proposalsFor(deps: AgentsDeps, p: ApplyP) {
  const { ref, refs } = await findRef(deps, p.reference);
  if (!ref) return { ok: false as const, refs };
  let channelId = targetIdsOf(ref)[0] ?? null;
  if (p.canal_cible) {
    const found = matchNames(p.canal_cible, (await channelRefs(deps)).filter((c) => !c.isTest));
    channelId = found[0]?.id ?? channelId;
  }
  if (!channelId) return { ok: false as const, refs, ref };
  const r = await inspirationProposals(deps, ref.id, channelId);
  return { ok: true as const, ref, channelId, r };
}

export const appliquerInspiration = defineCapability<ApplyP>({
  teamKey: T,
  key: "appliquer_inspiration",
  description: "Appliquer les propositions d'inspiration d'un canal de référence (numéros ou « tout »), dans les bornes, annulables",
  agents: AGENTS,
  spec: {
    reference: { kind: "string", description: "Canal d'inspiration (@nom ou titre)", optional: true, maxLength: 120 },
    canal_cible: { kind: "string", description: "Notre canal visé (facultatif)", optional: true, maxLength: 80 },
    numeros: { kind: "string", description: "Numéros des propositions (« 1 3 », « tout »)", optional: true, maxLength: 60 },
  },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    const x = await proposalsFor(deps, p);
    if (!x.ok) return refuse(x.refs.length ? "Je ne trouve pas ce canal d'inspiration (ou il n'est rattaché à aucun de nos canaux)." : "Aucun canal d'inspiration pour le moment.", [
      ...x.refs.slice(0, 3).map((r) => alt(`propositions de ${referenceLabel(r)}`, T, "appliquer_inspiration", { ...p, reference: r.username ?? r.title ?? r.id })),
      alt("analyser un canal qui marche", T, "analyser_canal", {}),
    ]);
    if (!x.r.ok) return refuse(x.r.message, [alt("question à l'équipe Inspiration", T, "question", {})]);
    if (!x.r.proposals.length) return refuse("Aucune proposition à appliquer pour l'instant.", [alt("question à l'équipe Inspiration", T, "question", {})]);
    return ok();
  },
  async plan(deps, p) {
    const x = await proposalsFor(deps, p);
    if (!x.ok || !x.r.ok) return [];
    const nums = parseNumbers(p.numeros, x.r.proposals.length);
    const chosen = x.r.proposals.filter((q) => nums.includes(q.number));
    return [{ stepKey: `appliquer_inspiration:${x.ref.id}:${nums.join(",")}`, capability: "appliquer_inspiration", teamKey: T, summary: `appliquer ${chosen.map((q) => q.label).join(" ; ")}`, params: { ids: chosen.flatMap((q) => q.recommendationIds) } }];
  },
  async run(deps, order, step) {
    const r = await applyInspiration(deps, (step.params.ids as string[]) ?? [], orderActor(order));
    return r.applied.length ? done(r.message) : failed(r.message);
  },
  async report(_deps, order) {
    return { ordre: order.number };
  },
});

export const annulerInspiration = defineCapability<{ reference?: string }>({
  teamKey: T,
  key: "annuler_inspiration",
  description: "Annuler l'inspiration : remettre les réglages d'avant pour un canal d'inspiration",
  agents: AGENTS,
  spec: { reference: { kind: "string", description: "Canal d'inspiration (facultatif : le dernier)", optional: true, maxLength: 120 } },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    const applied = await deps.prisma.recommendation.count({ where: { source: "inspiration", status: "APPLIED" } });
    if (!applied) return refuse("Aucun réglage d'inspiration appliqué à annuler.", [alt("question à l'équipe Inspiration", T, "question", {})]);
    if (p.reference && !(await findRef(deps, p.reference)).ref) return refuse(`Je ne trouve pas le canal d'inspiration « ${p.reference} ».`, [alt("annuler la dernière inspiration", T, "annuler_inspiration", {})]);
    return ok();
  },
  async plan(deps, p) {
    let refId: string | null = p.reference ? ((await findRef(deps, p.reference)).ref?.id ?? null) : null;
    if (!refId) refId = ((await deps.prisma.recommendation.findFirst({ where: { source: "inspiration", status: "APPLIED" }, orderBy: { appliedAt: "desc" } })) as { referenceChannelId: string | null } | null)?.referenceChannelId ?? null;
    return refId ? [{ stepKey: `annuler_inspiration:${refId}`, capability: "annuler_inspiration", teamKey: T, summary: "remettre les réglages d'avant l'inspiration", params: { referenceChannelId: refId } }] : [];
  },
  async run(deps, order, step) {
    const r = await undoInspiration(deps, String(step.params.referenceChannelId), orderActor(order));
    return r.ok ? done(r.message) : failed(r.message);
  },
  async report(_deps, order) {
    return { ordre: order.number };
  },
});

async function inspirationFacts(deps: AgentsDeps): Promise<{ facts: Record<string, unknown>; lines: string[] }> {
  const refs = await activeReferences(deps);
  const applied = await deps.prisma.recommendation.count({ where: { source: "inspiration", status: "APPLIED" } });
  const facts = { references: refs.map((r) => ({ nom: referenceLabel(r), etat: r.status, posts: r.postCount, canauxCibles: targetIdsOf(r).length })), reglagesAppliques: applied };
  const lines = refs.length ? [`${refs.length} canal${refs.length > 1 ? "aux" : ""} d'inspiration : ${refs.slice(0, 4).map((r) => `${referenceLabel(r)} (${r.postCount} posts)`).join(", ")}`, `${applied} réglage${applied > 1 ? "s" : ""} d'inspiration appliqué${applied > 1 ? "s" : ""}.`] : ["Aucun canal d'inspiration pour le moment."];
  return { facts, lines };
}

export const questionInspiration = defineCapability<{ sujet?: string }>({
  teamKey: T,
  key: "question",
  description: "Répondre à une question sur l'inspiration (canaux de référence, analyses, réglages appliqués)",
  agents: AGENTS,
  spec: { sujet: { kind: "string", description: "La question telle que posée", optional: true, maxLength: 200 } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "question", capability: "question", teamKey: T, summary: "question à l'équipe Inspiration", params: { sujet: p.sujet ?? null } }];
  },
  async run(deps) {
    return done((await inspirationFacts(deps)).lines.join("\n"));
  },
  async report(deps) {
    return (await inspirationFacts(deps)).facts;
  },
});

export const INSPIRATION_CAPABILITIES = [analyserCanal, appliquerInspiration, annulerInspiration, questionInspiration];
