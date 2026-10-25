/**
 * Phase 33 (chantier B) — la seule porte des demandes libres (règle 1) : outil `ordre_equipe` de l'interprète →
 * planificateur (Opus, cache 24 h, plafond) → validation par le code → récapitulatif → OUI ou lancement. Ne lève
 * jamais : toute panne devient une réponse de Kevin qui dit ce qui bloque.
 */
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import type { BossActor, BossChat, BossDeps, BossSpeaker } from "../boss/contract";
import { readBossPending } from "../boss/confirm";
import type { BossTurnRow } from "../boss/memory";
import { esc } from "../admin/journal";
import { agentHint, agentTargetOf, restrictPlanToAgent } from "./agent-order";
import { planOrder } from "./planner";
import { recordOrderUnmet } from "./unmet";
import { submitOrder, type OrderReply } from "./recap";
import { validatePlan } from "./validate";
import type { TeamOrderRow } from "./current";

export type OrderRequestInput = {
  text: string;
  hints?: { equipe?: string | null; canal?: string | null };
  memory?: readonly BossTurnRow[] | null;
  speaker?: BossSpeaker | null;
  chat?: BossChat | null;
  actor: BossActor;
};

/** Ordres en attente d'un OUI dont la confirmation n'existe plus (NON, expirée, remplacée) → annulés. */
export async function sweepStaleOrderConfirmations(deps: BossDeps): Promise<number> {
  const rows = (await deps.prisma.teamOrder.findMany({ where: { status: "WAITING_CONFIRM" }, take: 50 })) as unknown as TeamOrderRow[];
  if (!rows.length) return 0;
  const pending = await readBossPending(deps);
  const live = pending && !pending.expired ? pending.id : null;
  let n = 0;
  for (const r of rows) {
    if (r.pendingId && r.pendingId === live) continue;
    await deps.prisma.teamOrder.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
    n++;
  }
  return n;
}

/** Textes fixes de ce module (voix de Kevin, `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun. */
export const ORDER_REQUEST_VARIANTS = {
  budget: [
    "J'ai atteint mon plafond d'IA du mois : je ne peux plus monter de nouvelle demande. Les commandes simples marchent toujours, écris aide.",
    "Plafond d'IA du mois atteint, je ne prépare plus de nouvelles demandes. Les commandes simples restent possibles (aide).",
  ],
  noAi: [
    "Sans IA réglée, je ne peux pas monter ce genre de demande. Les commandes simples marchent, écris aide.",
    "Là il me faut l'IA pour préparer ça, et elle n'est pas réglée. Les commandes simples marchent toujours (aide).",
  ],
  invalid: ["Je n'ai pas réussi à monter ça proprement. Tu me le redis autrement ?", "Je me suis emmêlé en préparant ta demande. Tu peux la reformuler ?"],
  agentNoCap: voiceTemplate<{ agent: string; role: string }>([{ agent: "Horaires", role: "choisit les meilleures heures de chaque canal." }], (p) => [
    `L'agent ${p.agent} ne prend pas encore de consigne de ma part : ${p.role} Tu veux que je te dise ce qu'il a fait aujourd'hui ?`,
    `Je ne peux pas encore transmettre de consigne à l'agent ${p.agent}, c'est noté. Tu veux voir ce qu'il fait en ce moment ?`,
  ]),
} satisfies VoiceTable;

export const ORDER_BUDGET_REPLY = ORDER_REQUEST_VARIANTS.budget;
export const ORDER_NO_AI_REPLY = ORDER_REQUEST_VARIANTS.noAi;
export const ORDER_INVALID_REPLY = ORDER_REQUEST_VARIANTS.invalid;

/** Demande libre adressée à une équipe → ordre. */
export async function handleOrderRequest(deps: BossDeps, input: OrderRequestInput): Promise<OrderReply & { costCents: number }> {
  const chatId = input.chat?.chatId ?? null;
  try {
    await sweepStaleOrderConfirmations(deps).catch(() => 0);
    // « dis à l'agent X de … » : l'agent de l'annuaire et ses seules capacités (chaîne Kevin → Grand Chef → Chef).
    const target = agentTargetOf(input.text);
    const agent = target && "agent" in target ? target : null;
    if (agent && !agent.capabilities.length) {
      await recordOrderUnmet(deps, { text: input.text, part: `consigne à l'agent ${agent.agent.label}`, teamKey: agent.agent.teams[0] ?? null }).catch(() => undefined);
      return {
        reply: esc(
          pick(
            ORDER_REQUEST_VARIANTS.agentNoCap({ agent: agent.agent.label, role: `${agent.agent.role.charAt(0).toLowerCase()}${agent.agent.role.slice(1)}` }),
            "order.agent.nocap",
            chatId,
          ),
        ),
        status: "unmet",
        costCents: 0,
      };
    }
    const hint = [
      input.hints?.equipe ? `équipe : ${input.hints.equipe}` : null,
      input.hints?.canal ? `canal : ${input.hints.canal}` : null,
      agent ? agentHint(agent) : null,
    ]
      .filter(Boolean)
      .join(", ");
    const planned = await planOrder(deps, {
      text: input.text,
      hints: hint || null,
      memory: input.memory ?? null,
      chat: input.chat ?? null,
      speaker: input.speaker ?? null,
    });
    if (!planned.ok) {
      const variants = planned.reason === "budget" ? ORDER_BUDGET_REPLY : planned.reason === "no_ai" ? ORDER_NO_AI_REPLY : ORDER_INVALID_REPLY;
      return { reply: esc(pick(variants, `order.fail.${planned.reason}`, chatId)), status: planned.reason === "budget" || planned.reason === "no_ai" ? "error" : "clarify", costCents: planned.costCents };
    }
    const validated = await validatePlan(deps, agent ? restrictPlanToAgent(planned.plan, agent) : planned.plan);
    const r = await submitOrder(deps, validated, {
      requestText: input.text,
      actor: input.actor,
      speaker: input.speaker,
      chat: input.chat,
      plannerCostCents: planned.costCents,
      cacheKey: planned.cacheKey,
      raw: planned.plan,
    });
    return { ...r, costCents: planned.costCents };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[orders] demande en échec");
    return { reply: esc(pick(ORDER_INVALID_REPLY, "order.fail.error", chatId)), status: "error", costCents: 0 };
  }
}
