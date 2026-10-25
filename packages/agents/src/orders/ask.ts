/**
 * Phase 33 (relecture, R1 n°15) — question à une équipe (« demande à l'équipe Paris pourquoi il n'y a pas eu de pari
 * hier ») : Kevin ne touche JAMAIS une capacité lui-même. `askTeam` est le chemin du Grand Chef pour une question,
 * en LECTURE SEULE : il retrouve la capacité « question » de l'équipe dans le registre (`ports.ts`, seul point de
 * passage vers le chantier A), la planifie en simulation, la fait exécuter par le Chef de l'équipe (`cap.run`) et
 * rend les lignes et les faits du Chef. L'ordre `ASK` est journalisé (`TeamOrder`), puis clos (DONE). Rien n'est
 * publié, aucune dépense fournisseur, aucun réglage changé.
 */
import { nowOf } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import type { AgentsDeps } from "../types";
import type { OrderRow } from "./contract";
import type { TeamOrderRow } from "./current";
import { capability } from "./ports";

export type AskTeamResult =
  | { ok: true; orderId: string; lines: string[]; facts: Record<string, unknown> }
  | { ok: false; reason: "no_capability" | "bad_params"; error?: string };

/** Question à une équipe, lue par le Grand Chef et répondue par le Chef (lecture seule). Ne lève pas sur une panne du Chef. */
export async function askTeam(
  deps: AgentsDeps,
  teamKey: string,
  question: string,
  ctx: { actor: Pick<ActorRef, "userId"> | null; chatId?: bigint | string | null; teamLabel: string },
): Promise<AskTeamResult> {
  const cap = capability(teamKey, "question");
  if (!cap) return { ok: false, reason: "no_capability" };
  const props = Object.keys(((cap.params as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>);
  // Clé du schéma de la capacité (`sujet` dans le registre).
  const qKey = props.find((k) => /sujet|question|demande|texte/i.test(k)) ?? "sujet";
  const parsed = cap.parse({ [qKey]: question });
  if (!parsed.ok) return { ok: false, reason: "bad_params", error: parsed.error };
  const now = nowOf(deps);
  const steps = await cap.plan(deps, parsed.params, { now, mode: "simulation", period: null });
  const order = (await deps.prisma.teamOrder.create({
    data: {
      requestText: question.slice(0, 2000),
      interpretation: JSON.parse(
        JSON.stringify({ teamKey, scope: { teamWide: true }, kind: "ASK", mode: "simulation", steps: [{ teamKey, capability: "question", params: parsed.params }], resolved: {}, questions: [], impossible: [], plannedSteps: steps }),
      ) as never,
      recap: `Question à l'équipe ${ctx.teamLabel}`,
      kind: "ASK",
      teamKey,
      status: "RUNNING",
      createdById: ctx.actor?.userId ?? null,
      chatId: ctx.chatId != null ? String(ctx.chatId) : null,
    },
  })) as unknown as TeamOrderRow;
  const row: OrderRow = { ...order, kind: "ASK" } as OrderRow;
  let lines: string[] = [];
  let facts: Record<string, unknown> = {};
  try {
    const results = await Promise.all(steps.map((s) => cap.run(deps, row, s)));
    lines = results.flatMap((r) => r.message.split("\n")).map((l) => l.trim()).filter(Boolean);
    facts = (await cap.report(deps, row)) as Record<string, unknown>;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[orders] question à l'équipe en échec");
  }
  await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "DONE" } });
  return { ok: true, orderId: order.id, lines, facts };
}
