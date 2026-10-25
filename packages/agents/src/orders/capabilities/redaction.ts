/**
 * Capacité de l'agent Rédaction, passée par l'équipe Algorithme qui tient les consignes des canaux (phase 33) :
 * « écris plus court sur Roulette » → une ligne dans `ChannelAgentPlan.styleNotes`, posée comme une recommandation
 * appliquée (mêmes bornes, avant / après, annulable en un clic ou par `annuler_reglage`).
 */
import { applyRecommendation, undoRecommendation } from "../../algo/contracts";
import { STYLE_NOTES_MAX } from "../../agents/synthese/bounds";
import { proposeRecommendation } from "../../agents/synthese/proposals";
import { channelRefs, matchNames } from "../../boss/resolve";
import type { AgentsDeps } from "../../types";
import { alt, defineCapability, done, failed, ok, orderActor, refuse, settingTouches } from "./kit";

const T = "transverse" as const;
export const KEVIN_NOTE_TAG = "[Consigne de l'admin]";

type NoteP = { canal: string; consigne?: string; retirer?: boolean };

async function target(deps: AgentsDeps, raw: string) {
  const refs = (await channelRefs(deps)).filter((c) => !c.isTest);
  const found = matchNames(raw, refs);
  const c = found.length === 1 ? found[0]! : (found.find((f) => f.name.toLowerCase() === raw.toLowerCase()) ?? null);
  const plan = c ? ((await deps.prisma.channelAgentPlan.findUnique({ where: { channelId: c.id } })) as { teamKey: string; styleNotes: string | null } | null) : null;
  return { c, plan, found, refs };
}

/** Consignes du canal avec la consigne de l'admin ajoutée (ou retirée), bornées à la taille permise (pur). */
export function notesWith(current: string | null, consigne: string | null): string | null {
  const kept = (current ?? "").split("\n").filter((l) => l.trim() && !l.startsWith(KEVIN_NOTE_TAG));
  const mine = (current ?? "").split("\n").filter((l) => l.startsWith(KEVIN_NOTE_TAG));
  const lines = consigne ? [...kept, ...mine, `${KEVIN_NOTE_TAG} ${consigne.trim()}`] : kept;
  const out = lines.join("\n");
  return out.length > STYLE_NOTES_MAX ? out.slice(out.length - STYLE_NOTES_MAX).replace(/^[^\n]*\n/, "") : out || null;
}

export const consignesCanal = defineCapability<NoteP>({
  teamKey: T,
  key: "consignes_canal",
  description: "Donner une consigne d'écriture à l'agent Rédaction pour un canal (« écris plus court sur Roulette »), annulable",
  agents: ["redaction"],
  spec: {
    canal: { kind: "string", description: "Titre du canal", maxLength: 80 },
    consigne: { kind: "string", description: "La consigne d'écriture, courte (« écris plus court »)", optional: true, maxLength: 200 },
    retirer: { kind: "bool", description: "true = retirer les consignes données par l'admin", optional: true },
  },
  refine: (p) => (!p.consigne && !p.retirer ? "consigne manquante" : null),
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    const { c, plan, found, refs } = await target(deps, p.canal);
    if (!c) return refuse(found.length ? `Plusieurs canaux correspondent à « ${p.canal} ».` : `Je ne trouve pas le canal « ${p.canal} ».`, (found.length ? found : refs).slice(0, 4).map((x) => alt(`sur ${x.name}`, T, "consignes_canal", { ...p, canal: x.name })));
    if (!plan) return refuse(`${c.name} n'a pas encore de plan d'agents : la Rédaction n'y écrit rien.`, c.team && c.team !== "algo" ? [alt(`activer les agents sur ${c.name}`, c.team, "changer_plan", { canal: c.name, actif: true })] : []);
    return ok();
  },
  async plan(deps, p) {
    const { c, plan } = await target(deps, p.canal);
    if (!c || !plan) return [];
    return [
      {
        stepKey: `consignes_canal:${c.id}`,
        capability: "consignes_canal",
        teamKey: T,
        summary: p.retirer ? `retirer tes consignes d'écriture sur ${c.name}` : `consigne d'écriture sur ${c.name} : « ${p.consigne} »`,
        touches: settingTouches([c.id], false),
        // Seulement la consigne : les consignes du canal sont relues au moment d'écrire (rien de figé à la préparation).
        params: { channelId: c.id, teamKey: plan.teamKey, consigne: p.retirer ? null : (p.consigne ?? null), retirer: p.retirer === true },
      },
    ];
  },
  async run(deps, order, step) {
    const channelId = String(step.params.channelId);
    const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId } })) as { teamKey: string; styleNotes: string | null } | null;
    if (!plan) return failed("Ce canal n'a plus de plan d'agents.");
    const consigne = step.params.retirer === true ? null : typeof step.params.consigne === "string" ? step.params.consigne : null;
    const after = notesWith(plan.styleNotes, consigne);
    const rec = await proposeRecommendation(deps, {
      teamKey: plan.teamKey,
      target: "CHANNEL_PLAN",
      targetId: channelId,
      field: "styleNotes",
      before: plan.styleNotes ?? null,
      after: after ?? "",
      evidence: { source: "admin", orderId: order.id },
      expectedGain: "Consigne donnée par l'admin à Kevin.",
      size: "SMALL",
    });
    if (rec.skipped) return done("Cette consigne est déjà en place.");
    const r = await applyRecommendation(deps, rec.id, orderActor(order));
    return r.ok ? done(r.message, { postIds: [] }) : failed(r.message);
  },
  async report(_deps, order) {
    return { ordre: order.number };
  },
});

/** Annule la dernière consigne posée par un ordre (même chemin que « annule le réglage »). */
export async function undoOrderNote(deps: AgentsDeps, recommendationId: string, actor: { userId: string | null; via: "TELEGRAM" }) {
  return undoRecommendation(deps, recommendationId, actor);
}

export const REDACTION_CAPABILITIES = [consignesCanal];
